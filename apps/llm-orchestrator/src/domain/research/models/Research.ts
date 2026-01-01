/**
 * Research domain models.
 * Core entities for the LLM research orchestration.
 */

import { CLAUDE_DEFAULTS } from '@intexuraos/infra-claude';
import { GEMINI_DEFAULTS } from '@intexuraos/infra-gemini';
import { GPT_DEFAULTS } from '@intexuraos/infra-gpt';

export type LlmProvider = 'google' | 'openai' | 'anthropic';

export type ResearchStatus = 'draft' | 'pending' | 'processing' | 'completed' | 'failed';

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
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  sourceActionId?: string;
}

function getDefaultModel(provider: LlmProvider): string {
  switch (provider) {
    case 'google':
      return GEMINI_DEFAULTS.researchModel;
    case 'openai':
      return GPT_DEFAULTS.researchModel;
    case 'anthropic':
      return CLAUDE_DEFAULTS.researchModel;
  }
}

export function createResearch(params: {
  id: string;
  userId: string;
  prompt: string;
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
  externalReports?: { content: string; model?: string }[];
}): Research {
  const now = new Date().toISOString();
  const research: Research = {
    id: params.id,
    userId: params.userId,
    title: '',
    prompt: params.prompt,
    selectedLlms: params.selectedLlms,
    synthesisLlm: params.synthesisLlm,
    status: 'pending',
    llmResults: params.selectedLlms.map((provider) => ({
      provider,
      model: getDefaultModel(provider),
      status: 'pending' as const,
    })),
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
}): Research {
  const now = new Date().toISOString();
  const research: Research = {
    id: params.id,
    userId: params.userId,
    title: params.title,
    prompt: params.prompt,
    selectedLlms: params.selectedLlms,
    synthesisLlm: params.synthesisLlm,
    status: 'draft',
    llmResults: params.selectedLlms.map((provider) => ({
      provider,
      model: getDefaultModel(provider),
      status: 'pending' as const,
    })),
    startedAt: now,
  };

  if (params.sourceActionId !== undefined) {
    research.sourceActionId = params.sourceActionId;
  }

  return research;
}
