import { encryptionMode } from './constant.js';

/**
 * Each test scenario uses a distinct appId so the module-level stable token cache (keyed
 * by credential fingerprint) cannot leak state between tests.
 */
export const mockedConfig = {
  appId: 'wx1234567890abcdef',
  appSecret: '<app-secret>',
  token: '<callback-token>',
  encryptionMode: encryptionMode.safe,
  encodingAESKey: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
};
