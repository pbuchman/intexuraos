/**
 * Tests for GitHub Agent use case.
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { ToolCallingClient, ToolDefinition } from '@intexuraos/llm-contract';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { GitHubPREvent } from '../../domain/models/gitHubPREvent.js';
import { evaluateEvent, evaluatePREvent, isGitHubAgentEvent, type GitHubAgentDeps } from '../../domain/usecases/githubAgent.js';
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
    title: 'feat: add new feature',
    body: 'This PR adds a new feature.',
    state: 'open',
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
      { filename: 'src/utils.ts', status: 'added', additions: 30, deletions: 0 },
    ])),
    getPullRequestCommits: vi.fn().mockResolvedValue(ok([
      { sha: 'abc123', message: 'feat: add feature', author: 'dev-user' },
    ])),
    getPullRequestBaseBranch: vi.fn().mockResolvedValue(ok('main')),
    getPullRequestStatus: vi.fn().mockResolvedValue(
      ok({ state: 'open', mergedAt: null, headRef: 'task_existing_pr_branch' })
    ),
    postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 1 })),
    listOpenPullRequestsByBaseBranch: vi.fn().mockResolvedValue(ok([])),
    getPullRequestDetails: vi.fn().mockResolvedValue(ok({
      number: 42,
      title: 'feat: add new feature',
      body: 'This PR adds a new feature.',
      authorLogin: 'dev-user',
      baseBranch: 'main',
      headBranch: 'feature/test',
      mergeable: true,
      mergeableState: 'clean',
    })),
    updateIssueComment: vi.fn().mockResolvedValue(ok({ commentId: 1 })),
  };
}

function createFakeToolCallingClient(options?: {
  callTools?: boolean;
  error?: boolean;
  toolToCall?: string;
  toolArgs?: Record<string, unknown>;
}): ToolCallingClient {
  return {
    async run(params): ReturnType<ToolCallingClient['run']> {
      if (options?.error === true) {
        return err({ code: 'API_ERROR' as const, message: 'LLM unavailable' });
      }

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

function createFakeUserServiceClient(): UserServiceClient {
  return {
    getApiKeys: vi.fn().mockResolvedValue(ok({})),
    getLlmClient: vi.fn().mockResolvedValue(ok({})),
    reportLlmSuccess: vi.fn().mockResolvedValue(undefined),
    resolveGitHubUsername: vi.fn().mockResolvedValue(ok({ userId: 'user-1' })),
    getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'oauth-token-123', email: 'test@test.com' })),
  };
}

function createDeps(overrides: Partial<GitHubAgentDeps> = {}): GitHubAgentDeps {
  return {
    logger: createFakeLogger(),
    gitHubPRClient: createFakeGitHubPRClient(),
    toolCallingClient: createFakeToolCallingClient(),
    userServiceClient: createFakeUserServiceClient(),
    allowedBots: new Set(['claude[bot]', 'chatgpt-codex-connector[bot]']),
    ...overrides,
  };
}

describe('evaluateEvent', () => {
  describe('pull_request events', () => {
    it('evaluates a PR and returns request_review triage', async () => {
      const deps = createDeps();
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage.action).toBe('request_review');
        if (result.value.triage.action === 'request_review') {
          expect(result.value.triage.reviewTypes).toContain('code_quality');
        }
        expect(result.value.usage.costUsd).toBe(0.001);
        expect(result.value.usage.toolCalls).toHaveLength(1);
      }
    });

    it('fetches PR files using the client with OAuth token', async () => {
      const prClient = createFakeGitHubPRClient();
      const deps = createDeps({ gitHubPRClient: prClient });
      const event = createFakePREvent();

      await evaluateEvent(deps, event);

      expect(prClient.getPullRequestFiles).toHaveBeenCalledWith(
        'oauth-token-123', 'intexuraos', 'intexuraos', 42
      );
    });

    it('returns error when PR files fetch fails', async () => {
      const prClient = createFakeGitHubPRClient();
      vi.mocked(prClient.getPullRequestFiles).mockResolvedValue(
        err({ code: 'UNAUTHORIZED', message: 'Bad token' })
      );
      const deps = createDeps({ gitHubPRClient: prClient });
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

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

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_FAILED');
      }
    });

    it('rejects non-opened/synchronize actions', async () => {
      const deps = createDeps();
      const event = createFakePREvent({ action: 'closed' });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_EVENT');
      }
    });

    it('rejects invalid repository format', async () => {
      const deps = createDeps();
      const event = createFakePREvent({ repository: 'no-slash' });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_EVENT');
      }
    });

    it('handles skip tool call', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'skip',
          toolArgs: { reason: 'Docs-only change' },
        }),
      });
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage).toEqual({
          action: 'skip',
          reason: 'Docs-only change',
        });
      }
    });

    it('handles unknown review_type gracefully', async () => {
      const logger = createFakeLogger();
      const deps = createDeps({
        logger,
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'request_review',
          toolArgs: { review_type: 'performance' },
        }),
      });
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage).toEqual({ action: 'skip', reason: 'No tool called' });
      }
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ reviewType: 'performance' }),
        'GitHub Agent requested unknown review type'
      );
    });

    it('returns skip when no tool is called for PR event', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({ callTools: false }),
      });
      const event = createFakePREvent();
      const result = await evaluateEvent(deps, event);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage).toEqual({ action: 'skip', reason: 'No tool called' });
      }
    });

    it('handles multiple review types', async () => {
      const toolClient: ToolCallingClient = {
        async run(params): ReturnType<ToolCallingClient['run']> {
          const requestReview = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
          if (requestReview !== undefined) {
            await requestReview.run({ review_type: 'code_quality' });
            await requestReview.run({ review_type: 'security' });
          }
          return ok({
            content: 'Done.',
            toolCallsMade: 2,
            iterationCount: 1,
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.002 },
          });
        },
      };
      const deps = createDeps({ toolCallingClient: toolClient });
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok && result.value.triage.action === 'request_review') {
        expect(result.value.triage.reviewTypes).toEqual(['code_quality', 'security']);
      }
    });

    it('deduplicates review types when LLM calls same type twice', async () => {
      const toolClient: ToolCallingClient = {
        async run(params): ReturnType<ToolCallingClient['run']> {
          const requestReview = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
          if (requestReview !== undefined) {
            await requestReview.run({ review_type: 'code_quality' });
            await requestReview.run({ review_type: 'code_quality' });
            await requestReview.run({ review_type: 'security' });
          }
          return ok({
            content: 'Reviewing for code quality and security.',
            toolCallsMade: 3,
            iterationCount: 1,
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.003 },
          });
        },
      };
      const deps = createDeps({ toolCallingClient: toolClient });
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok && result.value.triage.action === 'request_review') {
        expect(result.value.triage.reviewTypes).toEqual(['code_quality', 'security']);
      }
    });

    it('returns USER_NOT_FOUND when GitHub user has no linked account', async () => {
      const userClient = createFakeUserServiceClient();
      vi.mocked(userClient.resolveGitHubUsername).mockResolvedValue(ok(null));
      const deps = createDeps({ userServiceClient: userClient });
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('USER_NOT_FOUND');
      }
    });

    it('returns USER_NOT_FOUND when user resolution fails', async () => {
      const userClient = createFakeUserServiceClient();
      vi.mocked(userClient.resolveGitHubUsername).mockResolvedValue(
        err({ code: 'NETWORK_ERROR' as const, message: 'Connection refused' })
      );
      const deps = createDeps({ userServiceClient: userClient });
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

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

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_NOT_AVAILABLE');
      }
    });

    it('handles null action by rejecting as invalid', async () => {
      const deps = createDeps();
      const event = createFakePREvent({ action: null });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_EVENT');
      }
    });

    it('handles null title and body in prompt building', async () => {
      const deps = createDeps();
      const event = createFakePREvent({ title: null, body: null, action: 'opened' });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
    });

    it('handles non-string review_type argument', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'request_review',
          toolArgs: { review_type: 42 },
        }),
      });
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage).toEqual({ action: 'skip', reason: 'No tool called' });
      }
    });

    it('resolves bot sender to repo owner before user lookup', async () => {
      const userClient = createFakeUserServiceClient();
      const deps = createDeps({
        userServiceClient: userClient,
        allowedBots: new Set(['claude[bot]', 'chatgpt-codex-connector[bot]', 'intexuraos-code-worker[bot]']),
      });
      const event = createFakePREvent({
        senderLogin: 'intexuraos-code-worker[bot]',
        repository: 'pbuchman/intexuraos',
      });

      await evaluateEvent(deps, event);

      // Should resolve 'pbuchman' (repo owner), not 'intexuraos-code-worker[bot]'
      expect(userClient.resolveGitHubUsername).toHaveBeenCalledWith('pbuchman');
    });

    it('does not remap non-bot sender for user lookup', async () => {
      const userClient = createFakeUserServiceClient();
      const deps = createDeps({
        userServiceClient: userClient,
        allowedBots: new Set(['claude[bot]', 'intexuraos-code-worker[bot]']),
      });
      const event = createFakePREvent({
        senderLogin: 'dev-user',
        repository: 'pbuchman/intexuraos',
      });

      await evaluateEvent(deps, event);

      expect(userClient.resolveGitHubUsername).toHaveBeenCalledWith('dev-user');
    });

    it('handles synchronize action', async () => {
      const deps = createDeps();
      const event = createFakePREvent({ action: 'synchronize' });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
    });

    it('returns reasoning from LLM content', async () => {
      const toolClient: ToolCallingClient = {
        async run(params): ReturnType<ToolCallingClient['run']> {
          const requestReview = params.tools.find((t: ToolDefinition) => t.name === 'request_review');
          if (requestReview !== undefined) {
            await requestReview.run({ review_type: 'code_quality' });
          }
          return ok({
            content: 'This PR modifies authentication logic across multiple services.',
            toolCallsMade: 1,
            iterationCount: 1,
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
          });
        },
      };
      const deps = createDeps({ toolCallingClient: toolClient });
      const event = createFakePREvent();

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.reasoning).toBe('This PR modifies authentication logic across multiple services.');
      }
    });

    it('logs reasoning in evaluation complete message', async () => {
      const logger = createFakeLogger();
      const deps = createDeps({
        logger,
        toolCallingClient: createFakeToolCallingClient(),
      });
      const event = createFakePREvent();

      await evaluateEvent(deps, event);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning: 'Done.' }),
        'GitHub Agent evaluation complete'
      );
    });
  });

  describe('issue_comment events', () => {
    it('evaluates a comment and returns dispatch triage', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'dispatch_to_task',
          toolArgs: { message_template: 'pr_comment' },
        }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'created',
        body: 'Can you fix the lint errors?',
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage).toEqual({
          action: 'dispatch',
          template: 'pr_comment',
        });
      }
    });

    it('evaluates a comment and returns skip triage', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'skip',
          toolArgs: { reason: 'Bot noise' },
        }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'created',
        body: '+1',
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage).toEqual({
          action: 'skip',
          reason: 'Bot noise',
        });
      }
    });

    it('dispatches as bot_review_edit for bot edits', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'dispatch_to_task',
          toolArgs: { message_template: 'bot_review_edit' },
        }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'edited',
        senderLogin: 'claude[bot]',
        body: '## Review Findings\n- [ ] Fix import order',
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage).toEqual({
          action: 'dispatch',
          template: 'bot_review_edit',
        });
      }
    });

    it('returns error for LLM failure', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({ error: true }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'created',
        body: 'test comment',
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_FAILED');
      }
    });

    it('returns skip when no tool is called', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({ callTools: false }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'created',
        body: 'ambiguous comment',
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage).toEqual({
          action: 'skip',
          reason: 'No tool called',
        });
      }
    });

    it('returns reasoning from LLM content for comment events', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'dispatch_to_task',
          toolArgs: { message_template: 'pr_comment' },
        }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'created',
        body: 'Please review the auth changes',
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.reasoning).toBe('Done.');
      }
    });

    it('rejects issue_comment with null action', async () => {
      const deps = createDeps();
      const event = createFakePREvent({ eventType: 'issue_comment', action: null });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_EVENT');
      }
    });

    it('handles null title, body, and action fields in comment events', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'dispatch_to_task',
          toolArgs: { message_template: 'pr_comment' },
        }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'created',
        title: null,
        body: null,
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
    });

    it('handles non-string dispatch_to_task template argument', async () => {
      const logger = createFakeLogger();
      const deps = createDeps({
        logger,
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'dispatch_to_task',
          toolArgs: { message_template: 123 },
        }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'created',
        body: 'test',
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('handles non-string skip reason argument in comment context', async () => {
      const deps = createDeps({
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'skip',
          toolArgs: { reason: 42 },
        }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'created',
        body: 'test',
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.triage).toEqual({
          action: 'skip',
          reason: '(no reason provided)',
        });
      }
    });

    it('handles invalid dispatch template gracefully', async () => {
      const logger = createFakeLogger();
      const deps = createDeps({
        logger,
        toolCallingClient: createFakeToolCallingClient({
          toolToCall: 'dispatch_to_task',
          toolArgs: { message_template: 'unknown_template' },
        }),
      });
      const event = createFakePREvent({
        eventType: 'issue_comment',
        action: 'created',
        body: 'test comment',
      });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'unknown_template' }),
        'GitHub Agent used unknown dispatch template'
      );
    });
  });

  describe('unsupported event types', () => {
    it('rejects pull_request_review events', async () => {
      const deps = createDeps();
      const event = createFakePREvent({ eventType: 'pull_request_review' });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_EVENT');
      }
    });

    it('rejects issue_comment with unsupported action', async () => {
      const deps = createDeps();
      const event = createFakePREvent({ eventType: 'issue_comment', action: 'deleted' });

      const result = await evaluateEvent(deps, event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_EVENT');
      }
    });
  });
});

describe('evaluatePREvent (legacy)', () => {
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

  it('handles skip tool call', async () => {
    const deps = createDeps({
      toolCallingClient: createFakeToolCallingClient({
        toolToCall: 'skip',
        toolArgs: { reason: 'Docs-only change' },
      }),
    });
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(true);
      expect(result.value.skipReason).toBe('Docs-only change');
      expect(result.value.reviewsRequested).toHaveLength(0);
    }
  });

  it('handles non-string reason in skip tool', async () => {
    const deps = createDeps({
      toolCallingClient: createFakeToolCallingClient({
        toolToCall: 'skip',
        toolArgs: {},
      }),
    });
    const event = createFakePREvent();

    const result = await evaluatePREvent(deps, event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(true);
      expect(result.value.skipReason).toBe('(no reason provided)');
    }
  });

  it('rejects non-pull_request events', async () => {
    const deps = createDeps();
    const event = createFakePREvent({ eventType: 'issue_comment' });

    const result = await evaluatePREvent(deps, event);

    // Legacy wrapper delegates to evaluateEvent which accepts issue_comment
    // but the event action 'opened' is not valid for issue_comment
    expect(result.ok).toBe(false);
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
