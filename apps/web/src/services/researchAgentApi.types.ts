/**
 * Research Agent types for research management.
 */

import type { LlmProvider as ContractLlmProvider, ResearchModel } from '@intexuraos/llm-contract';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

export type LlmProvider = ContractLlmProvider;

export type SupportedModel = ResearchModel;

const MODEL_TO_PROVIDER: Record<SupportedModel, LlmProvider> = {
  [LlmModels.Gemini25Pro]: LlmProviders.Google,
  [LlmModels.Gemini25Flash]: LlmProviders.Google,
  [LlmModels.ClaudeOpus45]: LlmProviders.Anthropic,
  [LlmModels.ClaudeSonnet45]: LlmProviders.Anthropic,
  [LlmModels.O4MiniDeepResearch]: LlmProviders.OpenAI,
  [LlmModels.GPT52]: LlmProviders.OpenAI,
  [LlmModels.Sonar]: LlmProviders.Perplexity,
  [LlmModels.SonarPro]: LlmProviders.Perplexity,
  [LlmModels.SonarDeepResearch]: LlmProviders.Perplexity,
};

export function getProviderForModel(model: SupportedModel): LlmProvider {
  return MODEL_TO_PROVIDER[model];
}

export type ResearchStatus =
  | 'draft'
  | 'pending'
  | 'processing'
  | 'awaiting_confirmation'
  | 'retrying'
  | 'synthesizing'
  | 'completed'
  | 'failed';

export type PartialFailureDecision = 'proceed' | 'retry' | 'cancel';

export interface PartialFailure {
  failedProviders: LlmProvider[];
  userDecision?: PartialFailureDecision;
  detectedAt: string;
  retryCount: number;
}

/**
 * Individual LLM result within a research.
 */
export interface LlmResult {
  provider: LlmProvider;
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  sources?: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * User-provided context included in research.
 */
export interface InputContext {
  id: string;
  content: string;
  label?: string;
  addedAt: string;
}

/**
 * Public share information for a research.
 */
export interface ShareInfo {
  shareToken: string;
  slug: string;
  shareUrl: string;
  sharedAt: string;
  gcsPath: string;
}

/**
 * Research document representing a multi-LLM research session.
 */
export interface Research {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  selectedModels: SupportedModel[];
  synthesisModel: SupportedModel;
  status: ResearchStatus;
  llmResults: LlmResult[];
  inputContexts?: InputContext[];
  synthesizedResult?: string;
  synthesisError?: string;
  partialFailure?: PartialFailure;
  shareInfo?: ShareInfo;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCostUsd?: number;
  skipSynthesis?: boolean;
  favourite?: boolean;
}

/**
 * Request body for creating a new research.
 */
export interface CreateResearchRequest {
  prompt: string;
  selectedModels: SupportedModel[];
  synthesisModel: SupportedModel;
  inputContexts?: { content: string }[];
  skipSynthesis?: boolean;
}

/**
 * Request body for saving a research draft (only prompt required).
 */
export interface SaveDraftRequest {
  prompt: string;
  selectedModels?: SupportedModel[];
  synthesisModel?: SupportedModel;
  inputContexts?: { content: string }[];
}

/**
 * Response from listing researches.
 */
export interface ListResearchesResponse {
  items: Research[];
  nextCursor?: string;
}

/**
 * Response from confirming partial failure action.
 */
export interface ConfirmPartialFailureResponse {
  action: PartialFailureDecision;
  message: string;
}

/**
 * Request body for validating input quality.
 */
export interface ValidateInputRequest {
  prompt: string;
  includeImprovement?: boolean;
}

/**
 * Response from input validation endpoint.
 */
export interface ValidateInputResponse {
  quality: 0 | 1 | 2;
  reason: string;
  improvedPrompt: string | null;
}

/**
 * Request body for improving input.
 */
export interface ImproveInputRequest {
  prompt: string;
}

/**
 * Response from input improvement endpoint.
 */
export interface ImproveInputResponse {
  improvedPrompt: string;
}
