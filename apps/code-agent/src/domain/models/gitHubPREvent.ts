/**
 * GitHub Pull Request Event domain model.
 *
 * Represents a normalized GitHub webhook event related to pull requests.
 */

export type GitHubEventType =
  | 'pull_request'
  | 'pull_request_review'
  | 'pull_request_review_comment'
  | 'push'
  | 'ping';

export type GitHubPRAction =
  | 'opened'
  | 'closed'
  | 'edited'
  | 'synchronized'
  | 'ready_for_review'
  | 'converted_to_draft'
  | 'submitted'
  | 'dismissed'
  | 'created'
  | 'deleted';

export interface GitHubPREvent {
  id: string;
  githubEventId: number;
  repository: string;
  repositoryId: number;
  pullRequestNumber: number;
  pullRequestId: number;
  eventType: GitHubEventType;
  action: GitHubPRAction | null;
  senderLogin: string;
  senderId: number;
  senderType: string;
  title: string | null;
  body: string | null;
  state: string | null;
  mergedAt: Date | null;
  createdAt: Date;
  processedAt: Date;
  payload: unknown;
}

/**
 * Input for creating a new GitHub PR event.
 */
export interface CreateGitHubPREventInput {
  githubEventId: number;
  repository: string;
  repositoryId: number;
  pullRequestNumber: number;
  pullRequestId: number;
  eventType: GitHubEventType;
  action: GitHubPRAction | null;
  senderLogin: string;
  senderId: number;
  senderType: string;
  title: string | null;
  body: string | null;
  state: string | null;
  mergedAt: Date | null;
  createdAt: Date;
  payload: unknown;
}
