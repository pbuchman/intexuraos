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

  describe('needs_triage with LLM', () => {
    it('dispatches issue_comment when LLM says dispatch', async () => {
      const deps = createFakeDeps({
        webhookRules: {
          evaluate: vi.fn().mockReturnValue({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }),
        } as unknown as WebhookRulesService,
        evaluateEvent: vi.fn().mockResolvedValue(ok({
          triage: { action: 'dispatch', template: 'pr_comment' },
          usage: { costUsd: 0.001, toolCalls: [] },
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
});
