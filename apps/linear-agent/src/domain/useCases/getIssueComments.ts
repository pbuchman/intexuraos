/**
 * Get Issue Comments Use Case
 *
 * Fetches paginated comments for a Linear issue.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { LinearError, LinearIssueRepository, LinearCommentRepository, LinearComment } from '../index.js';

export interface GetIssueCommentsDeps {
  issueRepository: LinearIssueRepository;
  commentRepository: LinearCommentRepository;
  logger?: Logger;
}

export interface GetIssueCommentsRequest {
  identifier: string;
  userId: string;
  limit: number;
  offset: number;
}

export interface PaginatedComments {
  comments: LinearComment[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export async function getIssueComments(
  request: GetIssueCommentsRequest,
  deps: GetIssueCommentsDeps
): Promise<Result<PaginatedComments | null, LinearError>> {
  const { identifier, userId, limit, offset } = request;
  const { issueRepository, commentRepository, logger } = deps;

  logger?.info({ identifier, userId, limit, offset }, 'getIssueComments: entry');

  // Find issue by identifier, scoped to the authenticated user
  const issueResult = await issueRepository.findByIdentifier(identifier, userId);
  if (!issueResult.ok) {
    logger?.error({ error: issueResult.error, identifier }, 'Failed to fetch issue');
    return err(issueResult.error);
  }

  const issue = issueResult.value;
  if (issue === null) {
    logger?.warn({ identifier }, 'Issue not found');
    // Return null in the Result value when issue not found (route maps to 404)
    return ok(null);
  }

  // Fetch comments and count in parallel
  const [commentsResult, countResult] = await Promise.all([
    commentRepository.listByIssueId(issue.id),
    commentRepository.countByIssueId(issue.id),
  ]);

  if (!commentsResult.ok) {
    logger?.error({ error: commentsResult.error, issueId: issue.id }, 'Failed to fetch comments');
    return err(commentsResult.error);
  }

  if (!countResult.ok) {
    logger?.error({ error: countResult.error, issueId: issue.id }, 'Failed to count comments');
    return err(countResult.error);
  }

  // Apply pagination
  const total = countResult.value;
  const comments = commentsResult.value.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  logger?.info({ identifier, total, returnedComments: comments.length, hasMore }, 'Comments fetched successfully');

  return ok({
    comments,
    total,
    limit,
    offset,
    hasMore,
  });
}
