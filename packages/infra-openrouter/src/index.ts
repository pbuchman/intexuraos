/**
 * @intexuraos/infra-openrouter
 *
 * OpenRouter client implementation providing access to frontier models
 * from multiple providers through a unified OpenAI-compatible API.
 */

export { createOpenRouterClient, type OpenRouterClient } from './client.js';
export { OPENROUTER_ALLOWED_MODELS, isAllowedModel, getAllowlistPricing } from './allowlist.js';
export { calculateTextCost, normalizeUsage, toModelPricing } from './costCalculator.js';
export type {
  OpenRouterConfig,
  OpenRouterError,
  OpenRouterModelInfo,
  OpenRouterKeyInfo,
  OpenRouterUsage,
  OpenRouterResponse,
  ResearchResult,
  GenerateResult,
} from './types.js';
