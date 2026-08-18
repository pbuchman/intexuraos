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
  type GenerateResult,
  type LLMError,
  isSupportedProvider,
} from './llmClientFactory.js';
export type {
  GenerateChatOptions,
  GenerateChatReasoningEffort,
  GenerateChatReasoningOptions,
  GenerateChatResult,
  GenerateChatStreamEvent,
  LlmChatMessage,
  LlmChatRole,
  LlmChatTextBlock,
} from '@intexuraos/llm-contract';
export { createOpenRouterGenerateClient } from './openRouterGenerateClient.js';
