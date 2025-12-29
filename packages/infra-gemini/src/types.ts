export interface GeminiConfig {
  apiKey: string;
  model?: string; // default: 'gemini-2.0-flash-exp'
}

export interface ResearchResult {
  content: string;
  sources?: string[];
}

export interface SynthesisInput {
  model: string;
  content: string;
}

export interface GeminiError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED';
  message: string;
}
