/**
 * Unit tests for unifiedEvaluator/scoring.ts.
 *
 * Covers:
 * - handleFallback: dispatch path for comment-shaped events, skip path for others,
 *   dispatch failure logging
 * - handleLlmTriage: no-llm fallback, LLM dispatch, LLM skip, LLM request_review,
 *   review task creation failure, retry-with-correction on pull_request failure,
 *   @review fail-closed branch, remediation interception on synchronize,
 *   onReviewSkipped callback invocation and rejection swallowing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { WebhookDispatchService } from '../../../../domain/services/gitHubDispatchService.js';
import type { CodeTaskRepository } from '../../../../domain/repositories/codeTaskRepository.js';
import type { UnifiedEvaluatorDeps } from '../../../../domain/services/unifiedEvaluator/types.js';
import { handleFallback, handleLlmTriage } from '../../../../domain/services/unifiedEvaluator/scoring.js';
import { createDeps as createBaseDeps, createFakeEvent, createFakeLogger } from './_fixtures.js';

/** Scoring tests default to a successful review-task creation. */
function createDeps(overrides: Partial<UnifiedEvaluatorDeps> = {}): UnifiedEvaluatorDeps {
  return createBaseDeps({
    createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-1', workerType: 'opus' })),
    ...overrides,
  });
}

describe('scoring/handleFallback', () => {
  let logger: Logger;
  beforeEach(() => { logger = createFakeLogger(); });

  it('dispatches for issue_comment event and records automation log', async () => {
    const deps = createDeps();
    await handleFallback(deps, createFakeEvent({ eventType: 'issue_comment' }), 'llm_down', Date.now(), logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1', _skipSentry: true }),
      'Fallback: dispatching comment event',
    );
    expect(deps.dispatchService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ reason: 'FALLBACK_DISPATCH: llm_down' }),
      }),
    );
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'triage_failed', fallbackAction: 'dispatch' }),
      undefined,
    );
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'dispatch', reason: 'fallback_dispatch: llm_down' }),
    );
  });

  it('dispatches for pull_request_review event', async () => {
    const deps = createDeps();
    await handleFallback(deps, createFakeEvent({ eventType: 'pull_request_review' }), 'x', Date.now(), logger);
    expect(deps.dispatchService.dispatch).toHaveBeenCalled();
  });

  it('dispatches for pull_request_review_comment event', async () => {
    const deps = createDeps();
    await handleFallback(deps, createFakeEvent({ eventType: 'pull_request_review_comment' }), 'x', Date.now(), logger);
    expect(deps.dispatchService.dispatch).toHaveBeenCalled();
  });

  it('logs Sentry-suppressed warning when dispatch fails', async () => {
    const deps = createDeps({
      dispatchService: {
        dispatch: vi.fn().mockResolvedValue({ success: false, error: 'boom' }),
      } as unknown as WebhookDispatchService,
    });
    await handleFallback(deps, createFakeEvent({ eventType: 'issue_comment' }), 'x', Date.now(), logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'boom', _skipSentry: true }),
      'Dispatch failed for fallback decision',
    );
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchSuccess: false, dispatchError: 'boom' }),
    );
  });

  it('skips for pull_request event', async () => {
    const deps = createDeps();
    await handleFallback(deps, createFakeEvent({ eventType: 'pull_request' }), 'llm_down', Date.now(), logger);
    expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'triage_failed', fallbackAction: 'skip' }),
      undefined,
    );
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'skip', reason: 'fallback_skip: llm_down' }),
    );
  });
});

describe('scoring/handleLlmTriage', () => {
  let logger: Logger;
  beforeEach(() => { logger = createFakeLogger(); });

  it('falls back to handleFallback when evaluateEvent is undefined', async () => {
    const deps = createDeps();
    delete (deps as { evaluateEvent?: unknown }).evaluateEvent;
    await handleLlmTriage(deps, createFakeEvent({ eventType: 'issue_comment' }), Date.now(), logger);
    expect(deps.dispatchService.dispatch).toHaveBeenCalled();
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'fallback_dispatch: no_llm_configured' }),
    );
  });

  it('dispatches on LLM triage.action === "dispatch"', async () => {
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'dispatch', template: 'pr_comment' },
      usage: { costUsd: 0.02, model: 'claude-opus', toolCalls: [{ tool: 'read_file', args: { path: 'a' } }] },
      reasoning: 'looks like a dispatch',
    }));
    const deps = createDeps({ evaluateEvent });
    await handleLlmTriage(deps, createFakeEvent(), Date.now(), logger);
    expect(deps.dispatchService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ decision: { action: 'dispatch', reason: 'LLM_DISPATCH' } }),
    );
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decidedBy: 'github_agent',
        decision: 'dispatch',
        reason: 'LLM dispatch: pr_comment',
        llmCostUsd: 0.02,
        llmModel: 'claude-opus',
      }),
    );
  });

  it('logs warning when LLM dispatch fails', async () => {
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'dispatch', template: 'pr_comment' },
      usage: { costUsd: 0.02, toolCalls: [] },
      reasoning: '',
    }));
    const deps = createDeps({
      evaluateEvent,
      dispatchService: {
        dispatch: vi.fn().mockResolvedValue({ success: false, error: 'boom' }),
      } as unknown as WebhookDispatchService,
    });
    await handleLlmTriage(deps, createFakeEvent(), Date.now(), logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'boom' }),
      'Dispatch failed for LLM decision',
    );
  });

  it('creates review task for triage.action === "request_review"', async () => {
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'request_review', reviewTypes: ['code_review'], workerType: 'opus' },
      usage: { costUsd: 0.01, toolCalls: [] },
      reasoning: 'needs review',
    }));
    const deps = createDeps({ evaluateEvent });
    await handleLlmTriage(deps, createFakeEvent(), Date.now(), logger);
    expect(deps.createReviewTask).toHaveBeenCalled();
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decidedBy: 'github_agent',
        decision: 'request_review',
        dispatchAction: 'create_review_task',
      }),
    );
  });

  it('records skip when createReviewTask fails', async () => {
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'request_review', reviewTypes: ['code_review'] },
      usage: { costUsd: 0.01, toolCalls: [] },
      reasoning: '',
    }));
    const deps = createDeps({
      evaluateEvent,
      createReviewTask: vi.fn().mockResolvedValue(err({ code: 'X', message: 'no_user' })),
    });
    await handleLlmTriage(deps, createFakeEvent(), Date.now(), logger);
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'skip', reason: 'review_task_failed: no_user' }),
    );
  });

  it('skips review when recent remediation indicates no re-review needed on synchronize', async () => {
    const codeTaskRepo = {
      findOriginTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findRecentRemediationForPR: vi.fn().mockResolvedValue(ok({
        status: 'running',
        requiresReReview: false,
      })),
    } as unknown as CodeTaskRepository;
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'request_review', reviewTypes: ['code_review'] },
      usage: { costUsd: 0.01, toolCalls: [] },
      reasoning: 'would-be review',
    }));
    const deps = createDeps({ evaluateEvent, codeTaskRepo });
    await handleLlmTriage(
      deps,
      createFakeEvent({ eventType: 'pull_request', action: 'synchronize' }),
      Date.now(),
      logger,
    );
    expect(deps.createReviewTask).not.toHaveBeenCalled();
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'skip',
        reason: expect.stringContaining('remediation_no_rereview'),
      }),
    );
  });

  it('proceeds with review when remediation check fails open (no task found)', async () => {
    const codeTaskRepo = {
      findOriginTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findRecentRemediationForPR: vi.fn().mockResolvedValue(ok(null)),
    } as unknown as CodeTaskRepository;
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'request_review', reviewTypes: ['code_review'] },
      usage: { costUsd: 0.01, toolCalls: [] },
      reasoning: 'review time',
    }));
    const deps = createDeps({ evaluateEvent, codeTaskRepo });
    await handleLlmTriage(
      deps,
      createFakeEvent({ eventType: 'pull_request', action: 'synchronize' }),
      Date.now(),
      logger,
    );
    expect(deps.createReviewTask).toHaveBeenCalled();
  });

  it('skips review when latest origin task ended in terminal failure', async () => {
    const findOriginTaskByPR = vi.fn().mockResolvedValue(ok({
      id: 'task-failed-1', status: 'failed', agentType: 'execution',
    }));
    const findRecentRemediationForPR = vi.fn().mockResolvedValue(ok(null));
    const codeTaskRepo = { findOriginTaskByPR, findRecentRemediationForPR } as unknown as CodeTaskRepository;
    const onReviewSkipped = vi.fn().mockResolvedValue(undefined);
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'request_review', reviewTypes: ['code_review'] },
      usage: { costUsd: 0.01, model: 'claude-opus', toolCalls: [] },
      reasoning: 'would-be review',
    }));
    const deps = createDeps({ evaluateEvent, codeTaskRepo, onReviewSkipped });
    await handleLlmTriage(
      deps,
      createFakeEvent({ eventType: 'pull_request', action: 'synchronize' }),
      Date.now(),
      logger,
    );
    expect(deps.createReviewTask).not.toHaveBeenCalled();
    expect(findRecentRemediationForPR).not.toHaveBeenCalled();
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decidedBy: 'github_agent',
        decision: 'skip',
        reason: expect.stringContaining('failed_origin_no_review'),
        llmModel: 'claude-opus',
        llmCostUsd: 0.01,
      }),
    );
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'skipped',
        decidedBy: 'llm_triage',
        reason: 'failed_origin_no_review',
      }),
      undefined,
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        originTaskId: 'task-failed-1',
        originAgentType: 'execution',
        originStatus: 'failed',
      }),
      'Skipping review: latest origin task ended in terminal failure',
    );
    // onReviewSkipped (which sets ready-to-merge) MUST NOT be invoked for failed origins
    await Promise.resolve();
    await Promise.resolve();
    expect(onReviewSkipped).not.toHaveBeenCalled();
  });

  it('failed-origin gate fires for non-synchronize events too (issue_comment)', async () => {
    const codeTaskRepo = {
      findOriginTaskByPR: vi.fn().mockResolvedValue(ok({
        id: 'task-int-1', status: 'interrupted', agentType: 'planning',
      })),
      findRecentRemediationForPR: vi.fn().mockResolvedValue(ok(null)),
    } as unknown as CodeTaskRepository;
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'request_review', reviewTypes: ['code_review'] },
      usage: { costUsd: 0.01, toolCalls: [] },
      reasoning: '',
    }));
    const deps = createDeps({ evaluateEvent, codeTaskRepo });
    await handleLlmTriage(
      deps,
      createFakeEvent({ eventType: 'issue_comment', body: 'looks good' }),
      Date.now(),
      logger,
    );
    expect(deps.createReviewTask).not.toHaveBeenCalled();
  });

  it('proceeds with review when origin task is implemented', async () => {
    const codeTaskRepo = {
      findOriginTaskByPR: vi.fn().mockResolvedValue(ok({
        id: 'task-ok', status: 'implemented', agentType: 'execution',
      })),
      findRecentRemediationForPR: vi.fn().mockResolvedValue(ok(null)),
    } as unknown as CodeTaskRepository;
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'request_review', reviewTypes: ['code_review'] },
      usage: { costUsd: 0.01, toolCalls: [] },
      reasoning: '',
    }));
    const deps = createDeps({ evaluateEvent, codeTaskRepo });
    await handleLlmTriage(deps, createFakeEvent(), Date.now(), logger);
    expect(deps.createReviewTask).toHaveBeenCalled();
  });

  it('proceeds (fail-open) when findOriginTaskByPR errors', async () => {
    const codeTaskRepo = {
      findOriginTaskByPR: vi.fn().mockResolvedValue(err({ code: 'X', message: 'firestore down' })),
      findRecentRemediationForPR: vi.fn().mockResolvedValue(ok(null)),
    } as unknown as CodeTaskRepository;
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'request_review', reviewTypes: ['code_review'] },
      usage: { costUsd: 0.01, toolCalls: [] },
      reasoning: '',
    }));
    const deps = createDeps({ evaluateEvent, codeTaskRepo });
    await handleLlmTriage(deps, createFakeEvent(), Date.now(), logger);
    expect(deps.createReviewTask).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('records skip for triage.action === "skip"', async () => {
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'skip', reason: 'no_changes' },
      usage: { costUsd: 0.0, toolCalls: [] },
      reasoning: '',
    }));
    const deps = createDeps({ evaluateEvent });
    await handleLlmTriage(deps, createFakeEvent(), Date.now(), logger);
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'skip',
        reason: 'LLM skip: no_changes',
      }),
    );
  });

  it('invokes onReviewSkipped callback for LLM skip', async () => {
    const onReviewSkipped = vi.fn().mockResolvedValue(undefined);
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'skip', reason: 'no_changes' },
      usage: { costUsd: 0.0, toolCalls: [] },
      reasoning: '',
    }));
    const deps = createDeps({ evaluateEvent, onReviewSkipped });
    await handleLlmTriage(deps, createFakeEvent(), Date.now(), logger);
    await Promise.resolve();
    await Promise.resolve();
    expect(onReviewSkipped).toHaveBeenCalledWith({ repository: 'intexuraos/intexuraos', prNumber: 42 });
  });

  it('swallows onReviewSkipped rejection', async () => {
    const onReviewSkipped = vi.fn().mockRejectedValue(new Error('cb_fail'));
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'skip', reason: 'no_changes' },
      usage: { costUsd: 0, toolCalls: [] },
      reasoning: '',
    }));
    const deps = createDeps({ evaluateEvent, onReviewSkipped });
    await handleLlmTriage(deps, createFakeEvent(), Date.now(), logger);
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'onReviewSkipped callback failed (best-effort)',
    );
  });

  it('retries with correction for pull_request LLM failure', async () => {
    const evaluateEvent = vi.fn()
      .mockResolvedValueOnce(err({ code: 'LLM_FAILED', message: 'no tool call' }))
      .mockResolvedValueOnce(ok({
        triage: { action: 'skip', reason: 'after_retry' },
        usage: { costUsd: 0.0, toolCalls: [] },
        reasoning: '',
      }));
    const deps = createDeps({ evaluateEvent });
    await handleLlmTriage(deps, createFakeEvent({ eventType: 'pull_request' }), Date.now(), logger);
    expect(evaluateEvent).toHaveBeenCalledTimes(2);
    const secondCall = evaluateEvent.mock.calls[1];
    expect(secondCall?.[1]).toContain('previous attempt produced the following error');
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'skip', reason: 'LLM skip: after_retry' }),
    );
  });

  it('falls back when both LLM attempts fail on pull_request', async () => {
    const evaluateEvent = vi.fn().mockResolvedValue(err({ code: 'LLM_FAILED', message: 'down' }));
    const deps = createDeps({ evaluateEvent });
    await handleLlmTriage(deps, createFakeEvent({ eventType: 'pull_request' }), Date.now(), logger);
    // pull_request fallback is skip
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'fallback_skip: down' }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1', _skipSentry: true }),
      'LLM triage failed',
    );
  });

  it('does not retry for non pull_request LLM failure; falls back to dispatch for issue_comment', async () => {
    const evaluateEvent = vi.fn().mockResolvedValue(err({ code: 'LLM_FAILED', message: 'down' }));
    const deps = createDeps({ evaluateEvent });
    await handleLlmTriage(deps, createFakeEvent({ eventType: 'issue_comment', body: 'hello world' }), Date.now(), logger);
    expect(evaluateEvent).toHaveBeenCalledTimes(1);
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'fallback_dispatch: down' }),
    );
  });

  it('fails closed for @review comment when LLM triage fails', async () => {
    const evaluateEvent = vi.fn().mockResolvedValue(err({ code: 'LLM_FAILED', message: 'down' }));
    const deps = createDeps({ evaluateEvent });
    await handleLlmTriage(
      deps,
      createFakeEvent({ eventType: 'issue_comment', body: '@review' }),
      Date.now(),
      logger,
    );
    expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decidedBy: 'github_agent',
        decision: 'skip',
        reason: expect.stringContaining('review_triage_failed'),
      }),
    );
  });

  it('includes llmModel when usage.model is present on remediation skip', async () => {
    const codeTaskRepo = {
      findOriginTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findRecentRemediationForPR: vi.fn().mockResolvedValue(ok({
        status: 'completed',
        completedAt: Timestamp.fromMillis(Date.now()),
        requiresReReview: false,
      })),
    } as unknown as CodeTaskRepository;
    const evaluateEvent = vi.fn().mockResolvedValue(ok({
      triage: { action: 'request_review', reviewTypes: ['code_review'] },
      usage: { costUsd: 0.01, model: 'claude-opus', toolCalls: [] },
      reasoning: '',
    }));
    const deps = createDeps({ evaluateEvent, codeTaskRepo });
    await handleLlmTriage(
      deps,
      createFakeEvent({ eventType: 'pull_request', action: 'synchronize' }),
      Date.now(),
      logger,
    );
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ llmModel: 'claude-opus' }),
    );
  });
});
