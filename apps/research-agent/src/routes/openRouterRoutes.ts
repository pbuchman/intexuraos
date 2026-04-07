/**
 * OpenRouter Routes
 *
 * GET  /research/openrouter/models - Get curated allowlist with live pricing
 */

import type { FastifyPluginCallback } from 'fastify';
import type { Logger } from '@intexuraos/common-core';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import {
  OPENROUTER_ALLOWED_MODELS,
  buildModelInfo,
  type CatalogEntry,
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
 * Reset the in-memory cache (for testing).
 */
export function resetOpenRouterCache(): void {
  cache = null;
  cacheExpiry = 0;
}

/**
 * Fetch the full OpenRouter model catalog once and return a map of modelId -> catalog entry.
 * This avoids the N+1 problem where each model triggered a separate full catalog fetch.
 */
async function fetchOpenRouterCatalog(
  apiKey: string,
  logger: Logger
): Promise<Map<string, CatalogEntry> | null> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://intexuraos.cloud',
        'X-Title': 'IntexuraOS',
      },
    });

    if (!response.ok) {
      return null;
    }

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
      // pricing is optional in the API response type; skip models without it
      if (model.pricing === undefined) {
        continue;
      }

      catalogMap.set(model.id, {
        pricing: {
          inputPricePerMillion: parseFloat(model.pricing.prompt ?? '0') * 1_000_000,
          outputPricePerMillion: parseFloat(model.pricing.completion ?? '0') * 1_000_000,
        },
        contextLength: model.context_length ?? 102400,
      });
    }

    return catalogMap;
  } catch (error) {
    /* v8 ignore start -- upstream: nock-based tests cannot trigger uncaught fetch exceptions in this code path @preserve */
    logger.warn({ err: error }, 'Failed to fetch OpenRouter catalog, using fallback pricing');
    /* v8 ignore stop @preserve */
    return null;
  }
}

export const openRouterRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /research/openrouter/models
  fastify.get('/research/openrouter/models', async (request, reply) => {
    logIncomingRequest(request, {
      message: 'Received request to GET /research/openrouter/models',
    });

    const user = await requireAuth(request, reply);
    /* v8 ignore start -- test-infra: requireAuth always returns valid user in test environment, cannot simulate null auth @preserve */
    if (user === null) return;
    /* v8 ignore stop @preserve */

    const { userServiceClient } = getServices();

    // Fetch user's API keys to check if OpenRouter key is configured
    const keysResult = await userServiceClient.getApiKeys(user.userId);
    if (!keysResult.ok) {
      return await reply.fail('INTERNAL_ERROR', 'Failed to fetch user API keys');
    }

    const apiKey = keysResult.value.openrouter;
    if (apiKey === undefined || apiKey === '') {
      return await reply.fail('NOT_FOUND', 'OpenRouter API key not configured');
    }

    // Check cache
    const now = Date.now();
    if (cache !== null && now < cacheExpiry) {
      return await reply.ok({ models: cache.models, cachedAt: cache.cachedAt });
    }

    // Fetch full catalog once (avoids N+1 problem of 14 separate catalog fetches)
    const catalog = await fetchOpenRouterCatalog(apiKey, request.log as Logger);

    // Build model info for each allowlisted model, enriching with live catalog data
    const modelsWithPricing: OpenRouterModelInfo[] = OPENROUTER_ALLOWED_MODELS.map((entry) => {
      const catalogEntry = catalog?.get(entry.id);
      return buildModelInfo(entry, catalogEntry);
    });

    const cachedAt = new Date().toISOString();
    cache = { models: modelsWithPricing, cachedAt };
    cacheExpiry = now + CACHE_TTL_MS;

    return await reply.ok({ models: modelsWithPricing, cachedAt });
  });

  done();
};
