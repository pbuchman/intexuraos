/**
 * Tests for UnifiedEvaluator service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { WebhookRulesService } from '../../../domain/services/gitHubWebhookRules.js';
import type { WebhookDispatchService } from '../../../domain/services/gitHubDispatchService.js';
import type { EventDecisionRepository } from '../../../domain/repositories/eventDecisionRepository.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import { createUnifiedEvaluator, buildTriageCommentBody, type UnifiedEvaluatorDeps } from '../../../domain/services/unifiedEvaluator.js';

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
        eventId: 'evt-1',
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
    evaluateEvent: vi.fn(),
    createReviewTask: vi.fn().mockResolvedValue(ok({ taskId: 'task-review-1' })),
    allowedBots: new Set(['claude[bot]']),
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
          decidedBy: 'hard_rules',
          decision: 'dispatch',
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
        createReviewTask: vi.fn().mockResolvedValue(ok({ taskId: 'task-review-1' })),
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
        createReviewTask: vi.fn().mockResolvedValue(ok({ taskId: 'task-review-2' })),
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
      const createReviewTask = vi.fn().mockResolvedValue(ok({ taskId: 'task-review-bot' }));
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
      const createReviewTask = vi.fn().mockResolvedValue(ok({ taskId: 'task-review-user' }));
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
      const event = createFakeEvent({ eventType: 'issue_comment' });

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

  describe('triage comment posting', () => {
    it('posts triage comment before creating review task', async () => {
      const callOrder: string[] = [];
      const postTriageComment = vi.fn().mockImplementation(() => {
        callOrder.push('postTriageComment');
        return Promise.resolve(ok({ commentId: 99 }));
      });
      const createReviewTask = vi.fn().mockImplementation(() => {
        callOrder.push('createReviewTask');
        return Promise.resolve(ok({ taskId: 'task-review-1' }));
      });
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [{ tool: 'request_review', args: { review_type: 'code_quality' } }] },
          reasoning: 'This PR modifies auth logic.',
        })),
        createReviewTask,
        postTriageComment,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(callOrder).toEqual(['postTriageComment', 'createReviewTask']);
    });

    it('comment body starts with @ignore and includes review types, cost, tool calls, and reasoning', async () => {
      const postTriageComment = vi.fn().mockResolvedValue(ok({ commentId: 99 }));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality', 'architecture'] },
          usage: {
            costUsd: 0.003,
            toolCalls: [
              { tool: 'request_review', args: { review_type: 'code_quality' } },
              { tool: 'request_review', args: { review_type: 'architecture' } },
            ],
          },
          reasoning: 'This PR modifies authentication logic across multiple services.',
        })),
        postTriageComment,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(postTriageComment).toHaveBeenCalledWith(
        'dev-user',
        'intexuraos/intexuraos',
        42,
        expect.stringContaining('code_quality')
      );
      const body = postTriageComment.mock.calls[0]?.[3] as string;
      expect(body).toMatch(/^@ignore\n/);
      expect(body).toContain('architecture');
      expect(body).toContain('$0.003');
      expect(body).toContain('request_review');
      expect(body).toContain('This PR modifies authentication logic');
    });

    it('continues dispatching when comment posting fails', async () => {
      const postTriageComment = vi.fn().mockResolvedValue(
        err({ code: 'UNAUTHORIZED', message: 'Bad token' })
      );
      const createReviewTask = vi.fn().mockResolvedValue(ok({ taskId: 'task-review-1' }));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'Review needed.',
        })),
        createReviewTask,
        postTriageComment,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1' }),
        expect.stringContaining('triage comment')
      );
      expect(createReviewTask).toHaveBeenCalled();
    });

    it('skips comment when postTriageComment is undefined', async () => {
      const createReviewTask = vi.fn().mockResolvedValue(ok({ taskId: 'task-review-1' }));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'Review needed.',
        })),
        createReviewTask,
        postTriageComment: undefined,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(createReviewTask).toHaveBeenCalled();
    });
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

  describe('error comment on review task failure', () => {
    it('posts error comment when createReviewTask fails', async () => {
      const postTriageComment = vi.fn().mockResolvedValue(ok({ commentId: 99 }));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'Review needed.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(
          err({ code: 'dispatch_failed' as const, message: 'Worker unavailable' })
        ),
        postTriageComment,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      // First call is triage comment, second is error comment
      expect(postTriageComment).toHaveBeenCalledTimes(2);
      const errorCommentBody = postTriageComment.mock.calls[1]?.[3] as string;
      expect(errorCommentBody).toContain('@ignore');
      expect(errorCommentBody).toContain('Automated Code Review Triage Decision');
      expect(errorCommentBody).toContain('Review task creation failed');
      expect(errorCommentBody).toContain('dispatch_failed');
      expect(errorCommentBody).not.toContain('Worker unavailable');
    });

    it('does not post error comment when postTriageComment is undefined', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'Review needed.',
        })),
        createReviewTask: vi.fn().mockResolvedValue(
          err({ code: 'dispatch_failed' as const, message: 'Worker unavailable' })
        ),
        postTriageComment: undefined,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      // Should not throw
      await evaluator.evaluate(event, logger);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1' }),
        'Failed to create review task'
      );
    });
  });

  describe('triage comment error resilience', () => {
    it('continues dispatching when postTriageComment throws an exception', async () => {
      const postTriageComment = vi.fn().mockRejectedValue(new Error('Network timeout'));
      const createReviewTask = vi.fn().mockResolvedValue(ok({ taskId: 'task-review-1' }));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'Review needed.',
        })),
        createReviewTask,
        postTriageComment,
      });
      const evaluator = createUnifiedEvaluator(deps);
      const event = createFakeEvent({ eventType: 'pull_request', action: 'opened' });

      await evaluator.evaluate(event, logger);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1' }),
        expect.stringContaining('Unexpected error')
      );
      expect(createReviewTask).toHaveBeenCalled();
    });

    it('remaps bot login to repo owner for triage comment', async () => {
      const postTriageComment = vi.fn().mockResolvedValue(ok({ commentId: 99 }));
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'request_review', reviewTypes: ['code_quality'] },
          usage: { costUsd: 0.002, toolCalls: [] },
          reasoning: 'Review needed.',
        })),
        postTriageComment,
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

      expect(postTriageComment).toHaveBeenCalledWith(
        'pbuchman',
        'pbuchman/intexuraos',
        42,
        expect.any(String)
      );
    });
  });
});

describe('buildTriageCommentBody', () => {
  it('starts with @ignore prefix and renamed heading', () => {
    const body = buildTriageCommentBody(
      ['code_quality'],
      0.001,
      [{ tool: 'request_review', args: { review_type: 'code_quality' } }],
      'Review needed.',
    );

    expect(body).toMatch(/^@ignore\n/);
    expect(body).toContain('### Automated Code Review Triage Decision');
    expect(body).not.toMatch(/^### Triage Decision$/m);
  });

  it('formats review types, cost, tool calls, and reasoning', () => {
    const body = buildTriageCommentBody(
      ['code_quality', 'architecture'],
      0.003,
      [
        { tool: 'request_review', args: { review_type: 'code_quality' } },
        { tool: 'request_review', args: { review_type: 'architecture' } },
      ],
      'This PR modifies auth logic.',
    );

    expect(body).toContain('### Automated Code Review Triage Decision');
    expect(body).toContain('`code_quality`');
    expect(body).toContain('`architecture`');
    expect(body).toContain('$0.003');
    expect(body).toContain('request_review');
    expect(body).toContain('> This PR modifies auth logic.');
  });

  it('handles multi-line reasoning with proper blockquote', () => {
    const body = buildTriageCommentBody(
      ['code_quality'],
      0.001,
      [],
      'Line one.\nLine two.\nLine three.',
    );

    expect(body).toContain('> Line one.');
    expect(body).toContain('> Line two.');
    expect(body).toContain('> Line three.');
  });

  it('handles empty tool calls array', () => {
    const body = buildTriageCommentBody(
      ['security'],
      0.001,
      [],
      'Needs security review.',
    );

    expect(body).toContain('**Tool calls:**');
    expect(body).toContain('`security`');
  });

  it('handles single review type without comma', () => {
    const body = buildTriageCommentBody(
      ['code_quality'],
      0.002,
      [{ tool: 'request_review', args: { review_type: 'code_quality' } }],
      'Single review.',
    );

    expect(body).toContain('`code_quality`');
    expect(body).not.toContain(',');
  });

  it('deduplicates identical tool calls', () => {
    const body = buildTriageCommentBody(
      ['code_quality'],
      0.002,
      [
        { tool: 'request_review', args: { review_type: 'code_quality' } },
        { tool: 'request_review', args: { review_type: 'code_quality' } },
        { tool: 'request_review', args: { review_type: 'code_quality' } },
        { tool: 'request_review', args: { review_type: 'code_quality' } },
        { tool: 'request_review', args: { review_type: 'code_quality' } },
      ],
      'Review needed.',
    );

    const toolCallMatches = body.match(/`request_review\(/g);
    expect(toolCallMatches).toHaveLength(1);
  });

  it('keeps distinct tool calls when deduplicating', () => {
    const body = buildTriageCommentBody(
      ['code_quality', 'security'],
      0.002,
      [
        { tool: 'request_review', args: { review_type: 'code_quality' } },
        { tool: 'request_review', args: { review_type: 'security' } },
        { tool: 'request_review', args: { review_type: 'code_quality' } },
      ],
      'Review needed.',
    );

    const toolCallMatches = body.match(/`request_review\(/g);
    expect(toolCallMatches).toHaveLength(2);
  });
});
