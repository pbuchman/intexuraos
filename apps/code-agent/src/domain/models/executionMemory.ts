import type { Timestamp } from '@google-cloud/firestore';

export type ExecutionMemoryType =
  | 'implementation_pattern'
  | 'verification_pattern'
  | 'pitfall_pattern';

export type ExecutionMemoryStatus = 'active' | 'suppressed';

export type ExecutionMemoryEmbeddingModel = 'text-embedding-3-small';

export interface ExecutionMemory {
  id: string;
  repository: string;
  sourceTaskId: string;
  sourceLinearIssueId?: string;
  memoryType: ExecutionMemoryType;
  title: string;
  appliesWhen: string;
  action: string;
  avoid: string;
  verification: string;
  evidenceSummary: string;
  retrievalText: string;
  keywords: string[];
  labelHints: string[];
  componentHints: string[];
  embeddingModel: ExecutionMemoryEmbeddingModel;
  fingerprint: string;
  distillationVersion: string;
  qualityScore: number;
  applicationCount: number;
  positiveCount: number;
  negativeCount: number;
  status: ExecutionMemoryStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ExecutionMemoryMatch extends ExecutionMemory {
  vectorScore: number;
}
