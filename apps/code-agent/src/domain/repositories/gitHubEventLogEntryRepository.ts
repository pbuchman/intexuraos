import type { Result } from '@intexuraos/common-core';
import type {
  CompleteGitHubEventLogEntryInput,
  CreatePendingGitHubEventLogEntryInput,
  GitHubEventLogEntry,
} from '../models/gitHubEventLogEntry.js';
import type { GitHubWebhookEventType } from '../models/gitHubWebhookTypes.js';

export interface GitHubEventLogEntryRepositoryError {
  code: 'FIRESTORE_ERROR';
  message: string;
}

export interface GitHubEventLogEntryRepository {
  createPending(
    input: CreatePendingGitHubEventLogEntryInput
  ): Promise<Result<GitHubEventLogEntry, GitHubEventLogEntryRepositoryError>>;
  complete(
    input: CompleteGitHubEventLogEntryInput
  ): Promise<Result<GitHubEventLogEntry, GitHubEventLogEntryRepositoryError>>;
  listRecent(options: {
    limit: number;
    cursor?: string;
    eventTypes?: readonly GitHubWebhookEventType[];
  }): Promise<
    Result<{
      entries: GitHubEventLogEntry[];
      nextCursor?: string;
    }, GitHubEventLogEntryRepositoryError>
  >;
  findByIds(
    ids: string[]
  ): Promise<Result<GitHubEventLogEntry[], GitHubEventLogEntryRepositoryError>>;
}
