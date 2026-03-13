import type {
  GitHubWebhookAction,
  GitHubWebhookEventType,
} from './gitHubWebhookTypes.js';

export type GitHubWebhookNormalizationStatus =
  | 'pending'
  | 'normalized'
  | 'ignored'
  | 'unsupported'
  | 'duplicate'
  | 'invalid'
  | 'failed';

export interface GitHubWebhookAuditEvent {
  id: string;
  deliveryId: string | null;
  githubEventName: string;
  eventType: GitHubWebhookEventType;
  action: GitHubWebhookAction | null;
  repository: string | null;
  repositoryId: number | null;
  pullRequestNumber: number | null;
  pullRequestId: number | null;
  senderLogin: string | null;
  senderId: number | null;
  senderType: string | null;
  authPassedAt: Date;
  receivedAt: Date;
  normalizationStatus: GitHubWebhookNormalizationStatus;
  payload: unknown;
}

export interface CreateGitHubWebhookAuditEventInput {
  deliveryId: string | null;
  githubEventName: string;
  eventType: GitHubWebhookEventType;
  action: GitHubWebhookAction | null;
  repository: string | null;
  repositoryId: number | null;
  pullRequestNumber: number | null;
  pullRequestId: number | null;
  senderLogin: string | null;
  senderId: number | null;
  senderType: string | null;
  authPassedAt: Date;
  receivedAt: Date;
  normalizationStatus: GitHubWebhookNormalizationStatus;
  payload: unknown;
}

export interface UpdateGitHubWebhookAuditEventNormalizationStatusInput {
  id: string;
  normalizationStatus: GitHubWebhookNormalizationStatus;
}
