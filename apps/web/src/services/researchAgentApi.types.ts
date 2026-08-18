/**
 * Research Agent types for research management.
 */

import type { ExecutableLlmProvider, ResearchModel } from '@intexuraos/llm-contract';
import { LlmProviders, isOpenRouterModel } from '@intexuraos/llm-contract';

export type LlmProvider = ExecutableLlmProvider;

export type SupportedModel = ResearchModel;
export type StoredResearchModel = string;

export function isSelectableModel(model: string): model is SupportedModel {
  return isOpenRouterModel(model);
}

export function getProviderForStoredModel(model: StoredResearchModel): LlmProvider | null {
  return isOpenRouterModel(model) ? LlmProviders.OpenRouter : null;
}

/** Model info from OpenRouter curated allowlist */
export interface OpenRouterModelInfo {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  pricing: {
    inputPricePerMillion: number;
    outputPricePerMillion: number;
  };
  inputModalities: string[];
  outputModalities: string[];
}

export interface OpenRouterModelsResponse {
  models: OpenRouterModelInfo[];
  cachedAt: string;
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
  failedModels: StoredResearchModel[];
  userDecision?: PartialFailureDecision;
  detectedAt: string;
  retryCount: number;
}

/**
 * Individual LLM result within a research.
 */
export interface LlmResult {
  provider: string;
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
  coverImageId?: string;
  coverImageUrl?: string;
}

/**
 * Notion export information for a research.
 */
export interface NotionExportInfo {
  mainPageId: string;
  mainPageUrl: string;
  llmReportPageIds: { model: string; pageId: string }[];
  exportedAt: string;
}

/**
 * Research document representing a multi-LLM research session.
 */
export interface Research {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  /** Original user prompt before improvement. Only set when user accepted an improved suggestion. */
  originalPrompt?: string;
  selectedModels: StoredResearchModel[];
  synthesisModel: StoredResearchModel;
  status: ResearchStatus;
  llmResults: LlmResult[];
  inputContexts?: InputContext[];
  synthesizedResult?: string;
  synthesisError?: string;
  partialFailure?: PartialFailure;
  shareInfo?: ShareInfo;
  notionExportInfo?: NotionExportInfo;
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
  /** Original user prompt before improvement. Set when user accepted an improved suggestion. */
  originalPrompt?: string;
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
 * Lightweight status info for each LLM model in a research.
 * Used in list view to show per-model progress without transferring result text.
 */
export interface LlmResultStatusInfo {
  provider: string;
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

/**
 * Summary projection of a Research for list views.
 * Contains only the fields needed to render a research card.
 * Full document fetched separately when opening research detail.
 */
export interface ResearchSummary {
  id: string;
  userId: string;
  title: string;
  status: ResearchStatus;
  selectedModels: StoredResearchModel[];
  synthesisModel: StoredResearchModel;
  startedAt: string;
  completedAt?: string;
  favourite?: boolean;
  llmResultStatuses: LlmResultStatusInfo[];
  totalCostUsd?: number;
  partialFailure?: PartialFailure;
}

/**
 * Response from listing researches (summary projection).
 */
export interface ListResearchSummariesResponse {
  items: ResearchSummary[];
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
