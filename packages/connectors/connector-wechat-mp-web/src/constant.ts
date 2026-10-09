import type { ConnectorMetadata } from '@logto/connector-kit';
import { ConnectorConfigFormItemType, ConnectorPlatform } from '@logto/connector-kit';

/**
 * Endpoint for creating a parameterized QR code ticket.
 *
 * @see {@link https://developers.weixin.qq.com/doc/offiaccount/Account_Management/Generating_a_Parametric_QR_Code.html | 获取带参数的二维码}
 */
export const qrCodeCreateEndpoint = 'https://api.weixin.qq.com/cgi-bin/qrcode/create';

/**
 * Endpoint for the stable interface call credential (stable access token).
 *
 * Unlike the legacy `GET /cgi-bin/token` endpoint, the stable token endpoint does not
 * invalidate the previously issued token when a new one is requested with
 * `force_refresh: false`, which makes per-replica local caches safe.
 *
 * @see {@link https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/getStableAccessToken.html | getStableAccessToken}
 */
export const stableAccessTokenEndpoint = 'https://api.weixin.qq.com/cgi-bin/stable_token';

/**
 * The WeChat server URL validation (challenge) is performed with the same signature
 * algorithm in both plain and safe mode:
 * `signature = sha1(sort(token, timestamp, nonce).join(''))`.
 *
 * @see {@link https://developers.weixin.qq.com/doc/service/guide/dev/push/ | 消息与事件推送介绍}
 */
export const echostr = 'echostr';
export const signature = 'signature';
export const timestamp = 'timestamp';
export const nonce = 'nonce';
export const messageSignature = 'msg_signature';

/** Prefix of the `EventKey` value in `subscribe` events triggered by scanning a parameterized QR code. */
export const qrScenePrefix = 'qrscene_';

/**
 * Margin subtracted from the token `expires_in` when caching, to prevent the use of a
 * token that expires mid-request.
 */
export const accessTokenTtlMarginInSeconds = 300;

export const defaultTimeout = 5000;

/**
 * Maximum accepted callback payload size in bytes. Requests with larger bodies are
 * rejected before signature validation.
 */
export const maxCallbackBodyLength = 64 * 1024;

export const encryptionMode = Object.freeze({
  plain: 'plain',
  safe: 'safe',
} as const);

/**
 * The callback `Token` configured in the WeChat official account server settings. It is
 * used for signature verification and is distinct from the account `appSecret`.
 */
export const defaultMetadata: ConnectorMetadata = {
  id: 'wechat-mp-web',
  target: 'wechat-mp',
  platform: ConnectorPlatform.Web,
  isQrCodeSupported: true,
  name: {
    en: 'WeChat (MP)',
    'zh-CN': '微信（服务号）',
  },
  logo: './logo.svg',
  logoDark: null,
  description: {
    en: 'WeChat service account QR code sign-in for web apps. Users scan a QR code with WeChat to sign in.',
    'zh-CN': '适用于网页应用的微信服务号扫码登录。用户使用微信扫描二维码完成登录。',
  },
  readme: './README.md',
  formItems: [
    {
      key: 'appId',
      label: 'App ID',
      required: true,
      type: ConnectorConfigFormItemType.Text,
      placeholder: '<app-id>',
    },
    {
      key: 'appSecret',
      label: 'App Secret',
      required: true,
      type: ConnectorConfigFormItemType.Text,
      isConfidential: true,
      placeholder: '<app-secret>',
    },
    {
      key: 'token',
      label: 'Token',
      required: true,
      type: ConnectorConfigFormItemType.Text,
      placeholder: '<callback-token>',
      description:
        'The callback token configured in the WeChat official account server settings (设置与开发 → 基本配置 → 服务器配置). It is used to verify message signatures and is NOT the app secret.',
    },
    {
      key: 'encryptionMode',
      label: 'Encryption mode',
      required: true,
      type: ConnectorConfigFormItemType.Select,
      selectItems: [
        { value: encryptionMode.safe, title: 'Safe (recommended)' },
        { value: encryptionMode.plain, title: 'Plain' },
      ],
      defaultValue: encryptionMode.safe,
      description:
        'The message encryption mode configured in the WeChat official account server settings. Must match the configured mode exactly. Safe mode encrypts all pushed messages.',
    },
    {
      key: 'encodingAESKey',
      label: 'Encoding AES Key',
      required: false,
      type: ConnectorConfigFormItemType.Text,
      isConfidential: true,
      placeholder: '<encoding-aes-key>',
      showConditions: [{ targetKey: 'encryptionMode', expectValue: encryptionMode.safe }],
      description:
        'The message encryption key configured in the WeChat official account server settings. Required in safe mode.',
    },
  ],
};
