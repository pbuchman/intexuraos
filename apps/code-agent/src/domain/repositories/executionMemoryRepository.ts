import type { Timestamp } from '@google-cloud/firestore';
import type { Result } from '@intexuraos/common-core';
import type {
  ExecutionMemory,
  ExecutionMemoryEmbeddingModel,
  ExecutionMemoryMatch,
  ExecutionMemoryStatus,
  ExecutionMemoryType,
} from '../models/executionMemory.js';

export interface CreateExecutionMemoryInput {
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
  embedding: number[];
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
}

export interface UpdateExecutionMemoryInput {
  sourceTaskId?: string;
  sourceLinearIssueId?: string;
  sourceAgentType?: 'execution' | 'planning' | 'review';
  memoryType?: ExecutionMemoryType;
  title?: string;
  appliesWhen?: string;
  action?: string;
  avoid?: string;
  verification?: string;
  evidenceSummary?: string;
  retrievalText?: string;
  keywords?: string[];
  labelHints?: string[];
  componentHints?: string[];
  embedding?: number[];
  embeddingModel?: ExecutionMemoryEmbeddingModel;
  fingerprint?: string;
  distillationVersion?: string;
  qualityScore?: number;
  distillationConfidence?: number;
  applicationCount?: number;
  positiveCount?: number;
  negativeCount?: number;
  status?: ExecutionMemoryStatus;
  lastAppliedAt?: Timestamp;
}

export interface FindNearestExecutionMemoryInput {
  repository: string;
  embedding: number[];
  limit: number;
  status?: ExecutionMemoryStatus;
}

export type ExecutionMemoryRepositoryError =
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'FIRESTORE_ERROR'; message: string };

export interface ExecutionMemoryRepository {
  create(input: CreateExecutionMemoryInput): Promise<Result<ExecutionMemory, ExecutionMemoryRepositoryError>>;
  findById(id: string): Promise<Result<ExecutionMemory, ExecutionMemoryRepositoryError>>;
  findByFingerprint(
    repository: string,
    fingerprint: string
  ): Promise<Result<ExecutionMemory | null, ExecutionMemoryRepositoryError>>;
  findNearest(
    input: FindNearestExecutionMemoryInput
  ): Promise<Result<ExecutionMemoryMatch[], ExecutionMemoryRepositoryError>>;
  update(
    id: string,
    input: UpdateExecutionMemoryInput
  ): Promise<Result<ExecutionMemory, ExecutionMemoryRepositoryError>>;
}
