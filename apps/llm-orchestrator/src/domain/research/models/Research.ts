/**
 * Research domain models.
 * Core entities for the LLM research orchestration.
 */

import {
  getProviderForModel,
  type LlmProvider,
  type SupportedModel,
} from '@intexuraos/llm-contract';
import type { ResearchContext } from '@intexuraos/common-core';

export type { LlmProvider, SupportedModel } from '@intexuraos/llm-contract';
export type { ResearchContext } from '@intexuraos/common-core';

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
  failedModels: SupportedModel[];
  userDecision?: PartialFailureDecision;
  detectedAt: string;
  retryCount: number;
}

export type LlmResultStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface LlmResult {
  provider: LlmProvider;
  model: string;
  status: LlmResultStatus;
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
 * Input context provided by user (e.g., articles, notes, external research).
 * Max 60k chars per context, max 5 contexts total.
 */
export interface InputContext {
  id: string;
  content: string;
  label?: string;
  addedAt: string;
}

/**
 * Public sharing information for a completed research.
 * Generated automatically when synthesis completes.
 */
export interface ShareInfo {
  shareToken: string;
  slug: string;
  shareUrl: string;
  sharedAt: string;
  gcsPath: string;
  coverImageId?: string;
}

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
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCostUsd?: number;
  sourceActionId?: string;
  skipSynthesis?: boolean;
  researchContext?: ResearchContext;
  shareInfo?: ShareInfo;
  sourceResearchId?: string;
}

export function createLlmResults(selectedModels: SupportedModel[]): LlmResult[] {
  return selectedModels.map((model) => ({
    provider: getProviderForModel(model),
    model,
    status: 'pending' as const,
  }));
}

export function createResearch(params: {
  id: string;
  userId: string;
  prompt: string;
  selectedModels: SupportedModel[];
  synthesisModel: SupportedModel;
  inputContexts?: { content: string; label?: string | undefined }[];
  skipSynthesis?: boolean;
}): Research {
  const now = new Date().toISOString();
  const research: Research = {
    id: params.id,
    userId: params.userId,
    title: '',
    prompt: params.prompt,
    selectedModels: params.selectedModels,
    synthesisModel: params.synthesisModel,
    status: 'pending',
    llmResults: createLlmResults(params.selectedModels),
    startedAt: now,
  };

  if (params.inputContexts !== undefined && params.inputContexts.length > 0) {
    research.inputContexts = params.inputContexts.map((ctx, idx) => {
      const inputContext: InputContext = {
        id: `${params.id}-ctx-${String(idx)}`,
        content: ctx.content,
        addedAt: now,
      };
      if (ctx.label !== undefined) {
        inputContext.label = ctx.label;
      }
      return inputContext;
    });
  }

  if (params.skipSynthesis === true) {
    research.skipSynthesis = true;
  }

  return research;
}

export function createDraftResearch(params: {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  selectedModels: SupportedModel[];
  synthesisModel: SupportedModel;
  sourceActionId?: string;
  inputContexts?: InputContext[];
}): Research {
  const now = new Date().toISOString();
  const research: Research = {
    id: params.id,
    userId: params.userId,
    title: params.title,
    prompt: params.prompt,
    selectedModels: params.selectedModels,
    synthesisModel: params.synthesisModel,
    status: 'draft',
    llmResults: createLlmResults(params.selectedModels),
    startedAt: now,
  };

  if (params.sourceActionId !== undefined) {
    research.sourceActionId = params.sourceActionId;
  }

  if (params.inputContexts !== undefined) {
    research.inputContexts = params.inputContexts;
  }

  return research;
}

export interface EnhanceResearchParams {
  id: string;
  userId: string;
  sourceResearch: Research;
  additionalModels?: SupportedModel[];
  additionalContexts?: { content: string; label?: string | undefined }[];
  synthesisModel?: SupportedModel;
  removeContextIds?: string[];
}

export function createEnhancedResearch(params: EnhanceResearchParams): Research {
  const now = new Date().toISOString();
  const source = params.sourceResearch;

  // Copy completed results but omit usage stats - they'll be recalculated after synthesis
  const completedResults: LlmResult[] = source.llmResults
    .filter((r) => r.status === 'completed')
    .map(({ inputTokens: _, outputTokens: __, costUsd: ___, ...rest }) => rest);

  const existingModels = new Set(completedResults.map((r) => r.model));
  const newModels = (params.additionalModels ?? []).filter((m) => !existingModels.has(m));
  const newResults = createLlmResults(newModels);

  const allModels = [
    ...new Set([...completedResults.map((r) => r.model as SupportedModel), ...newModels]),
  ];

  const removeSet = new Set(params.removeContextIds ?? []);
  const existingContexts = (source.inputContexts ?? []).filter((r) => !removeSet.has(r.id));

  const additionalContexts: InputContext[] = (params.additionalContexts ?? []).map((ctx, idx) => {
    const inputContext: InputContext = {
      id: `${params.id}-ctx-${String(idx)}`,
      content: ctx.content,
      addedAt: now,
    };
    if (ctx.label !== undefined) {
      inputContext.label = ctx.label;
    }
    return inputContext;
  });

  const allContexts = [...existingContexts, ...additionalContexts];

  const research: Research = {
    id: params.id,
    userId: params.userId,
    title: source.title,
    prompt: source.prompt,
    selectedModels: allModels,
    synthesisModel: params.synthesisModel ?? source.synthesisModel,
    status: 'pending',
    llmResults: [...completedResults, ...newResults],
    startedAt: now,
    sourceResearchId: source.id,
  };

  if (allContexts.length > 0) {
    research.inputContexts = allContexts;
  }

  return research;
}
