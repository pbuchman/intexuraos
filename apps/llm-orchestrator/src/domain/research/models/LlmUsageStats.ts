import type { LlmProvider } from './Research.js';

export interface LlmUsageStats {
  provider: LlmProvider;
  model: string;
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
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
