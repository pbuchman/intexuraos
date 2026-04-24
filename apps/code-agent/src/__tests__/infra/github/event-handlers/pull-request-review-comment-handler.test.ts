/**
 * Unit tests for the pull_request_review_comment event handler.
 */

import { describe, it, expect } from 'vitest';
import { parsePullRequestReviewCommentEvent } from '../../../../infra/github/event-handlers/pull-request-review-comment-handler.js';

describe('parsePullRequestReviewCommentEvent', () => {
  it('parses a valid inline review comment with the comment body in body', () => {
    const reviewCommentPayload = {
      id: 8001,
      action: 'created',
      repository: {
        id: 456,
        full_name: 'intexuraos/code-agent',
      },
      pull_request: {
        id: 101,
        number: 42,
        title: 'Refactor event parser',
        state: 'open',
        merged_at: null,
        draft: false,
        base: { ref: 'main' },
        user: { login: 'pr-author' },
      },
      comment: {
        id: 404,
        body: 'Consider extracting this helper into shared.ts',
        path: 'apps/code-agent/src/infra/github-event-parser.ts',
      },
      sender: {
        login: 'reviewer',
        id: 444,
        type: 'User',
      },
    };

    const result = parsePullRequestReviewCommentEvent(reviewCommentPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventType).toBe('pull_request_review_comment'); // @allow-result-access -- narrowed by result.ok
      expect(result.value.body).toBe('Consider extracting this helper into shared.ts'); // @allow-result-access -- narrowed by result.ok
      expect(result.value.pullRequestNumber).toBe(42); // @allow-result-access -- narrowed by result.ok
      expect(result.value.action).toBe('created'); // @allow-result-access -- narrowed by result.ok
      expect(result.value.baseBranch).toBe('main'); // @allow-result-access -- narrowed by result.ok
    }
  });
});
