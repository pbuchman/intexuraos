/**
 * Port for linear-agent communication.
 * Used to create and update Linear issues for code tasks.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 207-308)
 */

import type { Result } from '@intexuraos/common-core';

export interface CreateIssueRequest {
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
  issueId: string;
  state: 'backlog' | 'in_progress' | 'in_review' | 'qa';
}

export interface LinearAgentError {
  code: 'UNAVAILABLE' | 'RATE_LIMITED' | 'INVALID_REQUEST' | 'UNKNOWN';
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
}
