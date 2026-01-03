/**
 * LLM Orchestrator types for research management.
 */

export type LlmProvider = 'google' | 'openai' | 'anthropic';
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
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
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
  skipSynthesis?: boolean;
}

/**
 * Request body for creating a new research.
 */
export interface CreateResearchRequest {
  prompt: string;
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
  inputContexts?: { content: string }[];
  skipSynthesis?: boolean;
}

/**
 * Request body for saving a research draft (only prompt required).
 */
export interface SaveDraftRequest {
  prompt: string;
  selectedLlms?: LlmProvider[];
  synthesisLlm?: LlmProvider;
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
 * LLM usage statistics per model.
 */
export interface LlmUsageStats {
  provider: LlmProvider;
  model: string;
  period: string;
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  lastUpdatedAt: string;
}
