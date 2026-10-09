import {
  ConnectorError,
  ConnectorErrorCodes,
  ConnectorType,
  socialUserInfoGuard,
  type SocialConnector,
  type SocialUserInfo,
} from '@logto/connector-kit';
import { VerificationType, type JsonObject } from '@logto/schemas';
import { generateStandardSecret } from '@logto/shared';
import qrcode from 'qrcode';
import { z } from 'zod';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import type { LogEntry } from '#src/middleware/koa-audit-log.js';
import { type WithInteractionDetailsContext } from '#src/middleware/koa-interaction-details.js';
import { type WithExperienceInteractionContext } from '#src/routes/experience/middleware/koa-experience-interaction.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import assertThat from '#src/utils/assert-that.js';
import { type LogtoConnector } from '#src/utils/connectors/types.js';

/** The audit-log mixin of the experience verification routes (`verificationAuditLog`). */
type WithVerificationAuditLog = { verificationAuditLog: LogEntry };

/** The lifetime of a social QR code session (5 minutes). */
export const socialQrCodeSessionTtl = 5 * 60 * 1000;

/** The prefix for WeChat QR scene strings; the remainder is a 32-char high-entropy secret. */
const socialQrCodeScenePrefix = 'qr_';

/** The connector data shape accepted by the QR-only verify path. */
const qrCodeVerifyConnectorDataGuard = z.object({
  qrCodeSessionId: z.string().min(1),
});

/**
 * Whether the connector is a QR code capable social connector (capability metadata set). This is a
 * metadata-only check and does not assert the dev feature gate; combine with
 * {@linkcode assertQrCodeConnector} where an operation must be dev-gated.
 */
export const isQrCodeConnectorMetadata = (metadata: LogtoConnector['metadata']) =>
  metadata.isQrCodeSupported === true;

/**
 * Generate a unique, high-entropy WeChat QR scene string for a QR session. Well within the
 * 64-character WeChat scene limit, and never guessable from the interaction or verification ID.
 */
export const generateSocialQrCodeScene = () =>
  `${socialQrCodeScenePrefix}${generateStandardSecret()}`;

/**
 * Assert that the dev feature flag is enabled for QR code operations.
 *
 * @throws {RequestError} with 422 `request.feature_not_supported` when dev features are disabled.
 */
const assertThatQrCodeDevFeatureEnabled = () => {
  assertThat(
    EnvSet.values.isDevFeaturesEnabled,
    new RequestError({ code: 'request.feature_not_supported', status: 422 })
  );
};

/** A social connector proven to have the QR code capability (both QR methods required). */
export type QrCodeCapableConnector = LogtoConnector<SocialConnector> &
  Required<Pick<SocialConnector, 'createQrCode' | 'handleQrCodeCallback'>>;

/**
 * Assert that the given connector is a social connector with the QR code capability and that the
 * dev feature flag is enabled. All QR session operations and the public callback route share this
 * gate, so a QR-only connector is fully inert (no initiation, no polling, no callback handling)
 * when dev features are disabled or the connector lacks the QR methods.
 *
 * Narrows the connector to {@linkcode QrCodeCapableConnector}, so callers can invoke
 * `createQrCode`/`handleQrCodeCallback` without further checks.
 */
export function assertQrCodeConnector(
  connector: LogtoConnector
): asserts connector is QrCodeCapableConnector {
  assertThatQrCodeDevFeatureEnabled();
  assertThat(
    connector.type === ConnectorType.Social,
    new RequestError({ code: 'session.invalid_connector_id', status: 422 })
  );
  assertThat(
    connector.metadata.isQrCodeSupported === true &&
      typeof connector.createQrCode === 'function' &&
      typeof connector.handleQrCodeCallback === 'function',
    new RequestError({ code: 'connector.unexpected_type', status: 422 })
  );
}

/**
 * Render the connector's QR content URL as a PNG data URI for inline display in the sign-in
 * experience. The WeChat QR content URL itself never leaves the server.
 *
 * @param connector The social connector with the `createQrCode` capability (method required).
 * @param scene The QR session's scene string.
 * @returns The QR code image as a PNG data URI.
 */
export const createQrCodeDataUri = async (
  connector: Omit<LogtoConnector<SocialConnector>, 'createQrCode'> & {
    createQrCode: (scene: string, expiresIn: number) => Promise<string>;
  },
  scene: string
) => {
  try {
    // The TTL is owned by the session row; the connector only needs the seconds for WeChat's
    // `expire_seconds` parameter.
    return await qrcode.toDataURL(
      await connector.createQrCode(scene, socialQrCodeSessionTtl / 1000)
    );
  } catch (error: unknown) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
      message: 'Failed to create or render the QR code.',
      cause: error instanceof Error ? error.message : error,
    });
  }
};

/** The result of handling a WeChat QR code callback event (connector contract). */
export type SocialQrCodeCallbackResult = {
  response: string;
  scene?: string;
  userInfo?: SocialUserInfo;
};

/**
 * Verify a social sign-in through a confirmed QR code session (experience API verify path).
 *
 * The caller has already looked up the connector; this helper:
 *
 * 1. Enforces the dev feature gate and the QR capability for the connector.
 * 2. Requires the verify payload to carry `connectorData.qrCodeSessionId` equal to the
 *    verification ID — ordinary OAuth callback data is rejected, so a browser can never smuggle
 *    its own openid/user info through this endpoint for a QR-only connector.
 * 3. Atomically consumes the session row (one-time use) owned by the current interaction and
 *    verification record; replayed, foreign-browser, cancelled, unconfirmed, or expired sessions
 *    all fail here.
 * 4. Feeds the core-owned user info captured at scan time to the connector's
 *    `getUserInfo(_data, getSession)` through the internal `getSession` callback (never through
 *    browser input), so the connector's current-config validation (e.g. the AppID prefix check)
 *    runs before the record is marked verified.
 *
 * @returns The verified verification record.
 */
export const verifySocialQrCodeSession = async (
  ctx: WithExperienceInteractionContext & WithInteractionDetailsContext & WithVerificationAuditLog,
  tenantContext: TenantContext,
  {
    connector,
    verificationId,
    connectorData,
  }: {
    connector: LogtoConnector;
    verificationId: string | undefined;
    connectorData: JsonObject;
  }
) => {
  assertQrCodeConnector(connector);

  const { experienceInteraction, verificationAuditLog } = ctx;

  // The verification record must be pre-created by the QR initiation endpoint and owned by the
  // current interaction.
  assertThat(
    verificationId,
    new RequestError({ code: 'session.verification_session_not_found', status: 404 })
  );

  const socialVerificationRecord = experienceInteraction.getVerificationRecordByTypeAndId(
    VerificationType.Social,
    verificationId
  );

  assertThat(
    socialVerificationRecord.connectorId === connector.dbEntry.id,
    new RequestError({ code: 'session.verification_session_not_found', status: 404 })
  );

  // Ordinary OAuth callback shapes are rejected for QR-only connectors: only the owned session id
  // is a valid verify input.
  const parsedConnectorData = qrCodeVerifyConnectorDataGuard.safeParse(connectorData);

  if (!parsedConnectorData.success) {
    throw new RequestError({ code: 'session.invalid_connector_id', status: 400 });
  }

  assertThat(
    parsedConnectorData.data.qrCodeSessionId === verificationId,
    new RequestError({ code: 'session.invalid_connector_id', status: 400 })
  );

  // Atomic one-time consumption; tenant scoping is enforced by RLS, and the connector/interaction
  // binding is enforced by the query itself.
  const consumedSession =
    await tenantContext.queries.socialQrCodeSessions.consumeConfirmedSessionById(
      verificationId,
      connector.dbEntry.id,
      ctx.interactionDetails.jti
    );

  if (!consumedSession?.userInfo) {
    throw new RequestError({ code: 'session.verification_failed', status: 400 });
  }

  const parsedStoredUserInfo = socialUserInfoGuard.safeParse(consumedSession.userInfo);

  if (!parsedStoredUserInfo.success) {
    throw new RequestError({ code: 'session.verification_failed', status: 400 });
  }

  // Hand the core-owned user info to the connector through the internal session (never through
  // browser-supplied connectorData) so the connector validates it against its CURRENT config
  // (e.g. `${appId}:` id prefix) before we trust it.
  const userInfo = await connector.getUserInfo({}, async () => ({
    qrCodeUserInfo: parsedStoredUserInfo.data,
  }));

  // Mark the record verified with the connector-validated, core-owned user info; the internal
  // connector session result exposes the same value to any later connector call.
  // Intended: mutating the owned verification record in place (the class itself mutates these
  // fields the same way in `verify`); no functional API exists for a bulk replace.
  // eslint-disable-next-line @silverhand/fp/no-mutation
  socialVerificationRecord.socialUserInfo = userInfo;
  // eslint-disable-next-line @silverhand/fp/no-mutation
  socialVerificationRecord.connectorSession = { qrCodeUserInfo: userInfo };

  verificationAuditLog.append({
    payload: {
      connectorId: connector.dbEntry.id,
      verificationId,
      qrCodeSessionId: parsedConnectorData.data.qrCodeSessionId,
    },
  });

  return socialVerificationRecord;
};
