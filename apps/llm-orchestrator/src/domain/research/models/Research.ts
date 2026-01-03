/**
 * Research domain models.
 * Core entities for the LLM research orchestration.
 */

import { CLAUDE_DEFAULTS } from '@intexuraos/infra-claude';
import { GEMINI_DEFAULTS } from '@intexuraos/infra-gemini';
import { GPT_DEFAULTS } from '@intexuraos/infra-gpt';

export type LlmProvider = 'google' | 'openai' | 'anthropic';

export type SearchMode = 'deep' | 'quick';

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
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
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

export function getModelForMode(provider: LlmProvider, searchMode: SearchMode): string {
  switch (provider) {
    case 'google':
      return searchMode === 'quick' ? GEMINI_DEFAULTS.defaultModel : GEMINI_DEFAULTS.researchModel;
    case 'openai':
      return searchMode === 'quick' ? GPT_DEFAULTS.defaultModel : GPT_DEFAULTS.researchModel;
    case 'anthropic':
      return searchMode === 'quick' ? CLAUDE_DEFAULTS.defaultModel : CLAUDE_DEFAULTS.researchModel;
  }
}

export function createLlmResults(
  selectedLlms: LlmProvider[],
  searchMode: SearchMode = 'deep'
): LlmResult[] {
  return selectedLlms.map((provider) => ({
    provider,
    model: getModelForMode(provider, searchMode),
    status: 'pending' as const,
  }));
}

export function createResearch(params: {
  id: string;
  userId: string;
  prompt: string;
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
  externalReports?: { content: string; model?: string }[];
  skipSynthesis?: boolean;
  searchMode?: SearchMode;
}): Research {
  const now = new Date().toISOString();
  const resolvedSearchMode = params.searchMode ?? 'deep';
  const research: Research = {
    id: params.id,
    userId: params.userId,
    title: '',
    prompt: params.prompt,
    selectedLlms: params.selectedLlms,
    synthesisLlm: params.synthesisLlm,
    status: 'pending',
    llmResults: createLlmResults(params.selectedLlms, resolvedSearchMode),
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
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
  sourceActionId?: string;
  externalReports?: ExternalReport[];
  searchMode?: SearchMode;
}): Research {
  const now = new Date().toISOString();
  const resolvedSearchMode = params.searchMode ?? 'deep';
  const research: Research = {
    id: params.id,
    userId: params.userId,
    title: params.title,
    prompt: params.prompt,
    selectedLlms: params.selectedLlms,
    synthesisLlm: params.synthesisLlm,
    status: 'draft',
    llmResults: createLlmResults(params.selectedLlms, resolvedSearchMode),
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
  additionalLlms?: LlmProvider[];
  additionalContexts?: { content: string; model?: string }[];
  synthesisLlm?: LlmProvider;
  removeContextIds?: string[];
  searchMode?: SearchMode;
}

export function createEnhancedResearch(params: EnhanceResearchParams): Research {
  const now = new Date().toISOString();
  const resolvedSearchMode = params.searchMode ?? 'deep';
  const source = params.sourceResearch;

  const completedResults = source.llmResults
    .filter((r) => r.status === 'completed')
    .map((r) => ({ ...r }));

  const existingProviders = new Set(completedResults.map((r) => r.provider));
  const newProviders = (params.additionalLlms ?? []).filter((p) => !existingProviders.has(p));
  const newResults = createLlmResults(newProviders, resolvedSearchMode);

  const allProviders = [...new Set([...completedResults.map((r) => r.provider), ...newProviders])];

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
    selectedLlms: allProviders,
    synthesisLlm: params.synthesisLlm ?? source.synthesisLlm,
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
