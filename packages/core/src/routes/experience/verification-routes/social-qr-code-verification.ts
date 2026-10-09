import { VerificationType } from '@logto/schemas';
import { Action } from '@logto/schemas/lib/types/log/interaction.js';
import type Router from 'koa-router';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import {
  assertQrCodeConnector,
  createQrCodeDataUri,
  generateSocialQrCodeScene,
  socialQrCodeSessionTtl,
} from '#src/libraries/verification-helpers/social-qr-code.js';
import koaGuard from '#src/middleware/koa-guard.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import assertThat from '#src/utils/assert-that.js';

import { SocialVerification } from '../classes/verifications/social-verification.js';
import { experienceRoutes } from '../const.js';
import koaExperienceVerificationsAuditLog from '../middleware/koa-experience-verifications-audit-log.js';
import { type ExperienceInteractionRouterContext } from '../types.js';

const qrCodeStatusGuard = z.enum(['pending', 'confirmed', 'expired']);

export default function socialQrCodeVerificationRoutes<
  T extends ExperienceInteractionRouterContext,
>(router: Router<unknown, T>, tenantContext: TenantContext) {
  const { queries } = tenantContext;
  const { socialQrCodeSessions } = queries;

  router.post(
    `${experienceRoutes.verification}/social/:connectorId/qr-code`,
    koaGuard({
      params: z.object({ connectorId: z.string() }),
      body: z.object({}).catchall(z.never()).optional(),
      response: z.object({
        verificationId: z.string(),
        qrCode: z.string(),
        expiresAt: z.number().int(),
      }),
      status: [200, 400, 404, 422, 500],
    }),
    koaExperienceVerificationsAuditLog({
      type: VerificationType.Social,
      action: Action.Create,
    }),
    async (ctx, next) => {
      const { connectorId } = ctx.guard.params;
      const { verificationAuditLog } = ctx;
      const interactionId = ctx.interactionDetails.jti;

      const connector = await tenantContext.libraries.socials.getConnector(connectorId);
      assertQrCodeConnector(connector);

      // Opportunistic cleanup: piggyback expired-session deletion on initiation (no timer).
      await socialQrCodeSessions.deleteExpiredSessions();

      // Persist the browser-bound verification record FIRST (before the outbound WeChat call),
      // and atomically replace any prior session of this interaction+connector pair: a refresh
      // leaves no stale QR code behind, and concurrent creates serialize on the unique
      // (tenant_id, connector_id, interaction_id) constraint.
      const socialVerification = SocialVerification.create(
        tenantContext.libraries,
        queries,
        connectorId
      );

      const session = await socialQrCodeSessions.upsertSession({
        id: socialVerification.id,
        connectorId,
        interactionId,
        scene: generateSocialQrCodeScene(),
        expiresAt: Date.now() + socialQrCodeSessionTtl,
      });

      ctx.experienceInteraction.setVerificationRecord(socialVerification);
      await ctx.experienceInteraction.save();

      // Outbound WeChat call happens AFTER the row is durable; no DB lock is held across it.
      const qrCode = await createQrCodeDataUri(connector, session.scene);

      // The row may have been replaced by a newer create (or cancelled) while the upstream call
      // was in flight; a superseded request must never fail a newer session's state.
      const currentSession = await socialQrCodeSessions.findSessionById(session.id);

      if (!currentSession || currentSession.scene !== session.scene) {
        // This request was superseded (a newer create re-used the unique slot) or cancelled
        // (deleteSessionByIdAndInteractionId removed the row). The session row no longer backs
        // this request; fail the stale request WITHOUT touching newer state. The interaction
        // record of the stale request is inert: verification is gated on the consumed session
        // (which the stale request no longer owns), so it can never mark a sign-in verified.
        throw new RequestError({ code: 'session.interaction_not_found', status: 400 });
      }

      verificationAuditLog.append({
        payload: {
          connectorId,
          verificationId: socialVerification.id,
          expiresAt: session.expiresAt,
        },
      });

      ctx.body = {
        verificationId: socialVerification.id,
        qrCode,
        // The authoritative expiry is the DB row's, not a second clock read.
        expiresAt: session.expiresAt,
      };

      return next();
    }
  );

  router.get(
    `${experienceRoutes.verification}/social/:connectorId/qr-code/:verificationId`,
    koaGuard({
      params: z.object({ connectorId: z.string(), verificationId: z.string() }),
      response: z.object({
        status: qrCodeStatusGuard,
      }),
      status: [200, 400, 404, 422],
    }),
    async (ctx, next) => {
      const { connectorId, verificationId } = ctx.guard.params;
      const { experienceInteraction } = ctx;

      // Dev + capability gate: a QR session of a disabled connector is not pollable.
      const connector = await tenantContext.libraries.socials.getConnector(connectorId);
      assertQrCodeConnector(connector);

      // Ownership checks first: the verification record must belong to the current interaction
      // and match the connector.
      const socialVerificationRecord = experienceInteraction.getVerificationRecordByTypeAndId(
        VerificationType.Social,
        verificationId
      );

      assertThat(
        socialVerificationRecord.connectorId === connectorId,
        new RequestError({ code: 'session.verification_session_not_found', status: 404 })
      );

      const session = await socialQrCodeSessions.findSessionById(verificationId);

      const status = (() => {
        // Missing (never existed), cancelled, or replaced rows: the session is over.
        if (
          !session ||
          session.connectorId !== connectorId ||
          session.interactionId !== ctx.interactionDetails.jti
        ) {
          return 'expired' as const;
        }

        // Confirmed only while unexpired and not yet consumed.
        if (session.consumedAt === null && session.expiresAt > Date.now()) {
          return session.userInfo ? ('confirmed' as const) : ('pending' as const);
        }

        return 'expired' as const;
      })();

      ctx.body = { status };

      return next();
    }
  );

  router.delete(
    `${experienceRoutes.verification}/social/:connectorId/qr-code/:verificationId`,
    koaGuard({
      params: z.object({ connectorId: z.string(), verificationId: z.string() }),
      status: [204, 400, 404, 422],
    }),
    async (ctx, next) => {
      const { connectorId, verificationId } = ctx.guard.params;

      // Dev + capability gate: a QR session of a disabled connector is not cancellable.
      const connector = await tenantContext.libraries.socials.getConnector(connectorId);
      assertQrCodeConnector(connector);

      const socialVerificationRecord = ctx.experienceInteraction.getVerificationRecordByTypeAndId(
        VerificationType.Social,
        verificationId
      );

      assertThat(
        socialVerificationRecord.connectorId === connectorId,
        new RequestError({ code: 'session.verification_session_not_found', status: 404 })
      );

      // Owner-only invalidation: the session row must be bound to the current interaction.
      await socialQrCodeSessions.deleteSessionByIdAndInteractionId(
        verificationId,
        ctx.interactionDetails.jti
      );

      ctx.status = 204;

      return next();
    }
  );
}
