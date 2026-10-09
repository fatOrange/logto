import {
  ConnectorType,
  GoogleConnector,
  isGoogleOneTap as isGoogleOneTapChecker,
  logtoGoogleOneTapCookieKey,
  type SocialConnector,
} from '@logto/connector-kit';
import {
  VerificationType,
  socialAuthorizationUrlPayloadGuard,
  socialVerificationCallbackPayloadGuard,
} from '@logto/schemas';
import { Action } from '@logto/schemas/lib/types/log/interaction.js';
import type Router from 'koa-router';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import {
  isQrCodeConnectorMetadata,
  verifySocialQrCodeSession,
} from '#src/libraries/verification-helpers/social-qr-code.js';
import koaGuard from '#src/middleware/koa-guard.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import assertThat from '#src/utils/assert-that.js';
import { type LogtoConnector } from '#src/utils/connectors/types.js';

import { SocialVerification } from '../classes/verifications/social-verification.js';
import { experienceRoutes } from '../const.js';
import koaExperienceVerificationsAuditLog from '../middleware/koa-experience-verifications-audit-log.js';
import { type ExperienceInteractionRouterContext } from '../types.js';

/**
 * The QR verify path requires the full social connector contract; a connector whose metadata
 * flags QR support is always a social connector (the flag lives on social connector metadata).
 */
const isSocialLogtoConnector = (
  connector: LogtoConnector
): connector is LogtoConnector<SocialConnector> => connector.type === ConnectorType.Social;

export default function socialVerificationRoutes<T extends ExperienceInteractionRouterContext>(
  router: Router<unknown, T>,
  tenantContext: TenantContext
) {
  const { libraries, queries } = tenantContext;

  router.post(
    `${experienceRoutes.verification}/social/:connectorId/authorization-uri`,
    koaGuard({
      params: z.object({
        connectorId: z.string(),
      }),
      body: socialAuthorizationUrlPayloadGuard.omit({
        // Custom scope parameter is currently only available for the my-account social verification API
        scope: true,
      }),
      response: z.object({
        authorizationUri: z.string(),
        verificationId: z.string(),
      }),
      status: [200, 400, 404, 500, 501],
    }),
    koaExperienceVerificationsAuditLog({
      type: VerificationType.Social,
      action: Action.Create,
    }),
    async (ctx, next) => {
      const { connectorId } = ctx.guard.params;
      const { verificationAuditLog } = ctx;

      verificationAuditLog.append({
        payload: {
          connectorId,
          ...ctx.guard.body,
        },
      });

      const socialVerification = SocialVerification.create(libraries, queries, connectorId);

      const connector = await tenantContext.libraries.socials.getConnector(connectorId);

      // QR code sign-in has no redirect flow: reject explicitly with the connector's own error
      // semantics (mapped to 501 through the connector error handler) instead of fabricating an
      // authorization URI. The connector's `getAuthorizationUri` throws
      // `ConnectorErrorCodes.NotImplemented`.
      assertThat(
        !isQrCodeConnectorMetadata(connector.metadata),
        new RequestError({ code: 'connector.not_implemented', status: 501 })
      );

      const authorizationUri = await socialVerification.createAuthorizationUrl(
        ctx,
        tenantContext,
        ctx.guard.body
      );

      ctx.experienceInteraction.setVerificationRecord(socialVerification);

      await ctx.experienceInteraction.save();

      ctx.body = {
        authorizationUri,
        verificationId: socialVerification.id,
      };

      return next();
    }
  );

  router.post(
    `${experienceRoutes.verification}/social/:connectorId/verify`,
    koaGuard({
      params: z.object({
        connectorId: z.string(),
      }),
      body: socialVerificationCallbackPayloadGuard,
      response: z.object({
        verificationId: z.string(),
      }),
      status: [200, 400, 404, 422],
    }),
    koaExperienceVerificationsAuditLog({
      type: VerificationType.Social,
      action: Action.Submit,
    }),
    async (ctx, next) => {
      const { connectorId } = ctx.guard.params;
      const { connectorData, verificationId } = ctx.guard.body;
      const { verificationAuditLog } = ctx;
      const {
        socials: { getConnector },
      } = libraries;

      verificationAuditLog.append({
        payload: {
          connectorId,
          verificationId,
          connectorData,
        },
      });

      const connector = await getConnector(connectorId);

      const socialVerificationRecord = await (async () => {
        // Check if is Google one tap verification
        if (
          connector.metadata.id === GoogleConnector.factoryId &&
          isGoogleOneTapChecker(connectorData)
        ) {
          const socialVerificationRecord = SocialVerification.create(
            libraries,
            queries,
            connectorId
          );
          ctx.experienceInteraction.setVerificationRecord(socialVerificationRecord);
          return socialVerificationRecord;
        }

        // QR code session verification: consume the confirmed, browser-bound session atomically.
        // The QR-only connector rejects ordinary OAuth callback data, so its only valid verify
        // input is the owned `qrCodeSessionId`.
        if (isQrCodeConnectorMetadata(connector.metadata)) {
          assertThat(
            isSocialLogtoConnector(connector),
            new RequestError({ code: 'connector.unexpected_type', status: 422 })
          );

          return verifySocialQrCodeSession(ctx, tenantContext, {
            connector,
            verificationId,
            connectorData,
          });
        }

        if (verificationId) {
          return ctx.experienceInteraction.getVerificationRecordByTypeAndId(
            VerificationType.Social,
            verificationId
          );
        }

        // No verificationId provided and not Google one tap callback
        throw new RequestError({
          code: 'session.verification_session_not_found',
          status: 404,
        });
      })();

      assertThat(
        socialVerificationRecord.connectorId === connectorId,
        new RequestError({ code: 'session.verification_session_not_found', status: 404 })
      );

      // For QR code connectors the verification record is already verified by the consumed
      // session's core-owned user info inside `verifySocialQrCodeSession`; the ordinary OAuth
      // callback path is rejected there.
      if (!isQrCodeConnectorMetadata(connector.metadata)) {
        await socialVerificationRecord.verify(ctx, tenantContext, connectorData);
      }

      // Skip captcha for social verification, as it's already verified by the connector
      ctx.experienceInteraction.skipCaptcha();
      await ctx.experienceInteraction.save();

      // Clear the Google One Tap cookie to avoid the cookie being used in the next sign in.
      ctx.cookies.set(logtoGoogleOneTapCookieKey, '', {
        httpOnly: false,
        expires: new Date(0),
      });

      // The input verificationId may be undefined if it's a Google one tap callback
      ctx.body = {
        verificationId: socialVerificationRecord.id,
      };

      return next();
    }
  );
}
