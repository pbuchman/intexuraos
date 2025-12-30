export interface ClaudeConfig {
  apiKey: string;
  model?: string; // default: 'claude-opus-4-5'
}

export interface ResearchResult {
  content: string;
  sources?: string[];
}

export interface SynthesisInput {
  model: string;
  content: string;
}

export interface ClaudeError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED' | 'OVERLOADED';
  message: string;
}
