/* eslint-disable max-lines -- Safe-mode encryption, signature and XML-parsing scenarios are kept in one integration suite. */
import nock from 'nock';
import { createCipheriv, createHash } from 'node:crypto';

import { ConnectorError, ConnectorErrorCodes } from '@logto/connector-kit';

import { encryptionMode, qrCodeCreateEndpoint, stableAccessTokenEndpoint } from './constant.js';
import { decryptWechatMessage, deriveAesKey, parseDecryptedMessage } from './crypto.js';
import createConnector from './index.js';
import { mockedConfig } from './mock.js';
import { getStableAccessToken, resetStableAccessTokenCache } from './token-cache.js';
import type { WechatMpConfig } from './types.js';
import { parseWechatCallbackXml } from './xml.js';

const getConfig = vi.fn().mockResolvedValue(mockedConfig);

/** Test-only mirror of the WeChat safe-mode encryption, used to build fixtures. */
const encryptWechatMessage = (plaintext: Uint8Array, aesKey: Uint8Array): Uint8Array => {
  const blockSize = 32;
  const paddingSize = blockSize - (plaintext.length % blockSize);
  const padding = Buffer.alloc(paddingSize, paddingSize);
  const cipher = createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));

  cipher.setAutoPadding(false);

  return Buffer.concat([cipher.update(Buffer.concat([plaintext, padding])), cipher.final()]);
};

beforeEach(() => {
  resetStableAccessTokenCache();
});

const sha1 = (value: string): string => createHash('sha1').update(value).digest('hex');

const sortAndJoin = (...values: string[]): string => {
  // `values` is a test-owned rest array freshly created for this call; sorting it in
  // place never mutates caller data.
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods
  return values.sort().join('');
};

const buildXml = (fields: Record<string, string>): string =>
  [
    '<xml>',
    ...Object.entries(fields).map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`),
    '</xml>',
  ].join('');

const buildEncryptedXml = (
  config: WechatMpConfig,
  innerXml: string
): { encryptedBody: string; encryptValue: string } => {
  const aesKey = deriveAesKey(config.encodingAESKey!);
  const random = Buffer.from('0123456789abcdef');
  const message = Buffer.from(innerXml, 'utf8');
  const length = Buffer.alloc(4);

  length.writeUInt32BE(message.length);

  const plaintext = Buffer.concat([random, length, message, Buffer.from(config.appId)]);
  const encryptValue = Buffer.from(encryptWechatMessage(plaintext, aesKey)).toString('base64');

  return {
    encryptValue,
    encryptedBody: buildXml({ Encrypt: encryptValue }),
  };
};

const signedQuery = (
  config: WechatMpConfig,
  fields: { timestamp: string; nonce: string; echostr?: string; encrypt?: string }
): Record<string, string> => ({
  timestamp: fields.timestamp,
  nonce: fields.nonce,
  ...(fields.encrypt === undefined
    ? { signature: sha1(sortAndJoin(config.token, fields.timestamp, fields.nonce)) }
    : {
        msg_signature: sha1(
          sortAndJoin(config.token, fields.timestamp, fields.nonce, fields.encrypt)
        ),
      }),
  ...(fields.echostr === undefined ? {} : { echostr: fields.echostr }),
});

const timestampValue = '1700000000';
const nonceValue = 'nonce-1';

describe('getAuthorizationUri', () => {
  it('rejects the redirect flow explicitly', async () => {
    const connector = await createConnector({ getConfig });

    await expect(connector.getAuthorizationUri({} as never, vi.fn())).rejects.toMatchObject({
      code: ConnectorErrorCodes.NotImplemented,
    });
  });
});

const stableTokenScope = (token = 'stable-token') =>
  nock(new URL(stableAccessTokenEndpoint).origin)
    .post(new URL(stableAccessTokenEndpoint).pathname)
    .reply(200, { access_token: token, expires_in: 7200 });

describe('createQrCode', () => {
  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  it('creates a QR code and returns the QR content URL', async () => {
    stableTokenScope();
    nock(new URL(qrCodeCreateEndpoint).origin)
      .post(new URL(qrCodeCreateEndpoint).pathname)
      .query({ access_token: 'stable-token' })
      .reply(200, {
        ticket: 'ticket',
        expire_seconds: 300,
        url: 'https://weixin.qq.com/q/abc123',
      });

    const connector = await createConnector({ getConfig });
    const url = await connector.createQrCode!('scene-1', 300);

    expect(url).toEqual('https://weixin.qq.com/q/abc123');
  });

  it('rejects a non-JSON QR code API response with InvalidResponse', async () => {
    stableTokenScope();
    nock(new URL(qrCodeCreateEndpoint).origin)
      .post(new URL(qrCodeCreateEndpoint).pathname)
      .query({ access_token: 'stable-token' })
      .reply(200, '<html>gateway timeout page</html>');

    const connector = await createConnector({ getConfig });

    await expect(connector.createQrCode!('scene-1', 300)).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidResponse,
    });
  });

  it('caches the stable token across QR creations', async () => {
    stableTokenScope();
    const qrScope = nock(new URL(qrCodeCreateEndpoint).origin)
      .post(new URL(qrCodeCreateEndpoint).pathname)
      .query({ access_token: 'stable-token' })
      .twice()
      .reply(200, { ticket: 't', url: 'https://weixin.qq.com/q/x' });

    const connector = await createConnector({ getConfig });

    await connector.createQrCode!('scene-1', 300);
    await connector.createQrCode!('scene-2', 300);

    expect(qrScope.isDone()).toBe(true);
  });

  it('fetches the token once for concurrent creations (single flight)', async () => {
    const tokenScope = nock(new URL(stableAccessTokenEndpoint).origin)
      .post(new URL(stableAccessTokenEndpoint).pathname)
      .once()
      .reply(200, { access_token: 'stable-token', expires_in: 7200 });

    const connector = await createConnector({ getConfig });
    const qrScope = nock(new URL(qrCodeCreateEndpoint).origin)
      .post(new URL(qrCodeCreateEndpoint).pathname)
      .query({ access_token: 'stable-token' })
      .twice()
      .reply(200, { ticket: 't', url: 'https://weixin.qq.com/q/x' });

    await Promise.all([
      connector.createQrCode!('scene-1', 300),
      connector.createQrCode!('scene-2', 300),
    ]);

    expect(tokenScope.isDone()).toBe(true);
    expect(qrScope.isDone()).toBe(true);
  });

  it('invalidates the token cache and retries exactly once on invalid-token errcode', async () => {
    stableTokenScope('first-token');
    nock(new URL(qrCodeCreateEndpoint).origin)
      .post(new URL(qrCodeCreateEndpoint).pathname)
      .query({ access_token: 'first-token' })
      .reply(200, { errcode: 40_001, errmsg: 'invalid credential' });
    nock(new URL(stableAccessTokenEndpoint).origin)
      .post(new URL(stableAccessTokenEndpoint).pathname)
      .reply(200, { access_token: 'second-token', expires_in: 7200 });
    const retryScope = nock(new URL(qrCodeCreateEndpoint).origin)
      .post(new URL(qrCodeCreateEndpoint).pathname)
      .query({ access_token: 'second-token' })
      .reply(200, { ticket: 't', url: 'https://weixin.qq.com/q/after-retry' });

    const connector = await createConnector({ getConfig });
    const url = await connector.createQrCode!('scene-1', 300);

    expect(url).toEqual('https://weixin.qq.com/q/after-retry');
    expect(retryScope.isDone()).toBe(true);
  });

  it('rejects safe mode configuration without a valid encodingAESKey', async () => {
    const getConfigBad = vi.fn().mockResolvedValue({
      ...mockedConfig,
      encodingAESKey: undefined,
    });
    const connector = await createConnector({ getConfig: getConfigBad });

    await expect(connector.createQrCode!('scene-1', 300)).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidConfig,
    });
  });

  it('rejects scenes longer than 64 characters', async () => {
    const connector = await createConnector({ getConfig });

    await expect(connector.createQrCode!('a'.repeat(65), 300)).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidRequestParameters,
    });
  });
});

describe('getStableAccessToken caching', () => {
  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('reuses the cached token within its TTL', async () => {
    const scope = nock(new URL(stableAccessTokenEndpoint).origin)
      .post(new URL(stableAccessTokenEndpoint).pathname)
      .reply(200, {
        access_token: 'cached-token',
        expires_in: 7200,
      });

    expect(await getStableAccessToken(mockedConfig)).toEqual('cached-token');
    expect(await getStableAccessToken(mockedConfig)).toEqual('cached-token');
    expect(scope.isDone()).toBe(true);
  });

  it('rejects a non-JSON stable token response with InvalidResponse', async () => {
    nock(new URL(stableAccessTokenEndpoint).origin)
      .post(new URL(stableAccessTokenEndpoint).pathname)
      .reply(200, '<html>temporary error</html>');

    await expect(getStableAccessToken(mockedConfig)).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidResponse,
    });
  });

  it('does not reuse a token whose remaining validity is within the safety margin', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);

    const firstScope = nock(new URL(stableAccessTokenEndpoint).origin)
      .post(new URL(stableAccessTokenEndpoint).pathname)
      .reply(200, {
        // Expires_in equals the margin exactly: nothing cacheable remains.
        access_token: 'short-token',
        expires_in: 300,
      });
    const secondScope = nock(new URL(stableAccessTokenEndpoint).origin)
      .post(new URL(stableAccessTokenEndpoint).pathname)
      .reply(200, {
        access_token: 'fresh-token',
        expires_in: 7200,
      });

    expect(await getStableAccessToken(mockedConfig)).toEqual('short-token');
    expect(await getStableAccessToken(mockedConfig)).toEqual('fresh-token');

    // Even after advancing time within the (non-existent) cache window, the short-lived
    // token must never come back.
    vi.setSystemTime(1_700_000_000_000 + 60_000);
    expect(await getStableAccessToken(mockedConfig)).toEqual('fresh-token');

    expect(firstScope.isDone()).toBe(true);
    expect(secondScope.isDone()).toBe(true);
  });
});

describe('handleQrCodeCallback: GET verification challenge', () => {
  it('echoes echostr after verifying the signature (safe mode)', async () => {
    const connector = await createConnector({ getConfig });
    const result = await connector.handleQrCodeCallback!(
      signedQuery(mockedConfig, {
        timestamp: timestampValue,
        nonce: nonceValue,
        echostr: 'echo-123',
      })
    );

    expect(result.response).toEqual('echo-123');
    expect(result.scene).toBeUndefined();
    expect(result.userInfo).toBeUndefined();
  });

  it('echoes echostr after verifying the signature (plain mode)', async () => {
    const config: WechatMpConfig = { ...mockedConfig, encryptionMode: encryptionMode.plain };
    const getConfigForPlain = vi.fn().mockResolvedValue(config);
    const connector = await createConnector({ getConfig: getConfigForPlain });
    const result = await connector.handleQrCodeCallback!(
      signedQuery(config, { timestamp: timestampValue, nonce: nonceValue, echostr: 'echo-plain' })
    );

    expect(result.response).toEqual('echo-plain');
  });

  it('rejects an invalid challenge signature', async () => {
    const connector = await createConnector({ getConfig });
    const query = {
      ...signedQuery(mockedConfig, {
        timestamp: timestampValue,
        nonce: nonceValue,
        echostr: 'echo-123',
      }),
      signature: sha1(sortAndJoin('wrong-token', timestampValue, nonceValue)),
    };

    await expect(connector.handleQrCodeCallback!(query)).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidRequestParameters,
    });
  });

  it('rejects a challenge with missing parameters', async () => {
    const connector = await createConnector({ getConfig });

    await expect(
      connector.handleQrCodeCallback!({ signature: 'sig', timestamp: timestampValue })
    ).rejects.toMatchObject({
      code: ConnectorErrorCodes.InsufficientRequestParameters,
    });
  });
});

describe('handleQrCodeCallback: plain mode POST', () => {
  const plainConfig: WechatMpConfig = { ...mockedConfig, encryptionMode: encryptionMode.plain };
  const getConfigForPlain = vi.fn().mockResolvedValue(plainConfig);

  const plainConnector = async () => createConnector({ getConfig: getConfigForPlain });

  const buildQuery = (): Record<string, string> =>
    signedQuery(plainConfig, { timestamp: timestampValue, nonce: nonceValue });

  it('accepts a callback whose body starts with an XML declaration', async () => {
    const connector = await plainConnector();
    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<xml>',
      '<ToUserName><![CDATA[gh_official_account]]></ToUserName>',
      '<FromUserName><![CDATA[openid-user-1]]></FromUserName>',
      `<CreateTime>${timestampValue}</CreateTime>`,
      '<MsgType><![CDATA[event]]></MsgType>',
      '<Event><![CDATA[unsubscribe]]></Event>',
      '</xml>',
    ].join('');

    const result = await connector.handleQrCodeCallback!(buildQuery(), body);

    expect(result.response).toEqual('success');
    expect(result.scene).toBeUndefined();
    expect(result.userInfo).toBeUndefined();
  });

  it('confirms the session for a SCAN event', async () => {
    const connector = await plainConnector();
    const body = buildXml({
      ToUserName: 'gh_official_account',
      FromUserName: 'openid-user-1',
      CreateTime: timestampValue,
      MsgType: 'event',
      Event: 'SCAN',
      EventKey: 'scene-scan-1',
      Ticket: 'ticket-1',
    });

    const result = await connector.handleQrCodeCallback!(buildQuery(), body);

    expect(result.response).toEqual('success');
    expect(result.scene).toEqual('scene-scan-1');
    expect(result.userInfo).toMatchObject({ id: `${plainConfig.appId}:openid-user-1` });
  });

  it('confirms the session for a subscribe event with qrscene_ prefix', async () => {
    const connector = await plainConnector();
    const body = buildXml({
      ToUserName: 'gh_official_account',
      FromUserName: 'openid-user-2',
      CreateTime: timestampValue,
      MsgType: 'event',
      Event: 'subscribe',
      EventKey: 'qrscene_scene-sub-1',
      Ticket: 'ticket-2',
    });

    const result = await connector.handleQrCodeCallback!(buildQuery(), body);

    expect(result.scene).toEqual('scene-sub-1');
    expect(result.userInfo).toMatchObject({ id: `${plainConfig.appId}:openid-user-2` });
  });

  it('acks without scene for non-login events (unsubscribe)', async () => {
    const connector = await plainConnector();
    const body = buildXml({
      ToUserName: 'gh_official_account',
      FromUserName: 'openid-user-1',
      CreateTime: timestampValue,
      MsgType: 'event',
      Event: 'unsubscribe',
    });

    const result = await connector.handleQrCodeCallback!(buildQuery(), body);

    expect(result.response).toEqual('success');
    expect(result.scene).toBeUndefined();
    expect(result.userInfo).toBeUndefined();
  });

  it('acks without scene for a plain subscribe without qrscene_ prefix', async () => {
    const connector = await plainConnector();
    const body = buildXml({
      ToUserName: 'gh_official_account',
      FromUserName: 'openid-user-1',
      CreateTime: timestampValue,
      MsgType: 'event',
      Event: 'subscribe',
    });

    const result = await connector.handleQrCodeCallback!(buildQuery(), body);

    expect(result.scene).toBeUndefined();
    expect(result.userInfo).toBeUndefined();
  });

  it('acks without scene for text messages', async () => {
    const connector = await plainConnector();
    const body = buildXml({
      ToUserName: 'gh_official_account',
      FromUserName: 'openid-user-1',
      CreateTime: timestampValue,
      MsgType: 'text',
      Content: 'hello',
    });

    const result = await connector.handleQrCodeCallback!(buildQuery(), body);

    expect(result.response).toEqual('success');
    expect(result.scene).toBeUndefined();
  });

  it('rejects an invalid plaintext signature', async () => {
    const connector = await plainConnector();
    const body = buildXml({
      ToUserName: 'gh_official_account',
      FromUserName: 'openid-user-1',
      CreateTime: timestampValue,
      MsgType: 'event',
      Event: 'SCAN',
      EventKey: 'scene-1',
    });

    const query = {
      ...buildQuery(),
      signature: sha1(sortAndJoin('wrong-token', timestampValue, nonceValue)),
    };

    await expect(connector.handleQrCodeCallback!(query, body)).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidRequestParameters,
    });
  });

  it('rejects an encrypted payload while plain mode is configured', async () => {
    const connector = await plainConnector();
    const { encryptedBody } = buildEncryptedXml(mockedConfig, '<xml><x/></xml>');

    await expect(
      connector.handleQrCodeCallback!(
        signedQuery(plainConfig, {
          timestamp: timestampValue,
          nonce: nonceValue,
          encrypt: 'anything',
        }),
        encryptedBody
      )
    ).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidRequestParameters,
    });
  });
});

const safeConnector = async () => createConnector({ getConfig });

const buildSignedEncrypted = (innerXml: string, config: WechatMpConfig = mockedConfig) => {
  const { encryptValue, encryptedBody } = buildEncryptedXml(config, innerXml);
  const query = signedQuery(config, {
    timestamp: timestampValue,
    nonce: nonceValue,
    encrypt: encryptValue,
  });

  return { query, encryptedBody };
};

const scanInnerXml = (openid = 'openid-enc-1') =>
  buildXml({
    ToUserName: 'gh_official_account',
    FromUserName: openid,
    CreateTime: timestampValue,
    MsgType: 'event',
    Event: 'SCAN',
    EventKey: 'scene-enc-1',
    Ticket: 'ticket-enc-1',
  });

describe('handleQrCodeCallback: safe mode POST', () => {
  it('confirms the session for an encrypted SCAN event', async () => {
    const connector = await safeConnector();
    const { query, encryptedBody } = buildSignedEncrypted(scanInnerXml());

    const result = await connector.handleQrCodeCallback!(query, encryptedBody);

    expect(result.response).toEqual('success');
    expect(result.scene).toEqual('scene-enc-1');
    expect(result.userInfo).toMatchObject({ id: `${mockedConfig.appId}:openid-enc-1` });
  });

  it('rejects a bad msg_signature without decrypting', async () => {
    const connector = await safeConnector();
    const { encryptValue, encryptedBody } = buildEncryptedXml(mockedConfig, scanInnerXml());
    const query = {
      ...signedQuery(mockedConfig, {
        timestamp: timestampValue,
        nonce: nonceValue,
        encrypt: encryptValue,
      }),
      msg_signature: sha1(sortAndJoin('wrong-token', timestampValue, nonceValue, encryptValue)),
    };

    await expect(connector.handleQrCodeCallback!(query, encryptedBody)).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidRequestParameters,
    });
  });

  it('rejects ciphertext whose decrypted appid does not match the configured appId', async () => {
    const otherAppConfig: WechatMpConfig = {
      ...mockedConfig,
      appId: 'wx0000000000000000',
    };
    const { encryptValue, encryptedBody } = buildEncryptedXml(otherAppConfig, scanInnerXml());
    const query = signedQuery(mockedConfig, {
      timestamp: timestampValue,
      nonce: nonceValue,
      encrypt: encryptValue,
    });

    const connector = await safeConnector();

    await expect(connector.handleQrCodeCallback!(query, encryptedBody)).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidCertificate,
    });
  });

  it('rejects a plaintext body while safe mode is configured', async () => {
    const connector = await safeConnector();
    const body = buildXml({
      ToUserName: 'gh_official_account',
      FromUserName: 'openid-1',
      CreateTime: timestampValue,
      MsgType: 'event',
      Event: 'SCAN',
      EventKey: 'scene-1',
    });

    await expect(
      connector.handleQrCodeCallback!(
        signedQuery(mockedConfig, { timestamp: timestampValue, nonce: nonceValue }),
        body
      )
    ).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidRequestParameters,
    });
  });

  it('rejects ciphertext tampered after signing (decryption failure)', async () => {
    const connector = await safeConnector();
    const { encryptValue, encryptedBody } = buildEncryptedXml(mockedConfig, scanInnerXml());
    const query = signedQuery(mockedConfig, {
      timestamp: timestampValue,
      nonce: nonceValue,
      encrypt: encryptValue,
    });

    const originalBytes = Array.from(Buffer.from(encryptValue, 'base64'));
    const lastIndex = originalBytes.length - 1;
    // Flip the lowest bit of the final ciphertext byte.
    // eslint-disable-next-line no-bitwise -- XOR is the direct expression of a tampered-bit flip.
    const tamperedBytes = originalBytes.with(lastIndex, originalBytes[lastIndex]! ^ 0x01);
    const tamperedBase64 = Buffer.from(tamperedBytes).toString('base64');
    const tamperedBody = encryptedBody.replace(encryptValue, tamperedBase64);

    await expect(
      connector.handleQrCodeCallback!(
        {
          ...query,
          msg_signature: sha1(
            sortAndJoin(mockedConfig.token, timestampValue, nonceValue, tamperedBase64)
          ),
        },
        tamperedBody
      )
    ).rejects.toMatchObject({ code: ConnectorErrorCodes.InvalidCertificate });
  });

  it('acks without scene for encrypted non-login events', async () => {
    const connector = await safeConnector();
    const innerXml = buildXml({
      ToUserName: 'gh_official_account',
      FromUserName: 'openid-enc-2',
      CreateTime: timestampValue,
      MsgType: 'event',
      Event: 'unsubscribe',
    });
    const { query, encryptedBody } = buildSignedEncrypted(innerXml);

    const result = await connector.handleQrCodeCallback!(query, encryptedBody);

    expect(result.response).toEqual('success');
    expect(result.scene).toBeUndefined();
    expect(result.userInfo).toBeUndefined();
  });
});

describe('getUserInfo', () => {
  it('returns the user info from the core-owned session, ignoring browser data', async () => {
    const connector = await createConnector({ getConfig });
    const qrCodeUserInfo = {
      id: `${mockedConfig.appId}:openid-1`,
      rawData: { openid: 'openid-1', event: 'SCAN' },
    };

    expect(
      await connector.getUserInfo(
        { openid: 'attacker-openid', qrCodeUserInfo: { id: 'attacker-controlled' } },
        vi.fn().mockResolvedValue({ qrCodeUserInfo })
      )
    ).toEqual(qrCodeUserInfo);
  });

  it('rejects valid-looking browser data when the core-owned session is empty', async () => {
    const connector = await createConnector({ getConfig });

    await expect(
      connector.getUserInfo(
        {
          qrCodeUserInfo: { id: `${mockedConfig.appId}:openid-1`, rawData: { openid: 'openid-1' } },
        },
        // eslint-disable-next-line unicorn/no-useless-undefined -- `undefined` session is the scenario under test: an empty core-owned session.
        vi.fn().mockResolvedValue(undefined)
      )
    ).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidRequestParameters,
    });
  });

  it('rejects a session identity issued under a different configured App ID', async () => {
    const connector = await createConnector({ getConfig });

    await expect(
      connector.getUserInfo(
        undefined,
        vi.fn().mockResolvedValue({
          qrCodeUserInfo: { id: 'wx0000000000000000:openid-1', rawData: { openid: 'openid-1' } },
        })
      )
    ).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidRequestParameters,
    });
  });
});

describe('parseDecryptedMessage', () => {
  it('splits message and appid', () => {
    const aesKey = deriveAesKey(mockedConfig.encodingAESKey);
    const message = Buffer.from('<xml><a>1</a></xml>');
    const length = Buffer.alloc(4);

    length.writeUInt32BE(message.length);

    const plaintext = Buffer.concat([
      Buffer.alloc(16),
      length,
      message,
      Buffer.from(mockedConfig.appId),
    ]);

    expect(parseDecryptedMessage(plaintext, mockedConfig.appId)).toEqual({
      message: '<xml><a>1</a></xml>',
      appId: mockedConfig.appId,
    });
  });

  it('rejects an appid mismatch', () => {
    const aesKey = deriveAesKey(mockedConfig.encodingAESKey);
    const message = Buffer.from('<xml><a>1</a></xml>');
    const length = Buffer.alloc(4);

    length.writeUInt32BE(message.length);

    const plaintext = Buffer.concat([Buffer.alloc(16), length, message, Buffer.from('wx9999')]);

    expect(() => parseDecryptedMessage(plaintext, mockedConfig.appId)).toThrow(ConnectorError);
  });

  it('rejects truncated plaintext', () => {
    expect(() => parseDecryptedMessage(Buffer.alloc(10), mockedConfig.appId)).toThrow(
      ConnectorError
    );
  });
});

describe('parseWechatCallbackXml', () => {
  it('parses plain and CDATA fields', () => {
    expect(
      parseWechatCallbackXml(
        '<xml><CreateTime>123</CreateTime><MsgType><![CDATA[event]]></MsgType></xml>'
      )
    ).toEqual({ CreateTime: '123', MsgType: 'event' });
  });

  it('rejects duplicate critical fields', () => {
    expect(() =>
      parseWechatCallbackXml(
        '<xml><FromUserName><![CDATA[a]]></FromUserName><FromUserName><![CDATA[b]]></FromUserName></xml>'
      )
    ).toThrow(ConnectorError);
  });

  it('rejects DTD and entity constructs outside CDATA', () => {
    expect(() =>
      parseWechatCallbackXml(
        '<!DOCTYPE xml [<!ENTITY xxe "evil">]><xml><FromUserName>&xxe;</FromUserName></xml>'
      )
    ).toThrow(ConnectorError);
    expect(() => parseWechatCallbackXml('<xml><Content>&#60;</Content></xml>')).toThrow(
      ConnectorError
    );
  });

  it('respects CDATA when checking entities (literal text like &copy; is legitimate)', () => {
    expect(
      parseWechatCallbackXml('<xml><Content><![CDATA[&copy; 2026 &amp; co]]></Content></xml>')
    ).toEqual({ Content: '&copy; 2026 &amp; co' });
  });

  it('rejects malformed XML and wrong root elements', () => {
    expect(() => parseWechatCallbackXml('<xml><FromUserName>')).toThrow(ConnectorError);
    expect(() => parseWechatCallbackXml('<root><FromUserName>a</FromUserName></root>')).toThrow(
      ConnectorError
    );
  });

  it('tolerates unknown extra fields', () => {
    expect(
      parseWechatCallbackXml('<xml><SomeFutureField><![CDATA[v]]></SomeFutureField></xml>')
    ).toEqual({ SomeFutureField: 'v' });
  });

  it('tolerates nested unknown fields without interpreting them', () => {
    expect(
      parseWechatCallbackXml(
        '<xml><ScanCodeInfo><ScanType><![CDATA[qrcode]]></ScanType><ScanCodeInfo><![CDATA[1]]></ScanCodeInfo></ScanCodeInfo><Count>1</Count></xml>'
      )
    ).toEqual({ Count: '1' });
  });

  it('rejects nested or non-scalar values for interpreted critical fields', () => {
    expect(() =>
      parseWechatCallbackXml('<xml><FromUserName><Inner>a</Inner></FromUserName></xml>')
    ).toThrow(ConnectorError);
  });
});

describe('handleQrCodeCallback: nested non-login events', () => {
  it('acks a scancode_push menu event carrying ScanCodeInfo without a scene', async () => {
    const plainConfig: WechatMpConfig = { ...mockedConfig, encryptionMode: encryptionMode.plain };
    const connector = await createConnector({
      getConfig: vi.fn().mockResolvedValue(plainConfig),
    });
    const body = [
      '<xml>',
      '<ToUserName><![CDATA[gh_official_account]]></ToUserName>',
      '<FromUserName><![CDATA[openid-menu-1]]></FromUserName>',
      `<CreateTime>${timestampValue}</CreateTime>`,
      '<MsgType><![CDATA[event]]></MsgType>',
      '<Event><![CDATA[scancode_push]]></Event>',
      '<EventKey><![CDATA[menu-key]]></EventKey>',
      '<ScanCodeInfo><ScanType><![CDATA[qrcode]]></ScanType><ScanResult><![CDATA[https://example.com]]></ScanResult></ScanCodeInfo>',
      '</xml>',
    ].join('');

    const query = signedQuery(plainConfig, {
      timestamp: timestampValue,
      nonce: nonceValue,
    });
    const result = await connector.handleQrCodeCallback!(query, body);

    expect(result.response).toEqual('success');
    expect(result.scene).toBeUndefined();
    expect(result.userInfo).toBeUndefined();
  });

  it('acks an encrypted pic_sysphoto event with nested SendPicsInfo', async () => {
    const connector = await createConnector({ getConfig });
    const innerXml = [
      '<xml>',
      '<ToUserName><![CDATA[gh_official_account]]></ToUserName>',
      '<FromUserName><![CDATA[openid-pic-1]]></FromUserName>',
      `<CreateTime>${timestampValue}</CreateTime>`,
      '<MsgType><![CDATA[event]]></MsgType>',
      '<Event><![CDATA[pic_sysphoto]]></Event>',
      '<EventKey><![CDATA[menu-key]]></EventKey>',
      '<SendPicsInfo><Count>1</Count><PicList><item><PicMd5Sum><![CDATA[md5]]></PicMd5Sum></item></PicList></SendPicsInfo>',
      '</xml>',
    ].join('');
    const { encryptValue, encryptedBody } = buildEncryptedXml(mockedConfig, innerXml);
    const query = signedQuery(mockedConfig, {
      timestamp: timestampValue,
      nonce: nonceValue,
      encrypt: encryptValue,
    });

    const result = await connector.handleQrCodeCallback!(query, encryptedBody);

    expect(result.response).toEqual('success');
    expect(result.scene).toBeUndefined();
    expect(result.userInfo).toBeUndefined();
  });
});

describe('crypto round trip', () => {
  it('decrypts what it encrypts with the WeChat payload layout', () => {
    const aesKey = deriveAesKey(mockedConfig.encodingAESKey);
    const message = Buffer.from('<xml><Content><![CDATA[round-trip]]></Content></xml>');
    const length = Buffer.alloc(4);

    length.writeUInt32BE(message.length);

    const plaintext = Buffer.concat([
      Buffer.from('0123456789abcdef'),
      length,
      message,
      Buffer.from(mockedConfig.appId),
    ]);

    const ciphertext = encryptWechatMessage(plaintext, aesKey);
    const decrypted = decryptWechatMessage(ciphertext, aesKey);

    expect(parseDecryptedMessage(decrypted, mockedConfig.appId)).toEqual({
      message: message.toString('utf8'),
      appId: mockedConfig.appId,
    });
  });
});
/* eslint-enable max-lines */
