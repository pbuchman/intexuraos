/**
 * Formats a GitHub PR webhook event into a plain-text message
 * suitable for sending to a Claude worker via sendTaskMessage.
 *
 * Handles three event types:
 * - issue_comment: general PR comments
 * - pull_request_review_comment: inline diff comments with file:line context
 * - pull_request_review: review submissions with approval state
 */

import type { GitHubPREvent } from '../models/gitHubPREvent.js';

interface InlineCommentPayload {
  comment?: {
    path?: string;
    line?: number | null;
    diff_hunk?: string;
  };
}

interface ReviewPayload {
  review?: {
    state?: string;
  };
}

function extractDiffContext(diffHunk: string, maxLines: number): string {
  const lines = diffHunk.split('\n');
  return lines.slice(-maxLines).join('\n');
}

export function formatPRCommentMessage(event: GitHubPREvent): string {
  const { eventType, senderLogin, pullRequestNumber, body } = event;
  const bodyText = body ?? '';

  if (eventType === 'pull_request_review_comment') {
    const payload = event.payload as InlineCommentPayload;
    const path = payload.comment?.path;
    const line = payload.comment?.line;
    const diffHunk = payload.comment?.diff_hunk;

    const parts: string[] = [
      `[PR Inline Comment] from @${senderLogin} on PR #${String(pullRequestNumber)}`,
    ];

    if (typeof path === 'string') {
      const lineStr = typeof line === 'number' ? `:${String(line)}` : '';
      parts.push(`File: ${path}${lineStr}`);
    }

    if (typeof diffHunk === 'string' && diffHunk.length > 0) {
      parts.push('');
      parts.push('Diff context:');
      parts.push('```');
      parts.push(extractDiffContext(diffHunk, 5));
      parts.push('```');
    }

    parts.push('');
    parts.push(bodyText);

    return parts.join('\n');
  }

  if (eventType === 'pull_request_review') {
    const payload = event.payload as ReviewPayload;
    const state = payload.review?.state ?? 'unknown';

    return [
      `[PR Review] from @${senderLogin} on PR #${String(pullRequestNumber)} (state: ${state})`,
      '',
      bodyText,
    ].join('\n');
  }

  // Default: issue_comment
  return [
    `[PR Comment] from @${senderLogin} on PR #${String(pullRequestNumber)}`,
    '',
    bodyText,
  ].join('\n');
}
