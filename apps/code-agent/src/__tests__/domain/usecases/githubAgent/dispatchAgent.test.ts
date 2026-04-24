/**
 * Tests for GitHub Agent dispatch logic.
 *
 * Covers dispatchPRAgent and dispatchCommentAgent in isolation — user/token
 * resolution, plan-only short-circuit, tool-calling-client resolution and the
 * final LLM invocation.
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { ToolCallingClient, ToolDefinition } from '@intexuraos/llm-contract';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { Logger } from '@intexuraos/common-core';
import type { GitHubPRClient } from '../../../../domain/ports/gitHubPRClient.js';
import type { GitHubPREvent } from '../../../../domain/models/gitHubPREvent.js';
import {
  dispatchPRAgent,
  dispatchCommentAgent,
  type GitHubAgentDeps,
  type GitHubAgentError,
} from '../../../../domain/usecases/githubAgent/dispatchAgent.js';

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
    deliveryId: null,
    repository: 'intexuraos/intexuraos',
    repositoryId: 100,
    pullRequestNumber: 42,
    pullRequestId: 200,
    eventType: 'pull_request',
    action: 'opened',
    senderLogin: 'dev-user',
    senderId: 1,
    senderType: 'User',
    prAuthorLogin: null,
    title: 'feat: add new feature',
    body: 'This PR adds a new feature.',
    state: 'open',
    isDraft: null,
    baseBranch: null,
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
    ])),
    getPullRequestCommits: vi.fn().mockResolvedValue(ok([])),
    getPullRequestBaseBranch: vi.fn().mockResolvedValue(ok('main')),
    getPullRequestStatus: vi.fn().mockResolvedValue(ok({ state: 'open', mergedAt: null, headRef: 'task_branch' })),
    postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 1 })),
    listOpenPullRequestsByBaseBranch: vi.fn().mockResolvedValue(ok([])),
    getPullRequestDetails: vi.fn().mockResolvedValue(ok({
      number: 42,
      title: 'feat: add new feature',
      body: '',
      authorLogin: 'dev-user',
      baseBranch: 'main',
      headBranch: 'feature/test',
      mergeable: true,
      mergeableState: 'clean',
      headSha: 'sha123',
      createdAt: '2026-01-01T00:00:00Z',
    })),
    getIssueComment: vi.fn().mockResolvedValue(ok({ body: '' })),
    updateIssueComment: vi.fn().mockResolvedValue(ok({ commentId: 1 })),
    mergePullRequest: vi.fn().mockResolvedValue(ok({ sha: 'abc123', merged: true })),
    getCombinedCheckStatus: vi.fn().mockResolvedValue(ok({ state: 'success' })),
    listAllOpenPullRequests: vi.fn().mockResolvedValue(ok([])),
  };
}

function createFakeToolCallingClient(options?: {
  callTools?: boolean;
  toolToCall?: string;
  toolArgs?: Record<string, unknown>;
}): ToolCallingClient {
  return {
    async run(params): ReturnType<ToolCallingClient['run']> {
      if (options?.callTools !== false) {
        const toolName = options?.toolToCall ?? 'request_review';
        const tool = params.tools.find((t: ToolDefinition) => t.name === toolName);
        if (tool !== undefined) {
          const args = options?.toolArgs ?? { review_type: 'code_quality' };
          await tool.run(args);
        }
      }
      return ok({
        content: 'Done.',
        toolCallsMade: options?.callTools !== false ? 1 : 0,
        iterationCount: 1,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      });
    },
  };
}

function createFakeResolveToolCallingClient(options?: {
  callTools?: boolean;
  toolToCall?: string;
  toolArgs?: Record<string, unknown>;
  resolveError?: boolean;
}): (userId: string) => Promise<Result<ToolCallingClient, GitHubAgentError>> {
  return vi.fn().mockImplementation(async (_userId: string) => {
    if (options?.resolveError === true) {
      return err({ code: 'LLM_FAILED' as const, message: 'Orchestrator unavailable' });
    }
    return ok(createFakeToolCallingClient(options));
  });
}

function createFakeUserServiceClient(): UserServiceClient {
  return {
    getApiKeys: vi.fn().mockResolvedValue(ok({})),
    getLlmClient: vi.fn().mockResolvedValue(ok({})),
    reportLlmSuccess: vi.fn().mockResolvedValue(undefined),
    resolveGitHubUsername: vi.fn().mockResolvedValue(ok({ userId: 'user-1' })),
    getUserTimezone: async (): Promise<string | undefined> => undefined,
    getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'oauth-token-123', email: 'test@test.com' })),
  };
}

function createDeps(overrides: Partial<GitHubAgentDeps> = {}): GitHubAgentDeps {
  return {
    logger: createFakeLogger(),
    gitHubPRClient: createFakeGitHubPRClient(),
    resolveToolCallingClient: createFakeResolveToolCallingClient(),
    userServiceClient: createFakeUserServiceClient(),
    allowedBots: new Set<string>(['claude[bot]']),
    ...overrides,
  };
}

describe('dispatchPRAgent', () => {
  it('invokes LLM with request_review and skip tools and returns llm outcome', async () => {
    let capturedTools: ToolDefinition[] = [];
    let capturedPrompt = '';
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        capturedTools = params.tools;
        capturedPrompt = params.systemPrompt;
        const requestReview = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (requestReview !== undefined) {
          await requestReview.run({ review_type: 'code_quality' });
        }
        return ok({
          content: 'Done.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('llm');
      if (result.value.kind === 'llm') {
        expect(result.value.reviewsRequested).toEqual(['code_quality']);
        expect(result.value.toolCalls).toHaveLength(1);
        expect(result.value.runResult.usage.costUsd).toBe(0.001);
      }
    }
    expect(capturedTools.map((t) => t.name).sort()).toEqual(['request_review', 'skip']);
    expect(capturedPrompt.length).toBeGreaterThan(0);
  });

  it('returns error without retry when resolveToolCallingClient fails', async () => {
    const resolveMock = createFakeResolveToolCallingClient({ resolveError: true });
    const deps = createDeps({ resolveToolCallingClient: resolveMock });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_FAILED');
      expect(result.error.message).toContain('Orchestrator unavailable');
    }
    // Should be called exactly once — no retry
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });

  it('returns USER_NOT_FOUND when user resolution fails', async () => {
    const userClient = createFakeUserServiceClient();
    vi.mocked(userClient.resolveGitHubUsername).mockResolvedValue(
      err({ code: 'NETWORK_ERROR' as const, message: 'Connection refused' })
    );
    const deps = createDeps({ userServiceClient: userClient });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('USER_NOT_FOUND');
    }
  });

  it('returns USER_NOT_FOUND when resolved user is null', async () => {
    const userClient = createFakeUserServiceClient();
    vi.mocked(userClient.resolveGitHubUsername).mockResolvedValue(ok(null));
    const deps = createDeps({ userServiceClient: userClient });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('USER_NOT_FOUND');
    }
  });

  it('returns TOKEN_NOT_AVAILABLE when OAuth token fetch fails', async () => {
    const userClient = createFakeUserServiceClient();
    vi.mocked(userClient.getOAuthToken).mockResolvedValue(
      err({ code: 'CONNECTION_NOT_FOUND' as const, message: 'No GitHub OAuth connection' })
    );
    const deps = createDeps({ userServiceClient: userClient });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOKEN_NOT_AVAILABLE');
    }
  });

  it('returns GITHUB_API_FAILED when PR files fetch fails', async () => {
    const prClient = createFakeGitHubPRClient();
    vi.mocked(prClient.getPullRequestFiles).mockResolvedValue(
      err({ code: 'UNAUTHORIZED', message: 'Bad token' })
    );
    const deps = createDeps({ gitHubPRClient: prClient });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('GITHUB_API_FAILED');
    }
  });

  it('short-circuits for plan-only PR with deterministic outcome', async () => {
    const prClient = createFakeGitHubPRClient();
    vi.mocked(prClient.getPullRequestFiles).mockResolvedValue(ok([
      { filename: 'docs/plans/2026-03-20-my-plan.md', status: 'added', additions: 50, deletions: 0 },
    ]));
    const deps = createDeps({ gitHubPRClient: prClient });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('deterministic');
      if (result.value.kind === 'deterministic') {
        expect(result.value.triage).toEqual({ action: 'request_review', reviewTypes: ['plan_review'] });
        expect(result.value.reasoning).toContain('Plan-only PR');
      }
    }
  });

  it('returns LLM_FAILED when LLM call fails', async () => {
    const toolClient: ToolCallingClient = {
      async run(): ReturnType<ToolCallingClient['run']> {
        return err({ code: 'API_ERROR' as const, message: 'Upstream busted' });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_FAILED');
    }
  });

  it('appends correctionContext as second user message when provided', async () => {
    let capturedMessages: { role: string; content: string }[] = [];
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        capturedMessages = [...params.messages];
        const requestReview = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (requestReview !== undefined) {
          await requestReview.run({ review_type: 'code_quality' });
        }
        return ok({
          content: 'Done.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent();

    await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos', 'Retry reason');

    expect(capturedMessages).toHaveLength(2);
    expect(capturedMessages[1]?.content).toBe('Retry reason');
  });

  it('PR skip tool records state when called', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const skipTool = params.tools.find((t: ToolDefinition) => t.name === 'skip');
        if (skipTool !== undefined) {
          await skipTool.run({ reason: 'Docs-only' });
        }
        return ok({
          content: 'Skipped.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'llm') {
      expect(result.value.state.skipped).toBe(true);
      expect(result.value.state.skipReason).toBe('Docs-only');
    }
  });

  it('PR skip tool uses fallback reason for non-string reason arg', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const skipTool = params.tools.find((t: ToolDefinition) => t.name === 'skip');
        if (skipTool !== undefined) {
          await skipTool.run({});
        }
        return ok({
          content: 'Skipped.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'llm') {
      expect(result.value.state.skipReason).toBe('(no reason provided)');
    }
  });

  it('PR request_review with unknown type does not record review', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const tool = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (tool !== undefined) {
          await tool.run({ review_type: 'not-a-real-type' });
          await tool.run({ review_type: 42 });
        }
        return ok({
          content: 'Invalid.',
          toolCallsMade: 2,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent();

    const result = await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'llm') {
      expect(result.value.reviewsRequested).toEqual([]);
    }
  });

  it('PR onExhausted returns repair message string', async () => {
    let capturedOnExhausted: ((ctx: { iterationCount: number; toolCallsMade: number }) => string | undefined) | undefined;
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        capturedOnExhausted = params.onExhausted;
        return ok({
          content: 'Done.',
          toolCallsMade: 0,
          iterationCount: 5,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent();

    await dispatchPRAgent(deps, event, 'intexuraos', 'intexuraos');

    expect(capturedOnExhausted).toBeTypeOf('function');
    if (typeof capturedOnExhausted === 'function') {
      const repair = capturedOnExhausted({ iterationCount: 5, toolCallsMade: 0 });
      expect(repair).toBeTypeOf('string');
    }
  });
});

describe('dispatchCommentAgent', () => {
  it('uses request_review tool set for @review comments', async () => {
    let capturedTools: ToolDefinition[] = [];
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        capturedTools = params.tools;
        const requestReview = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (requestReview !== undefined) {
          await requestReview.run({ review_type: 'architecture', worker_type: 'qwen' });
        }
        return ok({
          content: 'Done.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '@review architecture with qwen',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'comment-llm') {
      expect(result.value.state.reviewTypes).toEqual(['architecture']);
      expect(result.value.state.reviewWorkerType).toBe('qwen');
    }
    expect(capturedTools.map((t) => t.name).sort()).toEqual(['request_review', 'skip']);
  });

  it('comment request_review rejects unknown review type', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const tool = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (tool !== undefined) {
          await tool.run({ review_type: 'bogus', worker_type: 'qwen' });
        }
        return ok({
          content: 'Invalid.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '@review bogus',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'comment-llm') {
      expect(result.value.state.reviewTypes).toEqual([]);
    }
  });

  it('uses dispatch_to_task tool set for non-@review comments', async () => {
    let capturedTools: ToolDefinition[] = [];
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        capturedTools = params.tools;
        const dispatchTool = params.tools.find((t: ToolDefinition) => t.name === 'dispatch_to_task');
        if (dispatchTool !== undefined) {
          await dispatchTool.run({ message_template: 'pr_comment' });
        }
        return ok({
          content: 'Done.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'Please fix the lint',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'comment-llm') {
      expect(result.value.state.dispatchTemplate).toBe('pr_comment');
    }
    expect(capturedTools.map((t) => t.name).sort()).toEqual(['dispatch_to_task', 'skip']);
  });

  it('returns error without retry when resolveToolCallingClient fails', async () => {
    const resolveMock = createFakeResolveToolCallingClient({ resolveError: true });
    const deps = createDeps({ resolveToolCallingClient: resolveMock });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '@review architecture',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_FAILED');
    }
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });

  it('returns USER_NOT_FOUND when comment sender resolution fails', async () => {
    const userClient = createFakeUserServiceClient();
    vi.mocked(userClient.resolveGitHubUsername).mockResolvedValue(
      err({ code: 'NETWORK_ERROR' as const, message: 'Connection refused' })
    );
    const deps = createDeps({ userServiceClient: userClient });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'test',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('USER_NOT_FOUND');
    }
  });

  it('returns USER_NOT_FOUND when comment sender is null', async () => {
    const userClient = createFakeUserServiceClient();
    vi.mocked(userClient.resolveGitHubUsername).mockResolvedValue(ok(null));
    const deps = createDeps({ userServiceClient: userClient });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'test',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('USER_NOT_FOUND');
    }
  });

  it('returns LLM_FAILED when LLM call fails', async () => {
    const toolClient: ToolCallingClient = {
      async run(): ReturnType<ToolCallingClient['run']> {
        return err({ code: 'API_ERROR' as const, message: 'LLM unavailable' });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'anything',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_FAILED');
    }
  });

  it('comment skip tool records state', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const skipTool = params.tools.find((t: ToolDefinition) => t.name === 'skip');
        if (skipTool !== undefined) {
          await skipTool.run({ reason: 'Bot noise' });
        }
        return ok({
          content: 'Skipped.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '+1',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'comment-llm') {
      expect(result.value.state.skipped).toBe(true);
      expect(result.value.state.skipReason).toBe('Bot noise');
    }
  });

  it('comment skip tool uses fallback reason for non-string reason', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const skipTool = params.tools.find((t: ToolDefinition) => t.name === 'skip');
        if (skipTool !== undefined) {
          await skipTool.run({});
        }
        return ok({
          content: 'Skipped.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'something',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'comment-llm') {
      expect(result.value.state.skipReason).toBe('(no reason provided)');
    }
  });

  it('dispatch_to_task rejects unknown template', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const tool = params.tools.find((t: ToolDefinition) => t.name === 'dispatch_to_task');
        if (tool !== undefined) {
          await tool.run({ message_template: 'nope' });
          await tool.run({ message_template: 7 });
        }
        return ok({
          content: 'Invalid.',
          toolCallsMade: 2,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'unlabelled comment',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'comment-llm') {
      expect(result.value.state.dispatchTemplate).toBeUndefined();
    }
  });

  it('@review request rejects invalid worker type', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const tool = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (tool !== undefined) {
          await tool.run({ review_type: 'architecture', worker_type: 'invalid-worker' });
        }
        return ok({
          content: 'Invalid.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '@review architecture',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'comment-llm') {
      expect(result.value.state.reviewTypes).toEqual([]);
      expect(result.value.state.reviewWorkerType).toBeUndefined();
    }
  });

  it('@review request rejects conflicting worker types', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const tool = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
        if (tool !== undefined) {
          await tool.run({ review_type: 'architecture', worker_type: 'qwen' });
          await tool.run({ review_type: 'security', worker_type: 'opus' });
        }
        return ok({
          content: 'Conflict.',
          toolCallsMade: 2,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '@review architecture and security',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'comment-llm') {
      expect(result.value.state.reviewTypes).toEqual(['architecture']);
      expect(result.value.state.reviewWorkerType).toBe('qwen');
    }
  });

  it('appends correctionContext for comment dispatch when provided', async () => {
    let capturedMessages: { role: string; content: string }[] = [];
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        capturedMessages = [...params.messages];
        const skipTool = params.tools.find((t: ToolDefinition) => t.name === 'skip');
        if (skipTool !== undefined) {
          await skipTool.run({ reason: 'Not actionable' });
        }
        return ok({
          content: 'Done.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'test',
    });

    await dispatchCommentAgent(deps, event, 'Retry reason');

    expect(capturedMessages).toHaveLength(2);
    expect(capturedMessages[1]?.content).toBe('Retry reason');
  });

  it('passes isBotSender=true to prompt when sender is an allowed bot', async () => {
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        const dispatchTool = params.tools.find((t: ToolDefinition) => t.name === 'dispatch_to_task');
        if (dispatchTool !== undefined) {
          await dispatchTool.run({ message_template: 'bot_review_edit' });
        }
        return ok({
          content: 'Done.',
          toolCallsMade: 1,
          iterationCount: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({
      resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)),
      allowedBots: new Set(['claude[bot]']),
    });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'edited',
      senderLogin: 'claude[bot]',
      body: '## Review Findings',
    });

    const result = await dispatchCommentAgent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'comment-llm') {
      expect(result.value.state.dispatchTemplate).toBe('bot_review_edit');
    }
  });

  it('comment onExhausted returns a repair message', async () => {
    let capturedOnExhausted: ((ctx: { iterationCount: number; toolCallsMade: number }) => string | undefined) | undefined;
    const toolClient: ToolCallingClient = {
      async run(params): ReturnType<ToolCallingClient['run']> {
        capturedOnExhausted = params.onExhausted;
        return ok({
          content: 'Done.',
          toolCallsMade: 0,
          iterationCount: 5,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 },
        });
      },
    };
    const deps = createDeps({ resolveToolCallingClient: vi.fn().mockResolvedValue(ok(toolClient)) });
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'test',
    });

    await dispatchCommentAgent(deps, event);

    expect(capturedOnExhausted).toBeTypeOf('function');
    if (typeof capturedOnExhausted === 'function') {
      const repair = capturedOnExhausted({ iterationCount: 5, toolCallsMade: 0 });
      expect(repair).toBeTypeOf('string');
    }
  });
});
