/**
 * UnifiedEvaluator service.
 *
 * Single entry point for webhook event evaluation:
 * 1. Hard rules (deterministic) → dispatch / skip / needs_triage
 * 2. LLM triage (if needs_triage) → dispatch / skip / request_review
 * 3. Audit trail via EventDecision
 */

import type { Logger, Result } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { CreateEventDecisionInput } from '../models/eventDecision.js';
import type { WebhookRulesService, RuleOutcome } from './gitHubWebhookRules.js';
import type { WebhookDispatchService } from './gitHubDispatchService.js';
import type { EventDecisionRepository } from '../repositories/eventDecisionRepository.js';
import type { GitHubAgentEvalResult, GitHubAgentError } from '../usecases/githubAgent.js';
import type { CreateReviewTaskRequest, CreateReviewTaskError } from '../usecases/createReviewTask.js';

export interface UnifiedEvaluatorDeps {
  webhookRules: WebhookRulesService;
  dispatchService: WebhookDispatchService;
  eventDecisionRepo: EventDecisionRepository;
  evaluateEvent?: ((event: GitHubPREvent) => Promise<Result<GitHubAgentEvalResult, GitHubAgentError>>) | undefined;
  /** Pre-bound review task creator. Logger is injected at call time; all other deps are closed over at wiring. */
  createReviewTask: (logger: Logger, request: CreateReviewTaskRequest) => Promise<Result<{ taskId: string }, CreateReviewTaskError>>;
  allowedBots: Set<string>;
}

export interface UnifiedEvaluator {
  evaluate(event: GitHubPREvent, logger: Logger): Promise<void>;
}

export function createUnifiedEvaluator(deps: UnifiedEvaluatorDeps): UnifiedEvaluator {
  return {
    async evaluate(event: GitHubPREvent, logger: Logger): Promise<void> {
      const startTime = Date.now();

      // Step 1: Hard rules
      const ruleOutcome = deps.webhookRules.evaluate(event);

      logger.info(
        { eventId: event.id, action: ruleOutcome.action, reason: ruleOutcome.reason },
        'Hard rules evaluated'
      );

      if (ruleOutcome.action === 'dispatch') {
        await dispatchAndRecord(deps, event, ruleOutcome, startTime, logger);
        return;
      }

      if (ruleOutcome.action === 'skip') {
        await recordDecision(deps, event, {
          decidedBy: 'hard_rules',
          decision: 'skip',
          reason: ruleOutcome.reason,
        }, startTime);
        return;
      }

      // Step 2: needs_triage → LLM
      if (deps.evaluateEvent === undefined) {
        logger.warn({ eventId: event.id }, 'No LLM configured for triage, using fallback');
        await handleFallback(deps, event, 'no_llm_configured', startTime, logger);
        return;
      }

      const llmResult = await deps.evaluateEvent(event);

      if (!llmResult.ok) {
        logger.warn(
          { eventId: event.id, error: llmResult.error },
          'LLM triage failed, using fallback'
        );
        await handleFallback(deps, event, llmResult.error.message, startTime, logger);
        return;
      }

      const { triage, usage } = llmResult.value; // @allow-result-access -- narrowed by !llmResult.ok

      if (triage.action === 'dispatch') {
        await deps.dispatchService.dispatch({
          event,
          decision: { action: 'dispatch', reason: 'LLM_DISPATCH' },
          logger,
        });
        await recordDecision(deps, event, {
          decidedBy: 'github_agent',
          decision: 'dispatch',
          reason: `LLM dispatch: ${triage.template}`,
          llmCostUsd: usage.costUsd,
          ...(usage.model !== undefined && { llmModel: usage.model }),
          llmToolCalls: usage.toolCalls,
        }, startTime);
        return;
      }

      if (triage.action === 'request_review') {
        await recordDecision(deps, event, {
          decidedBy: 'github_agent',
          decision: 'request_review',
          reason: `LLM request_review: ${triage.reviewTypes.join(', ')}`,
          dispatchAction: 'create_review_task',
          llmCostUsd: usage.costUsd,
          ...(usage.model !== undefined && { llmModel: usage.model }),
          llmToolCalls: usage.toolCalls,
        }, startTime);

        const reviewResult = await deps.createReviewTask(
          logger,
          {
            repository: event.repository,
            prNumber: event.pullRequestNumber,
            senderLogin: event.senderLogin,
            reviewTypes: triage.reviewTypes,
            eventId: event.id,
            ...(event.title !== null && { prTitle: event.title }),
          },
        );

        if (!reviewResult.ok) {
          logger.error(
            { eventId: event.id, error: reviewResult.error },
            'Failed to create review task'
          );
        }
        return;
      }

      // triage.action === 'skip'
      await recordDecision(deps, event, {
        decidedBy: 'github_agent',
        decision: 'skip',
        reason: `LLM skip: ${triage.reason}`,
        llmCostUsd: usage.costUsd,
        ...(usage.model !== undefined && { llmModel: usage.model }),
        llmToolCalls: usage.toolCalls,
      }, startTime);
    },
  };
}

async function dispatchAndRecord(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  decision: Extract<RuleOutcome, { action: 'dispatch' }>,
  startTime: number,
  logger: Logger,
): Promise<void> {
  await deps.dispatchService.dispatch({ event, decision, logger });
  await recordDecision(deps, event, {
    decidedBy: 'hard_rules',
    decision: 'dispatch',
    reason: decision.reason,
  }, startTime);
}

/**
 * Event-type-aware fallback when LLM is unavailable or fails.
 * - issue_comment → dispatch (don't miss human requests)
 * - pull_request → skip (don't waste review costs)
 */
async function handleFallback(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  reason: string,
  startTime: number,
  logger: Logger,
): Promise<void> {
  if (event.eventType === 'issue_comment' || event.eventType === 'pull_request_review' || event.eventType === 'pull_request_review_comment') {
    logger.warn({ eventId: event.id }, 'Fallback: dispatching comment event');
    await deps.dispatchService.dispatch({
      event,
      decision: { action: 'dispatch', reason: `FALLBACK_DISPATCH: ${reason}` },
      logger,
    });
    await recordDecision(deps, event, {
      decidedBy: 'hard_rules',
      decision: 'dispatch',
      reason: `fallback_dispatch: ${reason}`,
    }, startTime);
  } else {
    await recordDecision(deps, event, {
      decidedBy: 'hard_rules',
      decision: 'skip',
      reason: `fallback_skip: ${reason}`,
    }, startTime);
  }
}

async function recordDecision(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  fields: {
    decidedBy: 'hard_rules' | 'github_agent';
    decision: 'dispatch' | 'skip' | 'request_review';
    reason: string;
    dispatchAction?: 'create_task' | 'send_message' | 'create_review_task';
    llmCostUsd?: number;
    llmModel?: string;
    llmToolCalls?: { tool: string; args: Record<string, unknown> }[];
  },
  startTime: number,
): Promise<void> {
  const input: CreateEventDecisionInput = {
    eventId: event.id,
    repository: event.repository,
    pullRequestNumber: event.pullRequestNumber,
    eventType: event.eventType,
    eventAction: event.action ?? 'unknown',
    senderLogin: event.senderLogin,
    decidedBy: fields.decidedBy,
    decision: fields.decision,
    reason: fields.reason,
    ...(fields.dispatchAction !== undefined && { dispatchAction: fields.dispatchAction }),
    ...(fields.llmCostUsd !== undefined && { llmCostUsd: fields.llmCostUsd }),
    ...(fields.llmModel !== undefined && { llmModel: fields.llmModel }),
    ...(fields.llmToolCalls !== undefined && { llmToolCalls: fields.llmToolCalls }),
    decisionLatencyMs: Date.now() - startTime,
  };

  await deps.eventDecisionRepo.save(input);
}
