import type { Result } from '@intexuraos/common-core';
import type {
  AcquireSentryTaskReservationInput,
  AcquireSentryTaskReservationResult,
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

  completeReservation(
    input: CompleteSentryTaskReservationInput
  ): Promise<Result<void, SentryIssueEventRepositoryError>>;

  failReservation(
    input: FailSentryTaskReservationInput
  ): Promise<Result<void, SentryIssueEventRepositoryError>>;
}
