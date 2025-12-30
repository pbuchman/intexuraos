export interface GptConfig {
  apiKey: string;
  model?: string; // default: 'gpt-5.2-pro'
}

export interface ResearchResult {
  content: string;
  sources?: string[]; // GPT doesn't provide sources
}

export interface SynthesisInput {
  model: string;
  content: string;
}

export interface GptError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED' | 'CONTEXT_LENGTH';
  message: string;
}
