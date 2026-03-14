/**
 * Port for PR automation comment persistence.
 *
 * Tracks which GitHub PR comment is used for the unified automation log
 * so subsequent events can be appended to the same comment.
 */

export interface PRAutomationComment {
  repository: string;
  prNumber: number;
  commentId: number;
  tokenUserId: string;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PRAutomationCommentRepository {
  get(repository: string, prNumber: number): Promise<PRAutomationComment | undefined>;
  create(comment: PRAutomationComment): Promise<void>;
  update(repository: string, prNumber: number, fields: { eventCount: number; updatedAt: string }): Promise<void>;
}
