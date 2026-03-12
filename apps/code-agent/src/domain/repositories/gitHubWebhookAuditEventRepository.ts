import type { Result } from '@intexuraos/common-core';
import type {
  CreateGitHubWebhookAuditEventInput,
  GitHubWebhookAuditEvent,
  UpdateGitHubWebhookAuditEventNormalizationStatusInput,
} from '../models/gitHubWebhookAuditEvent.js';

export interface GitHubWebhookAuditEventRepositoryError {
  code: 'FIRESTORE_ERROR';
  message: string;
}

export interface GitHubWebhookAuditEventRepository {
  save(
    input: CreateGitHubWebhookAuditEventInput
  ): Promise<Result<GitHubWebhookAuditEvent, GitHubWebhookAuditEventRepositoryError>>;
  findByIds(
    ids: string[]
  ): Promise<Result<GitHubWebhookAuditEvent[], GitHubWebhookAuditEventRepositoryError>>;
  updateNormalizationStatus(
    input: UpdateGitHubWebhookAuditEventNormalizationStatusInput
  ): Promise<Result<GitHubWebhookAuditEvent, GitHubWebhookAuditEventRepositoryError>>;
}
