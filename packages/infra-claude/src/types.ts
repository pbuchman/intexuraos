export interface ClaudeConfig {
  apiKey: string;
  model?: string; // default: 'claude-sonnet-4-20250514'
}

export interface ResearchResult {
  content: string;
  sources?: string[];
}

export interface ClaudeError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED' | 'OVERLOADED';
  message: string;
}
