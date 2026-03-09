/**
 * Tests for GitHub Agent use case.
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { ToolCallingClient, ToolDefinition } from '@intexuraos/llm-contract';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { GitHubPREvent } from '../../domain/models/gitHubPREvent.js';
import { evaluatePREvent, isGitHubAgentEvent, type GitHubAgentDeps } from '../../domain/usecases/githubAgent.js';
import type { Logger } from '@intexuraos/common-core';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createFakePREvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
  return {
    id: 'evt-1',
    githubEventId: 1001,
    repository: 'intexuraos/intexuraos',
    repositoryId: 100,
    pullRequestNumber: 42,
    pullRequestId: 200,
    eventType: 'pull_request',
    action: 'opened',
    senderLogin: 'dev-user',
    senderId: 1,
    senderType: 'User',
    title: 'feat: add new feature',
    body: 'This PR adds a new feature.',
    state: 'open',
    mergedAt: null,
    createdAt: new Date(),
    processedAt: new Date(),
    payload: null,
    ...overrides,
  };
}

function createFakeGitHubPRClient(): GitHubPRClient {
  return {
    updatePRTitle: vi.fn().mockResolvedValue(ok(undefined)),
    getPullRequestFiles: vi.fn().mockResolvedValue(ok([
      { filename: 'src/index.ts', status: 'modified', additions: 10, deletions: 5 },
      { filename: 'src/utils.ts', status: 'added', additions: 30, deletions: 0 },
    ])),
    getPullRequestCommits: vi.fn().mockResolvedValue(ok([
      { sha: 'abc123', message: 'feat: add feature', author: 'dev-user' },
    ])),
    postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 1 })),
  };
}

function createFakeToolCallingClient(options?: {
  callTools?: boolean;
  error?: boolean;
}): ToolCallingClient {
  return {
    async run(params): ReturnType<ToolCallingClient['run']> {
      if (options?.error === true) {
        return err({ code: 'API_ERROR' as const, message: 'LLM unavailable' });
      }

      // Simulate tool execution: call the first tool if callTools is true
      if (options?.callTools !== false) {
        const requestReview = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (requestReview !== undefined) {
          await requestReview.run({ review_type: 'code_quality' });
        }
      }

      return ok({
        content: 'Review dispatched.',
        toolCallsMade: options?.callTools !== false ? 1 : 0,
        iterationCount: 1,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      });
    },
  };
}

function createDeps(overrides: Partial<GitHubAgentDeps> = {}): GitHubAgentDeps {
  return {
    logger: createFakeLogger(),
    gitHubPRClient: createFakeGitHubPRClient(),
    toolCallingClient: createFakeToolCallingClient(),
    ...overrides,
  };
}

describe('evaluatePREvent', () => {
  it('evaluates a PR and requests a review', async () => {
    const deps = createDeps();
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reviewsRequested).toContain('code_quality');
      expect(result.value.toolCallsMade).toBe(1);
      expect(result.value.skipped).toBe(false);
    }
  });

  it('fetches PR files using the client', async () => {
    const prClient = createFakeGitHubPRClient();
    const deps = createDeps({ gitHubPRClient: prClient });
    const event = createFakePREvent();

    await evaluatePREvent(deps, event);

    expect(prClient.getPullRequestFiles).toHaveBeenCalledWith(
      'intexuraos', 'intexuraos', 42
    );
  });

  it('returns error when PR files fetch fails', async () => {
    const prClient = createFakeGitHubPRClient();
    vi.mocked(prClient.getPullRequestFiles).mockResolvedValue(
      err({ code: 'UNAUTHORIZED', message: 'Bad token' })
    );
    const deps = createDeps({ gitHubPRClient: prClient });
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('GITHUB_API_FAILED');
    }
  });

  it('returns error when LLM call fails', async () => {
    const deps = createDeps({
      toolCallingClient: createFakeToolCallingClient({ error: true }),
    });
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_FAILED');
    }
  });

  it('rejects non-pull_request events', async () => {
    const deps = createDeps();
    const event = createFakePREvent({ eventType: 'issue_comment' });

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_EVENT');
    }
  });

  it('rejects non-opened/synchronize actions', async () => {
    const deps = createDeps();
    const event = createFakePREvent({ action: 'closed' });

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_EVENT');
    }
  });

  it('rejects invalid repository format', async () => {
    const deps = createDeps();
    const event = createFakePREvent({ repository: 'no-slash' });

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_EVENT');
    }
  });

  it('rejects unknown review_type in request_review tool', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const requestReview = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (requestReview !== undefined) {
          const result = await requestReview.run({ review_type: 'performance' });
          expect(result).toContain('Unknown review type');
        }
        return ok({
          content: 'Done.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110, costUsd: 0.0005 },
        });
      },
    };
    const logger = createFakeLogger();
    const deps = createDeps({ toolCallingClient: toolClient, logger });
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Invalid review types should not be added to reviewsRequested
      expect(result.value.reviewsRequested).toHaveLength(0);
    }
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reviewType: 'performance' }),
      'GitHub Agent requested unknown review type'
    );
  });

  it('handles non-string review_type in request_review tool', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const requestReview = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (requestReview !== undefined) {
          const result = await requestReview.run({});
          expect(result).toContain('Unknown review type');
        }
        return ok({
          content: 'Done.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110, costUsd: 0.0005 },
        });
      },
    };
    const deps = createDeps({ toolCallingClient: toolClient });
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reviewsRequested).toHaveLength(0);
    }
  });

  it('handles skip_review tool call', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const skipTool = params.tools.find((t: ToolDefinition) => t.name === 'skip_review');
        if (skipTool !== undefined) {
          await skipTool.run({ reason: 'Docs-only change' });
        }
        return ok({
          content: 'Skipped review.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110, costUsd: 0.0005 },
        });
      },
    };
    const deps = createDeps({ toolCallingClient: toolClient });
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(true);
      expect(result.value.skipReason).toBe('Docs-only change');
      expect(result.value.reviewsRequested).toHaveLength(0);
    }
  });

  it('handles non-string reason in skip_review tool', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const skipTool = params.tools.find((t: ToolDefinition) => t.name === 'skip_review');
        if (skipTool !== undefined) {
          await skipTool.run({});
        }
        return ok({
          content: 'Skipped.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110, costUsd: 0.0005 },
        });
      },
    };
    const deps = createDeps({ toolCallingClient: toolClient });
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(true);
      expect(result.value.skipReason).toBe('(no reason provided)');
    }
  });

  it('handles synchronize action', async () => {
    const deps = createDeps();
    const event = createFakePREvent({ action: 'synchronize' });

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
  });

  it('handles PR with no changed files', async () => {
    const prClient = createFakeGitHubPRClient();
    vi.mocked(prClient.getPullRequestFiles).mockResolvedValue(ok([]));
    const deps = createDeps({ gitHubPRClient: prClient });
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
  });

  it('handles PR with no title or body', async () => {
    const deps = createDeps();
    const event = createFakePREvent({ title: null, body: null });

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
  });
});

describe('isGitHubAgentEvent', () => {
  it('returns true for pull_request.opened', () => {
    const event = createFakePREvent({ eventType: 'pull_request', action: 'opened' });
    expect(isGitHubAgentEvent(event)).toBe(true);
  });

  it('returns true for pull_request.synchronize', () => {
    const event = createFakePREvent({ eventType: 'pull_request', action: 'synchronize' });
    expect(isGitHubAgentEvent(event)).toBe(true);
  });

  it('returns false for pull_request.closed', () => {
    const event = createFakePREvent({ eventType: 'pull_request', action: 'closed' });
    expect(isGitHubAgentEvent(event)).toBe(false);
  });

  it('returns false for issue_comment', () => {
    const event = createFakePREvent({ eventType: 'issue_comment', action: 'created' });
    expect(isGitHubAgentEvent(event)).toBe(false);
  });

  it('returns false for null action', () => {
    const event = createFakePREvent({ eventType: 'pull_request', action: null });
    expect(isGitHubAgentEvent(event)).toBe(false);
  });
});
