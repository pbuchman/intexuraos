import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { GitHubPREventRepository } from '../../../domain/repositories/gitHubPREventRepository.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import {
  enrichReviewWithComments,
  formatEnrichedReview,
} from '../../../domain/usecases/enrichReviewWithComments.js';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function createCommentEvent(overrides: {
  reviewId: number;
  path: string;
  line: number | null;
  body: string;
  author: string;
  commentId: number;
}): GitHubPREvent {
  return {
    id: `event-${String(overrides.commentId)}`,
    githubEventId: overrides.commentId,
    deliveryId: null,
    repository: 'intexuraos/test-repo',
    repositoryId: 123,
    pullRequestNumber: 42,
    pullRequestId: 456,
    eventType: 'pull_request_review_comment',
    action: 'created',
    senderLogin: overrides.author,
    senderId: 999,
    senderType: 'User',
    prAuthorLogin: null,
    title: null,
    body: overrides.body,
    state: 'open',
    baseBranch: null,
    mergedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    processedAt: new Date('2024-01-01T00:00:00Z'),
    payload: {
      comment: {
        id: overrides.commentId,
        pull_request_review_id: overrides.reviewId,
        path: overrides.path,
        line: overrides.line,
        body: overrides.body,
        user: { login: overrides.author },
      },
    },
  };
}

function createMockRepo(findReviewCommentsFn: GitHubPREventRepository['findReviewComments']): GitHubPREventRepository {
  return {
    save: vi.fn(),
    findByPullRequest: vi.fn(),
    findByRepository: vi.fn(),
    findAll: vi.fn(),
    findReviewComments: findReviewCommentsFn,
  };
}

describe('enrichReviewWithComments', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return comments on first attempt', async () => {
    const events = [
      createCommentEvent({ reviewId: 100, path: 'src/index.ts', line: 42, body: 'Fix this', author: 'reviewer', commentId: 1 }),
    ];
    const repo = createMockRepo(vi.fn().mockResolvedValue(ok(events)));

    const result = await enrichReviewWithComments(
      { logger: mockLogger, gitHubPREventRepo: repo },
      { repository: 'intexuraos/test-repo', pullRequestNumber: 42, reviewId: 100, reviewBody: 'Looks good overall' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reviewBody).toBe('Looks good overall');
      expect(result.value.comments).toHaveLength(1);
      expect(result.value.comments[0]?.path).toBe('src/index.ts');
      expect(result.value.comments[0]?.line).toBe(42);
      expect(result.value.comments[0]?.body).toBe('Fix this');
      expect(result.value.comments[0]?.author).toBe('reviewer');
      expect(result.value.comments[0]?.commentId).toBe(1);
    }
    expect(repo.findReviewComments).toHaveBeenCalledTimes(1);
  });

  it('should retry when no comments found and review body is null', async () => {
    const events = [
      createCommentEvent({ reviewId: 100, path: 'src/main.ts', line: 10, body: 'Change this', author: 'reviewer', commentId: 2 }),
    ];
    const findReviewComments = vi.fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok(events));

    const repo = createMockRepo(findReviewComments);

    const resultPromise = enrichReviewWithComments(
      { logger: mockLogger, gitHubPREventRepo: repo },
      { repository: 'intexuraos/test-repo', pullRequestNumber: 42, reviewId: 100, reviewBody: null }
    );

    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comments).toHaveLength(1);
      expect(result.value.comments[0]?.body).toBe('Change this');
    }
    expect(findReviewComments).toHaveBeenCalledTimes(2);
  });

  it('should retry when no comments found and review body is empty string', async () => {
    const findReviewComments = vi.fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([]));

    const repo = createMockRepo(findReviewComments);

    const resultPromise = enrichReviewWithComments(
      { logger: mockLogger, gitHubPREventRepo: repo },
      { repository: 'intexuraos/test-repo', pullRequestNumber: 42, reviewId: 100, reviewBody: '' }
    );

    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comments).toHaveLength(0);
    }
    expect(findReviewComments).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry when review body exists', async () => {
    const findReviewComments = vi.fn().mockResolvedValue(ok([]));
    const repo = createMockRepo(findReviewComments);

    const result = await enrichReviewWithComments(
      { logger: mockLogger, gitHubPREventRepo: repo },
      { repository: 'intexuraos/test-repo', pullRequestNumber: 42, reviewId: 100, reviewBody: 'Some feedback' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comments).toHaveLength(0);
      expect(result.value.reviewBody).toBe('Some feedback');
    }
    expect(findReviewComments).toHaveBeenCalledTimes(1);
  });

  it('should handle repository errors on first attempt', async () => {
    const repo = createMockRepo(
      vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR' as const, message: 'Connection failed' }))
    );

    const result = await enrichReviewWithComments(
      { logger: mockLogger, gitHubPREventRepo: repo },
      { repository: 'intexuraos/test-repo', pullRequestNumber: 42, reviewId: 100, reviewBody: null }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FIRESTORE_ERROR');
    }
  });

  it('should handle repository errors on retry', async () => {
    const findReviewComments = vi.fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR' as const, message: 'Retry failed' }));

    const repo = createMockRepo(findReviewComments);

    const resultPromise = enrichReviewWithComments(
      { logger: mockLogger, gitHubPREventRepo: repo },
      { repository: 'intexuraos/test-repo', pullRequestNumber: 42, reviewId: 100, reviewBody: null }
    );

    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FIRESTORE_ERROR');
    }
  });

  it('should handle events with missing comment in payload', async () => {
    const badEvent: GitHubPREvent = {
      id: 'event-bad',
      githubEventId: 999,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 123,
      pullRequestNumber: 42,
      pullRequestId: 456,
      eventType: 'pull_request_review_comment',
      action: 'created',
      senderLogin: 'reviewer',
      senderId: 999,
      senderType: 'User',
      prAuthorLogin: null,
      title: null,
      body: null,
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date(),
      processedAt: new Date(),
      payload: {},
    };

    const repo = createMockRepo(vi.fn().mockResolvedValue(ok([badEvent])));

    const result = await enrichReviewWithComments(
      { logger: mockLogger, gitHubPREventRepo: repo },
      { repository: 'intexuraos/test-repo', pullRequestNumber: 42, reviewId: 100, reviewBody: 'Body' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comments).toHaveLength(0);
    }
  });

  it('should handle events with null payload', async () => {
    const nullPayloadEvent: GitHubPREvent = {
      id: 'event-null',
      githubEventId: 998,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 123,
      pullRequestNumber: 42,
      pullRequestId: 456,
      eventType: 'pull_request_review_comment',
      action: 'created',
      senderLogin: 'reviewer',
      senderId: 999,
      senderType: 'User',
      prAuthorLogin: null,
      title: null,
      body: null,
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date(),
      processedAt: new Date(),
      payload: null,
    };

    const repo = createMockRepo(vi.fn().mockResolvedValue(ok([nullPayloadEvent])));

    const result = await enrichReviewWithComments(
      { logger: mockLogger, gitHubPREventRepo: repo },
      { repository: 'intexuraos/test-repo', pullRequestNumber: 42, reviewId: 100, reviewBody: 'Body' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comments).toHaveLength(0);
    }
  });

  it('should use fallback values for malformed comment fields', async () => {
    const malformedEvent: GitHubPREvent = {
      id: 'event-malformed',
      githubEventId: 997,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 123,
      pullRequestNumber: 42,
      pullRequestId: 456,
      eventType: 'pull_request_review_comment',
      action: 'created',
      senderLogin: 'reviewer',
      senderId: 999,
      senderType: 'User',
      prAuthorLogin: null,
      title: null,
      body: null,
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date(),
      processedAt: new Date(),
      payload: {
        comment: {
          pull_request_review_id: 100,
          id: 'not-a-number',
          path: 12345,
          line: 'not-a-number',
          body: null,
          user: null,
        },
      },
    };

    const repo = createMockRepo(vi.fn().mockResolvedValue(ok([malformedEvent])));

    const result = await enrichReviewWithComments(
      { logger: mockLogger, gitHubPREventRepo: repo },
      { repository: 'intexuraos/test-repo', pullRequestNumber: 42, reviewId: 100, reviewBody: 'Body' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comments).toHaveLength(1);
      const comment = result.value.comments[0];
      expect(comment?.path).toBe('unknown');
      expect(comment?.line).toBeNull();
      expect(comment?.body).toBe('');
      expect(comment?.commentId).toBe(0);
      expect(comment?.author).toBe('unknown');
    }
  });
});

describe('formatEnrichedReview', () => {
  it('should format review with comments', () => {
    const result = formatEnrichedReview({
      reviewBody: 'Please fix these issues',
      comments: [
        { path: 'src/index.ts', line: 42, body: 'Fix this function', author: 'pbuchman', commentId: 100 },
        { path: 'src/utils.ts', line: null, body: 'General comment', author: 'pbuchman', commentId: 101 },
      ],
    });

    expect(result).toContain('Review body:');
    expect(result).toContain('Please fix these issues');
    expect(result).toContain('Inline comments (2):');
    expect(result).toContain('--- src/index.ts (line 42) ---');
    expect(result).toContain('Comment by @pbuchman (comment ID: 100):');
    expect(result).toContain('Fix this function');
    expect(result).toContain('--- src/utils.ts ---');
    expect(result).toContain('General comment');
  });

  it('should format review with empty body', () => {
    const result = formatEnrichedReview({
      reviewBody: null,
      comments: [
        { path: 'src/index.ts', line: 10, body: 'Fix this', author: 'reviewer', commentId: 200 },
      ],
    });

    expect(result).toContain('Review body:');
    expect(result).toContain('(empty)');
    expect(result).toContain('Inline comments (1):');
  });

  it('should format review with no comments', () => {
    const result = formatEnrichedReview({
      reviewBody: 'Looks good',
      comments: [],
    });

    expect(result).toContain('Review body:');
    expect(result).toContain('Looks good');
    expect(result).not.toContain('Inline comments');
  });
});
