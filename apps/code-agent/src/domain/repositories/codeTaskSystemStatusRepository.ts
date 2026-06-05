import type { Result } from '@intexuraos/common-core';
import type {
  CodeTaskSystemStatus,
  UpsertCodeTaskSystemStatusInput,
} from '../models/codeTaskSystemStatus.js';
import type { CodeTaskDispatchBlockerReason } from '../services/codeTaskDispatchBlockers.js';

export interface CodeTaskSystemStatusRepositoryError {
  readonly code: 'FIRESTORE_ERROR';
  readonly message: string;
}

export interface ResolveCodeTaskSystemStatusesInput {
  readonly userId: string;
  readonly workerType: string;
  readonly reasons?: readonly CodeTaskDispatchBlockerReason[];
}

export interface CodeTaskSystemStatusRepository {
  upsertActive(
    input: UpsertCodeTaskSystemStatusInput,
  ): Promise<Result<CodeTaskSystemStatus, CodeTaskSystemStatusRepositoryError>>;

  listActiveForUser(
    userId: string,
  ): Promise<Result<CodeTaskSystemStatus[], CodeTaskSystemStatusRepositoryError>>;

  resolveActive(
    input: ResolveCodeTaskSystemStatusesInput,
  ): Promise<Result<number, CodeTaskSystemStatusRepositoryError>>;

  markNotified(
    id: string,
    notifiedAt: Date,
  ): Promise<Result<void, CodeTaskSystemStatusRepositoryError>>;
}
