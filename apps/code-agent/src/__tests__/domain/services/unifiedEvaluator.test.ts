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
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import { Timestamp } from '@google-cloud/firestore';
import { LlmModels } from '@intexuraos/llm-contract';

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

    it('calls onUnauthorizedSender when skip reason is SENDER_NOT_WHITELISTED', async () => {
      const onUnauthorizedSender = vi.fn().mockResolvedValue(undefined);
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'skip', reason: 'SENDER_NOT_WHITELISTED' }),
        } as unknown as WebhookRulesService,
        onUnauthorizedSender,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ senderLogin: 'random-user' });

      await evaluator.evaluate(event, logger);

      expect(onUnauthorizedSender).toHaveBeenCalledWith(event);
    });

    it('does not call onUnauthorizedSender for other skip reasons', async () => {
      const onUnauthorizedSender = vi.fn().mockResolvedValue(undefined);
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'skip', reason: 'BOT_NOISE' }),
        } as unknown as WebhookRulesService,
        onUnauthorizedSender,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(onUnauthorizedSender).not.toHaveBeenCalled();
    });

    it('does not fail when onUnauthorizedSender rejects', async () => {
      const onUnauthorizedSender = vi.fn().mockRejectedValue(new Error('GitHub API error'));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'skip', reason: 'SENDER_NOT_WHITELISTED' }),
        } as unknown as WebhookRulesService,
        onUnauthorizedSender,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ senderLogin: 'random-user' });

      // Should not throw even when onUnauthorizedSender rejects
      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'skip', reason: 'SENDER_NOT_WHITELISTED' })
      );
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

    it('records llmModel when createReviewTask fails and usage.model is defined', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, model: 'claude-opus-4', toolCalls: [] },
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
          decidedBy: 'github_agent',
          decision: 'skip',
          llmModel: 'claude-opus-4',
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

  describe('check_suite CI failure path', () => {
    function createCheckSuiteEvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
      return createFakeEvent({
        eventType: 'check_suite',
        action: 'completed',
        baseBranch: 'task_abc123',
        ...overrides,
      });
    }

    it('dispatches CI failure fix when check_suite matches task branch', async () => {
      const mockCIDispatch = {
        dispatchCIFailure: vi.fn().mockResolvedValue({
          success: true,
          fixTaskCreated: true,
          fixTaskId: 'task-fix-1',
        }),
      };
      const deps = createFakeDeps({
        ciFailureDispatchService: mockCIDispatch,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createCheckSuiteEvent();

      await evaluator.evaluate(event, logger);

      expect(mockCIDispatch.dispatchCIFailure).toHaveBeenCalledWith({ event, logger });
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'hard_rules',
          decision: 'dispatch',
          reason: 'ci_failure_fix_dispatched',
          dispatchAction: 'create_task',
          dispatchParams: { taskId: 'task-fix-1' },
        }),
      );
      // Should NOT fall through to normal webhook rules
      expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
    });

    it('records skip decision when CI failure dispatch is skipped', async () => {
      const mockCIDispatch = {
        dispatchCIFailure: vi.fn().mockResolvedValue({
          success: false,
          fixTaskCreated: false,
          skipped: true,
          skipReason: 'no_parent_task',
        }),
      };
      const deps = createFakeDeps({
        ciFailureDispatchService: mockCIDispatch,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createCheckSuiteEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'hard_rules',
          decision: 'skip',
          reason: 'ci_failure_skipped: no_parent_task',
        }),
      );
      expect(deps.dispatchService.dispatch).not.toHaveBeenCalled();
    });

    it('records automation log for CI failure skip with headBranch', async () => {
      const mockCIDispatch = {
        dispatchCIFailure: vi.fn().mockResolvedValue({
          success: false,
          fixTaskCreated: false,
          skipped: true,
          skipReason: 'no_parent_task',
        }),
      };
      const deps = createFakeDeps({
        ciFailureDispatchService: mockCIDispatch,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createCheckSuiteEvent({ baseBranch: 'task_xyz789' });

      await evaluator.evaluate(event, logger);

      expect(deps.automationLog.record).toHaveBeenCalledWith(
        { repository: 'intexuraos/intexuraos', prNumber: 42 },
        expect.objectContaining({
          type: 'ci_failure_skip',
          reason: 'no_parent_task',
          headBranch: 'task_xyz789',
        }),
        undefined,
      );
    });

    it('falls through to normal rules when check_suite has no task branch', async () => {
      const mockCIDispatch = {
        dispatchCIFailure: vi.fn(),
      };
      const deps = createFakeDeps({
        ciFailureDispatchService: mockCIDispatch,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createCheckSuiteEvent({ baseBranch: 'feature/some-branch' });

      await evaluator.evaluate(event, logger);

      // CIFailureRule returns skip for non-task branches, so it falls through
      expect(mockCIDispatch.dispatchCIFailure).not.toHaveBeenCalled();
      // Normal webhook rules should still run
      expect(deps.webhookRules.evaluate).toHaveBeenCalled();
    });

    it('falls through to normal rules when ciFailureDispatchService is not provided', async () => {
      const deps = createFakeDeps();
      // Ensure no ciFailureDispatchService
      delete (deps as unknown as Record<string, unknown>)['ciFailureDispatchService'];
      const evaluator = createUnifiedEvaluator(deps);
      const event = createCheckSuiteEvent();

      await evaluator.evaluate(event, logger);

      // Should fall through to normal webhook rules
      expect(deps.webhookRules.evaluate).toHaveBeenCalled();
    });

    it('records dispatch with error when CI failure dispatch fails', async () => {
      const mockCIDispatch = {
        dispatchCIFailure: vi.fn().mockResolvedValue({
          success: false,
          fixTaskCreated: false,
          error: 'Worker unavailable',
        }),
      };
      const deps = createFakeDeps({
        ciFailureDispatchService: mockCIDispatch,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createCheckSuiteEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decidedBy: 'hard_rules',
          decision: 'dispatch',
          reason: 'ci_failure_fix_dispatched',
          dispatchSuccess: false,
          dispatchError: 'Worker unavailable',
        }),
      );
    });

    it('records dispatch without dispatchParams when fixTaskId is undefined', async () => {
      const mockCIDispatch = {
        dispatchCIFailure: vi.fn().mockResolvedValue({
          success: true,
          fixTaskCreated: true,
        }),
      };
      const deps = createFakeDeps({
        ciFailureDispatchService: mockCIDispatch,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createCheckSuiteEvent();

      await evaluator.evaluate(event, logger);

      const savedInput = vi.mocked(deps.eventDecisionRepo.save).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(savedInput).toBeDefined();
      expect(savedInput?.['decidedBy']).toBe('hard_rules');
      expect(savedInput?.['decision']).toBe('dispatch');
      expect(savedInput?.['reason']).toBe('ci_failure_fix_dispatched');
      expect(savedInput?.['dispatchParams']).toBeUndefined();
    });

    it('handles check_suite skip with null baseBranch via CIFailureRule', async () => {
      const mockCIDispatch = {
        dispatchCIFailure: vi.fn(),
      };
      const deps = createFakeDeps({
        ciFailureDispatchService: mockCIDispatch,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createCheckSuiteEvent({ baseBranch: null });

      await evaluator.evaluate(event, logger);

      // CIFailureRule returns skip for null branch, falls through
      expect(mockCIDispatch.dispatchCIFailure).not.toHaveBeenCalled();
      expect(deps.webhookRules.evaluate).toHaveBeenCalled();
    });

    it('defaults skipReason to unknown when not provided', async () => {
      const mockCIDispatch = {
        dispatchCIFailure: vi.fn().mockResolvedValue({
          success: false,
          fixTaskCreated: false,
          skipped: true,
        }),
      };
      const deps = createFakeDeps({
        ciFailureDispatchService: mockCIDispatch,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createCheckSuiteEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'ci_failure_skipped: unknown',
        }),
      );
    });
  });

  describe('synchronize remediation interception', () => {
    function createSynchronizeEvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
      return createFakeEvent({
        eventType: 'pull_request',
        action: 'synchronize',
        repository: 'test/repo',
        pullRequestNumber: 42,
        ...overrides,
      });
    }

    function createRemediationCodeTaskRepo(task: { status: string; completedAt?: Date; requiresReReview?: boolean } | null): Partial<CodeTaskRepository> {
      if (task === null) {
        return {
          findRecentRemediationForPR: vi.fn().mockResolvedValue(ok(null)),
        };
      }
      return {
        findRecentRemediationForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-rem-1',
          agentType: 'remediation',
          status: task.status,
          repository: 'test/repo',
          prNumber: 42,
          completedAt: task.completedAt !== undefined ? Timestamp.fromDate(task.completedAt) : undefined,
          requiresReReview: task.requiresReReview,
        })),
      };
    }

    it('skips review when recent remediation task has requiresReReview=false', async () => {
      const codeTaskRepo = createRemediationCodeTaskRepo({
        status: 'reviewed',
        completedAt: new Date(), // just completed
        requiresReReview: false,
      });
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.001, toolCalls: [], model: LlmModels.Gemini25Flash },
          reasoning: 'PR was updated.',
        })),
        codeTaskRepo: codeTaskRepo as CodeTaskRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createSynchronizeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.createReviewTask).not.toHaveBeenCalled();
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'skip',
          reason: expect.stringContaining('remediation_no_rereview'),
          llmModel: LlmModels.Gemini25Flash,
        }),
      );
    });

    it('triggers review when recent remediation task has requiresReReview=true', async () => {
      const codeTaskRepo = createRemediationCodeTaskRepo({
        status: 'reviewed',
        completedAt: new Date(),
        requiresReReview: true,
      });
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'PR was updated.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-2', workerType: 'opus' })),
        codeTaskRepo: codeTaskRepo as CodeTaskRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createSynchronizeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.createReviewTask).toHaveBeenCalled();
    });

    it('triggers review when recent remediation task has requiresReReview=undefined', async () => {
      const codeTaskRepo = createRemediationCodeTaskRepo({
        status: 'reviewed',
        completedAt: new Date(),
        // requiresReReview not set yet — fail open to a fresh review
      });
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'PR was updated.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-3', workerType: 'opus' })),
        codeTaskRepo: codeTaskRepo as CodeTaskRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createSynchronizeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.createReviewTask).toHaveBeenCalled();
      expect(deps.eventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'request_review',
          reason: expect.stringContaining('LLM request_review'),
        }),
      );
    });

    it('triggers review when no recent remediation task exists', async () => {
      const codeTaskRepo = createRemediationCodeTaskRepo(null);
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'PR was updated.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-4', workerType: 'opus' })),
        codeTaskRepo: codeTaskRepo as CodeTaskRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createSynchronizeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.createReviewTask).toHaveBeenCalled();
    });

    it('treats running remediation task as recent (skips review when requiresReReview=false)', async () => {
      const codeTaskRepo = createRemediationCodeTaskRepo({
        status: 'running',
        requiresReReview: false,
      });
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'PR was updated.',
        })),
        codeTaskRepo: codeTaskRepo as CodeTaskRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createSynchronizeEvent();

      await evaluator.evaluate(event, logger);

      expect(deps.createReviewTask).not.toHaveBeenCalled();
    });

    it('ignores remediation task completed more than 60 minutes ago', async () => {
      const oldCompletedAt = new Date(Date.now() - 61 * 60 * 1000); // 61 minutes ago
      const codeTaskRepo = createRemediationCodeTaskRepo({
        status: 'reviewed',
        completedAt: oldCompletedAt,
        requiresReReview: false,
      });
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'PR was updated.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-5', workerType: 'opus' })),
        codeTaskRepo: codeTaskRepo as CodeTaskRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createSynchronizeEvent();

      await evaluator.evaluate(event, logger);

      // Old remediation task should be ignored, review should proceed
      expect(deps.createReviewTask).toHaveBeenCalled();
    });

    it('does not intercept non-synchronize pull_request events', async () => {
      const codeTaskRepo = createRemediationCodeTaskRepo({
        status: 'reviewed',
        completedAt: new Date(),
        requiresReReview: false,
      });
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'PR was opened.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-6', workerType: 'opus' })),
        codeTaskRepo: codeTaskRepo as CodeTaskRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'pull_request',
        action: 'opened',
      });

      await evaluator.evaluate(event, logger);

      // Should NOT query for remediation tasks on non-synchronize events
      expect(codeTaskRepo.findRecentRemediationForPR).not.toHaveBeenCalled();
      expect(deps.createReviewTask).toHaveBeenCalled();
    });

    it('does not intercept issue_comment events', async () => {
      const codeTaskRepo = createRemediationCodeTaskRepo({
        status: 'reviewed',
        completedAt: new Date(),
        requiresReReview: false,
      });
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'Comment requested review.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-7', workerType: 'opus' })),
        codeTaskRepo: codeTaskRepo as CodeTaskRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({
        eventType: 'issue_comment',
        action: 'created',
      });

      await evaluator.evaluate(event, logger);

      expect(codeTaskRepo.findRecentRemediationForPR).not.toHaveBeenCalled();
      expect(deps.createReviewTask).toHaveBeenCalled();
    });

    it('proceeds with review when codeTaskRepo query fails', async () => {
      const codeTaskRepo: Partial<CodeTaskRepository> = {
        findRecentRemediationForPR: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'Connection failed' })),
      };
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'PR was updated.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(ok({ status: 'created', taskId: 'task-review-8', workerType: 'opus' })),
        codeTaskRepo: codeTaskRepo as CodeTaskRepository,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createSynchronizeEvent();

      await evaluator.evaluate(event, logger);

      // Fail open: review should proceed even when repo query fails
      expect(deps.createReviewTask).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1' }),
        expect.stringContaining('Failed to check remediation task'),
      );
    });
  });

  describe('onReviewSkipped callback', () => {
    it('calls onReviewSkipped when LLM triage skips', async () => {
      const onReviewSkipped = vi.fn().mockResolvedValue(undefined);
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'skip' as const, reason: 'Documentation-only change' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'Docs only.',
        })),
        onReviewSkipped,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ repository: 'pbuchman/intexuraos', pullRequestNumber: 42 });

      await evaluator.evaluate(event, logger);

      expect(onReviewSkipped).toHaveBeenCalledWith({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
      });
    });

    it('does not call onReviewSkipped when hard rules skip', async () => {
      const onReviewSkipped = vi.fn().mockResolvedValue(undefined);
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'skip', reason: 'PROTECTED_BASE_BRANCH' }),
        } as unknown as WebhookRulesService,
        onReviewSkipped,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      await evaluator.evaluate(event, logger);

      expect(onReviewSkipped).not.toHaveBeenCalled();
    });

    it('swallows onReviewSkipped errors', async () => {
      const onReviewSkipped = vi.fn().mockRejectedValue(new Error('boom'));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'skip' as const, reason: 'No code changes' },
          usage: { costUsd: 0.001, toolCalls: [] },
          reasoning: 'No code.',
        })),
        onReviewSkipped,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent();

      // Should not throw
      await evaluator.evaluate(event, logger);

      expect(onReviewSkipped).toHaveBeenCalled();
    });
  });
});
