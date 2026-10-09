import { got } from 'got';
import { createHash } from 'node:crypto';

import { ConnectorError, ConnectorErrorCodes } from '@logto/connector-kit';

import {
  accessTokenTtlMarginInSeconds,
  defaultTimeout,
  stableAccessTokenEndpoint,
} from './constant.js';
import type { WechatMpConfig } from './types.js';
import { stableAccessTokenResponseGuard } from './types.js';

// WeChat error codes that explicitly report the presented access token as invalid.
// The token cache is invalidated when one of them is returned. See
// https://developers.weixin.qq.com/doc/oplatform/Return_codes/Return_code_descriptions_new.html
export const invalidTokenErrcodes: readonly number[] = Object.freeze([40_001, 40_014, 42_001]);

type CachedToken = { token: string; expiresAtMs: number };

/**
 * Maximum number of configs tracked by the token cache. Core rebuilds the connector
 * instance on every library call, so this cache must live at module scope; the bound
 * keeps config churn (e.g. tenants rotating `appSecret`) from leaking memory.
 */
const maxCachedConfigs = 100;

/**
 * In-memory stable access token cache keyed by `sha256(appId + '\n' + appSecret)`.
 *
 * The cache is module-level because core rebuilds raw connector instances on every
 * `getLogtoConnectors`/`getLogtoConnectorById` call, which would discard any
 * closure-scoped cache. The credential fingerprint (not the raw secret) is the key, so
 * secrets never sit in the map; a rotated `appSecret` simply gets a new entry.
 *
 * The stable token endpoint (`POST /cgi-bin/stable_token` with `force_refresh: false`)
 * returns the same token within its validity window instead of invalidating the previous
 * one, so per-replica local caches are safe and no distributed cache is required.
 */
const tokenCache = new Map<string, CachedToken>();

/** Single-flight token requests per credential fingerprint, preventing thundering herds. */
const inFlightTokenRequests = new Map<string, Promise<string>>();

const getCacheKey = (config: WechatMpConfig): string => {
  const hash = createHash('sha256');

  hash.update(config.appId);
  hash.update('\n');
  hash.update(config.appSecret);

  return hash.digest('hex');
};

const purgeExpiredCacheEntries = (): void => {
  const now = Date.now();

  for (const [key, cached] of tokenCache) {
    if (cached.expiresAtMs <= now) {
      tokenCache.delete(key);
    }
  }
};

const fetchStableAccessToken = async (config: WechatMpConfig): Promise<string> => {
  const httpResponse = await got
    .post(stableAccessTokenEndpoint, {
      json: {
        grant_type: 'client_credential',
        appid: config.appId,
        secret: config.appSecret,
        force_refresh: false,
      },
      timeout: { request: defaultTimeout },
    })
    .catch((error: unknown) => {
      throw new ConnectorError(ConnectorErrorCodes.General, {
        message: 'Failed to request the WeChat stable access token.',
        detail: String(error),
      });
    });

  const tokenResponse: unknown = (() => {
    try {
      const parsed: unknown = JSON.parse(httpResponse.body);

      return parsed;
    } catch {
      throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
        message: 'WeChat stable access token response is not valid JSON.',
        detail: httpResponse.body,
      });
    }
  })();

  const result = stableAccessTokenResponseGuard.safeParse(tokenResponse);

  if (!result.success || !result.data.access_token) {
    throw new ConnectorError(
      ConnectorErrorCodes.InvalidResponse,
      result.success ? result.data : result.error
    );
  }

  const { access_token: accessToken, expires_in: expiresIn = 7200 } = result.data;

  // Cache with a safety margin so the token is refreshed before it can expire
  // mid-request. A token whose remaining validity does not exceed the margin is not
  // cached (the caller still uses it for the current request).
  const ttlMs = (expiresIn - accessTokenTtlMarginInSeconds) * 1000;

  if (ttlMs > 0) {
    tokenCache.set(getCacheKey(config), { token: accessToken, expiresAtMs: Date.now() + ttlMs });
    purgeExpiredCacheEntries();

    // Evict oldest entries when over capacity (Map preserves insertion order).
    while (tokenCache.size > maxCachedConfigs) {
      const oldest = tokenCache.keys().next();

      if (oldest.done) {
        break;
      }

      tokenCache.delete(oldest.value);
    }
  }

  return accessToken;
};

/**
 * Returns a cached stable access token for the configured credential, requesting a new
 * one with single-flight semantics when missing or expired.
 */
export const getStableAccessToken = async (config: WechatMpConfig): Promise<string> => {
  const cacheKey = getCacheKey(config);
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.token;
  }

  const inFlight = inFlightTokenRequests.get(cacheKey);

  if (inFlight) {
    return inFlight;
  }

  // Single-flight: the registry entry is always released once the request settles.
  // eslint-disable-next-line promise/prefer-await-to-then -- Releasing the in-flight entry is cleanup, not part of the token request result.
  const request = fetchStableAccessToken(config).finally(() => {
    inFlightTokenRequests.delete(cacheKey);
  });

  inFlightTokenRequests.set(cacheKey, request);

  return request;
};

/**
 * Evicts the cached token for the given credential after WeChat reports it as invalid,
 * so the next {@link getStableAccessToken} call fetches a fresh one.
 */
export const invalidateStableAccessToken = (config: WechatMpConfig): void => {
  tokenCache.delete(getCacheKey(config));
};

/**
 * Clears the token cache and single-flight registry.
 *
 * @internal Only for tests; the cache intentionally outlives connector instances.
 */
export const resetStableAccessTokenCache = (): void => {
  tokenCache.clear();
  inFlightTokenRequests.clear();
};
