import type { Logger } from '@intexuraos/common-core';
import type { CatalogEntry } from './allowlist.js';
import {
  assertIntexAgentCatalogConformance,
  type IntexAgentCatalogEvidence,
} from './intexAgentCatalog.js';

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const CATALOG_TIMEOUT_MS = 10_000;
const CATALOG_FRESHNESS_MS = 5 * 60 * 1000;
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const MAX_CATALOG_ENTRIES = 10_000;

export interface OpenRouterCatalogSnapshot {
  catalog: unknown;
  fetchedAt: string;
}

export interface OpenRouterCatalogClientConfig {
  apiKey: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface OpenRouterCatalogClient {
  /** Fetch the catalog once during startup, then retain it only while fresh. */
  start(): Promise<OpenRouterCatalogSnapshot | null>;
  /** Return a fresh snapshot, single-flighting concurrent refreshes. */
  getCatalog(): Promise<OpenRouterCatalogSnapshot | null>;
  /** Return strict Intex evidence only when the shared snapshot conforms. */
  getIntexAgentCatalogEvidence(): Promise<IntexAgentCatalogEvidence | null>;
}

function hasBoundedCatalogSchema(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const data = (value as Record<string, unknown>)['data'];
  return Array.isArray(data) && data.length <= MAX_CATALOG_ENTRIES;
}

function nonNegativeFinite(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveFinite(value: unknown): number | null {
  const parsed = nonNegativeFinite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

async function abortAndCancelResponseBody(
  response: Response,
  controller: AbortController
): Promise<void> {
  controller.abort();
  if (response.body === null) return;
  try {
    await response.body.cancel();
  } catch {
    // A body may already be locked or cancelled by the fetch implementation.
  }
}

async function readBoundedResponseBody(
  response: Response,
  controller: AbortController
): Promise<string | null> {
  if (response.body === null) return '';
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const value = result.value;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CATALOG_BYTES) {
        controller.abort();
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/** Convert only complete, provider-reported entries into display metadata. */
export function createOpenRouterCatalogEntryMap(catalog: unknown): Map<string, CatalogEntry> {
  if (!hasBoundedCatalogSchema(catalog)) return new Map();
  const data = (catalog as { data: unknown[] }).data;
  const entries = new Map<string, CatalogEntry>();
  for (const value of data) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry['id'] !== 'string') continue;
    if (typeof entry['pricing'] !== 'object' || entry['pricing'] === null) continue;
    const pricing = entry['pricing'] as Record<string, unknown>;
    const prompt = positiveFinite(pricing['prompt']);
    const completion = positiveFinite(pricing['completion']);
    const contextLength = nonNegativeFinite(entry['context_length']);
    if (prompt === null || completion === null || contextLength === null || contextLength <= 0)
      continue;
    entries.set(entry['id'], {
      pricing: {
        inputPricePerMillion: prompt * 1_000_000,
        outputPricePerMillion: completion * 1_000_000,
      },
      contextLength,
    });
  }
  return entries;
}

/** Extract model availability without requiring optional pricing metadata. */
export function createOpenRouterCatalogModelIdSet(catalog: unknown): Set<string> {
  if (!hasBoundedCatalogSchema(catalog)) return new Set();
  const data = (catalog as { data: unknown[] }).data;
  const modelIds = new Set<string>();
  for (const value of data) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const id = (value as Record<string, unknown>)['id'];
    if (typeof id === 'string') modelIds.add(id);
  }
  return modelIds;
}

/**
 * The only OpenRouter catalog fetcher. It bounds time and response size,
 * never logs bodies, and never serves a stale snapshot.
 */
export function createOpenRouterCatalogClient(
  config: OpenRouterCatalogClientConfig
): OpenRouterCatalogClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? ((): Date => new Date());
  let snapshot: OpenRouterCatalogSnapshot | null = null;
  let freshUntilMs = 0;
  let inFlight: Promise<OpenRouterCatalogSnapshot | null> | null = null;

  async function refresh(): Promise<OpenRouterCatalogSnapshot | null> {
    const controller = new AbortController();
    const timeout = setTimeout((): void => {
      controller.abort();
    }, CATALOG_TIMEOUT_MS);
    try {
      const response = await fetchImpl(CATALOG_URL, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'HTTP-Referer': 'https://intexuraos.cloud',
          'X-Title': 'IntexuraOS',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        config.logger.warn(
          { reason: 'http_status', statusCode: response.status },
          'OpenRouter catalog refresh failed'
        );
        return null;
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null && Number(contentLength) > MAX_CATALOG_BYTES) {
        await abortAndCancelResponseBody(response, controller);
        config.logger.warn({ reason: 'response_too_large' }, 'OpenRouter catalog refresh failed');
        return null;
      }
      const body = await readBoundedResponseBody(response, controller);
      if (body === null) {
        config.logger.warn({ reason: 'response_too_large' }, 'OpenRouter catalog refresh failed');
        return null;
      }

      let catalog: unknown;
      try {
        catalog = JSON.parse(body) as unknown;
      } catch {
        config.logger.warn({ reason: 'invalid_json' }, 'OpenRouter catalog refresh failed');
        return null;
      }
      if (!hasBoundedCatalogSchema(catalog)) {
        config.logger.warn({ reason: 'invalid_schema' }, 'OpenRouter catalog refresh failed');
        return null;
      }

      const fetchedAt = now().toISOString();
      const nextSnapshot = { catalog, fetchedAt };
      snapshot = nextSnapshot;
      freshUntilMs = now().getTime() + CATALOG_FRESHNESS_MS;
      return nextSnapshot;
    } catch {
      config.logger.warn({ reason: 'fetch_failed' }, 'OpenRouter catalog refresh failed');
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getCatalog(): Promise<OpenRouterCatalogSnapshot | null> {
    if (snapshot !== null && now().getTime() < freshUntilMs) {
      return snapshot;
    }
    inFlight ??= refresh().finally((): void => {
      inFlight = null;
    });
    return await inFlight;
  }

  return {
    async start(): Promise<OpenRouterCatalogSnapshot | null> {
      return await getCatalog();
    },
    getCatalog,
    async getIntexAgentCatalogEvidence(): Promise<IntexAgentCatalogEvidence | null> {
      const currentSnapshot = await getCatalog();
      if (currentSnapshot === null) return null;
      try {
        return assertIntexAgentCatalogConformance(
          currentSnapshot.catalog,
          currentSnapshot.fetchedAt
        );
      } catch {
        config.logger.warn(
          { reason: 'intex_catalog_non_conformant' },
          'OpenRouter catalog refresh failed'
        );
        return null;
      }
    },
  };
}
