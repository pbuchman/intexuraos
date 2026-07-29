import type { Result } from '@intexuraos/common-core';
import type {
  AcquireSentryTaskReservationInput,
  AcquireSentryTaskReservationResult,
  CheckpointSentryLinearIssueInput,
  CompleteSentryTaskReservationInput,
  FailSentryTaskReservationInput,
} from '../models/sentryIssueEvent.js';

export interface SentryIssueEventRepositoryError {
  code: 'FIRESTORE_ERROR';
  message: string;
}

export interface SentryIssueEventRepository {
  acquire(
    input: AcquireSentryTaskReservationInput
  ): Promise<Result<AcquireSentryTaskReservationResult, SentryIssueEventRepositoryError>>;

  checkpointLinearIssue(
    input: CheckpointSentryLinearIssueInput
  ): Promise<Result<void, SentryIssueEventRepositoryError>>;

  completeReservation(
    input: CompleteSentryTaskReservationInput
  ): Promise<Result<void, SentryIssueEventRepositoryError>>;

  failReservation(
    input: FailSentryTaskReservationInput
  ): Promise<Result<void, SentryIssueEventRepositoryError>>;
}
