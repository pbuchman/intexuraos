import type { GitHubEventType, GitHubPRAction } from './gitHubPREvent.js';

export const GITHUB_WEBHOOK_EVENT_TYPES = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'push',
  'ping',
  'unknown',
] as const;

export type GitHubWebhookEventType = typeof GITHUB_WEBHOOK_EVENT_TYPES[number];

export const GITHUB_WEBHOOK_ACTIONS = [
  'opened',
  'closed',
  'edited',
  'synchronize',
  'reopened',
  'ready_for_review',
  'converted_to_draft',
  'assigned',
  'unassigned',
  'labeled',
  'unlabeled',
  'locked',
  'unlocked',
  'review_requested',
  'review_request_removed',
  'milestoned',
  'demilestoned',
  'enqueued',
  'dequeued',
  'auto_merge_enabled',
  'auto_merge_disabled',
  'submitted',
  'dismissed',
  'created',
  'deleted',
  'unknown',
] as const;

export type GitHubWebhookAction = typeof GITHUB_WEBHOOK_ACTIONS[number];

export function toGitHubWebhookEventType(value: unknown): GitHubWebhookEventType {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  return GITHUB_WEBHOOK_EVENT_TYPES.includes(value as GitHubWebhookEventType)
    ? value as GitHubWebhookEventType
    : 'unknown';
}

export function toGitHubWebhookAction(value: unknown): GitHubWebhookAction | null {
  if (typeof value !== 'string') {
    return null;
  }

  return GITHUB_WEBHOOK_ACTIONS.includes(value as GitHubWebhookAction)
    ? value as GitHubWebhookAction
    : 'unknown';
}

export function fromNormalizedEventType(value: GitHubEventType): GitHubWebhookEventType {
  return value;
}

export function fromNormalizedAction(value: GitHubPRAction | null): GitHubWebhookAction {
  if (value === null) {
    return 'unknown';
  }

  return value;
}
