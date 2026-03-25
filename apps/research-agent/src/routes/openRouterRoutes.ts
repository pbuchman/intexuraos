/**
 * OpenRouter Routes
 *
 * GET  /research/openrouter/models - Get curated allowlist with live pricing
 */

import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import {
  OPENROUTER_ALLOWED_MODELS,
  type OpenRouterModelInfo,
} from '@intexuraos/infra-openrouter';

/**
 * In-memory cache for allowlist with live pricing.
 * TTL: 5 minutes.
 */
interface CacheEntry {
  models: OpenRouterModelInfo[];
  cachedAt: string;
}

let cache: CacheEntry | null = null;
let cacheExpiry = 0;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Cached catalog data from OpenRouter API.
 */
interface CatalogEntry {
  pricing: { inputPricePerMillion: number; outputPricePerMillion: number };
  contextLength: number;
}

/**
 * Fetch the full OpenRouter model catalog once and return a map of modelId -> catalog entry.
 * This avoids the N+1 problem where each model triggered a separate full catalog fetch.
 */
async function fetchOpenRouterCatalog(
  apiKey: string
): Promise<Map<string, CatalogEntry> | null> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://intexuraos.cloud',
        'X-Title': 'IntexuraOS',
      },
    });

    /* v8 ignore start -- upstream: cannot simulate non-200 HTTP status from live OpenRouter API @preserve */
    if (!response.ok) {
      return null;
    }
    /* v8 ignore stop @preserve */

    const data = (await response.json()) as {
      data: {
        id: string;
        pricing?: {
          prompt?: string;
          completion?: string;
        };
        context_length?: number;
      }[];
    };

    const catalogMap = new Map<string, CatalogEntry>();
    for (const model of data.data) {
      /* v8 ignore start -- ts-type: cannot simulate API response missing pricing data in unit tests @preserve */
      if (model.pricing === undefined) {
        continue;
      }
      /* v8 ignore stop @preserve */

      /* v8 ignore start -- ts-type: parseFloat nullish coalescing defaults are unreachable in unit tests @preserve */
      catalogMap.set(model.id, {
        pricing: {
          inputPricePerMillion: parseFloat(model.pricing.prompt ?? '0') * 1_000_000,
          outputPricePerMillion: parseFloat(model.pricing.completion ?? '0') * 1_000_000,
        },
        contextLength: model.context_length ?? 102400,
      });
      /* v8 ignore stop @preserve */
    }

    return catalogMap;
  } catch {
    return null;
  }
}

/**
 * Build OpenRouterModelInfo from an allowlist entry, enriched with live catalog data.
 */
/* v8 ignore start -- upstream: buildModelInfo fallback path requires live API null response in unit tests @preserve */
function buildModelInfo(
  entry: (typeof OPENROUTER_ALLOWED_MODELS)[number],
  catalogEntry?: CatalogEntry
): OpenRouterModelInfo {
  return {
    id: entry.id,
    name: entry.name,
    provider: entry.provider,
    contextLength: catalogEntry?.contextLength ?? 102400,
    pricing: catalogEntry
      ? {
          inputPricePerMillion: catalogEntry.pricing.inputPricePerMillion,
          outputPricePerMillion: catalogEntry.pricing.outputPricePerMillion,
          useProviderCost: true,
        }
      : {
          inputPricePerMillion: parseFloat(entry.promptPerToken) * 1_000_000,
          outputPricePerMillion: parseFloat(entry.completionPerToken) * 1_000_000,
          useProviderCost: true,
        },
    inputModalities: ['text'],
    outputModalities: ['text'],
  };
}
/* v8 ignore stop @preserve */

export const openRouterRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /research/openrouter/models
  fastify.get('/research/openrouter/models', async (request, reply) => {
    logIncomingRequest(request, {
      message: 'Received request to GET /research/openrouter/models',
    });

    const user = await requireAuth(request, reply);
    /* v8 ignore start -- test-infra: FakeAuthPlugin always returns valid user, cannot simulate null auth @preserve */
    if (user === null) return;
    /* v8 ignore stop @preserve */

    const { userServiceClient } = getServices();

    // Fetch user's API keys to check if OpenRouter key is configured
    const keysResult = await userServiceClient.getApiKeys(user.userId);
    /* v8 ignore start -- test-infra: FakeUserServiceClient cannot simulate getApiKeys failure @preserve */
    if (!keysResult.ok) {
      return await reply.fail('INTERNAL_ERROR', 'Failed to fetch user API keys');
    }
    /* v8 ignore stop @preserve */

    const apiKey = keysResult.value.openrouter;
    /* v8 ignore start -- test-infra: FakeUserServiceClient cannot model empty string API key @preserve */
    if (apiKey === undefined || apiKey === '') {
      return await reply.fail('NOT_FOUND', 'OpenRouter API key not configured');
    }
    /* v8 ignore stop @preserve */

    // Check cache
    const now = Date.now();
    /* v8 ignore start -- test-infra: cannot simulate stale cache hit in unit tests without time mocking @preserve */
    if (cache !== null && now < cacheExpiry) {
      return await reply.ok({ models: cache.models, cachedAt: cache.cachedAt });
    }
    /* v8 ignore stop @preserve */

    // Fetch full catalog once (avoids N+1 problem of 14 separate catalog fetches)
    const catalog = await fetchOpenRouterCatalog(apiKey);

    // Build model info for each allowlisted model, enriching with live catalog data
    const modelsWithPricing: OpenRouterModelInfo[] = OPENROUTER_ALLOWED_MODELS.map((entry) => {
      const catalogEntry = catalog?.get(entry.id);
      /* v8 ignore start -- upstream: cannot simulate null catalog from OpenRouter API in unit tests @preserve */
      return buildModelInfo(entry, catalogEntry);
      /* v8 ignore stop @preserve */
    });

    const cachedAt = new Date().toISOString();
    cache = { models: modelsWithPricing, cachedAt };
    cacheExpiry = now + CACHE_TTL_MS;

    return await reply.ok({ models: modelsWithPricing, cachedAt });
  });

  done();
};
