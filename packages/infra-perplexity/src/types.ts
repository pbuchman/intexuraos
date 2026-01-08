export type {
  LLMError as PerplexityError,
  ResearchResult,
  GenerateResult,
  ModelPricing,
} from '@intexuraos/llm-contract';

/**
 * Logger interface for Perplexity API calls.
 */
export interface PerplexityLogger {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}

/**
 * Perplexity client configuration with explicit pricing.
 */
export interface PerplexityConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: import('@intexuraos/llm-contract').ModelPricing;
  /** Request timeout in milliseconds. Default: 840000 (14 minutes) */
  timeoutMs?: number;
  /** Optional logger for SSE stream debugging */
  logger?: PerplexityLogger;
}

export type SearchContextSize = 'low' | 'medium' | 'high';

export interface PerplexityRequestBody {
  model: string;
  messages: {
    role: 'system' | 'user';
    content: string;
  }[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface PerplexitySearchResult {
  title?: string;
  url?: string;
  date?: string;
}

export interface PerplexityCost {
  input_tokens_cost?: number;
  output_tokens_cost?: number;
  request_cost?: number;
  total_cost?: number;
}

export interface PerplexityUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  citation_tokens?: number;
  reasoning_tokens?: number;
  search_context_size?: SearchContextSize;
  cost?: PerplexityCost;
}

export interface PerplexityResponse {
  id: string;
  model: string;
  created: number;
  object: string;
  choices: {
    index: number;
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }[];
  usage?: PerplexityUsage;
  search_results?: PerplexitySearchResult[];
}
