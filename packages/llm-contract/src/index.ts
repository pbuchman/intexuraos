/**
 * @intexuraos/llm-contract
 *
 * Common types and interfaces for LLM client implementations.
 */

export type {
  LLMConfig,
  TokenUsage,
  NormalizedUsage,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
  LLMErrorCode,
  LLMError,
  LLMClient,
} from './types.js';

export {
  SUPPORTED_MODELS,
  SYSTEM_DEFAULT_MODELS,
  getProviderForModel,
  isValidModel,
  getModelsForProvider,
  getDisplayName,
} from './supportedModels.js';

export type { SupportedModel, LlmProvider } from './supportedModels.js';

export { generateThumbnailPrompt } from './helpers.js';
export type {
  ThumbnailPrompt,
  ThumbnailPromptParameters,
  ThumbnailPromptError,
  ThumbnailPromptResult,
  RealismStyle,
} from './helpers.js';
