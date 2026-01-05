/**
 * LLM Orchestrator types for research management.
 */

export type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity';

export type SupportedModel =
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-5-20250929'
  | 'o4-mini-deep-research'
  | 'gpt-5.2'
  | 'sonar'
  | 'sonar-pro'
  | 'sonar-deep-research';

const MODEL_TO_PROVIDER: Record<SupportedModel, LlmProvider> = {
  'gemini-2.5-pro': 'google',
  'gemini-2.5-flash': 'google',
  'claude-opus-4-5-20251101': 'anthropic',
  'claude-sonnet-4-5-20250929': 'anthropic',
  'o4-mini-deep-research': 'openai',
  'gpt-5.2': 'openai',
  sonar: 'perplexity',
  'sonar-pro': 'perplexity',
  'sonar-deep-research': 'perplexity',
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
  skipSynthesis?: boolean;
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
