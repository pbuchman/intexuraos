/**
 * Get Issue Detail Use Case
 *
 * Fetches a single Linear issue with comment count and metadata.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { LinearError, LinearIssueRepository, LinearCommentRepository } from '../index.js';
import { toCommentSummary } from '../issueDisplayMapper.js';

export interface GetIssueDetailDeps {
  issueRepository: LinearIssueRepository;
  commentRepository: LinearCommentRepository;
  logger?: Logger;
}

export interface GetIssueDetailRequest {
  identifier: string;
  userId: string;
}

export interface IssueDetailResponse {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; type: string };
  priority: number;
  assignee: { id: string; name: string } | null;
  labels: { id: string; name: string; color: string }[];
  url: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  lastCommentAt: string | null;
}

export async function getIssueDetail(
  request: GetIssueDetailRequest,
  deps: GetIssueDetailDeps
): Promise<Result<IssueDetailResponse | null, LinearError>> {
  const { identifier, userId } = request;
  const { issueRepository, commentRepository, logger } = deps;

  logger?.info({ userId, identifier }, 'getIssueDetail: entry');

  // Find issue by identifier, scoped to the authenticated user
  const issueResult = await issueRepository.findByIdentifier(identifier, userId);
  if (!issueResult.ok) {
    logger?.error({ error: issueResult.error, identifier }, 'Failed to fetch issue');
    return err(issueResult.error);
  }

  const issue = issueResult.value;
  if (issue === null) {
    logger?.warn({ identifier }, 'Issue not found');
    return ok(null);
  }

  // Get comments
  const commentsResult = await commentRepository.listByIssueId(issue.id);
  if (!commentsResult.ok) {
    logger?.error({ error: commentsResult.error, issueId: issue.id }, 'Failed to fetch comments');
    return err(commentsResult.error);
  }

  // Use existing utility to extract comment summary
  const { commentCount, lastCommentAt } = toCommentSummary(commentsResult.value);

  logger?.info({ identifier, commentCount }, 'Issue detail fetched successfully');

  return ok({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    state: { name: issue.state, type: issue.stateType },
    priority: issue.priority,
    /* v8 ignore start -- ts-type: nullish coalescing fallback for assigneeName; always provided when assigneeId is non-null @preserve */
    assignee: issue.assigneeId !== null ? { id: issue.assigneeId, name: issue.assigneeName ?? '' } : null,
    /* v8 ignore stop @preserve */
    labels: issue.labels.map((label) => ({ id: label.id, name: label.name, color: label.color })),
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    commentCount,
    lastCommentAt,
  });
}
