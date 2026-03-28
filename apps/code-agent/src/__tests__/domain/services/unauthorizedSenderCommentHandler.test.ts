import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { createMockLogger } from '../../helpers/mockLogger.js';
import {
  buildUnauthorizedSenderComment,
  createUnauthorizedSenderCommentHandler,
  isUnauthorizedHumanCommandAttempt,
} from '../../../domain/services/unauthorizedSenderCommentHandler.js';

function createEvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
  return {
    id: 'event-1',
    githubEventId: 123,
    deliveryId: 'delivery-1',
    repository: 'pbuchman/intexuraos',
    repositoryId: 456,
    pullRequestNumber: 42,
    pullRequestId: 999,
    eventType: 'issue_comment',
    action: 'created',
    senderLogin: 'reviewer',
    senderId: 222,
    senderType: 'User',
    prAuthorLogin: 'pbuchman',
    title: 'Test PR',
    body: '@claude review this',
    state: 'open',
    baseBranch: null,
    mergedAt: null,
    createdAt: new Date('2026-03-26T12:00:00.000Z'),
    processedAt: new Date('2026-03-26T12:00:01.000Z'),
    payload: {},
    ...overrides,
  };
}

function createGitHubPRClientMock(): GitHubPRClient {
  return {
    updatePRTitle: vi.fn().mockResolvedValue(ok(undefined)),
    getPullRequestFiles: vi.fn().mockResolvedValue(ok([])),
    getPullRequestCommits: vi.fn().mockResolvedValue(ok([])),
    getPullRequestBaseBranch: vi.fn().mockResolvedValue(ok('development')),
    getPullRequestStatus: vi.fn().mockResolvedValue(ok({ state: 'open', mergedAt: null, headRef: 'branch' })),
    postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 1 })),
    listOpenPullRequestsByBaseBranch: vi.fn().mockResolvedValue(ok([])),
    getPullRequestDetails: vi.fn().mockResolvedValue(ok({
      number: 42,
      title: 'Test PR',
      body: 'body',
      state: 'open',
      authorLogin: 'pbuchman',
      baseBranch: 'development',
      headBranch: 'feature',
      mergeable: true,
      mergeableState: 'clean',
      headSha: 'sha123',
    })),
    getIssueComment: vi.fn().mockResolvedValue(ok({ body: '' })),
    updateIssueComment: vi.fn().mockResolvedValue(ok({ commentId: 1 })),
    mergePullRequest: vi.fn().mockResolvedValue(ok({ sha: 'sha123', merged: true })),
    getCombinedCheckStatus: vi.fn().mockResolvedValue(ok({ state: 'success' })),
    listAllOpenPullRequests: vi.fn().mockResolvedValue(ok([])),
  };
}

function createUserServiceClientMock(): UserServiceClient {
  return {
    getApiKeys: vi.fn().mockResolvedValue(ok({})),
    getLlmClient: vi.fn(),
    reportLlmSuccess: vi.fn().mockResolvedValue(undefined),
    getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'github-token', email: 'owner@example.com' })),
    resolveGitHubUsername: vi.fn().mockResolvedValue(ok({ userId: 'owner-user-id' })),
      getUserTimezone: async (): Promise<string | undefined> => undefined,
  };
}

describe('isUnauthorizedHumanCommandAttempt', () => {
  it('returns false for non-comment events', () => {
    const event = createEvent({ eventType: 'pull_request', body: '@claude review this' });

    expect(isUnauthorizedHumanCommandAttempt(event)).toBe(false);
  });

  it('returns false for bot comments', () => {
    const event = createEvent({ senderType: 'Bot', body: '@claude review this' });

    expect(isUnauthorizedHumanCommandAttempt(event)).toBe(false);
  });

  it('returns false when the comment body is missing', () => {
    const event = createEvent({ body: null });

    expect(isUnauthorizedHumanCommandAttempt(event)).toBe(false);
  });

  it('returns false for non-command human comments', () => {
    const event = createEvent({ body: 'please take a look' });

    expect(isUnauthorizedHumanCommandAttempt(event)).toBe(false);
  });

  it('returns true for @claude commands from humans', () => {
    const event = createEvent({ body: '  @claude review this' });

    expect(isUnauthorizedHumanCommandAttempt(event)).toBe(true);
  });

  it('returns true for @codex commands from humans', () => {
    const event = createEvent({ body: '@codex fix this lint error' });

    expect(isUnauthorizedHumanCommandAttempt(event)).toBe(true);
  });

  it('returns true for @review commands from humans', () => {
    const event = createEvent({ body: '@review architecture' });

    expect(isUnauthorizedHumanCommandAttempt(event)).toBe(true);
  });
});

describe('buildUnauthorizedSenderComment', () => {
  it('starts the warning comment with @ignore', () => {
    const comment = buildUnauthorizedSenderComment('linear[bot]');

    expect(comment).toBe(
      '@ignore\n\n⚠️ Only the repository owner and authorized bots can trigger worker commands. This event from `linear[bot]` has been ignored.'
    );
  });
});

describe('createUnauthorizedSenderCommentHandler', () => {
  it('does not post a comment for unauthorized bots', async () => {
    const gitHubPRClient = createGitHubPRClientMock();
    const userServiceClient = createUserServiceClientMock();
    const handler = createUnauthorizedSenderCommentHandler({
      gitHubPRClient,
      userServiceClient,
      logger: createMockLogger(),
    });

    await handler(createEvent({ senderType: 'Bot', senderLogin: 'linear[bot]' }));

    expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
  });

  it('does not post a comment for unauthorized human non-commands', async () => {
    const gitHubPRClient = createGitHubPRClientMock();
    const userServiceClient = createUserServiceClientMock();
    const handler = createUnauthorizedSenderCommentHandler({
      gitHubPRClient,
      userServiceClient,
      logger: createMockLogger(),
    });

    await handler(createEvent({ body: 'please review this when you can' }));

    expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
  });

  it('posts an @ignore warning for unauthorized human commands', async () => {
    const gitHubPRClient = createGitHubPRClientMock();
    const userServiceClient = createUserServiceClientMock();
    const handler = createUnauthorizedSenderCommentHandler({
      gitHubPRClient,
      userServiceClient,
      logger: createMockLogger(),
    });

    await handler(createEvent({ senderLogin: 'reviewer', body: '@codex fix this lint error' }));

    expect(userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('pbuchman');
    expect(userServiceClient.getOAuthToken).toHaveBeenCalledWith('owner-user-id', 'github');
    expect(gitHubPRClient.postPRComment).toHaveBeenCalledWith(
      'github-token',
      'pbuchman',
      'intexuraos',
      42,
      '@ignore\n\n⚠️ Only the repository owner and authorized bots can trigger worker commands. This event from `reviewer` has been ignored.'
    );
  });

  it('posts an @ignore warning for unauthorized @review commands', async () => {
    const gitHubPRClient = createGitHubPRClientMock();
    const userServiceClient = createUserServiceClientMock();
    const handler = createUnauthorizedSenderCommentHandler({
      gitHubPRClient,
      userServiceClient,
      logger: createMockLogger(),
    });

    await handler(createEvent({ senderLogin: 'reviewer', body: '@review architecture' }));

    expect(userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('pbuchman');
    expect(userServiceClient.getOAuthToken).toHaveBeenCalledWith('owner-user-id', 'github');
    expect(gitHubPRClient.postPRComment).toHaveBeenCalledWith(
      'github-token',
      'pbuchman',
      'intexuraos',
      42,
      '@ignore\n\n⚠️ Only the repository owner and authorized bots can trigger worker commands. This event from `reviewer` has been ignored.'
    );
  });

  it('does not post a comment when the repository cannot be parsed', async () => {
    const gitHubPRClient = createGitHubPRClientMock();
    const userServiceClient = createUserServiceClientMock();
    const handler = createUnauthorizedSenderCommentHandler({
      gitHubPRClient,
      userServiceClient,
      logger: createMockLogger(),
    });

    await handler(createEvent({ repository: 'invalid-repository' }));

    expect(userServiceClient.resolveGitHubUsername).not.toHaveBeenCalled();
    expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
  });

  it('does not post a comment when resolving the repo owner fails', async () => {
    const gitHubPRClient = createGitHubPRClientMock();
    const userServiceClient = createUserServiceClientMock();
    userServiceClient.resolveGitHubUsername = vi
      .fn()
      .mockResolvedValue(err({ code: 'API_ERROR', message: 'User service unavailable' }));
    const handler = createUnauthorizedSenderCommentHandler({
      gitHubPRClient,
      userServiceClient,
      logger: createMockLogger(),
    });

    await handler(createEvent());

    expect(userServiceClient.getOAuthToken).not.toHaveBeenCalled();
    expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
  });

  it('does not post a comment when the repo owner is not linked to a user', async () => {
    const gitHubPRClient = createGitHubPRClientMock();
    const userServiceClient = createUserServiceClientMock();
    userServiceClient.resolveGitHubUsername = vi.fn().mockResolvedValue(ok(null));
    const handler = createUnauthorizedSenderCommentHandler({
      gitHubPRClient,
      userServiceClient,
      logger: createMockLogger(),
    });

    await handler(createEvent());

    expect(userServiceClient.getOAuthToken).not.toHaveBeenCalled();
    expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
  });

  it('does not post a comment when the repo owner has no GitHub token', async () => {
    const gitHubPRClient = createGitHubPRClientMock();
    const userServiceClient = createUserServiceClientMock();
    userServiceClient.getOAuthToken = vi
      .fn()
      .mockResolvedValue(err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub token' }));
    const handler = createUnauthorizedSenderCommentHandler({
      gitHubPRClient,
      userServiceClient,
      logger: createMockLogger(),
    });

    await handler(createEvent());

    expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
  });
});
