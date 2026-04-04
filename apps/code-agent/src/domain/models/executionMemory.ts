import type { Timestamp } from '@google-cloud/firestore';

export type ExecutionMemoryType =
  | 'implementation_pattern'
  | 'verification_pattern'
  | 'pitfall_pattern'
  | 'decomposition_pattern'
  | 'planning_decision'
  | 'review_finding';

export type ExecutionMemoryStatus = 'active' | 'suppressed';

export type ExecutionMemoryEmbeddingModel = 'text-embedding-3-small';

export interface ExecutionMemory {
  id: string;
  repository: string;
  sourceTaskId: string;
  sourceLinearIssueId?: string;
  sourceAgentType?: 'execution' | 'planning' | 'review';
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
  distillationConfidence: number;
  applicationCount: number;
  positiveCount: number;
  negativeCount: number;
  status: ExecutionMemoryStatus;
  lastAppliedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ExecutionMemoryMatch extends ExecutionMemory {
  vectorScore: number;
}
