/**
 * Research domain models.
 * Core entities for the LLM research orchestration.
 */

export type LlmProvider = 'google' | 'openai' | 'anthropic';

export type ResearchStatus = 'pending' | 'processing' | 'completed' | 'failed';

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

export interface Research {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
  status: ResearchStatus;
  llmResults: LlmResult[];
  synthesizedResult?: string;
  synthesisError?: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
}

function getDefaultModel(provider: LlmProvider): string {
  switch (provider) {
    case 'google':
      return 'gemini-3-pro-preview';
    case 'openai':
      return 'gpt-4.1';
    case 'anthropic':
      return 'claude-opus-4-5';
  }
}

export function createResearch(params: {
  id: string;
  userId: string;
  prompt: string;
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
}): Research {
  return {
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
    startedAt: new Date().toISOString(),
  };
}
