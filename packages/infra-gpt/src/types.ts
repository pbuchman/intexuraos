export interface GptConfig {
  apiKey: string;
  model?: string; // default: 'gpt-4o'
}

export interface ResearchResult {
  content: string;
  sources?: string[]; // GPT doesn't provide sources
}

export interface GptError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED' | 'CONTEXT_LENGTH';
  message: string;
}
