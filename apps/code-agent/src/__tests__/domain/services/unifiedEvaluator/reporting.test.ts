/**
 * Unit tests for unifiedEvaluator/reporting.ts.
 *
 * Covers:
 * - deduplicateToolCalls behavior
 * - resolveUserId fallback paths (undefined deps, throwing resolver, success)
 * - recordLog swallows automationLog rejections
 * - recordDecision persistence (success, save-fail, complete-fail, thrown save, no auditEventId)
 * - dispatchAndRecord success + failure paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { err, type Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../../../domain/models/gitHubPREvent.js';
import type { EventDecisionRepository } from '../../../../domain/repositories/eventDecisionRepository.js';
import type { GitHubEventLogEntryRepository } from '../../../../domain/repositories/gitHubEventLogEntryRepository.js';
import type { WebhookDispatchService } from '../../../../domain/services/gitHubDispatchService.js';
import type { UnifiedEvaluatorDeps } from '../../../../domain/services/unifiedEvaluator/types.js';
import {
  deduplicateToolCalls,
  dispatchAndRecord,
  recordDecision,
  recordLog,
  resolveUserId,
} from '../../../../domain/services/unifiedEvaluator/reporting.js';
import { createDeps, createFakeEvent, createFakeLogger } from './_fixtures.js';

describe('reporting/deduplicateToolCalls', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateToolCalls([])).toEqual([]);
  });

  it('collapses identical tool calls into one summary', () => {
    const result = deduplicateToolCalls([
      { tool: 'read_file', args: { path: 'a.ts' } },
      { tool: 'read_file', args: { path: 'a.ts' } },
    ]);
    expect(result).toEqual(['read_file({"path":"a.ts"})']);
  });

  it('keeps distinct tool/args pairs', () => {
    const result = deduplicateToolCalls([
      { tool: 'read_file', args: { path: 'a.ts' } },
      { tool: 'read_file', args: { path: 'b.ts' } },
      { tool: 'grep', args: { q: 'foo' } },
    ]);
    expect(result).toHaveLength(3);
    expect(result).toContain('read_file({"path":"a.ts"})');
    expect(result).toContain('read_file({"path":"b.ts"})');
    expect(result).toContain('grep({"q":"foo"})');
  });
});

describe('reporting/resolveUserId', () => {
  it('returns undefined when resolveTokenUserId is not configured', async () => {
    const deps = createDeps();
    expect(await resolveUserId(deps, createFakeEvent())).toBeUndefined();
  });

  it('calls resolveTokenUserId with login and returns its value', async () => {
    const resolveTokenUserId = vi.fn().mockResolvedValue('user-42');
    const deps = createDeps({ resolveTokenUserId });
    expect(await resolveUserId(deps, createFakeEvent())).toBe('user-42');
    expect(resolveTokenUserId).toHaveBeenCalled();
  });

  it('returns undefined when resolveTokenUserId throws', async () => {
    const resolveTokenUserId = vi.fn().mockRejectedValue(new Error('boom'));
    const deps = createDeps({ resolveTokenUserId });
    expect(await resolveUserId(deps, createFakeEvent())).toBeUndefined();
  });
});

describe('reporting/recordLog', () => {
  it('invokes automationLog.record with prRef and userId', () => {
    const deps = createDeps();
    recordLog(deps, createFakeEvent(), { type: 'skipped', decidedBy: 'hard_rules', reason: 'X', ruleName: 'X' }, 'user-1');
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'intexuraos/intexuraos', prNumber: 42 },
      expect.objectContaining({ type: 'skipped' }),
      'user-1',
    );
  });

  it('swallows automationLog rejections without throwing', async () => {
    const deps = createDeps({
      automationLog: { record: vi.fn().mockRejectedValue(new Error('logfail')) },
    });
    expect(() => recordLog(deps, createFakeEvent(), { type: 'skipped', decidedBy: 'hard_rules', reason: 'X', ruleName: 'X' })).not.toThrow();
    // flush microtasks to allow rejection handler to run
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('reporting/recordDecision', () => {
  let logger: Logger;
  beforeEach(() => { logger = createFakeLogger(); });

  it('persists all fields and completes gitHubEventLogEntry on happy path', async () => {
    const deps = createDeps();
    await recordDecision(deps, createFakeEvent(), {
      decidedBy: 'hard_rules',
      decision: 'dispatch',
      reason: 'ALL_RULES_PASSED',
      dispatchAction: 'create_task',
      dispatchParams: { taskId: 't-1' },
      dispatchSuccess: true,
      llmCostUsd: 0.01,
      llmModel: 'model-x',
      llmToolCalls: [{ tool: 't', args: {} }],
      llmReasoning: 'because',
    }, Date.now() - 5, logger);
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'audit-evt-1',
        normalizedEventId: 'evt-1',
        decidedBy: 'hard_rules',
        decision: 'dispatch',
        reason: 'ALL_RULES_PASSED',
        dispatchAction: 'create_task',
        dispatchParams: { taskId: 't-1' },
        dispatchSuccess: true,
        llmCostUsd: 0.01,
        llmModel: 'model-x',
        llmReasoning: 'because',
      }),
    );
    expect(deps.gitHubEventLogEntryRepo?.complete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'audit-evt-1', decisionState: 'completed', decisionOutcome: 'dispatch' }),
    );
  });

  it('logs error and skips complete() when save fails', async () => {
    const deps = createDeps({
      eventDecisionRepo: {
        save: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE', message: 'fail' })),
      } as unknown as EventDecisionRepository,
    });
    await recordDecision(deps, createFakeEvent(), { decidedBy: 'hard_rules', decision: 'skip', reason: 'X' }, 0, logger);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-1',
        auditEventId: 'audit-evt-1',
        error: { code: 'FIRESTORE', message: 'fail' },
        _skipSentry: true,
      }),
      'Failed to save event decision audit record',
    );
    expect(deps.gitHubEventLogEntryRepo?.complete).not.toHaveBeenCalled();
  });

  it('logs error when complete() fails but does not throw', async () => {
    const deps = createDeps({
      gitHubEventLogEntryRepo: {
        complete: vi.fn().mockResolvedValue(err({ code: 'X', message: 'nope' })),
        createPending: vi.fn(),
        listRecent: vi.fn(),
        findByIds: vi.fn(),
      } as unknown as GitHubEventLogEntryRepository,
    });
    await recordDecision(deps, createFakeEvent(), { decidedBy: 'hard_rules', decision: 'skip', reason: 'X' }, 0, logger);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ auditEventId: 'audit-evt-1' }),
      'Failed to complete GitHub event log entry',
    );
  });

  it('handles thrown save errors by logging them', async () => {
    const deps = createDeps({
      eventDecisionRepo: {
        save: vi.fn().mockRejectedValue(new Error('boom')),
      } as unknown as EventDecisionRepository,
    });
    await recordDecision(deps, createFakeEvent(), { decidedBy: 'hard_rules', decision: 'skip', reason: 'X' }, 0, logger);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Failed to save event decision audit record',
    );
  });

  it('omits normalizedEventId and skips complete() when auditEventId is undefined', async () => {
    const deps = createDeps();
    const base = createFakeEvent();
    const event: GitHubPREvent = { ...base };
    delete event.auditEventId;
    await recordDecision(deps, event, { decidedBy: 'hard_rules', decision: 'skip', reason: 'X' }, 0, logger);
    const saveCall = (deps.eventDecisionRepo.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(saveCall).toEqual(expect.objectContaining({ eventId: 'evt-1' }));
    expect(saveCall).not.toHaveProperty('normalizedEventId');
    expect(deps.gitHubEventLogEntryRepo?.complete).not.toHaveBeenCalled();
  });

  it('skips complete() when gitHubEventLogEntryRepo is undefined', async () => {
    const deps = createDeps();
    const depsNoRepo: UnifiedEvaluatorDeps = { ...deps };
    delete depsNoRepo.gitHubEventLogEntryRepo;
    await recordDecision(depsNoRepo, createFakeEvent(), { decidedBy: 'hard_rules', decision: 'skip', reason: 'X' }, 0, logger);
    expect(deps.eventDecisionRepo.save).toHaveBeenCalled();
  });

  it('uses action="unknown" when event.action is null', async () => {
    const deps = createDeps();
    const event = createFakeEvent({ action: null });
    await recordDecision(deps, event, { decidedBy: 'hard_rules', decision: 'skip', reason: 'X' }, 0, logger);
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventAction: 'unknown' }),
    );
  });
});

describe('reporting/dispatchAndRecord', () => {
  let logger: Logger;
  beforeEach(() => { logger = createFakeLogger(); });

  it('dispatches and records success with decision.reason', async () => {
    const deps = createDeps();
    await dispatchAndRecord(deps, createFakeEvent(), { action: 'dispatch', reason: 'ALL_RULES_PASSED' }, 0, logger);
    expect(deps.dispatchService.dispatch).toHaveBeenCalled();
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'dispatch', reason: 'ALL_RULES_PASSED', dispatchSuccess: true }),
    );
  });

  it('logs warning and records dispatchError on failure', async () => {
    const deps = createDeps({
      dispatchService: {
        dispatch: vi.fn().mockResolvedValue({ success: false, error: 'fetch_failed' }),
      } as unknown as WebhookDispatchService,
    });
    await dispatchAndRecord(deps, createFakeEvent(), { action: 'dispatch', reason: 'ALL_RULES_PASSED' }, 0, logger);
    const warnContext = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(warnContext).not.toHaveProperty('_skipSentry');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'fetch_failed' }),
      'Dispatch failed for hard-rule decision',
    );
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchSuccess: false, dispatchError: 'fetch_failed' }),
    );
  });

  it('suppresses expected active-task dedup dispatch failures from Sentry', async () => {
    const deps = createDeps({
      dispatchService: {
        dispatch: vi.fn().mockResolvedValue({ success: false, error: 'Active task exists for Linear issue' }),
      } as unknown as WebhookDispatchService,
    });
    await dispatchAndRecord(deps, createFakeEvent(), { action: 'dispatch', reason: 'ALL_RULES_PASSED' }, 0, logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Active task exists for Linear issue',
        _skipSentry: true,
      }),
      'Dispatch failed for hard-rule decision',
    );
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchSuccess: false,
        dispatchError: 'Active task exists for Linear issue',
      }),
    );
  });
});
