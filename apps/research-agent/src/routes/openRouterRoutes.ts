/**
 * OpenRouter Routes
 *
 * GET  /research/openrouter/models - Get curated allowlist with live pricing
 */

import type { FastifyPluginCallback } from 'fastify';
import type { Logger } from '@intexuraos/common-core';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getOpenRouterRawId, RESEARCH_SYNTHESIS_MODELS } from '@intexuraos/llm-contract';
import { getServices } from '../services.js';
import {
  OPENROUTER_ALLOWED_MODELS,
  buildModelInfo,
  createOpenRouterCatalogClient,
  createOpenRouterCatalogEntryMap,
  createOpenRouterCatalogModelIdSet,
  type OpenRouterCatalogClient,
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
let catalogClient: OpenRouterCatalogClient | null = null;
let catalogClientApiKey: string | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const RECOMMENDED_OPENROUTER_MODEL_IDS = RESEARCH_SYNTHESIS_MODELS.map(getOpenRouterRawId);
const RECOMMENDED_OPENROUTER_MODEL_ID_SET = new Set(RECOMMENDED_OPENROUTER_MODEL_IDS);
const ORDERED_OPENROUTER_ALLOWED_MODELS = [
  // The endpoint test enforces that every recommended synthesis model belongs to the allowlist.
  ...RECOMMENDED_OPENROUTER_MODEL_IDS.map(
    (modelId) => OPENROUTER_ALLOWED_MODELS.find((entry) => entry.id === modelId)
  ).filter(
    (model): model is (typeof OPENROUTER_ALLOWED_MODELS)[number] => model !== undefined
  ),
  ...OPENROUTER_ALLOWED_MODELS.filter(
    (entry) => !RECOMMENDED_OPENROUTER_MODEL_ID_SET.has(entry.id)
  ),
];

/**
 * Reset the in-memory cache (for testing).
 */
export function resetOpenRouterCache(): void {
  cache = null;
  cacheExpiry = 0;
  catalogClient = null;
  catalogClientApiKey = null;
}

function getCatalogClient(apiKey: string, logger: Logger): OpenRouterCatalogClient {
  if (catalogClient === null || catalogClientApiKey !== apiKey) {
    catalogClient = createOpenRouterCatalogClient({ apiKey, logger });
    catalogClientApiKey = apiKey;
  }
  return catalogClient;
}

export const openRouterRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /research/openrouter/models
  fastify.get('/openrouter/models', async (request, reply) => {
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
    const catalogSnapshot = await getCatalogClient(apiKey, request.log).getCatalog();
    const catalog =
      catalogSnapshot === null ? null : createOpenRouterCatalogEntryMap(catalogSnapshot.catalog);
    const availableModelIds =
      catalogSnapshot === null
        ? null
        : createOpenRouterCatalogModelIdSet(catalogSnapshot.catalog);

    // A successful catalog response is authoritative for availability. Keep the
    // reviewed static allowlist only as the outage fallback when catalog fetch fails.
    const availableModels =
      availableModelIds === null
        ? ORDERED_OPENROUTER_ALLOWED_MODELS
        : ORDERED_OPENROUTER_ALLOWED_MODELS.filter((entry) => availableModelIds.has(entry.id));
    const modelsWithPricing: OpenRouterModelInfo[] = availableModels.map((entry) =>
      buildModelInfo(entry, catalog?.get(entry.id))
    );

    const cachedAt = new Date().toISOString();
    cache = { models: modelsWithPricing, cachedAt };
    cacheExpiry = now + CACHE_TTL_MS;

    return await reply.ok({ models: modelsWithPricing, cachedAt });
  });

  done();
};
