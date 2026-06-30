/**
 * Unit tests for handleTaskCompletion use case — the domain logic extracted
 * from `POST /internal/webhooks/task-complete`.
 *
 * These tests exercise the use case directly via `setServices({fakes} as unknown as ServiceContainer)`.
 * End-to-end coverage (HTTP + signature + auth) remains in
 * `__tests__/routes/webhooks.test.ts`, which is the authoritative regression
 * suite. The cases here pin the handler result contract + key side effects.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';

import {
  handleTaskCompletion,
  type TaskCompleteWebhookBody,
} from '../../../domain/usecases/handleTaskCompletion.js';
import { resetServices, setServices, type ServiceContainer } from '../../../services.js';
import type { TaskFormatterEntry } from '../../../domain/services/webhookHelpers.js';
import { ok, err } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import { createMockLogger } from '../../helpers/mockLogger.js';

// Mock heavy downstream use cases — we only need to verify they are invoked.
vi.mock('../../../domain/usecases/drainTaskQueue.js', () => ({
  drainTaskQueue: vi.fn().mockResolvedValue({ ok: true, value: { action: 'empty' } }),
  _resetDrainGuard: vi.fn(),
}));
vi.mock('../../../domain/usecases/triageFailedTask.js', () => ({
  triageFailedTask: vi.fn().mockResolvedValue({ action: 'permanent_failure', reason: 'test' }),
}));

function buildRequestLog(): ReturnType<typeof createMockLogger> {
  return createMockLogger();
}

function buildInput(body: TaskCompleteWebhookBody): Parameters<typeof handleTaskCompletion>[1] {
  return {
    body,
    requestLog: buildRequestLog(),
    traceId: 'trace-1',
    taskFormatterStates: new Map<string, TaskFormatterEntry>(),
  };
}

describe('handleTaskCompletion', () => {
  afterEach(() => {
    resetServices();
    vi.clearAllMocks();
  });

  describe('task lookup', () => {
    it('returns fail/NOT_FOUND when the task cannot be resolved', async () => {
      setServices({
        codeTaskRepo: { findById: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'missing' })) } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);
      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-missing',
        status: 'completed',
      }));
      expect(result).toEqual({ kind: 'fail', code: 'NOT_FOUND', message: 'Task not found' });
    });
  });

  describe('stale cancelled callback', () => {
    it('returns received without updating when task is already cancelled and incoming status matches', async () => {
      const update = vi.fn();
      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'cancelled',
            agentType: 'execution',
          })),
          update,
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);
      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-cancel',
        status: 'cancelled',
      }));
      expect(result).toEqual({ kind: 'received' });
      expect(update).not.toHaveBeenCalled();
    });

    it('returns received without updating when task is already cancelled and incoming status differs', async () => {
      const update = vi.fn();
      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'cancelled',
            agentType: 'execution',
          })),
          update,
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);
      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-cancel',
        status: 'completed',
      }));
      expect(result).toEqual({ kind: 'received' });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('interrupted path', () => {
    it('updates the task, notifies, and returns received for an interrupted status', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const notifyTaskFailed = vi.fn().mockResolvedValue(ok(undefined));

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
            dispatchedAt: Timestamp.now(),
          })),
          update,
        } as never,
        whatsappNotifier: { notifyTaskFailed } as never,
        metricsClient: {
          incrementTasksCompleted: vi.fn().mockResolvedValue(undefined),
          recordTaskDuration: vi.fn().mockResolvedValue(undefined),
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-interrupted',
        status: 'interrupted',
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(update).toHaveBeenCalledWith(
        't-interrupted',
        expect.objectContaining({
          status: 'interrupted',
          error: { code: 'worker_interrupted', message: 'Worker was interrupted during task execution' },
          callbackReceived: true,
        }),
      );
      expect(notifyTaskFailed).toHaveBeenCalled();
    });

    it('returns fail when interrupted status update fails', async () => {
      const update = vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' }));

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
          })),
          update,
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-interrupted',
        status: 'interrupted',
      }));

      expect(result).toEqual({ kind: 'fail', code: 'INTERNAL_ERROR', message: 'write failed' });
    });
  });

  describe('completed path — execution agent (memory queued + automation logged)', () => {
    const ORIGINAL_EXECUTION_MEMORY_ENABLED =
      process.env['INTEXURAOS_EXECUTION_MEMORY_ENABLED'];

    afterEach(() => {
      // Restore the prior value so the env var does not leak into downstream
      // tests. `resetServices()` in the outer afterEach does not touch env.
      if (ORIGINAL_EXECUTION_MEMORY_ENABLED === undefined) {
        delete process.env['INTEXURAOS_EXECUTION_MEMORY_ENABLED'];
      } else {
        process.env['INTEXURAOS_EXECUTION_MEMORY_ENABLED'] = ORIGINAL_EXECUTION_MEMORY_ENABLED;
      }
    });

    it('queues the execution-memory post-run block and records metrics when an execution task completes (already_completed outcome)', async () => {
      // Turn on memory queueing for the duration of this test.
      process.env['INTEXURAOS_EXECUTION_MEMORY_ENABLED'] = 'true';

      const update = vi.fn().mockResolvedValue(ok(undefined));
      const notifyTaskComplete = vi.fn().mockResolvedValue(ok(undefined));
      const incrementTasksCompleted = vi.fn().mockResolvedValue(undefined);
      const recordTaskDuration = vi.fn().mockResolvedValue(undefined);
      const validateIssue = vi.fn().mockResolvedValue(ok({
        id: 'linear-uuid', identifier: 'INT-1', title: 't', url: 'u',
        labels: [], childCount: 0, parentId: null,
      }));
      const addComment = vi.fn().mockResolvedValue(ok({ commentId: 'c-1' }));
      const updateIssueState = vi.fn().mockResolvedValue(ok(undefined));
      const updateIssueMetadata = vi.fn().mockResolvedValue(ok({ droppedLabels: [] }));

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
            linearIssueId: 'INT-1',
            // No prNumber → cleanupLockIfPR + triggerDrainForPR short-circuit.
          })),
          update,
        } as never,
        whatsappNotifier: { notifyTaskComplete } as never,
        metricsClient: { incrementTasksCompleted, recordTaskDuration } as never,
        linearAgentClient: {
          validateIssue, addComment, updateIssueState, updateIssueMetadata,
        } as never,
        linearIssueService: { markInReview: vi.fn().mockResolvedValue(undefined) } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-done',
        status: 'completed',
        result: {
          execution_outcome_label: 'already_completed',
          prUrl: 'https://github.com/a/b/pull/9',
          summary: 'Work done previously',
        },
      }));

      expect(result).toEqual({ kind: 'received' });
      // Memory queued: the update must include the `executionMemoryPostRun` block
      // with `status: 'pending'` so the post-run memory worker will pick it up.
      expect(update).toHaveBeenCalledWith(
        't-done',
        expect.objectContaining({
          status: 'implemented',
          executionMemoryPostRun: expect.objectContaining({
            status: 'pending',
            attempts: 0,
            generatedMemoryIds: [],
          }),
          callbackReceived: true,
        }),
      );
      // Automation/observability: metrics emitted + whatsapp notified.
      expect(incrementTasksCompleted).toHaveBeenCalledWith('claude-opus', 'implemented');
      expect(notifyTaskComplete).toHaveBeenCalled();
    });
  });

  describe('completed path — review agent (remediation decision recorded)', () => {
    it('records a required remediation decision when a review completes with needs_remediation=1', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const automationRecord = vi.fn().mockResolvedValue(undefined);
      const notifyTaskComplete = vi.fn().mockResolvedValue(ok(undefined));
      const incrementTasksCompleted = vi.fn().mockResolvedValue(undefined);
      const recordTaskDuration = vi.fn().mockResolvedValue(undefined);
      const markInReview = vi.fn().mockResolvedValue(undefined);

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'review',
            linearIssueId: 'INT-1',
            // No prNumber on the task — prNumber is resolved from prUrl in result.
          })),
          update,
          findOriginTaskByPR: vi.fn().mockResolvedValue(ok(null)),
        } as never,
        whatsappNotifier: { notifyTaskComplete } as never,
        metricsClient: { incrementTasksCompleted, recordTaskDuration } as never,
        automationLog: { record: automationRecord } as never,
        linearIssueService: {
          removeLabel: vi.fn().mockResolvedValue(undefined),
          markInReview,
        } as never,
        logger: createMockLogger() as never,
        // No createRemediationTaskFn → the branch that records the decision
        // without a taskId is exercised.
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-review',
        status: 'completed',
        result: {
          review_id: 'rev-1',
          review_comments_posted: '1',
          review_types: 'code_quality',
          prUrl: 'https://github.com/a/b/pull/42',
          needs_remediation: '1',
        },
      }));

      expect(result).toEqual({ kind: 'received' });
      // Remediation decision: the review raised needs_remediation=1, so an
      // automation log MUST be recorded with required=true and signal='1'.
      // The review agent does not currently carry a prNumber on the task
      // record; the helper resolves it from result.prUrl.
      const remediationCall = automationRecord.mock.calls.find((call) => {
        const event = call[1] as { type?: string; required?: boolean; signal?: string };
        return event.type === 'remediation_decision' && event.required === true;
      });
      expect(remediationCall).toBeDefined();
      expect(remediationCall?.[1]).toMatchObject({
        type: 'remediation_decision',
        required: true,
        signal: '1',
        source: 'review_result',
      });
      expect(remediationCall?.[0]).toMatchObject({ repository: 'a/b', prNumber: 42 });
      expect(markInReview).toHaveBeenCalledWith('u1', 'INT-1');
    });

    it.each([
      ['merged', { prMergedAt: Timestamp.fromDate(new Date('2026-06-29T04:39:58Z')) }],
      ['closed', { prClosedAt: Timestamp.fromDate(new Date('2026-06-29T04:39:58Z')) }],
    ])('records the review decision but skips remediation creation when the PR is already %s', async (_state, prLifecycle) => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const automationRecord = vi.fn().mockResolvedValue(undefined);
      const notifyTaskComplete = vi.fn().mockResolvedValue(ok(undefined));
      const incrementTasksCompleted = vi.fn().mockResolvedValue(undefined);
      const recordTaskDuration = vi.fn().mockResolvedValue(undefined);
      const createRemediationTaskFn = vi.fn().mockResolvedValue(ok({ taskId: 'remed-1' }));
      const findOriginTaskByPR = vi.fn().mockResolvedValue(ok(null));
      const removeLabel = vi.fn().mockResolvedValue(undefined);
      const markInReview = vi.fn().mockResolvedValue(undefined);

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'review',
            linearIssueId: 'INT-1',
            prNumber: 42,
            ...prLifecycle,
          })),
          update,
          findOriginTaskByPR,
        } as never,
        whatsappNotifier: { notifyTaskComplete } as never,
        metricsClient: { incrementTasksCompleted, recordTaskDuration } as never,
        automationLog: { record: automationRecord } as never,
        linearIssueService: {
          removeLabel,
          markInReview,
        } as never,
        logger: createMockLogger() as never,
        createRemediationTaskFn,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-review-closed',
        status: 'completed',
        result: {
          review_id: 'rev-1',
          review_comments_posted: '1',
          review_types: 'code_quality',
          prUrl: 'https://github.com/a/b/pull/42',
          needs_remediation: '1',
        },
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(createRemediationTaskFn).not.toHaveBeenCalled();
      expect(findOriginTaskByPR).not.toHaveBeenCalled();
      expect(removeLabel).not.toHaveBeenCalled();
      expect(markInReview).not.toHaveBeenCalled();
      const remediationCall = automationRecord.mock.calls.find((call) => {
        const event = call[1] as { type?: string; required?: boolean; signal?: string; taskId?: string };
        return event.type === 'remediation_decision';
      });
      expect(remediationCall?.[1]).toMatchObject({
        type: 'remediation_decision',
        required: true,
        signal: '1',
        source: 'review_result',
      });
      expect(remediationCall?.[1]).not.toHaveProperty('taskId');
    });
  });

  describe('completed path — Sentry agent', () => {
    const sentryIssue = {
      organizationSlug: 'intexura',
      projectSlug: 'code-agent',
      issueId: '123456',
      issueUrl: 'https://intexura.sentry.io/issues/123456/',
      title: 'TypeError',
      action: 'created',
      receivedAt: '2026-06-28T12:00:00.000Z',
    };

    const sentryTask = {
      userId: 'u1',
      repository: 'a/b',
      workerType: 'codex-xhigh',
      status: 'running',
      agentType: 'sentry',
      linearIssueId: 'INT-123',
      sentryIssue,
    };

    const sentryResult = {
      prUrl: 'https://github.com/a/b/pull/77',
      sentry_issue_url: 'https://intexura.sentry.io/issues/123456/',
      sentry_linear_issue: 'https://linear.app/pbuchman/issue/INT-123/sentry-typeerror',
      sentry_outcome: 'fixed' as const,
      sentry_verification: 'pnpm test',
    };

    function installSentryCompletion(overrides: {
      task?: Record<string, unknown>;
      update?: ReturnType<typeof vi.fn>;
    } = {}): ReturnType<typeof vi.fn> {
      const update = overrides.update ?? vi.fn().mockResolvedValue(ok(undefined));
      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            ...sentryTask,
            ...overrides.task,
          })),
          update,
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);
      return update;
    }

    it('rejects a successful Sentry completion without a PR URL', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'codex-xhigh',
            status: 'running',
            agentType: 'sentry',
            linearIssueId: 'INT-123',
            sentryIssue: {
              organizationSlug: 'intexura',
              projectSlug: 'code-agent',
              issueId: '123456',
              issueUrl: 'https://intexura.sentry.io/issues/123456/',
              title: 'TypeError',
              action: 'created',
              receivedAt: '2026-06-28T12:00:00.000Z',
            },
          })),
          update,
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-sentry-no-pr',
        status: 'completed',
        result: {
          sentry_issue_url: 'https://intexura.sentry.io/issues/123456/',
          sentry_linear_issue: 'https://linear.app/pbuchman/issue/INT-123/sentry-typeerror',
          sentry_outcome: 'fixed',
          sentry_verification: 'pnpm test',
        },
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(update).toHaveBeenCalledWith(
        't-sentry-no-pr',
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry enforcement requires result.prUrl',
          }),
          callbackReceived: true,
        }),
      );
    });

    it('rejects a completed Sentry callback without a result payload', async () => {
      const update = installSentryCompletion();

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-sentry-no-result',
        status: 'completed',
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(update).toHaveBeenCalledWith(
        't-sentry-no-result',
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message: 'Sentry completion missing result payload',
          }),
          callbackReceived: true,
        }),
      );
    });

    it('returns fail when persisting a missing-result Sentry rejection fails', async () => {
      installSentryCompletion({
        update: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' })),
      });

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-sentry-no-result-write-fails',
        status: 'completed',
      }));

      expect(result).toEqual({ kind: 'fail', code: 'INTERNAL_ERROR', message: 'write failed' });
    });

    it.each([
      {
        name: 'missing Sentry issue context',
        task: { sentryIssue: undefined },
        result: sentryResult,
        message: 'Sentry enforcement requires task.sentryIssue context',
      },
      {
        name: 'missing routed Linear issue',
        task: { linearIssueId: undefined },
        result: sentryResult,
        message: 'Sentry enforcement requires routed linearIssueId',
      },
      {
        name: 'invalid outcome',
        task: {},
        result: { ...sentryResult, sentry_outcome: 'ignored' },
        message: 'Sentry enforcement requires result.sentry_outcome fixed or suppressed',
      },
      {
        name: 'missing Sentry URL',
        task: {},
        result: { ...sentryResult, sentry_issue_url: '' },
        message: 'Sentry enforcement requires result.sentry_issue_url',
      },
      {
        name: 'mismatched Sentry URL',
        task: {},
        result: { ...sentryResult, sentry_issue_url: 'https://intexura.sentry.io/issues/999999/' },
        message: 'Sentry enforcement requires result.sentry_issue_url to match the task Sentry issue',
      },
      {
        name: 'missing Linear issue URL',
        task: {},
        result: { ...sentryResult, sentry_linear_issue: '' },
        message: 'Sentry enforcement requires result.sentry_linear_issue',
      },
      {
        name: 'missing verification evidence',
        task: {},
        result: { ...sentryResult, sentry_verification: undefined },
        message: 'Sentry enforcement requires result.sentry_verification',
      },
      {
        name: 'blank verification evidence',
        task: {},
        result: { ...sentryResult, sentry_verification: '   ' },
        message: 'Sentry enforcement requires result.sentry_verification',
      },
    ])('rejects Sentry completion with $name', async ({ task, result: resultPayload, message }) => {
      const update = installSentryCompletion({ task });

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-sentry-invariant',
        status: 'completed',
        result: resultPayload as NonNullable<TaskCompleteWebhookBody['result']>,
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(update).toHaveBeenCalledWith(
        't-sentry-invariant',
        expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({
            code: 'SENTRY_AGENT_ENFORCEMENT_FAILED',
            message,
          }),
          callbackReceived: true,
        }),
      );
    });

    it('returns fail when persisting a Sentry enforcement rejection fails', async () => {
      installSentryCompletion({
        update: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' })),
      });

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-sentry-invariant-write-fails',
        status: 'completed',
        result: {
          ...sentryResult,
          sentry_outcome: 'ignored' as never,
        },
      }));

      expect(result).toEqual({ kind: 'fail', code: 'INTERNAL_ERROR', message: 'write failed' });
    });

    it('stores Sentry completion evidence when a Sentry task opens a PR', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const notifyTaskComplete = vi.fn().mockResolvedValue(ok(undefined));
      const incrementTasksCompleted = vi.fn().mockResolvedValue(undefined);
      const recordTaskDuration = vi.fn().mockResolvedValue(undefined);
      const resultPayload = {
        prUrl: 'https://github.com/a/b/pull/77',
        branch: 'task_sentry_123456',
        summary: 'Fixed the Sentry issue.',
        sentry_issue_url: 'https://intexura.sentry.io/issues/123456/',
        sentry_linear_issue: 'https://linear.app/pbuchman/issue/INT-123/sentry-typeerror',
        sentry_outcome: 'fixed' as const,
        sentry_verification: 'pnpm --dir apps/code-agent test -- sentry',
      };

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'codex-xhigh',
            status: 'running',
            agentType: 'sentry',
            linearIssueId: 'INT-123',
            sentryIssue: {
              organizationSlug: 'intexura',
              projectSlug: 'code-agent',
              issueId: '123456',
              issueUrl: 'https://intexura.sentry.io/issues/123456/',
              title: 'TypeError',
              action: 'created',
              receivedAt: '2026-06-28T12:00:00.000Z',
            },
          })),
          update,
        } as never,
        whatsappNotifier: { notifyTaskComplete } as never,
        metricsClient: { incrementTasksCompleted, recordTaskDuration } as never,
        linearIssueService: { markInReview: vi.fn().mockResolvedValue(undefined) } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-sentry-fixed',
        status: 'completed',
        result: resultPayload,
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(update).toHaveBeenCalledWith(
        't-sentry-fixed',
        expect.objectContaining({
          status: 'implemented',
          prNumber: 77,
          prBranch: 'task_sentry_123456',
          result: expect.objectContaining(resultPayload),
          error: null,
          callbackReceived: true,
        }),
      );
      expect(incrementTasksCompleted).toHaveBeenCalledWith('codex-xhigh', 'implemented');
      expect(notifyTaskComplete).toHaveBeenCalled();
    });
  });

  describe('failed path', () => {
    it('returns received for a failed status with permanent_failure triage', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const notifyTaskFailed = vi.fn().mockResolvedValue(ok(undefined));

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
          })),
          update,
        } as never,
        whatsappNotifier: { notifyTaskFailed } as never,
        metricsClient: {
          incrementTasksCompleted: vi.fn().mockResolvedValue(undefined),
          recordTaskDuration: vi.fn().mockResolvedValue(undefined),
        } as never,
        automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
        taskEnqueueService: {} as never,
        logLineRepo: {} as never,
        userServiceClient: {} as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-failed',
        status: 'failed',
        error: { code: 'EXECUTION_AGENT_CRASH', message: 'boom' },
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(update).toHaveBeenCalledWith(
        't-failed',
        expect.objectContaining({
          status: 'failed',
          callbackReceived: true,
          error: expect.objectContaining({ code: 'EXECUTION_AGENT_CRASH', message: 'boom' }),
        }),
      );
      expect(notifyTaskFailed).toHaveBeenCalled();
    });

    it('returns fail when failed status update fails', async () => {
      const update = vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'write failed' }));

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
          })),
          update,
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-failed',
        status: 'failed',
        error: { code: 'EXECUTION_AGENT_CRASH', message: 'boom' },
      }));

      expect(result).toEqual({ kind: 'fail', code: 'INTERNAL_ERROR', message: 'write failed' });
    });
  });

  describe('cancelled path', () => {
    it('records duration metrics when a task is cancelled with duration', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const notifyTaskFailed = vi.fn().mockResolvedValue(ok(undefined));
      const recordTaskDuration = vi.fn().mockResolvedValue(undefined);

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
          })),
          update,
        } as never,
        whatsappNotifier: { notifyTaskFailed } as never,
        metricsClient: {
          incrementTasksCompleted: vi.fn().mockResolvedValue(undefined),
          recordTaskDuration,
        } as never,
        logger: createMockLogger() as never,
      } as unknown as ServiceContainer);

      const result = await handleTaskCompletion(createMockLogger(), buildInput({
        taskId: 't-cancelled',
        status: 'cancelled',
        duration: 123,
      }));

      expect(result).toEqual({ kind: 'received' });
      expect(recordTaskDuration).toHaveBeenCalledWith('claude-opus', 123);
    });
  });

  // INT-1763: best-effort Cloud Monitoring writes may fail with
  // `monitoring.timeSeries.create denied` until the IAM role grant
  // (terraform/modules/iam/main.tf: code_agent_monitoring_metric_writer) is
  // propagated or has been pending permission setup. These warnings are
  // expected best-effort telemetry — they stay in stdout/Cloud Logging for
  // debugging but must not generate new Sentry issues.
  describe('metrics telemetry is annotated as non-Sentry (INT-1763)', () => {
    it('marks the task-completion metric warn payload with _skipSentry when incrementTasksCompleted rejects', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const notifyTaskComplete = vi.fn().mockResolvedValue(ok(undefined));
      const incrementTasksCompleted = vi
        .fn()
        .mockRejectedValue(new Error('Permission monitoring.timeSeries.create denied'));
      const recordTaskDuration = vi.fn().mockResolvedValue(undefined);
      const validateIssue = vi.fn().mockResolvedValue(ok({
        id: 'linear-uuid', identifier: 'INT-1', title: 't', url: 'u',
        labels: [], childCount: 0, parentId: null,
      }));
      const addComment = vi.fn().mockResolvedValue(ok({ commentId: 'c-1' }));
      const updateIssueState = vi.fn().mockResolvedValue(ok(undefined));
      const updateIssueMetadata = vi.fn().mockResolvedValue(ok({ droppedLabels: [] }));
      const requestLog = createMockLogger();

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
            linearIssueId: 'INT-1',
          })),
          update,
        } as never,
        whatsappNotifier: { notifyTaskComplete } as never,
        metricsClient: { incrementTasksCompleted, recordTaskDuration } as never,
        linearAgentClient: {
          validateIssue, addComment, updateIssueState, updateIssueMetadata,
        } as never,
        linearIssueService: { markInReview: vi.fn().mockResolvedValue(undefined) } as never,
        logger: requestLog as never,
      } as unknown as ServiceContainer);

      await handleTaskCompletion(requestLog, {
        ...buildInput({
          taskId: 't-metrics-skip-sentry',
          status: 'completed',
          result: {
            execution_outcome_label: 'already_completed',
            prUrl: 'https://github.com/a/b/pull/9',
            summary: 'Work already complete',
          },
        }),
        requestLog,
      });

      // Allow the queued catch() callbacks to run.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(requestLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 't-metrics-skip-sentry',
          [SKIP_SENTRY_KEY]: true,
        }),
        'Failed to record task completion metric'
      );
    });

    it('marks the task-duration metric warn payload with _skipSentry when recordTaskDuration rejects', async () => {
      const update = vi.fn().mockResolvedValue(ok(undefined));
      const notifyTaskFailed = vi.fn().mockResolvedValue(ok(undefined));
      const incrementTasksCompleted = vi.fn().mockResolvedValue(undefined);
      const recordTaskDuration = vi
        .fn()
        .mockRejectedValue(new Error('Permission monitoring.timeSeries.create denied'));
      const requestLog = createMockLogger();

      setServices({
        codeTaskRepo: {
          findById: vi.fn().mockResolvedValue(ok({
            userId: 'u1',
            repository: 'a/b',
            workerType: 'claude-opus',
            status: 'running',
            agentType: 'execution',
          })),
          update,
        } as never,
        whatsappNotifier: { notifyTaskFailed } as never,
        metricsClient: { incrementTasksCompleted, recordTaskDuration } as never,
        logger: requestLog as never,
      } as unknown as ServiceContainer);

      await handleTaskCompletion(requestLog, {
        ...buildInput({
          taskId: 't-duration-skip-sentry',
          status: 'interrupted',
          duration: 42,
        }),
        requestLog,
      });

      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(requestLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 't-duration-skip-sentry',
          [SKIP_SENTRY_KEY]: true,
        }),
        'Failed to record task duration metric'
      );
    });
  });
});
