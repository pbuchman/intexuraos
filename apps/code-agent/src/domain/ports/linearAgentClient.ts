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
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';
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
  /** Label names associated with the issue */
  labels: string[];
  /** Number of child issues */
  childCount: number;
  /** Parent issue UUID (null for top-level issues) */
  parentId: string | null;
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

export interface IssueTreeNode {
  id: string;
  identifier: string;
  url: string;
  parentId: string | null;
  labels: string[];
  assigneeId: string | null;
  state: string;
}

export interface IssueTreeResponse {
  root: IssueTreeNode;
  descendants: IssueTreeNode[];
}

export interface LinearIssueForDisplay {
  identifier: string;
  title: string;
  state: { name: string; type: string };
  priority: number;
  assignee: { id: string; name: string } | null;
  labels: { id: string; name: string }[];
  url: string;
  commentCount: number;
  lastCommentAt: string | null;
}

export interface IssueContextComment {
  body: string;
  createdAt: string;
}

export interface IssueContext {
  description: string | null;
  comments: IssueContextComment[];
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

  fetchIssueTree(request: {
    userId: string;
    issueId: string;
  }): Promise<Result<IssueTreeResponse, LinearAgentError>>;

  updateIssueMetadata(request: {
    userId: string;
    issueId: string;
    assigneeId?: string | null;
    addLabels?: string[];
    removeLabels?: string[];
  }): Promise<Result<{ droppedLabels: string[] }, LinearAgentError>>;

  /**
   * Fetch Linear issue data for display in task detail view.
   * Returns structured issue data from linear-agent's internal API.
   */
  fetchIssueForDisplay(request: ValidateIssueRequest): Promise<Result<LinearIssueForDisplay, LinearAgentError>>;

  /**
   * Fetch multiple Linear issues for display in task list views.
   * Missing identifiers are omitted from the response.
   */
  fetchIssuesForDisplay(request: {
    userId: string;
    identifiers: string[];
  }): Promise<Result<LinearIssueForDisplay[], LinearAgentError>>;

  /**
   * Fetch the description of a Linear issue.
   * Used by review task creation to embed requirements context in the prompt.
   */
  getIssueDescription(request: ValidateIssueRequest): Promise<Result<string | undefined, LinearAgentError>>;

  /**
   * Fetch issue context (description + comments) for deep validation.
   * Used by the issue-context proxy endpoint to avoid direct Linear API calls from orchestrator.
   */
  getIssueContext(request: { identifier: string }): Promise<Result<IssueContext, LinearAgentError>>;
}
