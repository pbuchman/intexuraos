/**
 * Port for linear-agent communication.
 * Used to create and update Linear issues for code tasks.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 207-308)
 */

import type { Result } from '@intexuraos/common-core';

export interface CreateIssueRequest {
  userId: string;
  title: string;
  description: string;
  labels?: string[];
}

export interface CreateIssueResponse {
  issueId: string;
  issueIdentifier: string; // e.g., "INT-123"
  issueTitle: string;
  issueUrl: string;
}

export interface UpdateIssueStateRequest {
  userId: string;
  issueId: string;
  state: 'backlog' | 'in_progress' | 'in_review' | 'qa';
}

export interface ValidateIssueRequest {
  userId: string;
  identifier: string;
}

export interface ValidatedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

export interface GenerateTitleRequest {
  userId: string;
  description: string;
}

export interface GeneratedTitle {
  title: string;
  issueType: 'feature' | 'bug' | 'refactor' | 'research';
}

export interface AddCommentRequest {
  userId: string;
  issueId: string;
  body: string;
}

export interface AddCommentResponse {
  commentId: string;
}

export interface LinearAgentError {
  code: 'UNAVAILABLE' | 'RATE_LIMITED' | 'INVALID_REQUEST' | 'NOT_FOUND' | 'UNKNOWN';
  message: string;
}

export interface LinearAgentClient {
  /**
   * Create a new Linear issue for a code task.
   * Returns the created issue details or an error.
   */
  createIssue(request: CreateIssueRequest): Promise<Result<CreateIssueResponse, LinearAgentError>>;

  /**
   * Update the state of an existing Linear issue.
   * Used for state transitions: Backlog → In Progress → In Review
   */
  updateIssueState(request: UpdateIssueStateRequest): Promise<Result<void, LinearAgentError>>;

  /**
   * Validate that a Linear issue exists and belongs to the user's team.
   * Returns validated issue details or an error.
   */
  validateIssue(request: ValidateIssueRequest): Promise<Result<ValidatedIssue, LinearAgentError>>;

  /**
   * Generate a concise issue title from a task description using LLM.
   * Returns generated title with issue type classification.
   */
  generateTitle(request: GenerateTitleRequest): Promise<Result<GeneratedTitle, LinearAgentError>>;

  /**
   * Add a comment to an existing Linear issue.
   * Used for adding retry context when retrying failed tasks.
   */
  addComment(request: AddCommentRequest): Promise<Result<AddCommentResponse, LinearAgentError>>;
}
