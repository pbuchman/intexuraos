export interface GeminiConfig {
  apiKey: string;
  model?: string; // default: 'gemini-2.0-flash'
}

export interface ResearchResult {
  content: string;
  sources?: string[];
}

export interface SynthesisInput {
  model: string;
  content: string;
}

export interface ClassificationResult<T extends string = string> {
  type: T;
  confidence: number;
  title: string;
}

export interface ClassifyOptions<T extends string = string> {
  text: string;
  systemPrompt: string;
  validTypes: readonly T[];
  defaultType: T;
}

export interface GeminiError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED' | 'PARSE_ERROR';
  message: string;
}
