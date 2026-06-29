import type { Result } from '@intexuraos/common-core';
import type {
  ReserveSentryIssueEventInput,
  ReserveSentryIssueEventResult,
  SentryIssueEventRecord,
} from '../models/sentryIssueEvent.js';

export interface SentryIssueEventRepositoryError {
  code: 'FIRESTORE_ERROR';
  message: string;
}

export interface SentryIssueEventRepository {
  reserve(
    input: ReserveSentryIssueEventInput
  ): Promise<Result<ReserveSentryIssueEventResult, SentryIssueEventRepositoryError>>;

  reserveTaskForProblem(
    input: ReserveSentryIssueEventInput
  ): Promise<Result<ReserveSentryIssueEventResult, SentryIssueEventRepositoryError>>;

  markCodeTaskCreated(input: {
    dedupeKey: string;
    codeTaskId: string;
    linearIssueId?: string | undefined;
  }): Promise<Result<SentryIssueEventRecord, SentryIssueEventRepositoryError>>;
}
