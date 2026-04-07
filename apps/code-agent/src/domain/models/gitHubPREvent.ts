/**
 * GitHub Pull Request Event domain model.
 *
 * Represents a normalized GitHub webhook event related to pull requests.
 */

export type GitHubEventType =
  | 'pull_request'
  | 'pull_request_review'
  | 'pull_request_review_comment'
  | 'issue_comment'
  | 'push'
  | 'ping'
  | 'check_suite';

export type GitHubPRAction =
  // pull_request actions
  | 'opened'
  | 'closed'
  | 'edited'
  | 'synchronize'
  | 'reopened'
  | 'ready_for_review'
  | 'converted_to_draft'
  | 'assigned'
  | 'unassigned'
  | 'labeled'
  | 'unlabeled'
  | 'locked'
  | 'unlocked'
  | 'review_requested'
  | 'review_request_removed'
  | 'milestoned'
  | 'demilestoned'
  | 'enqueued'
  | 'dequeued'
  | 'auto_merge_enabled'
  | 'auto_merge_disabled'
  // pull_request_review actions
  | 'submitted'
  | 'dismissed'
  // pull_request_review_comment actions
  | 'created'
  | 'deleted'
  // check_suite actions
  | 'completed';

export interface GitHubPREvent {
  id: string;
  auditEventId?: string;
  githubEventId: number;
  deliveryId: string | null;
  repository: string;
  repositoryId: number;
  pullRequestNumber: number;
  pullRequestId: number;
  eventType: GitHubEventType;
  action: GitHubPRAction | null;
  senderLogin: string;
  senderId: number;
  senderType: string;
  prAuthorLogin: string | null;
  title: string | null;
  body: string | null;
  state: string | null;
  baseBranch: string | null;
  mergedAt: Date | null;
  createdAt: Date;
  processedAt: Date;
  payload: unknown;
}

/**
 * Input for creating a new GitHub PR event.
 */
export interface CreateGitHubPREventInput {
  auditEventId?: string;
  githubEventId: number;
  deliveryId: string | null;
  repository: string;
  repositoryId: number;
  pullRequestNumber: number;
  pullRequestId: number;
  eventType: GitHubEventType;
  action: GitHubPRAction | null;
  senderLogin: string;
  senderId: number;
  senderType: string;
  prAuthorLogin: string | null;
  title: string | null;
  body: string | null;
  state: string | null;
  baseBranch: string | null;
  mergedAt: Date | null;
  createdAt: Date;
  payload: unknown;
}
