/**
 * The implementation of WeChat Official Account (service account, 服务号) QR code
 * sign-in for web apps.
 *
 * Users scan a parameterized QR code (created via `POST /cgi-bin/qrcode/create`) with
 * WeChat; the resulting `SCAN` or `subscribe` event is pushed to Logto's callback URL,
 * where the scene value is matched against a pending sign-in session.
 *
 * @see {@link https://developers.weixin.qq.com/doc/offiaccount/Account_Management/Generating_a_Parametric_QR_Code.html | 获取带参数的二维码}
 * @see {@link https://developers.weixin.qq.com/doc/service/guide/dev/push/ | 消息与事件推送介绍}
 */

import { got } from 'got';

import type {
  CreateConnector,
  CreateQrCode,
  GetConnectorConfig,
  GetUserInfo,
  HandleQrCodeCallback,
  QrCodeCallbackResult,
  SocialConnector,
  SocialUserInfo,
} from '@logto/connector-kit';
import {
  ConnectorError,
  ConnectorErrorCodes,
  ConnectorType,
  jsonGuard,
  socialUserInfoGuard,
  validateConfig,
} from '@logto/connector-kit';

import {
  defaultMetadata,
  defaultTimeout,
  echostr,
  encryptionMode,
  maxCallbackBodyLength,
  messageSignature,
  nonce,
  qrCodeCreateEndpoint,
  qrScenePrefix,
  signature,
  timestamp,
} from './constant.js';
import {
  decryptWechatMessage,
  deriveAesKey,
  parseDecryptedMessage,
  verifySignature,
} from './crypto.js';
import {
  getStableAccessToken,
  invalidateStableAccessToken,
  invalidTokenErrcodes,
} from './token-cache.js';
import type { QrCodeCreateResponse, WechatMpConfig } from './types.js';
import {
  assertSafeModeConfig,
  qrCodeCreateResponseGuard,
  qrCodeSessionDataGuard,
  wechatMpConfigGuard,
} from './types.js';
import { parseWechatCallbackXml } from './xml.js';

const createQrCode =
  (getConfig: GetConnectorConfig): CreateQrCode =>
  async (scene, expiresIn) => {
    if (!scene) {
      throw new ConnectorError(ConnectorErrorCodes.InsufficientRequestParameters, {
        message: 'QR code scene value is required.',
      });
    }

    if (scene.length > 64) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
        message: 'QR code scene value must be at most 64 characters.',
      });
    }

    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, wechatMpConfigGuard);
    assertSafeModeConfig(config);

    const requestQrCode = async (token: string): Promise<QrCodeCreateResponse> => {
      const httpResponse = await got
        .post(qrCodeCreateEndpoint, {
          searchParams: { access_token: token },
          json: {
            expire_seconds: expiresIn,
            action_name: 'QR_STR_SCENE',
            action_info: { scene: { scene_str: scene } },
          },
          timeout: { request: defaultTimeout },
        })
        .catch((error: unknown) => {
          throw new ConnectorError(ConnectorErrorCodes.General, {
            message: 'Failed to create the WeChat QR code.',
            detail: String(error),
          });
        });

      const qrCodeResponse: unknown = (() => {
        try {
          const parsed: unknown = JSON.parse(httpResponse.body);

          return parsed;
        } catch {
          throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
            message: 'WeChat QR code response is not valid JSON.',
            detail: httpResponse.body,
          });
        }
      })();

      const result = qrCodeCreateResponseGuard.safeParse(qrCodeResponse);

      if (!result.success) {
        throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, result.error);
      }

      return result.data;
    };

    // Only documented invalid-token responses trigger a cache invalidation and exactly
    // one retry; all other failures propagate. The retry goes through the single-flight
    // getter so concurrent callers share one fresh fetch.
    const response = await (async () => {
      const firstResponse = await requestQrCode(await getStableAccessToken(config));

      if (!firstResponse.errcode || !invalidTokenErrcodes.includes(firstResponse.errcode)) {
        return firstResponse;
      }

      invalidateStableAccessToken(config);

      return requestQrCode(await getStableAccessToken(config));
    })();

    if (!response.url) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
        message: 'WeChat QR code response does not contain a `url`.',
        detail: response,
      });
    }

    return response.url;
  };

const requiredString = (query: Record<string, unknown>, key: string): string => {
  const value = query[key];

  if (typeof value !== 'string' || value.length === 0) {
    throw new ConnectorError(ConnectorErrorCodes.InsufficientRequestParameters, {
      message: `Missing required query parameter \`${key}\`.`,
    });
  }

  return value;
};

/**
 * Handles the WeChat server URL validation challenge (GET).
 *
 * The same `sha1(sort(token, timestamp, nonce))` signature applies in both plain and safe
 * mode; the `echostr` is echoed back verbatim after a timing-safe signature check.
 */
const handleVerificationChallenge = async (
  query: Record<string, unknown>,
  config: WechatMpConfig
): Promise<string> => {
  const signatureValue = requiredString(query, signature);
  const timestampValue = requiredString(query, timestamp);
  const nonceValue = requiredString(query, nonce);
  const echostrValue = requiredString(query, echostr);

  if (!verifySignature(signatureValue, config.token, timestampValue, nonceValue)) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
      message: 'WeChat callback signature verification failed.',
    });
  }

  return echostrValue;
};

/** Extracts the scene value from a login-relevant event; `undefined` for other events. */
const getScanScene = (event: string, eventKey: string): string | undefined => {
  if (event === 'SCAN') {
    return eventKey || undefined;
  }

  if (event === 'subscribe' && eventKey.startsWith(qrScenePrefix)) {
    return eventKey.slice(qrScenePrefix.length) || undefined;
  }

  return undefined;
};

/**
 * Builds the authenticated social user info for a scan event. The identity is
 * `${appId}:${openid}`, namespaced under the independent `wechat-mp` target; no profile
 * enrichment (nickname/avatar) is performed.
 */
const buildScanUserInfo = (
  appId: string,
  openid: string,
  event: string,
  ticket: string | undefined
): SocialUserInfo => {
  const rawData = jsonGuard.parse(ticket ? { openid, event, ticket } : { openid, event });

  return socialUserInfoGuard.parse({ id: `${appId}:${openid}`, rawData });
};

const handleEventPost = (fields: Record<string, string>, appId: string): QrCodeCallbackResult => {
  const messageType = fields.MsgType;
  const event = fields.Event;

  if (messageType !== 'event' || !event) {
    // Non-event messages (text, image, etc.) are acknowledged without action.
    return { response: 'success' };
  }

  const scene = getScanScene(event, fields.EventKey ?? '');

  if (!scene) {
    // Login-irrelevant events (plain subscribe, unsubscribe, LOCATION, CLICK, VIEW, ...)
    // are acknowledged without action.
    return { response: 'success' };
  }

  const openid = fields.FromUserName;

  if (!openid) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
      message: 'WeChat scan event is missing `FromUserName`.',
    });
  }

  return {
    response: 'success',
    scene,
    userInfo: buildScanUserInfo(appId, openid, event, fields.Ticket),
  };
};

const handleEncryptedEventPost = async (
  fields: Record<string, string>,
  query: Record<string, unknown>,
  config: WechatMpConfig
): Promise<QrCodeCallbackResult> => {
  // Callers must only dispatch to this handler with a verified `<Encrypt>` field.
  const encryptValue = fields.Encrypt;

  if (encryptValue === undefined) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
      message: 'WeChat encrypted callback is missing the `Encrypt` field.',
    });
  }

  const messageSignatureValue = requiredString(query, messageSignature);
  const timestampValue = requiredString(query, timestamp);
  const nonceValue = requiredString(query, nonce);

  if (
    !verifySignature(messageSignatureValue, config.token, timestampValue, nonceValue, encryptValue)
  ) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
      message: 'WeChat callback message signature verification failed.',
    });
  }

  if (!config.encodingAESKey) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidConfig, {
      message: '`encodingAESKey` is required in safe encryption mode.',
    });
  }

  const aesKey = deriveAesKey(config.encodingAESKey);
  const decrypted = decryptWechatMessage(Buffer.from(encryptValue, 'base64'), aesKey);
  const { message } = parseDecryptedMessage(decrypted, config.appId);

  return handleEventPost(parseWechatCallbackXml(message), config.appId);
};

const handleQrCodeCallback =
  (getConfig: GetConnectorConfig): HandleQrCodeCallback =>
  async (query, body) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, wechatMpConfigGuard);
    assertSafeModeConfig(config);

    // GET: URL validation challenge.
    if (body === undefined) {
      return { response: await handleVerificationChallenge(query, config) };
    }

    if (body.length > maxCallbackBodyLength) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
        message: 'WeChat callback body exceeds the size limit.',
      });
    }

    const fields = parseWechatCallbackXml(body);
    const encrypted = typeof fields.Encrypt === 'string';

    // Enforce the configured encryption mode; reject downgrades and upgrades alike.
    if (config.encryptionMode === encryptionMode.safe && !encrypted) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
        message: 'Received a plaintext callback while safe encryption mode is configured.',
      });
    }

    if (config.encryptionMode === encryptionMode.plain && encrypted) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
        message: 'Received an encrypted callback while plain encryption mode is configured.',
      });
    }

    if (encrypted) {
      return handleEncryptedEventPost(fields, query, config);
    }

    // Plain mode: `signature` binds token/timestamp/nonce only.
    const signatureValue = requiredString(query, signature);
    const timestampValue = requiredString(query, timestamp);
    const nonceValue = requiredString(query, nonce);

    if (!verifySignature(signatureValue, config.token, timestampValue, nonceValue)) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
        message: 'WeChat callback signature verification failed.',
      });
    }

    return handleEventPost(fields, config.appId);
  };

/**
 * QR code sign-in has no redirect flow. Core must never call this method for this
 * connector; the explicit error keeps the standard connector contract intact.
 */
const getAuthorizationUri = async (): Promise<string> => {
  throw new ConnectorError(ConnectorErrorCodes.NotImplemented, {
    message: 'QR code sign-in does not use an authorization URI.',
  });
};

/**
 * Returns the QR code user info from the core-owned connector session.
 *
 * The user info is read exclusively from `getSession()`, which core populates only from
 * the server-side QR code session after atomically consuming a confirmed, browser-bound
 * scan. The `data` argument (browser-supplied connector data) is ignored entirely and
 * can never influence the result. The identity id (`${appId}:${openid}`) must carry the
 * *current* configured `appId` as prefix, so a session confirmed under a previously
 * configured service account cannot be consumed after the App ID changes.
 */
const getUserInfo =
  (getConfig: GetConnectorConfig): GetUserInfo =>
  async (_data, getSession) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, wechatMpConfigGuard);
    assertSafeModeConfig(config);

    const session = await getSession();
    const result = qrCodeSessionDataGuard.safeParse(session);

    if (!result.success) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
        message: 'Missing or invalid core-owned QR code session user info.',
      });
    }

    const { id } = result.data.qrCodeUserInfo;

    if (!id.startsWith(`${config.appId}:`)) {
      throw new ConnectorError(ConnectorErrorCodes.InvalidRequestParameters, {
        message: 'QR code session identity does not match the configured App ID.',
      });
    }

    return result.data.qrCodeUserInfo;
  };

const createWechatMpConnector: CreateConnector<SocialConnector> = async ({ getConfig }) => {
  return {
    metadata: defaultMetadata,
    type: ConnectorType.Social,
    configGuard: wechatMpConfigGuard,
    getAuthorizationUri,
    getUserInfo: getUserInfo(getConfig),
    createQrCode: createQrCode(getConfig),
    handleQrCodeCallback: handleQrCodeCallback(getConfig),
  };
};

export default createWechatMpConnector;
