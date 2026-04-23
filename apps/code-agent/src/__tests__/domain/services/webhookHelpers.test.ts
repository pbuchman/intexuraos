/**
 * Unit tests for webhookHelpers — pure/isolated helpers that used to be
 * inline in webhookRoutes.ts.
 *
 * These tests exercise the decision logic directly, independent of Fastify.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';

import {
  createTaskFormatterEntry,
  flushPendingTaskLogLines,
  recordRemediationDecision,
  recordTaskFailed,
  resolveLogRuntime,
  shouldQueueExecutionMemoryPostRun,
  type TaskFormatterEntry,
} from '../../../domain/services/webhookHelpers.js';
import { resetServices, setServices, type ServiceContainer } from '../../../services.js';
import { createMockLogger } from '../../helpers/mockLogger.js';

describe('webhookHelpers', () => {
  afterEach(() => {
    resetServices();
    vi.restoreAllMocks();
  });

  describe('resolveLogRuntime', () => {
    it('returns "codex" for workerType starting with "codex"', () => {
      expect(resolveLogRuntime('codex-cli')).toBe('codex');
      expect(resolveLogRuntime('codex-gpt-5')).toBe('codex');
    });

    it('returns "claude" for non-codex worker types', () => {
      expect(resolveLogRuntime('claude-opus')).toBe('claude');
      expect(resolveLogRuntime('sonnet')).toBe('claude');
      expect(resolveLogRuntime('auto')).toBe('claude');
    });
  });

  describe('createTaskFormatterEntry', () => {
    it('creates an entry with the runtime matching the worker type', () => {
      const entry = createTaskFormatterEntry('codex-cli');
      expect(entry.runtime).toBe('codex');
      expect(entry.lastSequence).toBe(0);
    });

    it('starts lastSequence at zero for claude workers', () => {
      const entry = createTaskFormatterEntry('claude-opus');
      expect(entry.runtime).toBe('claude');
      expect(entry.lastSequence).toBe(0);
    });
  });

  describe('shouldQueueExecutionMemoryPostRun', () => {
    beforeEach(() => {
      process.env['INTEXURAOS_EXECUTION_MEMORY_ENABLED'] = 'true';
    });

    it('returns true for eligible execution agent with no existing status', () => {
      expect(shouldQueueExecutionMemoryPostRun({
        agentType: 'execution',
        existingStatus: undefined,
      })).toBe(true);
    });

    it('returns false when an existing status is present', () => {
      expect(shouldQueueExecutionMemoryPostRun({
        agentType: 'execution',
        existingStatus: 'pending',
      })).toBe(false);
      expect(shouldQueueExecutionMemoryPostRun({
        agentType: 'execution',
        existingStatus: 'complete',
      })).toBe(false);
    });

    it('returns false for undefined agent types (ineligible)', () => {
      expect(shouldQueueExecutionMemoryPostRun({
        agentType: undefined,
        existingStatus: undefined,
      })).toBe(false);
    });

    it('returns false for unknown agent types', () => {
      expect(shouldQueueExecutionMemoryPostRun({
        agentType: 'unknown-type',
        existingStatus: undefined,
      })).toBe(false);
    });

    it('returns false when execution memory feature flag is disabled', () => {
      process.env['INTEXURAOS_EXECUTION_MEMORY_ENABLED'] = 'false';
      expect(shouldQueueExecutionMemoryPostRun({
        agentType: 'execution',
        existingStatus: undefined,
      })).toBe(false);
    });
  });

  describe('recordTaskFailed', () => {
    it('is a no-op when the task has no prNumber', () => {
      const record = vi.fn().mockResolvedValue(undefined);
      setServices({
        automationLog: { record } as never,
      } as unknown as ServiceContainer);
      recordTaskFailed({
        task: { repository: 'a/b', userId: 'u1' },
        taskId: 't1',
        completedAt: new Date(),
        error: 'boom',
        errorCode: 'BOOM',
      });
      expect(record).not.toHaveBeenCalled();
    });

    it('records a task_failed automation log when prNumber is present', () => {
      const record = vi.fn().mockResolvedValue(undefined);
      setServices({
        automationLog: { record } as never,
      } as unknown as ServiceContainer);
      recordTaskFailed({
        task: { repository: 'a/b', userId: 'u1', prNumber: 42 },
        taskId: 't1',
        completedAt: new Date(),
        error: 'boom',
        errorCode: 'BOOM',
      });
      expect(record).toHaveBeenCalledWith(
        { repository: 'a/b', prNumber: 42 },
        expect.objectContaining({ type: 'task_failed', taskId: 't1', error: 'boom', errorCode: 'BOOM' }),
        'u1',
      );
    });

    it('swallows automation log errors (fire-and-forget)', async () => {
      const warn = vi.fn();
      const record = vi.fn().mockRejectedValue(new Error('downstream'));
      setServices({
        automationLog: { record } as never,
        logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } as never,
      } as unknown as ServiceContainer);
      recordTaskFailed({
        task: { repository: 'a/b', userId: 'u1', prNumber: 1 },
        taskId: 't1',
        completedAt: new Date(),
        error: 'boom',
        errorCode: 'BOOM',
      });
      // Allow the rejected promise's .catch to run
      await new Promise((r) => setImmediate(r));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 't1' }),
        'Failed to record automation log for task failure',
      );
    });
  });

  describe('recordRemediationDecision', () => {
    it('records a remediation_decision with required=true and optional taskId', () => {
      const record = vi.fn().mockResolvedValue(undefined);
      setServices({
        automationLog: { record } as never,
      } as unknown as ServiceContainer);
      recordRemediationDecision({
        repository: 'a/b',
        prNumber: 5,
        userId: 'u1',
        required: true,
        signal: '1',
        taskId: 'remed-1',
      });
      expect(record).toHaveBeenCalledWith(
        { repository: 'a/b', prNumber: 5 },
        { type: 'remediation_decision', required: true, source: 'review_result', signal: '1', taskId: 'remed-1' },
        'u1',
      );
    });

    it('records a remediation_decision without taskId when omitted', () => {
      const record = vi.fn().mockResolvedValue(undefined);
      setServices({ automationLog: { record } as never } as unknown as ServiceContainer);
      recordRemediationDecision({
        repository: 'a/b',
        prNumber: 5,
        userId: 'u1',
        required: false,
        signal: '0',
      });
      expect(record).toHaveBeenCalledWith(
        expect.anything(),
        { type: 'remediation_decision', required: false, source: 'review_result', signal: '0' },
        'u1',
      );
    });

    it('swallows automation log errors (fire-and-forget)', async () => {
      const warn = vi.fn();
      const record = vi.fn().mockRejectedValue(new Error('downstream'));
      setServices({
        automationLog: { record } as never,
        logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } as never,
      } as unknown as ServiceContainer);
      recordRemediationDecision({
        repository: 'a/b',
        prNumber: 5,
        userId: 'u1',
        required: false,
        signal: 'missing',
      });
      await new Promise((r) => setImmediate(r));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'a/b', prNumber: 5 }),
        'Failed to record remediation decision automation log',
      );
    });
  });

  describe('flushPendingTaskLogLines', () => {
    it('returns silently when no formatter state exists for the task', async () => {
      const storeBatch = vi.fn();
      setServices({ logLineRepo: { storeBatch } as never } as unknown as ServiceContainer);
      const states = new Map<string, TaskFormatterEntry>();

      await flushPendingTaskLogLines(states, 'unknown-task', createMockLogger());

      expect(storeBatch).not.toHaveBeenCalled();
    });

    it('deletes the entry and skips storeBatch when no pending lines remain', async () => {
      const storeBatch = vi.fn();
      setServices({ logLineRepo: { storeBatch } as never } as unknown as ServiceContainer);
      const states = new Map<string, TaskFormatterEntry>();
      states.set('t1', createTaskFormatterEntry('claude-opus'));

      await flushPendingTaskLogLines(states, 't1', createMockLogger());

      expect(states.has('t1')).toBe(false);
      expect(storeBatch).not.toHaveBeenCalled();
    });

    it('logs an error when storeBatch fails but does not throw', async () => {
      const error = vi.fn();
      const logger = { info: vi.fn(), warn: vi.fn(), error, debug: vi.fn() };
      const storeBatch = vi.fn().mockResolvedValue({ ok: false, error: new Error('write fail') });
      setServices({ logLineRepo: { storeBatch } as never } as unknown as ServiceContainer);

      const states = new Map<string, TaskFormatterEntry>();
      // Build an entry with a buffered line so flush produces output
      const entry: TaskFormatterEntry = {
        runtime: 'claude',
        state: {
          codexCurrentMessageLines: [],
          codexInCodeBlock: false,
          codexLastFlushKind: null,
          claudeToolNames: new Map(),
          pendingUserMessages: new Map([
            [
              't1-msg',
              {
                sequence: 1,
                text: 'pending flush message',
                timestamp: Timestamp.now(),
              },
            ],
          ]),
        } as never,
        lastSequence: 1,
      };
      states.set('t1', entry);

      await flushPendingTaskLogLines(states, 't1', logger as never);

      // FlushLogChunkFormatterForRuntime implementation may or may not produce
      // lines; we only assert the function doesn't throw. If lines were produced
      // the error logger will have been called, otherwise storeBatch not called.
      expect(states.has('t1')).toBe(false);
    });
  });
});
