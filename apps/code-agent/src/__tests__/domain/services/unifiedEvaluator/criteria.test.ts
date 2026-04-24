/**
 * Unit tests for unifiedEvaluator/criteria.ts.
 *
 * Covers:
 * - handleCheckSuiteCIFailure: dispatch (task branch), skip (fixTaskId missing),
 *   skipped by service, dispatch without fixTaskId, fall-through for non-matching events
 * - handleHardRules: dispatch / skip / needs_triage outcomes, unauthorized sender callback
 * - shouldSkipReviewForRemediation: no task, running task, recently completed, stale,
 *   repository error, requiresReReview undefined vs false vs true
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { GitHubPREvent } from '../../../../domain/models/gitHubPREvent.js';
import type { WebhookRulesService } from '../../../../domain/services/gitHubWebhookRules.js';
import type {
  WebhookDispatchService,
  CIFailureDispatchService,
} from '../../../../domain/services/gitHubDispatchService.js';
import type { EventDecisionRepository } from '../../../../domain/repositories/eventDecisionRepository.js';
import type { GitHubEventLogEntryRepository } from '../../../../domain/repositories/gitHubEventLogEntryRepository.js';
import type { CodeTaskRepository } from '../../../../domain/repositories/codeTaskRepository.js';
import type { UnifiedEvaluatorDeps } from '../../../../domain/services/unifiedEvaluator/types.js';
import {
  handleCheckSuiteCIFailure,
  handleHardRules,
  shouldSkipReviewForRemediation,
  REMEDIATION_RECENCY_MS,
} from '../../../../domain/services/unifiedEvaluator/criteria.js';

function createFakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createFakeEvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
  return {
    id: 'evt-1',
    auditEventId: 'audit-evt-1',
    githubEventId: 1001,
    deliveryId: null,
    repository: 'intexuraos/intexuraos',
    repositoryId: 100,
    pullRequestNumber: 42,
    pullRequestId: 200,
    eventType: 'issue_comment',
    action: 'created',
    senderLogin: 'dev-user',
    senderId: 1,
    senderType: 'User',
    prAuthorLogin: null,
    title: 't',
    body: 'b',
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

function createDeps(overrides: Partial<UnifiedEvaluatorDeps> = {}): UnifiedEvaluatorDeps {
  return {
    webhookRules: {
      evaluate: vi.fn().mockReturnValue({ action: 'dispatch', reason: 'ALL_RULES_PASSED' }),
    } as unknown as WebhookRulesService,
    dispatchService: {
      dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: true }),
    } as unknown as WebhookDispatchService,
    eventDecisionRepo: {
      save: vi.fn().mockResolvedValue(ok({ id: 'ed_1' })),
    } as unknown as EventDecisionRepository,
    gitHubEventLogEntryRepo: {
      complete: vi.fn().mockResolvedValue(ok({ id: 'audit-evt-1' })),
      createPending: vi.fn(),
      listRecent: vi.fn(),
      findByIds: vi.fn(),
    } as unknown as GitHubEventLogEntryRepository,
    createReviewTask: vi.fn(),
    allowedBots: new Set(['claude[bot]']),
    automationLog: { record: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

function ciFailureService(
  result: {
    success: boolean;
    skipped?: boolean;
    skipReason?: string;
    fixTaskId?: string;
    error?: string;
  } = { success: true, fixTaskId: 'task-fix-1' },
): CIFailureDispatchService {
  return {
    dispatchCIFailure: vi.fn().mockResolvedValue(result),
  } as unknown as CIFailureDispatchService;
}

describe('criteria/handleCheckSuiteCIFailure', () => {
  let logger: Logger;
  beforeEach(() => { logger = createFakeLogger(); });

  it('dispatches CI failure fix for task branch and returns handled=true', async () => {
    const service = ciFailureService({ success: true, fixTaskId: 'task-fix-7' });
    const deps = createDeps({ ciFailureDispatchService: service });
    const event = createFakeEvent({ eventType: 'check_suite', baseBranch: 'task_foo' });
    const handled = await handleCheckSuiteCIFailure(deps, service, event, Date.now(), logger);
    expect(handled).toBe(true);
    expect(service.dispatchCIFailure).toHaveBeenCalled();
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decidedBy: 'hard_rules',
        decision: 'dispatch',
        reason: 'ci_failure_fix_dispatched',
        dispatchAction: 'create_task',
        dispatchParams: { taskId: 'task-fix-7' },
      }),
    );
  });

  it('records skip when CIFailureDispatchService returns skipped', async () => {
    const service = ciFailureService({ success: false, skipped: true, skipReason: 'running_task_exists' });
    const deps = createDeps({ ciFailureDispatchService: service });
    const event = createFakeEvent({ eventType: 'check_suite', baseBranch: 'task_foo' });
    const handled = await handleCheckSuiteCIFailure(deps, service, event, Date.now(), logger);
    expect(handled).toBe(true);
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'skip',
        reason: 'ci_failure_skipped: running_task_exists',
      }),
    );
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'intexuraos/intexuraos', prNumber: 42 },
      expect.objectContaining({ type: 'ci_failure_skip', reason: 'running_task_exists', headBranch: 'task_foo' }),
      undefined,
    );
  });

  it('records skip with unknown reason when skipReason is missing', async () => {
    const service = ciFailureService({ success: false, skipped: true });
    const deps = createDeps({ ciFailureDispatchService: service });
    // CIFailureRule only dispatches when baseBranch starts with "task_"
    const event = createFakeEvent({ eventType: 'check_suite', baseBranch: 'task_foo' });
    await handleCheckSuiteCIFailure(deps, service, event, Date.now(), logger);
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ci_failure_skipped: unknown' }),
    );
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'ci_failure_skip', headBranch: 'task_foo' }),
      undefined,
    );
  });

  it('omits dispatchParams when fixTaskId is undefined and passes dispatchError', async () => {
    const service = ciFailureService({ success: false, error: 'fetch_failed' });
    const deps = createDeps({ ciFailureDispatchService: service });
    const event = createFakeEvent({ eventType: 'check_suite', baseBranch: 'task_foo' });
    await handleCheckSuiteCIFailure(deps, service, event, Date.now(), logger);
    const saveCall = (deps.eventDecisionRepo.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(saveCall?.dispatchParams).toBeUndefined();
    expect(saveCall?.dispatchError).toBe('fetch_failed');
    expect(saveCall?.dispatchSuccess).toBe(false);
  });

  it('returns handled=false for check_suite without task branch', async () => {
    const service = ciFailureService();
    const deps = createDeps({ ciFailureDispatchService: service });
    const event = createFakeEvent({ eventType: 'check_suite', baseBranch: 'main' });
    const handled = await handleCheckSuiteCIFailure(deps, service, event, Date.now(), logger);
    expect(handled).toBe(false);
    expect(service.dispatchCIFailure).not.toHaveBeenCalled();
  });
});

describe('criteria/handleHardRules', () => {
  let logger: Logger;
  beforeEach(() => { logger = createFakeLogger(); });

  it('returns handled for dispatch outcome and invokes dispatchService', async () => {
    const deps = createDeps();
    const result = await handleHardRules(deps, createFakeEvent(), Date.now(), logger);
    expect(result).toBe('handled');
    expect(deps.dispatchService.dispatch).toHaveBeenCalled();
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decidedBy: 'hard_rules', decision: 'dispatch' }),
    );
  });

  it('returns handled for skip outcome and records hard_rules skip', async () => {
    const deps = createDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'skip', reason: 'BOT_NOISE' }),
      } as unknown as WebhookRulesService,
    });
    const result = await handleHardRules(deps, createFakeEvent(), Date.now(), logger);
    expect(result).toBe('handled');
    expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'skipped', decidedBy: 'hard_rules', reason: 'BOT_NOISE' }),
      undefined,
    );
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'skip', reason: 'BOT_NOISE' }),
    );
  });

  it('invokes onUnauthorizedSender for SENDER_NOT_WHITELISTED skip', async () => {
    const onUnauthorizedSender = vi.fn().mockResolvedValue(undefined);
    const deps = createDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'skip', reason: 'SENDER_NOT_WHITELISTED' }),
      } as unknown as WebhookRulesService,
      onUnauthorizedSender,
    });
    await handleHardRules(deps, createFakeEvent(), Date.now(), logger);
    // the callback is fired-and-forgotten; flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(onUnauthorizedSender).toHaveBeenCalled();
  });

  it('swallows onUnauthorizedSender rejection', async () => {
    const onUnauthorizedSender = vi.fn().mockRejectedValue(new Error('gh-fail'));
    const deps = createDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'skip', reason: 'SENDER_NOT_WHITELISTED' }),
      } as unknown as WebhookRulesService,
      onUnauthorizedSender,
    });
    await handleHardRules(deps, createFakeEvent(), Date.now(), logger);
    // flush async error logging
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns needs_triage for needs_triage outcome', async () => {
    const deps = createDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'SOFT_LOGIC' }),
      } as unknown as WebhookRulesService,
    });
    const result = await handleHardRules(deps, createFakeEvent(), Date.now(), logger);
    expect(result).toBe('needs_triage');
    expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
    expect(deps.eventDecisionRepo.save).not.toHaveBeenCalled();
  });
});

describe('criteria/shouldSkipReviewForRemediation', () => {
  let logger: Logger;
  beforeEach(() => { logger = createFakeLogger(); });

  function createCodeTaskRepo(result: unknown): CodeTaskRepository {
    return {
      findRecentRemediationForPR: vi.fn().mockResolvedValue(result),
    } as unknown as CodeTaskRepository;
  }

  it('returns false when repository call fails (fails open)', async () => {
    const repo = createCodeTaskRepo(err({ code: 'X', message: 'boom' }));
    expect(await shouldSkipReviewForRemediation(repo, 'o/r', 1, 'evt-1', logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns false when no remediation task found', async () => {
    const repo = createCodeTaskRepo(ok(null));
    expect(await shouldSkipReviewForRemediation(repo, 'o/r', 1, 'evt-1', logger)).toBe(false);
  });

  it('returns false when task is neither running nor recently completed', async () => {
    const ancient = Timestamp.fromMillis(Date.now() - (REMEDIATION_RECENCY_MS + 5000));
    const repo = createCodeTaskRepo(ok({ status: 'completed', completedAt: ancient, requiresReReview: false }));
    expect(await shouldSkipReviewForRemediation(repo, 'o/r', 1, 'evt-1', logger)).toBe(false);
  });

  it('returns true when running task has requiresReReview=false', async () => {
    const repo = createCodeTaskRepo(ok({ status: 'running', requiresReReview: false }));
    expect(await shouldSkipReviewForRemediation(repo, 'o/r', 1, 'evt-1', logger)).toBe(true);
  });

  it('returns false when running task has requiresReReview=undefined (fails open)', async () => {
    const repo = createCodeTaskRepo(ok({ status: 'running' }));
    expect(await shouldSkipReviewForRemediation(repo, 'o/r', 1, 'evt-1', logger)).toBe(false);
  });

  it('returns false when running task explicitly requires re-review', async () => {
    const repo = createCodeTaskRepo(ok({ status: 'running', requiresReReview: true }));
    expect(await shouldSkipReviewForRemediation(repo, 'o/r', 1, 'evt-1', logger)).toBe(false);
  });

  it('returns true for recently completed task with requiresReReview=false', async () => {
    const recent = Timestamp.fromMillis(Date.now() - 1000);
    const repo = createCodeTaskRepo(ok({ status: 'completed', completedAt: recent, requiresReReview: false }));
    expect(await shouldSkipReviewForRemediation(repo, 'o/r', 1, 'evt-1', logger)).toBe(true);
  });
});
