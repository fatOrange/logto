import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';

import { ConnectorError, ConnectorErrorCodes } from '@logto/connector-kit';

/**
 * The decrypted WeChat message buffer. `Buffer` is the native payload type produced by
 * `Buffer.concat` during decryption; consumers parse it with `Buffer` methods directly.
 */
export type WechatMessageBuffer = ReturnType<typeof Buffer.concat>;

/**
 * Verifies a WeChat signature in a timing-safe manner.
 *
 * The signature is `sha1` of the lexicographically sorted, concatenated argument strings.
 *
 * @see {@link https://developers.weixin.qq.com/doc/service/guide/dev/push/ | 消息与事件推送介绍}
 */
export const verifySignature = (signature: string, ...values: string[]): boolean => {
  // `values` is a connector-owned rest array freshly created for this call; sorting it
  // in place never mutates caller data.
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods
  const expected = createHash('sha1').update(values.sort().join('')).digest('hex');
  const actual = Buffer.from(signature.toLowerCase());
  const expectedBuffer = Buffer.from(expected);

  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
};

/**
 * Derives the 32-byte AES key from the 43-character `EncodingAESKey`.
 */
export const deriveAesKey = (encodingAesKey: string): Uint8Array =>
  Buffer.from(encodingAesKey + '=', 'base64');

/**
 * Decrypts a WeChat safe-mode message payload.
 *
 * Plaintext layout: `random(16 bytes) + msg_len(4 bytes, big-endian) + msg + appId`.
 * The AES key is derived from the configured `EncodingAESKey`, the IV is the first 16
 * bytes of the key, and PKCS#7 padding uses a 32-byte block size.
 *
 * @throws {ConnectorError} with {@link ConnectorErrorCodes.InvalidCertificate} when the
 * ciphertext is malformed or the padding is invalid.
 */
export const decryptWechatMessage = (
  ciphertext: Uint8Array,
  aesKey: Uint8Array
): WechatMessageBuffer => {
  const decipher = createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));

  decipher.setAutoPadding(false);

  const plaintext = (() => {
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new ConnectorError(ConnectorErrorCodes.InvalidCertificate, {
        message: 'Failed to decrypt the WeChat callback message.',
      });
    }
  })();

  const padding = plaintext.at(-1);

  // WeChat PKCS#7 padding uses a block size of 32.
  if (padding === undefined || padding < 1 || padding > 32 || padding > plaintext.length) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidCertificate, {
      message: 'Invalid WeChat message padding.',
    });
  }

  const paddedLength = plaintext.length - padding;

  if (!plaintext.subarray(paddedLength).every((byte) => byte === padding)) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidCertificate, {
      message: 'Invalid WeChat message padding.',
    });
  }

  return plaintext.subarray(0, paddedLength);
};

/**
 * Parses the decrypted WeChat message buffer into its components and validates the
 * trailing appid against the configured one.
 *
 * @throws {ConnectorError} with {@link ConnectorErrorCodes.InvalidCertificate} when the
 * structure is malformed or the appid does not match the configured `appId`. This
 * prevents encrypted payloads issued for a different app from being accepted.
 */
export const parseDecryptedMessage = (
  plaintext: WechatMessageBuffer,
  expectedAppId: string
): { message: string; appId: string } => {
  if (plaintext.length < 20) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidCertificate, {
      message: 'Decrypted WeChat message is too short.',
    });
  }

  // The producer (`decryptWechatMessage`) already returns a `Buffer`, so native
  // `Buffer` parsing (readUInt32BE / ranged toString) needs no wrapper allocation.
  const messageLength = plaintext.readUInt32BE(16);

  if (messageLength <= 0 || 20 + messageLength > plaintext.length) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidCertificate, {
      message: 'Decrypted WeChat message length is invalid.',
    });
  }

  const message = plaintext.toString('utf8', 20, 20 + messageLength);
  const appId = plaintext.toString('utf8', 20 + messageLength);

  if (appId !== expectedAppId) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidCertificate, {
      message: 'Decrypted WeChat message appid mismatch.',
    });
  }

  return { message, appId };
};
