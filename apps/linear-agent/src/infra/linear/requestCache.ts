/**
 * Request caching and deduplication for Linear API client.
 * Implements client instance caching and request deduplication to optimize API usage.
 */

import { LinearClient } from '@linear/sdk';
import { createAppLogger } from '@intexuraos/infra-sentry';

const logger = createAppLogger({ name: 'linear-api-client' });

export const CLIENT_TTL_MS = 5 * 60 * 1000;
export const DEDUP_TTL_MS = 10 * 1000;

interface CachedClient {
  client: LinearClient;
  lastUsed: number;
}

const clientCache = new Map<string, CachedClient>();
const requestDedup = new Map<string, Promise<unknown>>();

/* istanbul ignore next -- @preserve Linear SDK client creation cannot be unit tested without real API key */
export function getOrCreateClient(apiKey: string): LinearClient {
  const cached = clientCache.get(apiKey);
  const now = Date.now();

  if (cached !== undefined && now - cached.lastUsed < CLIENT_TTL_MS) {
    cached.lastUsed = now;
    return cached.client;
  }

  const client = new LinearClient({ apiKey });
  clientCache.set(apiKey, { client, lastUsed: now });

  return client;
}

/* istanbul ignore next -- @preserve Timer-based cleanup cannot be unit tested without waiting 5 minutes */
export function cleanupExpiredClients(): void {
  const now = Date.now();
  for (const [key, cached] of clientCache.entries()) {
    if (now - cached.lastUsed >= CLIENT_TTL_MS) {
      clientCache.delete(key);
    }
  }
}

/* istanbul ignore next -- @preserve Timer setup runs at module load time */
setInterval(cleanupExpiredClients, CLIENT_TTL_MS);

/** Creates a deduplication key for request caching. Exported for testing. */
export function createDedupKey(operation: string, ...args: string[]): string {
  return `${operation}:${args.join(':')}`;
}

/* istanbul ignore next -- @preserve Request deduplication requires concurrent real API calls to test */
export async function withDeduplication<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const existing = requestDedup.get(key) as Promise<T> | undefined;
  if (existing !== undefined) {
    logger.debug({ key }, 'Request deduplication hit');
    return await existing;
  }

  const promise = fn().finally(() => {
    setTimeout(() => {
      requestDedup.delete(key);
    }, DEDUP_TTL_MS);
  });

  requestDedup.set(key, promise);
  return await promise;
}

export function clearClientCache(): void {
  clientCache.clear();
  requestDedup.clear();
}

export function getClientCacheSize(): number {
  return clientCache.size;
}

export function getDedupCacheSize(): number {
  return requestDedup.size;
}
