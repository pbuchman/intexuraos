/**
 * @intexuraos/infra-openrouter
 *
 * OpenRouter client implementation providing access to frontier models
 * from multiple providers through a unified OpenAI-compatible API.
 */

export { createOpenRouterClient, type OpenRouterClient } from './client.js';
export {
  createOpenRouterToolCallingClient,
  type OpenRouterToolCallingConfig,
} from './toolCallingClient.js';
export {
  OPENROUTER_ALLOWED_MODELS,
  OPENROUTER_VALIDATION_MODEL,
  isAllowedModel,
  allowlistModelIds,
  buildModelInfo,
  type AllowedOpenRouterModel,
  type CatalogEntry,
} from './allowlist.js';
export {
  DEFAULT_OPENROUTER_ALLOWED_MODELS,
  isDefaultAllowedModel,
  type DefaultAllowedOpenRouterModel,
} from './defaultAllowlist.js';
export { normalizeUsage, toModelPricing } from './costCalculator.js';
export type {
  GenerateOptions,
  GenerateChatOptions,
  GenerateChatResult,
  LlmChatMessage,
  LlmChatRole,
  LlmChatTextBlock,
  OpenRouterConfig,
  OpenRouterError,
  OpenRouterModelInfo,
  OpenRouterKeyInfo,
  OpenRouterUsage,
  OpenRouterResponse,
  ResearchResult,
  GenerateResult,
} from './types.js';
