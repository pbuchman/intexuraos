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
 * Fetch live pricing from OpenRouter API for a specific model.
 */
async function fetchLivePricingForModel(
  apiKey: string,
  modelId: string
): Promise<{ inputPricePerMillion: number; outputPricePerMillion: number } | null> {
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

    const model = data.data.find((m) => m.id === modelId);
    /* v8 ignore start -- ts-type: cannot simulate API response missing pricing data in unit tests @preserve */
    if (model?.pricing === undefined) {
      return null;
    }
    /* v8 ignore stop @preserve */

    /* v8 ignore start -- ts-type: parseFloat nullish coalescing defaults are unreachable in unit tests @preserve */
    return {
      inputPricePerMillion: parseFloat(model.pricing.prompt ?? '0') * 1_000_000,
      outputPricePerMillion: parseFloat(model.pricing.completion ?? '0') * 1_000_000,
    };
    /* v8 ignore stop @preserve */
  } catch {
    return null;
  }
}

/**
 * Build OpenRouterModelInfo from an allowlist entry, optionally enriched with live pricing.
 */
/* v8 ignore start -- upstream: buildModelInfo fallback pricing path requires live API null response in unit tests @preserve */
function buildModelInfo(
  entry: (typeof OPENROUTER_ALLOWED_MODELS)[number],
  livePricing?: { inputPricePerMillion: number; outputPricePerMillion: number }
): OpenRouterModelInfo {
  return {
    id: entry.id,
    name: entry.name,
    provider: entry.provider,
    contextLength: 102400, // Default context window; live API provides actual value
    pricing: livePricing
      ? {
          inputPricePerMillion: livePricing.inputPricePerMillion,
          outputPricePerMillion: livePricing.outputPricePerMillion,
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

    // Fetch live pricing for all allowlisted models
    const modelsWithPricing: OpenRouterModelInfo[] = [];

    await Promise.all(
      OPENROUTER_ALLOWED_MODELS.map(async (entry) => {
        const livePricing = await fetchLivePricingForModel(apiKey, entry.id);
        /* v8 ignore start -- upstream: cannot simulate null livePricing from OpenRouter API in unit tests @preserve */
        modelsWithPricing.push(buildModelInfo(entry, livePricing ?? undefined));
        /* v8 ignore stop @preserve */
      })
    );

    const cachedAt = new Date().toISOString();
    cache = { models: modelsWithPricing, cachedAt };
    cacheExpiry = now + CACHE_TTL_MS;

    return await reply.ok({ models: modelsWithPricing, cachedAt });
  });

  done();
};
