/**
 * Research domain models.
 * Core entities for the LLM research orchestration.
 */

import {
  getProviderForModel,
  type LlmProvider,
  type SupportedModel,
} from '@intexuraos/llm-contract';

export type { LlmProvider, SupportedModel } from '@intexuraos/llm-contract';

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
 * External LLM report provided by user (e.g., from Perplexity, GPT-4 web).
 * Max 60k chars per report, max 5 reports total.
 */
export interface ExternalReport {
  id: string;
  content: string;
  model?: string;
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
  externalReports?: ExternalReport[];
  synthesizedResult?: string;
  synthesisError?: string;
  partialFailure?: PartialFailure;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  sourceActionId?: string;
  skipSynthesis?: boolean;
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
  externalReports?: { content: string; model?: string }[];
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

  if (params.externalReports !== undefined && params.externalReports.length > 0) {
    research.externalReports = params.externalReports.map((report, idx) => {
      const externalReport: ExternalReport = {
        id: `${params.id}-ext-${String(idx)}`,
        content: report.content,
        addedAt: now,
      };
      if (report.model !== undefined) {
        externalReport.model = report.model;
      }
      return externalReport;
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
  externalReports?: ExternalReport[];
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

  if (params.externalReports !== undefined) {
    research.externalReports = params.externalReports;
  }

  return research;
}

export interface EnhanceResearchParams {
  id: string;
  userId: string;
  sourceResearch: Research;
  additionalModels?: SupportedModel[];
  additionalContexts?: { content: string; model?: string }[];
  synthesisModel?: SupportedModel;
  removeContextIds?: string[];
}

export function createEnhancedResearch(params: EnhanceResearchParams): Research {
  const now = new Date().toISOString();
  const source = params.sourceResearch;

  const completedResults = source.llmResults
    .filter((r) => r.status === 'completed')
    .map((r) => ({ ...r }));

  const existingModels = new Set(completedResults.map((r) => r.model));
  const newModels = (params.additionalModels ?? []).filter((m) => !existingModels.has(m));
  const newResults = createLlmResults(newModels);

  const allModels = [
    ...new Set([...completedResults.map((r) => r.model as SupportedModel), ...newModels]),
  ];

  const removeSet = new Set(params.removeContextIds ?? []);
  const existingContexts = (source.externalReports ?? []).filter((r) => !removeSet.has(r.id));

  const additionalContexts: ExternalReport[] = (params.additionalContexts ?? []).map((ctx, idx) => {
    const report: ExternalReport = {
      id: `${params.id}-ext-${String(idx)}`,
      content: ctx.content,
      addedAt: now,
    };
    if (ctx.model !== undefined) {
      report.model = ctx.model;
    }
    return report;
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
    research.externalReports = allContexts;
  }

  return research;
}
