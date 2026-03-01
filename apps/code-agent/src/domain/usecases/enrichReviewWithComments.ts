import type { Result, Logger } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { GitHubPREventRepository, RepositoryError } from '../repositories/gitHubPREventRepository.js';

export interface ReviewComment {
  path: string;
  line: number | null;
  body: string;
  author: string;
  commentId: number;
}

export interface EnrichedReview {
  reviewBody: string | null;
  comments: ReviewComment[];
}

export interface EnrichReviewRequest {
  repository: string;
  pullRequestNumber: number;
  reviewId: number;
  reviewBody: string | null;
}

export interface EnrichReviewDeps {
  logger: Logger;
  gitHubPREventRepo: GitHubPREventRepository;
}

function extractCommentFromEvent(payload: unknown): ReviewComment | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const comment = p['comment'] as Record<string, unknown> | undefined;
  if (comment === undefined) return null;

  const path = typeof comment['path'] === 'string' ? comment['path'] : 'unknown';
  const rawLine = comment['line'];
  const line = typeof rawLine === 'number' ? rawLine : null;
  const body = typeof comment['body'] === 'string' ? comment['body'] : '';
  const commentId = typeof comment['id'] === 'number' ? comment['id'] : 0;

  const user = comment['user'] as Record<string, unknown> | undefined;
  const author = typeof user?.['login'] === 'string' ? user['login'] : 'unknown';

  return { path, line, body, author, commentId };
}

const RETRY_DELAY_MS = 2000;

export async function enrichReviewWithComments(
  deps: EnrichReviewDeps,
  request: EnrichReviewRequest
): Promise<Result<EnrichedReview, RepositoryError>> {
  const { logger, gitHubPREventRepo } = deps;
  const { repository, pullRequestNumber, reviewId, reviewBody } = request;

  const result = await gitHubPREventRepo.findReviewComments(repository, pullRequestNumber, reviewId);
  if (!result.ok) return result;

  let comments = result.value
    .map((event) => extractCommentFromEvent(event.payload))
    .filter((c): c is ReviewComment => c !== null);

  if (comments.length === 0 && (reviewBody === null || reviewBody === '')) {
    logger.debug(
      { repository, pullRequestNumber, reviewId },
      'No inline comments found and review body is empty, retrying after delay'
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

    const retryResult = await gitHubPREventRepo.findReviewComments(repository, pullRequestNumber, reviewId);
    if (!retryResult.ok) return retryResult;

    comments = retryResult.value
      .map((event) => extractCommentFromEvent(event.payload))
      .filter((c): c is ReviewComment => c !== null);
  }

  return ok({ reviewBody, comments });
}

export function formatEnrichedReview(enriched: EnrichedReview): string {
  const lines: string[] = [
    'Review body:',
    enriched.reviewBody ?? '(empty)',
  ];

  if (enriched.comments.length > 0) {
    lines.push('');
    lines.push(`Inline comments (${String(enriched.comments.length)}):`);

    for (const comment of enriched.comments) {
      lines.push('');
      const lineInfo = comment.line !== null ? ` (line ${String(comment.line)})` : '';
      lines.push(`--- ${comment.path}${lineInfo} ---`);
      lines.push(`Comment by @${comment.author} (comment ID: ${String(comment.commentId)}):`);
      lines.push(comment.body);
    }
  }

  return lines.join('\n');
}
