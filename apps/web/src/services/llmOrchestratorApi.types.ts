/**
 * LLM Orchestrator types for research management.
 */

export type LlmProvider = 'google' | 'openai' | 'anthropic';
export type ResearchStatus = 'pending' | 'processing' | 'completed' | 'failed';

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
  synthesizedResult?: string;
  synthesisError?: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
}

/**
 * Request body for creating a new research.
 */
export interface CreateResearchRequest {
  prompt: string;
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
}

/**
 * Response from listing researches.
 */
export interface ListResearchesResponse {
  items: Research[];
  nextCursor?: string;
}
