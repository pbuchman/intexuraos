/**
 * @intexuraos/llm-factory
 *
 * Unified factory for creating LLM clients across different providers.
 */

export {
  createLlmClient,
  createToolCallingClient,
  type LlmClientConfig,
  type ToolCallingClientConfig,
  type LlmGenerateClient,
  type GenerateOptions,
  type GenerateChatOptions,
  type GenerateChatResult,
  type GenerateResult,
  type LlmChatMessage,
  type LlmChatRole,
  type LlmChatTextBlock,
  type LLMError,
  isSupportedProvider,
} from './llmClientFactory.js';
export { createOpenRouterGenerateClient } from './openRouterGenerateClient.js';
export { createClaudeGenerateClient } from './claudeGenerateClient.js';
export { createGptGenerateClient } from './gptGenerateClient.js';
export { createPerplexityGenerateClient } from './perplexityGenerateClient.js';
