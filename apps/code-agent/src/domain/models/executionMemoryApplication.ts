import type { Timestamp } from '@google-cloud/firestore';
import type { ExecutionMemoryType } from './executionMemory.js';

export type ExecutionMemoryApplicationStatus = 'matched' | 'no_match' | 'error';
export type ExecutionMemoryOutcome = 'positive' | 'neutral' | 'negative' | 'unknown';

export interface ExecutionMemoryApplicationMatch {
  memoryId: string;
  vectorScore: number;
  rerankScore: number;
  title: string;
  memoryType: ExecutionMemoryType;
}

export interface ExecutionMemoryPerMemoryOutcome {
  memoryId: string;
  outcome: ExecutionMemoryOutcome;
  reason: string;
  confidence: number;
}

export interface ExecutionMemoryApplication {
  id: string;
  taskId: string;
  repository: string;
  linearIssueId?: string;
  querySummary: string;
  queryText: string;
  queryComponents: string[];
  queryRiskFlags: string[];
  retrievalVersion: string;
  matchedMemories: ExecutionMemoryApplicationMatch[];
  status: ExecutionMemoryApplicationStatus;
  memoryIdsUsed: string[];
  memoryIdsRejected: string[];
  evaluationSummary?: string;
  perMemoryOutcome?: ExecutionMemoryPerMemoryOutcome[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
}
