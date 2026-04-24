/**
 * Tests for GitHub Agent response processing logic.
 *
 * Covers processPRResponse / processCommentResponse with success and failure
 * dispatch outcomes, including deterministic plan-only outcomes.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../../../domain/models/gitHubPREvent.js';
import type { DispatchOutcome } from '../../../../domain/usecases/githubAgent/dispatchAgent.js';
import {
  processPRResponse,
  processCommentResponse,
} from '../../../../domain/usecases/githubAgent/processResponse.js';

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
    body: 'body',
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

describe('processPRResponse', () => {
  it('builds deterministic plan-only result with zero cost and empty tool calls', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent();
    const outcome: DispatchOutcome = {
      kind: 'deterministic',
      triage: { action: 'request_review', reviewTypes: ['plan_review'] },
      reasoning: 'Plan-only PR detected — deterministic dispatch to plan_review',
    };

    const result = processPRResponse(logger, event, outcome);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.triage).toEqual({ action: 'request_review', reviewTypes: ['plan_review'] });
      expect(result.value.usage.costUsd).toBe(0);
      expect(result.value.usage.toolCalls).toEqual([]);
      expect(result.value.reasoning).toContain('Plan-only PR');
    }
  });

  it('builds success result from llm outcome with reviewsRequested', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent();
    const outcome: DispatchOutcome = {
      kind: 'llm',
      runResult: {
        content: 'Reasoning here.',
        toolCallsMade: 2,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.01 },
      },
      state: { skipped: false, skipReason: undefined },
      toolCalls: [
        { tool: 'request_review', args: { review_type: 'code_quality' } },
        { tool: 'request_review', args: { review_type: 'security' } },
      ],
      reviewsRequested: ['code_quality', 'security'],
    };

    const result = processPRResponse(logger, event, outcome);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.triage).toEqual({ action: 'request_review', reviewTypes: ['code_quality', 'security'] });
      expect(result.value.usage.costUsd).toBe(0.01);
      expect(result.value.reasoning).toBe('Reasoning here.');
    }
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: 'Reasoning here.' }),
      'GitHub Agent evaluation complete'
    );
  });

  it('builds skip result when state.skipped and reason non-empty', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent();
    const outcome: DispatchOutcome = {
      kind: 'llm',
      runResult: {
        content: 'Skipped.',
        toolCallsMade: 1,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: { skipped: true, skipReason: 'Docs only' },
      toolCalls: [{ tool: 'skip', args: { reason: 'Docs only' } }],
      reviewsRequested: [],
    };

    const result = processPRResponse(logger, event, outcome);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.triage).toEqual({ action: 'skip', reason: 'Docs only' });
    }
  });

  it('returns LLM_FAILED when llm outcome has no triage tool called', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent();
    const outcome: DispatchOutcome = {
      kind: 'llm',
      runResult: {
        content: 'No tool called.',
        toolCallsMade: 0,
        iterationCount: 5,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: { skipped: false, skipReason: undefined },
      toolCalls: [],
      reviewsRequested: [],
    };

    const result = processPRResponse(logger, event, outcome);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_FAILED');
      expect(result.error.message).toContain('No triage tool was called');
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 42 }),
      'GitHub Agent triage validation failed after repair'
    );
  });

  it('returns LLM_FAILED when skip reason is empty', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent();
    const outcome: DispatchOutcome = {
      kind: 'llm',
      runResult: {
        content: 'Skip with empty.',
        toolCallsMade: 1,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: { skipped: true, skipReason: '' },
      toolCalls: [{ tool: 'skip', args: { reason: '' } }],
      reviewsRequested: [],
    };

    const result = processPRResponse(logger, event, outcome);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_FAILED');
      expect(result.error.message).toContain('Skip reason must not be empty');
    }
  });

  it('deduplicates review types', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent();
    const outcome: DispatchOutcome = {
      kind: 'llm',
      runResult: {
        content: 'Multi.',
        toolCallsMade: 3,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: { skipped: false, skipReason: undefined },
      toolCalls: [],
      reviewsRequested: ['code_quality', 'code_quality', 'security'],
    };

    const result = processPRResponse(logger, event, outcome);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.triage.action === 'request_review') {
      expect(result.value.triage.reviewTypes).toEqual(['code_quality', 'security']);
    }
  });
});

describe('processCommentResponse', () => {
  it('builds success result for dispatch outcome', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'fix lint',
    });
    const outcome: DispatchOutcome = {
      kind: 'comment-llm',
      runResult: {
        content: 'Forwarding.',
        toolCallsMade: 1,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: {
        skipped: false,
        skipReason: undefined,
        reviewTypes: [],
        reviewWorkerType: undefined,
        dispatchTemplate: 'pr_comment',
      },
      toolCalls: [{ tool: 'dispatch_to_task', args: { message_template: 'pr_comment' } }],
    };

    const result = processCommentResponse(logger, event, outcome);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.triage).toEqual({ action: 'dispatch', template: 'pr_comment' });
    }
  });

  it('builds success result for @review outcome with workerType', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '@review architecture with qwen',
    });
    const outcome: DispatchOutcome = {
      kind: 'comment-llm',
      runResult: {
        content: 'Dispatched.',
        toolCallsMade: 2,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: {
        skipped: false,
        skipReason: undefined,
        reviewTypes: ['architecture', 'security'],
        reviewWorkerType: 'qwen',
        dispatchTemplate: undefined,
      },
      toolCalls: [],
    };

    const result = processCommentResponse(logger, event, outcome);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.triage).toEqual({
        action: 'request_review',
        reviewTypes: ['architecture', 'security'],
        workerType: 'qwen',
      });
    }
  });

  it('builds @review outcome without workerType when not set', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '@review architecture',
    });
    const outcome: DispatchOutcome = {
      kind: 'comment-llm',
      runResult: {
        content: 'Dispatched.',
        toolCallsMade: 1,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: {
        skipped: false,
        skipReason: undefined,
        reviewTypes: ['architecture'],
        reviewWorkerType: undefined,
        dispatchTemplate: undefined,
      },
      toolCalls: [],
    };

    const result = processCommentResponse(logger, event, outcome);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.triage).toEqual({ action: 'request_review', reviewTypes: ['architecture'] });
      expect('workerType' in result.value.triage).toBe(false);
    }
  });

  it('builds skip result for comment', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '+1',
    });
    const outcome: DispatchOutcome = {
      kind: 'comment-llm',
      runResult: {
        content: 'Skipped.',
        toolCallsMade: 1,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: {
        skipped: true,
        skipReason: 'Noise',
        reviewTypes: [],
        reviewWorkerType: undefined,
        dispatchTemplate: undefined,
      },
      toolCalls: [{ tool: 'skip', args: { reason: 'Noise' } }],
    };

    const result = processCommentResponse(logger, event, outcome);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.triage).toEqual({ action: 'skip', reason: 'Noise' });
    }
  });

  it('returns LLM_FAILED when no triage tool called for comment', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'noop',
    });
    const outcome: DispatchOutcome = {
      kind: 'comment-llm',
      runResult: {
        content: 'Nothing.',
        toolCallsMade: 0,
        iterationCount: 5,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: {
        skipped: false,
        skipReason: undefined,
        reviewTypes: [],
        reviewWorkerType: undefined,
        dispatchTemplate: undefined,
      },
      toolCalls: [],
    };

    const result = processCommentResponse(logger, event, outcome);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_FAILED');
      expect(result.error.message).toContain('No triage tool was called');
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 42 }),
      'GitHub Agent comment triage validation failed after repair'
    );
  });

  it('returns LLM_FAILED when skip reason is empty for comment', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: 'noop',
    });
    const outcome: DispatchOutcome = {
      kind: 'comment-llm',
      runResult: {
        content: 'Empty reason.',
        toolCallsMade: 1,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: {
        skipped: true,
        skipReason: '',
        reviewTypes: [],
        reviewWorkerType: undefined,
        dispatchTemplate: undefined,
      },
      toolCalls: [],
    };

    const result = processCommentResponse(logger, event, outcome);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_FAILED');
      expect(result.error.message).toContain('Skip reason must not be empty');
    }
  });

  it('deduplicates comment review types', () => {
    const logger = createFakeLogger();
    const event = createFakePREvent({
      eventType: 'issue_comment',
      action: 'created',
      body: '@review architecture',
    });
    const outcome: DispatchOutcome = {
      kind: 'comment-llm',
      runResult: {
        content: 'Multi.',
        toolCallsMade: 3,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      },
      state: {
        skipped: false,
        skipReason: undefined,
        reviewTypes: ['architecture', 'architecture', 'security'],
        reviewWorkerType: undefined,
        dispatchTemplate: undefined,
      },
      toolCalls: [],
    };

    const result = processCommentResponse(logger, event, outcome);

    expect(result.ok).toBe(true);
    if (result.ok && result.value.triage.action === 'request_review') {
      expect(result.value.triage.reviewTypes).toEqual(['architecture', 'security']);
    }
  });
});
