import { z } from 'zod';

import { ConnectorError, ConnectorErrorCodes, socialUserInfoGuard } from '@logto/connector-kit';

import { encryptionMode } from './constant.js';

export const wechatMpConfigGuard = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  /** The callback token from the WeChat server settings. Distinct from `appSecret`. */
  token: z.string().min(1),
  encryptionMode: z.enum([encryptionMode.plain, encryptionMode.safe]),
  /** Required if and only if `encryptionMode` is `safe`. */
  encodingAESKey: z.string().optional(),
});

export type WechatMpConfig = {
  appId: string;
  appSecret: string;
  /** The callback token from the WeChat server settings. Distinct from `appSecret`. */
  token: string;
  encryptionMode: typeof encryptionMode.plain | typeof encryptionMode.safe;
  /** Required if and only if `encryptionMode` is `safe`. */
  encodingAESKey?: string;
};

/**
 * Validates the safe-mode prerequisites of an already-parsed config. Kept out of the
 * guard because `configGuard` must remain a plain `z.object` (the connector-kit
 * `BaseConnector` contract), while this rule is cross-field.
 *
 * @throws {ConnectorError} when safe mode is configured without a well-formed
 * `encodingAESKey` (a 43-character alphanumeric string; appending `=` yields the 32-byte
 * AES key).
 */
export const assertSafeModeConfig = (config: WechatMpConfig): void => {
  if (config.encryptionMode !== encryptionMode.safe) {
    return;
  }

  if (!config.encodingAESKey || !/^[\dA-Za-z]{43}$/.test(config.encodingAESKey)) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidConfig, {
      message:
        '`encodingAESKey` is required in safe encryption mode and must be a 43-character alphanumeric string.',
    });
  }
};

export const stableAccessTokenResponseGuard = z.object({
  access_token: z.string().optional(),
  expires_in: z.number().optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
});

export type StableAccessTokenResponse = z.infer<typeof stableAccessTokenResponseGuard>;

export const qrCodeCreateResponseGuard = z.object({
  ticket: z.string().optional(),
  /** QR code content URL. Expired QR codes return this value too. */
  url: z.string().optional(),
  expire_seconds: z.number().optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
});

export type QrCodeCreateResponse = z.infer<typeof qrCodeCreateResponseGuard>;

/**
 * Guard for the core-owned QR code user info injected into `getUserInfo` after the QR
 * code session has been confirmed and consumed. `qrCodeUserInfo` is a full
 * `SocialUserInfo` (identity id `${appId}:${openid}`), persisted by core from the
 * verified callback event; browser-supplied values never reach the connector.
 */
export const qrCodeSessionDataGuard = z.object({
  qrCodeUserInfo: socialUserInfoGuard,
});
