import type { Result } from '@intexuraos/common-core';
import type {
  ExecutionMemoryApplication,
  ExecutionMemoryApplicationMatch,
  ExecutionMemoryApplicationStatus,
  ExecutionMemoryPerMemoryOutcome,
} from '../models/executionMemoryApplication.js';

export interface CreateExecutionMemoryApplicationInput {
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
}

export interface UpdateExecutionMemoryApplicationInput {
  status?: ExecutionMemoryApplicationStatus;
  memoryIdsUsed?: string[];
  memoryIdsRejected?: string[];
  evaluationSummary?: string;
  perMemoryOutcome?: ExecutionMemoryPerMemoryOutcome[];
  completedAt?: Date;
}

export type ExecutionMemoryApplicationRepositoryError =
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'FIRESTORE_ERROR'; message: string };

export interface ExecutionMemoryApplicationRepository {
  create(
    input: CreateExecutionMemoryApplicationInput
  ): Promise<Result<ExecutionMemoryApplication, ExecutionMemoryApplicationRepositoryError>>;
  findById(
    id: string
  ): Promise<Result<ExecutionMemoryApplication, ExecutionMemoryApplicationRepositoryError>>;
  update(
    id: string,
    input: UpdateExecutionMemoryApplicationInput
  ): Promise<Result<ExecutionMemoryApplication, ExecutionMemoryApplicationRepositoryError>>;
}
