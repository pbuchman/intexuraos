import type { GitHubWebhookEventType } from '../models/gitHubWebhookTypes.js';

/**
 * Event types shown in the GitHub Event Log UI.
 * Must stay in sync with VISIBLE_EVENT_TYPES in apps/web/src/hooks/useGitHubEventLog.ts
 */
export const VISIBLE_EVENT_TYPES: readonly GitHubWebhookEventType[] = [
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'push',
] as const;
