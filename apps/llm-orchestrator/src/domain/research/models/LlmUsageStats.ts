import type { LlmProvider } from './Research.js';

export type LlmCallType =
  | 'research'
  | 'synthesis'
  | 'title'
  | 'context_inference'
  | 'context_label'
  | 'image_prompt'
  | 'image_generation'
  | 'validation'
  | 'other';

export interface LlmUsageStats {
  provider: LlmProvider;
  model: string;
  callType: LlmCallType;
  period: string; // 'total' | 'YYYY-MM' | 'YYYY-MM-DD'

  calls: number;
  successfulCalls: number;
  failedCalls: number;

  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  costUsd: number;

  lastUpdatedAt: string;
}

export interface LlmUsageIncrement {
  provider: LlmProvider;
  model: string;
  callType: LlmCallType;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
