/**
 * Tests for UnifiedEvaluator service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { WebhookRulesService } from '../../../domain/services/gitHubWebhookRules.js';
import type { WebhookDispatchService } from '../../../domain/services/gitHubDispatchService.js';
import type { EventDecisionRepository } from '../../../domain/repositories/eventDecisionRepository.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import { createUnifiedEvaluator, type UnifiedEvaluatorDeps } from '../../../domain/services/unifiedEvaluator.js';
import type { GitHubEventLogEntryRepository } from '../../../domain/repositories/gitHubEventLogEntryRepository.js';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
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
    title: 'feat: new feature',
    body: 'Can you fix the lint?',
    state: 'open',
    baseBranch: null,
    mergedAt: null,
    createdAt: new Date(),
    processedAt: new Date(),
    payload: null,
    ...overrides,
  };
}

function createFakeDeps(overrides: Partial<UnifiedEvaluatorDeps> = {}): UnifiedEvaluatorDeps {
  return {
    webhookRules: {
      evaluate: vi.fn().mockReturnValue({
        action: 'dispatch',
        reason: 'ALL_RULES_PASSED',
      }),
    } as unknown as WebhookRulesService,
    dispatchService: {
      dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: true }),
    } as unknown as WebhookDispatchService,
    eventDecisionRepo: {
      save: vi.fn().mockResolvedValue(ok({
        id: 'ed_evt-1',
        eventId: 'audit-evt-1',
        repository: 'intexuraos/intexuraos',
        pullRequestNumber: 42,
        eventType: 'issue_comment',
        eventAction: 'created',
        senderLogin: 'dev-user',
        decidedBy: 'hard_rules',
        decision: 'dispatch',
        reason: 'ALL_RULES_PASSED',
        createdAt: new Date(),
        decisionLatencyMs: 1,
      })),
    } as unknown as EventDecisionRepository,
    gitHubEventLogEntryRepo: {
      complete: vi.fn().mockResolvedValue(ok({
        id: 'audit-evt-1',
        githubEventName: 'issue_comment',
        eventType: 'issue_comment',
        action: 'created',
        repository: 'intexuraos/intexuraos',
        pullRequestNumber: 42,
        authPassedAt: new Date(),
        updatedAt: new Date(),
        decisionState: 'completed',
        decisionOutcome: 'dispatch',
        decisionId: 'ed_evt-1',
        rowVersion: 2,
      })),
      createPending: vi.fn(),
      listRecent: vi.fn(),
      findByIds: vi.fn(),
    } as unknown as GitHubEventLogEntryRepository,
    evaluateEvent: vi.fn(),
    createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-1' })),
    allowedBots: new Set(['claude[bot]']),
    automationLog: { record: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

describe('UnifiedEvaluator', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createFakeLogger();
    vi.clearAllMocks();
  });

  describe('hard rule outcomes', () => {
    it('dispatches when rules return dispatch', async () => {
      const deps = createFakeDeps();
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).toHaveBeenCalled();
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'audit-evt-1',
          normalizedEventId: 'evt-1',
          decidedBy: 'hard_rules',
          decision: 'dispatch',
        })
      );
      expect(deps.gitHubEventLogEntryRepo?.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'audit-evt-1',
          decisionState: 'completed',
        })
      );
      expect(deps.evaluateEvent).not.toHaveBeenCalled();
    });

    it('skips when rules return skip', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'skip', reason: 'BOT_NOISE' }),
        } as unknown as WebhookRulesService,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'hard_rules',
          decision: 'skip',
          reason: 'BOT_NOISE',
        })
      );
      expect(deps.evaluateEvent).not.toHaveBeenCalled();
    });
  });

  describe('dispatch result tracking', () => {
    it('records dispatchSuccess: true when hard-rule dispatch succeeds', async () => {
      const deps = createFakeDeps({
        dispatchService: {
          dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: true }),
        } as unknown as WebhookDispatchService,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchSuccess: true,
        })
      );
    });

    it('records dispatchSuccess: false and dispatchError when hard-rule dispatch fails', async () => {
      const deps = createFakeDeps({
        dispatchService: {
          dispatch: vi.fn().mockResolvedValue({ success: false, dispatched: false, error: 'Worker unavailable' }),
        } as unknown as WebhookDispatchService,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchSuccess: false,
          dispatchError: 'Worker unavailable',
        })
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1' }),
        expect.stringContaining('Dispatch failed')
      );
    });

    it('records dispatchSuccess: true when LLM dispatch succeeds', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'dispatch', template: 'pr_comment' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
        dispatchService: {
          dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: true }),
        } as unknown as WebhookDispatchService,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'github_agent',
          decision: 'dispatch',
          dispatchSuccess: true,
        })
      );
    });

    it('records dispatchSuccess: false when LLM dispatch fails', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'dispatch', template: 'pr_comment' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
        dispatchService: {
          dispatch: vi.fn().mockResolvedValue({ success: false, dispatched: false, error: 'Timeout' }),
        } as unknown as WebhookDispatchService,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'github_agent',
          dispatchSuccess: false,
          dispatchError: 'Timeout',
        })
      );
    });

    it('records dispatchSuccess: true when fallback dispatch succeeds', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: undefined,
        dispatchService: {
          dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: true }),
        } as unknown as WebhookDispatchService,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'issue_comment' });

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchSuccess: true,
        })
      );
    });

    it('records dispatchSuccess: false when fallback dispatch fails', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: undefined,
        dispatchService: {
          dispatch: vi.fn().mockResolvedValue({ success: false, dispatched: false, error: 'No workers' }),
        } as unknown as WebhookDispatchService,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'issue_comment' });

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchSuccess: false,
          dispatchError: 'No workers',
        })
      );
    });
  });

  describe('recordDecision resilience', () => {
    it('uses normalized event id when no audit event id exists and skips live-log completion', async () => {
      const deps = createFakeDeps();
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();
      delete event.auditEventId;

      await evaluator.evaluate(event, logger);

      const savedDecisionInput = vi.mocked(deps.eventDecisionRepo.save).mock.calls[0]?.[0];
      expect(savedDecisionInput).toBeDefined();
      expect(savedDecisionInput?.eventId).toBe('evt-1');
      expect('normalizedEventId' in (savedDecisionInput ?? {})).toBe(false);
      expect(deps.gitHubEventLogEntryRepo?.complete).not.toHaveBeenCalled();
    });

    it('logs and returns when eventDecisionRepo.save returns an error result', async () => {
      const deps = createFakeDeps({
        eventDecisionRepo: {
          save: vi.fn().mockResolvedValue(err({
            code: 'FIRESTORE_ERROR',
            message: 'write failed',
          })),
        } as unknown as EventDecisionRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-1',
          auditEventId: 'audit-evt-1',
          error: { code: 'FIRESTORE_ERROR', message: 'write failed' },
        }),
        'Failed to save event decision audit record'
      );
      expect(deps.gitHubEventLogEntryRepo?.complete).not.toHaveBeenCalled();
    });

    it('logs when live-log completion fails after saving the decision', async () => {
      const deps = createFakeDeps({
        gitHubEventLogEntryRepo: {
          complete: vi.fn().mockResolvedValue(err({
            code: 'FIRESTORE_ERROR',
            message: 'completion failed',
          })),
          createPending: vi.fn(),
          listRecent: vi.fn(),
          findByIds: vi.fn(),
        } as unknown as GitHubEventLogEntryRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-1',
          auditEventId: 'audit-evt-1',
          error: { code: 'FIRESTORE_ERROR', message: 'completion failed' },
        }),
        'Failed to complete GitHub event log entry'
      );
    });

    it('does not throw when eventDecisionRepo.save fails', async () => {
      const deps = createFakeDeps({
        eventDecisionRepo: {
          save: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
        } as unknown as EventDecisionRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      // Should not throw — dispatch already happened, losing the audit record
      // is better than crashing and triggering a retry that re-dispatches
      await expect(evaluator.evaluate(event, logger)).resolves.not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1' }),
        'Failed to save event decision audit record'
      );
    });
  });

  describe('needs_triage with LLM', () => {
    it('dispatches issue_comment when LLM says dispatch', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'dispatch', template: 'pr_comment' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'issue_comment' });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).toHaveBeenCalled();
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'github_agent',
          decision: 'dispatch',
        })
      );
    });

    it('skips issue_comment when LLM says skip', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'skip', reason: 'Bot noise' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'issue_comment' });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'github_agent',
          decision: 'skip',
        })
      );
    });

    it('creates review task when LLM says request_review for PR', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality', 'security'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-1' })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(deps.createReviewTask).toHaveBeenCalledWith(
        logger,
        expect.objectContaining({
          reviewTypes: ['code_quality', 'security'],
          repository: 'intexuraos/intexuraos',
          prNumber: 42,
        })
      );
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'github_agent',
          decision: 'request_review',
          dispatchAction: 'create_review_task',
          dispatchParams: expect.objectContaining({
            taskId: 'task-review-1',
            reviewTypes: ['code_quality', 'security'],
          }),
        })
      );
    });

    it('creates review task for @review issue_comment with selected worker type', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: {
            action: 'request_review',
            reviewTypes: ['architecture'],
            workerType: 'qwen',
          },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'The comment explicitly requested architecture review with qwen.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-comment-1', workerType: 'qwen' })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'issue_comment',
        action: 'created',
        body: '@review architecture',
      });

      await evaluator.evaluate(event, logger);

      expect(deps.createReviewTask).toHaveBeenCalledWith(
        logger,
        expect.objectContaining({
          reviewTypes: ['architecture'],
          workerType: 'qwen',
          reviewComment: '@review architecture',
        })
      );
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'request_review',
          dispatchParams: expect.objectContaining({
            taskId: 'task-review-comment-1',
            reviewTypes: ['architecture'],
            workerType: 'qwen',
          }),
        })
      );
    });

    it('creates review task and uses effective worker type from result', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({
          status: 'created',
          taskId: 'task-review-1',
          workerType: 'sonnet',
        })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'github_agent',
          decision: 'request_review',
          dispatchAction: 'create_review_task',
          dispatchParams: expect.objectContaining({
            taskId: 'task-review-1',
            reviewTypes: ['code_quality'],
          }),
        })
      );
    });

    it('threads baseBranch from event to createReviewTask', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-2' })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened', baseBranch: 'development' });

      await evaluator.evaluate(event, logger);

      expect(deps.createReviewTask).toHaveBeenCalledWith(
        logger,
        expect.objectContaining({
          baseBranch: 'development',
        })
      );
    });

    it('records skip when createReviewTask fails', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(
          err({ code: 'task_creation_failed' as const, message: 'Firestore unavailable' })
        ),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'github_agent',
          decision: 'skip',
          reason: expect.stringContaining('review_task_failed'),
        })
      );
    });

    it('remaps bot login to repo owner for review tasks', async () => {
      const createReviewTask = vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-bot' }));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
        createReviewTask,
        allowedBots: new Set(['claude[bot]']),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'claude[bot]',
        repository: 'pbuchman/intexuraos',
      });

      await evaluator.evaluate(event, logger);

      expect(createReviewTask).toHaveBeenCalledWith(
        logger,
        expect.objectContaining({
          senderLogin: 'pbuchman',
        })
      );
    });

    it('passes through non-bot login for review tasks', async () => {
      const createReviewTask = vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-user' }));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
        createReviewTask,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'pull_request',
        action: 'opened',
        senderLogin: 'dev-user',
      });

      await evaluator.evaluate(event, logger);

      expect(createReviewTask).toHaveBeenCalledWith(
        logger,
        expect.objectContaining({
          senderLogin: 'dev-user',
        })
      );
    });

    it('skips PR when LLM says skip', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'skip', reason: 'Docs-only PR' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
      expect(deps.createReviewTask).not.toHaveBeenCalled();
    });

    it('passes resolved userId to automation log when resolveTokenUserId is provided', async () => {
      const automationLog = { record: vi.fn().mockResolvedValue(undefined) };
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'dispatch', template: 'pr_comment' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'LLM reasoning.',
        })),
        automationLog,
        resolveTokenUserId: vi.fn().mockResolvedValue('user-resolved-1'),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(automationLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'intexuraos/intexuraos', prNumber: 42 }),
        expect.objectContaining({ type: 'triage_dispatch' }),
        'user-resolved-1',
      );
    });

    it('deduplicates identical tool calls in automation log for LLM dispatch', async () => {
      const automationLog = { record: vi.fn().mockResolvedValue(undefined) };
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'dispatch', template: 'pr_comment' },
          usage: {
            costUsd: 0.003,
            toolCalls: [
              { tool: 'get_file', args: { path: 'README.md' } },
              { tool: 'get_file', args: { path: 'README.md' } },
              { tool: 'list_files', args: { dir: 'src' } },
            ],
          },
          reasoning: 'LLM reasoning.',
        })),
        automationLog,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(automationLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'intexuraos/intexuraos', prNumber: 42 }),
        expect.objectContaining({
          type: 'triage_dispatch',
          toolCalls: [
            'get_file({"path":"README.md"})',
            'list_files({"dir":"src"})',
          ],
        }),
        undefined,
      );
    });
  });

  describe('fallback when no LLM', () => {
    it('falls back to dispatch for issue_comment when evaluateEvent is undefined', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: undefined,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'issue_comment' });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('falls back to skip for pull_request when evaluateEvent is undefined', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: undefined,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('falls back to dispatch for pull_request_review when evaluateEvent is undefined', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: undefined,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request_review' });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).toHaveBeenCalled();
    });

    it('falls back to dispatch for pull_request_review_comment when evaluateEvent is undefined', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: undefined,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request_review_comment' });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).toHaveBeenCalled();
    });
  });

  describe('LLM failure fallback', () => {
    it('falls back to dispatch for issue_comment when LLM fails', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(
          err({ code: 'LLM_FAILED' as const, message: 'API error' })
        ),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'issue_comment', body: 'Can you help with this?' });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('falls back to skip for pull_request when LLM fails', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(
          err({ code: 'LLM_FAILED' as const, message: 'API error' })
        ),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('explicit @review triage failure - fail closed', () => {
    it('does not dispatch when LLM fails for explicit @review issue_comment', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(
          err({ code: 'LLM_FAILED' as const, message: 'API error' })
        ),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'issue_comment',
        body: '@review architecture security',
      });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
    });

    it('records skip decision with review_triage_failed reason', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(
          err({ code: 'LLM_FAILED' as const, message: 'API error' })
        ),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'issue_comment',
        body: '@review architecture',
      });

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'github_agent',
          decision: 'skip',
          reason: expect.stringContaining('review_triage_failed'),
        })
      );
    });

    it('records workerType from createReviewTask result in dispatchParams', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['architecture'], workerType: 'qwen' },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'Architecture review requested.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-1', workerType: 'opus' })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'issue_comment', body: '@review architecture' });

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchParams: expect.objectContaining({
            workerType: 'opus',
          }),
        })
      );
    });
  });

  it('records LLM model when present in usage on dispatch path', async () => {
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent: vi.fn().mockResolvedValue(ok({
        triage: { action: 'dispatch', template: 'pr_comment' },
        usage: { costUsd: 0.001, model: 'test-model-id', toolCalls: [] },
        reasoning: 'LLM reasoning.',
      })),
    });
    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent();

    await evaluator.evaluate(event, logger);

    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        llmModel: 'test-model-id',
      })
    );
  });

  it('records LLM model on request_review path', async () => {
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent: vi.fn().mockResolvedValue(ok({
        triage: { action: 'request_review', reviewTypes: ['code_quality'] },
        usage: { costUsd: 0.002, model: 'test-model-id', toolCalls: [] },
        reasoning: 'LLM reasoning.',
      })),
    });
    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

    await evaluator.evaluate(event, logger);

    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        llmModel: 'test-model-id',
      })
    );
  });

  it('records LLM model on skip path', async () => {
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent: vi.fn().mockResolvedValue(ok({
        triage: { action: 'skip', reason: 'Docs only' },
        usage: { costUsd: 0.001, model: 'test-model-id', toolCalls: [] },
        reasoning: 'LLM reasoning.',
      })),
    });
    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent();

    await evaluator.evaluate(event, logger);

    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        llmModel: 'test-model-id',
      })
    );
  });

  it('logs error when createReviewTask fails', async () => {
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent: vi.fn().mockResolvedValue(ok({
        triage: { action: 'request_review', reviewTypes: ['security'] },
        usage: { costUsd: 0.002, toolCalls: [] },
        reasoning: 'LLM reasoning.',
      })),
      createReviewTask: vi.fn().mockResolvedValue(
        err({ code: 'dispatch_failed', message: 'Worker unavailable' })
      ),
    });
    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

    await evaluator.evaluate(event, logger);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1' }),
      'Failed to create review task'
    );
  });

  it('handles event with null action in recordDecision', async () => {
    const deps = createFakeDeps();
    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent({ action: null });

    await evaluator.evaluate(event, logger);

    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventAction: 'unknown',
      })
    );
  });

  it('records decision latency', async () => {
    const deps = createFakeDeps();
    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent();

    await evaluator.evaluate(event, logger);

    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionLatencyMs: expect.any(Number),
      })
    );
  });


  describe('llmReasoning in audit trail', () => {
    it('passes llmReasoning to recordDecision on request_review', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'Auth logic changed.',
        })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          llmReasoning: 'Auth logic changed.',
        })
      );
    });

    it('passes llmReasoning to recordDecision on dispatch', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'dispatch', template: 'pr_comment' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'User asked for help.',
        })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          llmReasoning: 'User asked for help.',
        })
      );
    });

    it('passes llmReasoning to recordDecision on skip', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'skip', reason: 'Docs only' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'Only markdown files.',
        })),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          llmReasoning: 'Only markdown files.',
        })
      );
    });

    it('passes llmReasoning to recordDecision on review task failure', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'Needs review.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(
          err({ code: 'task_creation_failed' as const, message: 'Firestore unavailable' })
        ),
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          llmReasoning: 'Needs review.',
        })
      );
    });
  });

});

describe('fail-closed @review triage', () => {
  it('fails closed when LLM triage fails for @review comment', async () => {
    const logger = createFakeLogger();
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({
          action: 'needs_triage',
          reason: 'ISSUE_COMMENT_REQUIRES_LLM',
        }),
      } as unknown as WebhookRulesService,
      evaluateEvent: vi.fn().mockResolvedValue(err({ message: 'LLM timeout', code: 'timeout' })),
    });

    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent({
      eventType: 'issue_comment',
      body: '@review architecture',
    });

    await evaluator.evaluate(event, logger);

    // Should NOT dispatch fallback
    expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
    // Should record skip decision with review_triage_failed reason
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'skip',
        reason: expect.stringContaining('review_triage_failed'),
      }),
    );
  });

  it('extracts worker type from @review comment on triage failure', async () => {
    const logger = createFakeLogger();
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({
          action: 'needs_triage',
          reason: 'ISSUE_COMMENT_REQUIRES_LLM',
        }),
      } as unknown as WebhookRulesService,
      evaluateEvent: vi.fn().mockResolvedValue(err({ message: 'LLM error', code: 'error' })),
    });

    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent({
      eventType: 'issue_comment',
      body: '@review opus security',
    });

    await evaluator.evaluate(event, logger);

    // Should record worker type in dispatch params
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchParams: { workerType: 'opus' },
      }),
    );
  });

  it('falls back to dispatch for non-review comment on LLM failure', async () => {
    const logger = createFakeLogger();
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({
          action: 'needs_triage',
          reason: 'ISSUE_COMMENT_REQUIRES_LLM',
        }),
      } as unknown as WebhookRulesService,
      evaluateEvent: vi.fn().mockResolvedValue(err({ message: 'LLM error', code: 'error' })),
      dispatchService: {
        dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: true }),
      } as unknown as WebhookDispatchService,
    });

    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent({
      eventType: 'issue_comment',
      body: 'Fix the tests',
    });

    await evaluator.evaluate(event, logger);

    // Should fallback dispatch for non-review comment
    expect(deps.dispatchService.dispatch).toHaveBeenCalled();
  });

  it('handles null body in @review check on LLM failure', async () => {
    const logger = createFakeLogger();
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({
          action: 'needs_triage',
          reason: 'ISSUE_COMMENT_REQUIRES_LLM',
        }),
      } as unknown as WebhookRulesService,
      evaluateEvent: vi.fn().mockResolvedValue(err({ message: 'LLM error', code: 'error' })),
      dispatchService: {
        dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: true }),
      } as unknown as WebhookDispatchService,
    });

    const evaluator = createUnifiedEvaluator(deps);
    const event = createFakeEvent({
      eventType: 'issue_comment',
      body: null,
    });

    await evaluator.evaluate(event, logger);

    // Should fallback dispatch when body is null (not a @review command)
    expect(deps.dispatchService.dispatch).toHaveBeenCalled();
  });
});

describe('LLM triage retry for pull_request events', () => {
  it('retries evaluateEvent once on failure for pull_request event and succeeds', async () => {
    const prEvent = createFakeEvent({
      eventType: 'pull_request',
      action: 'opened',
      id: 'evt-pr-retry',
      auditEventId: 'audit-pr-retry',
    });

    const evaluateEvent = vi.fn()
      .mockResolvedValueOnce(err({ code: 'LLM_FAILED', message: 'LLM failed: Empty response from model' }))
      .mockResolvedValueOnce(ok({
        triage: { action: 'skip', reason: 'Trivial config change' },
        usage: { costUsd: 0.001, toolCalls: [{ tool: 'skip', args: { reason: 'Trivial config change' } }] },
        reasoning: 'Config-only PR, no review needed.',
      }));

    const logger = createFakeLogger();
    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent,
    });

    const evaluator = createUnifiedEvaluator(deps);
    await evaluator.evaluate(prEvent, logger);

    expect(evaluateEvent).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: prEvent.id }),
      'LLM triage failed for pull_request event, retrying with correction context'
    );
    // Second call should include correctionContext
    expect(evaluateEvent).toHaveBeenCalledWith(prEvent, expect.stringContaining('Your previous attempt produced the following error'));
    // Should record a skip decision (from the successful second attempt)
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'skip', reason: expect.stringContaining('Trivial') })
    );
  });

  it('does NOT retry for issue_comment events — falls back immediately', async () => {
    const commentEvent = createFakeEvent({
      eventType: 'issue_comment',
      action: 'created',
    });

    const evaluateEvent = vi.fn()
      .mockResolvedValue(err({ code: 'LLM_FAILED', message: 'LLM failed: Empty response from model' }));

    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent,
    });

    const evaluator = createUnifiedEvaluator(deps);
    await evaluator.evaluate(commentEvent, createFakeLogger());

    // Only called once — no retry for non-PR events
    expect(evaluateEvent).toHaveBeenCalledTimes(1);
  });

  it('falls back to skip if retry also fails for pull_request event', async () => {
    const prEvent = createFakeEvent({
      eventType: 'pull_request',
      action: 'opened',
      id: 'evt-pr-double-fail',
      auditEventId: 'audit-pr-double-fail',
    });

    const evaluateEvent = vi.fn()
      .mockResolvedValue(err({ code: 'LLM_FAILED', message: 'LLM failed: Empty response from model' }));

    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
      } as unknown as WebhookRulesService,
      evaluateEvent,
    });

    const logger = createFakeLogger();
    const evaluator = createUnifiedEvaluator(deps);
    await evaluator.evaluate(prEvent, logger);

    expect(evaluateEvent).toHaveBeenCalledTimes(2);
    // Falls back to skip
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'skip', reason: expect.stringContaining('fallback_skip') })
    );
    // Both warns fire: retry warn first, then the existing 'LLM triage failed' warn
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: prEvent.id }),
      'LLM triage failed for pull_request event, retrying with correction context'
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: prEvent.id }),
      'LLM triage failed'
    );
  });
});



describe('LLM retry for pull_request events', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createFakeLogger();
  });

  it('retry recovers on second attempt with correction context', async () => {
    const evaluateEvent = vi.fn()
      .mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'Empty response from model' }))
      .mockResolvedValueOnce(ok({
        triage: { action: 'skip', reason: 'No review needed' },
        usage: { costUsd: 0.001, toolCalls: [] },
        reasoning: 'Test reasoning',
      }));

    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'NEEDS_LLM' }),
      } as unknown as WebhookRulesService,
      evaluateEvent,
    });

    const event = createFakeEvent({ eventType: 'pull_request', action: 'opened', body: null });
    const evaluator = createUnifiedEvaluator(deps);
    await evaluator.evaluate(event, logger);

    expect(evaluateEvent).toHaveBeenCalledTimes(2);

    // First call: no correction context (only event arg)
    expect(evaluateEvent.mock.calls[0]).toHaveLength(1);

    // Second call: includes correction context with the original error
    const secondCallArgs = evaluateEvent.mock.calls[1] as [unknown, string];
    expect(secondCallArgs[1]).toContain('Empty response from model');
    expect(secondCallArgs[1]).toContain('MUST call one of the provided tools');

    expect(deps.eventDecisionRepo.save).toHaveBeenCalledTimes(1);
    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decidedBy: 'github_agent',
        decision: 'skip',
        reason: 'LLM skip: No review needed',
      }),
    );
  });

  it('no retry for issue_comment — no correction context passed', async () => {
    const evaluateEvent = vi.fn()
      .mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'Empty response from model' }));

    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'NEEDS_LLM' }),
      } as unknown as WebhookRulesService,
      evaluateEvent,
    });

    const event = createFakeEvent({ eventType: 'issue_comment', action: 'created', body: 'some comment' });
    const evaluator = createUnifiedEvaluator(deps);
    await evaluator.evaluate(event, logger);

    expect(evaluateEvent).toHaveBeenCalledTimes(1);
    // Only event arg passed — no correction context
    expect(evaluateEvent.mock.calls[0]).toHaveLength(1);
  });

  it('fallback to skip on double failure — correction context passed on retry', async () => {
    const evaluateEvent = vi.fn()
      .mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'Empty response from model' }))
      .mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'Empty response from model again' }));

    const deps = createFakeDeps({
      webhookRules: {
        evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'NEEDS_LLM' }),
      } as unknown as WebhookRulesService,
      evaluateEvent,
    });

    const event = createFakeEvent({ eventType: 'pull_request', action: 'opened', body: null });
    const evaluator = createUnifiedEvaluator(deps);
    await evaluator.evaluate(event, logger);

    expect(evaluateEvent).toHaveBeenCalledTimes(2);

    // First call: no correction context (only event arg)
    expect(evaluateEvent.mock.calls[0]).toHaveLength(1);

    // Second call: includes correction context with the first error message
    const secondCallArgs = evaluateEvent.mock.calls[1] as [unknown, string];
    expect(secondCallArgs[1]).toContain('Empty response from model');
    expect(secondCallArgs[1]).toContain('MUST call one of the provided tools');

    expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'skip',
        reason: expect.stringContaining('fallback_skip'),
      }),
    );
  });

  describe('enforcement loop cap', () => {
    it('dispatches CODE_WORKER_REVIEW when no prior enforcement exists', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({
            action: 'dispatch',
            reason: 'CODE_WORKER_REVIEW',
          }),
        } as unknown as WebhookRulesService,
        eventDecisionRepo: {
          save: vi.fn().mockResolvedValue(ok({
            id: 'ed_evt-1',
            eventId: 'audit-evt-1',
            repository: 'intexuraos/intexuraos',
            pullRequestNumber: 42,
            eventType: 'pull_request_review',
            eventAction: 'submitted',
            senderLogin: 'intexuraos-code-worker[bot]',
            decidedBy: 'hard_rules',
            decision: 'dispatch',
            reason: 'CODE_WORKER_REVIEW',
            createdAt: new Date(),
            decisionLatencyMs: 1,
          })),
          existsByPRAndReason: vi.fn().mockResolvedValue(ok(false)),
        } as unknown as EventDecisionRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'pull_request_review',
        action: 'submitted',
        senderLogin: 'intexuraos-code-worker[bot]',
      });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).toHaveBeenCalled();
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'dispatch',
          reason: 'CODE_WORKER_REVIEW',
        }),
      );
    });

    it('skips CODE_WORKER_REVIEW when enforcement already ran for this PR', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({
            action: 'dispatch',
            reason: 'CODE_WORKER_REVIEW',
          }),
        } as unknown as WebhookRulesService,
        eventDecisionRepo: {
          save: vi.fn().mockResolvedValue(ok({
            id: 'ed_evt-1',
            eventId: 'audit-evt-1',
            repository: 'intexuraos/intexuraos',
            pullRequestNumber: 42,
            eventType: 'pull_request_review',
            eventAction: 'submitted',
            senderLogin: 'intexuraos-code-worker[bot]',
            decidedBy: 'hard_rules',
            decision: 'skip',
            reason: 'ENFORCEMENT_ALREADY_RAN',
            createdAt: new Date(),
            decisionLatencyMs: 1,
          })),
          existsByPRAndReason: vi.fn().mockResolvedValue(ok(true)),
        } as unknown as EventDecisionRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'pull_request_review',
        action: 'submitted',
        senderLogin: 'intexuraos-code-worker[bot]',
      });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'skip',
          reason: 'ENFORCEMENT_ALREADY_RAN',
        }),
      );
    });

    it('dispatches normally when existsByPRAndReason is not implemented', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({
            action: 'dispatch',
            reason: 'CODE_WORKER_REVIEW',
          }),
        } as unknown as WebhookRulesService,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'pull_request_review',
        action: 'submitted',
        senderLogin: 'intexuraos-code-worker[bot]',
      });

      await evaluator.evaluate(event, logger);

      expect(deps.dispatchService.dispatch).toHaveBeenCalled();
    });
  });
});
