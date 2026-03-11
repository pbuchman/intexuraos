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
import { resolveLoginForTaskCreation } from './gitHubDispatchService.js';
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
  postTriageComment?: ((
    senderLogin: string,
    repository: string,
    prNumber: number,
    body: string,
  ) => Promise<Result<{ commentId: number }, { code: string; message: string }>>) | undefined;
  allowedBots: Set<string>;
}

export interface UnifiedEvaluator {
  evaluate(event: GitHubPREvent, logger: Logger): Promise<void>;
}

export function buildTriageCommentBody(
  reviewTypes: string[],
  costUsd: number,
  toolCalls: { tool: string; args: Record<string, unknown> }[],
  reasoning: string,
): string {
  const reviewTypesStr = reviewTypes.map((t) => `\`${t}\``).join(', ');

  // Deduplicate identical tool calls
  const seen = new Set<string>();
  const uniqueToolCalls = toolCalls.filter((tc) => {
    const key = `${tc.tool}:${JSON.stringify(tc.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const toolCallLines = uniqueToolCalls
    .map((tc) => `- \`${tc.tool}(${JSON.stringify(tc.args)})\``)
    .join('\n');
  const costStr = `$${String(costUsd)}`;

  return [
    '@ignore',
    '### Automated Code Review Triage Decision',
    '',
    '**Action:** Dispatching review',
    `**Review types:** ${reviewTypesStr}`,
    `**Cost:** ${costStr}`,
    '',
    '**Tool calls:**',
    toolCallLines,
    '',
    '**Reasoning:**',
    reasoning.split('\n').map((line) => `> ${line}`).join('\n'),
  ].join('\n');
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
        }, startTime, logger);
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

      const { triage, usage, reasoning } = llmResult.value; // @allow-result-access -- narrowed by !llmResult.ok

      if (triage.action === 'dispatch') {
        const llmDispatchResult = await deps.dispatchService.dispatch({
          event,
          decision: { action: 'dispatch', reason: 'LLM_DISPATCH' },
          logger,
        });
        if (!llmDispatchResult.success) {
          logger.warn({ eventId: event.id, error: llmDispatchResult.error }, 'Dispatch failed for LLM decision');
        }
        await recordDecision(deps, event, {
          decidedBy: 'github_agent',
          decision: 'dispatch',
          reason: `LLM dispatch: ${triage.template}`,
          llmCostUsd: usage.costUsd,
          /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes compliance @preserve */
          ...(usage.model !== undefined && { llmModel: usage.model }),
          /* v8 ignore stop @preserve */
          llmToolCalls: usage.toolCalls,
          llmReasoning: reasoning,
          dispatchSuccess: llmDispatchResult.success,
          ...(llmDispatchResult.error !== undefined && { dispatchError: llmDispatchResult.error }),
        }, startTime, logger);
        return;
      }

      if (triage.action === 'request_review') {
        // Post informational triage comment (non-fatal — must not block review task creation)
        if (deps.postTriageComment !== undefined) {
          try {
            const commentBody = buildTriageCommentBody(triage.reviewTypes, usage.costUsd, usage.toolCalls, reasoning);
            const commentResult = await deps.postTriageComment(
              resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
              event.repository,
              event.pullRequestNumber,
              commentBody,
            );
            if (!commentResult.ok) {
              logger.warn(
                { eventId: event.id, error: commentResult.error },
                'Failed to post triage comment, continuing with review task creation'
              );
            }
          } catch (commentError: unknown) {
            logger.warn(
              { eventId: event.id, error: commentError },
              'Unexpected error posting triage comment, continuing with review task creation'
            );
          }
        }

        const reviewResult = await deps.createReviewTask(
          logger,
          {
            repository: event.repository,
            prNumber: event.pullRequestNumber,
            senderLogin: resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
            reviewTypes: triage.reviewTypes,
            eventId: event.id,
            ...(event.title !== null && { prTitle: event.title }),
            ...(event.body !== null && { prBody: event.body }),
            /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes compliance @preserve */
            ...(event.baseBranch !== null && { baseBranch: event.baseBranch }),
            /* v8 ignore stop @preserve */
          },
        );

        if (!reviewResult.ok) {
          logger.error(
            { eventId: event.id, error: reviewResult.error },
            'Failed to create review task'
          );

          // Post error comment (best-effort)
          if (deps.postTriageComment !== undefined) {
            try {
              const errorBody = [
                '@ignore',
                '### Automated Code Review Triage Decision',
                '',
                '**Action:** Review task creation failed',
                `**Error code:** ${reviewResult.error.code}`,
                '',
                'The triage agent decided to request a review but the review task could not be created.',
              ].join('\n');
              await deps.postTriageComment(
                resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
                event.repository,
                event.pullRequestNumber,
                errorBody,
              );
            } catch (commentError: unknown) {
              logger.warn(
                { eventId: event.id, error: commentError },
                'Failed to post error comment for review task failure (best-effort)'
              );
            }
          }

          await recordDecision(deps, event, {
            decidedBy: 'github_agent',
            decision: 'skip',
            reason: `review_task_failed: ${reviewResult.error.message}`,
            llmCostUsd: usage.costUsd,
            /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes compliance @preserve */
            ...(usage.model !== undefined && { llmModel: usage.model }),
            /* v8 ignore stop @preserve */
            llmToolCalls: usage.toolCalls,
            llmReasoning: reasoning,
          }, startTime, logger);
          return;
        }

        await recordDecision(deps, event, {
          decidedBy: 'github_agent',
          decision: 'request_review',
          reason: `LLM request_review: ${triage.reviewTypes.join(', ')}`,
          dispatchAction: 'create_review_task',
          dispatchParams: { taskId: reviewResult.value.taskId, reviewTypes: triage.reviewTypes }, // @allow-result-access -- narrowed by !reviewResult.ok above
          llmCostUsd: usage.costUsd,
          /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes compliance @preserve */
          ...(usage.model !== undefined && { llmModel: usage.model }),
          /* v8 ignore stop @preserve */
          llmToolCalls: usage.toolCalls,
          llmReasoning: reasoning,
        }, startTime, logger);
        return;
      }

      // triage.action === 'skip'
      await recordDecision(deps, event, {
        decidedBy: 'github_agent',
        decision: 'skip',
        reason: `LLM skip: ${triage.reason}`,
        llmCostUsd: usage.costUsd,
        /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes compliance @preserve */
        ...(usage.model !== undefined && { llmModel: usage.model }),
        /* v8 ignore stop @preserve */
        llmToolCalls: usage.toolCalls,
        llmReasoning: reasoning,
      }, startTime, logger);
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
  const result = await deps.dispatchService.dispatch({ event, decision, logger });
  if (!result.success) {
    logger.warn({ eventId: event.id, error: result.error }, 'Dispatch failed for hard-rule decision');
  }
  await recordDecision(deps, event, {
    decidedBy: 'hard_rules',
    decision: 'dispatch',
    reason: decision.reason,
    dispatchSuccess: result.success,
    ...(result.error !== undefined && { dispatchError: result.error }),
  }, startTime, logger);
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
    const fallbackResult = await deps.dispatchService.dispatch({
      event,
      decision: { action: 'dispatch', reason: `FALLBACK_DISPATCH: ${reason}` },
      logger,
    });
    if (!fallbackResult.success) {
      logger.warn({ eventId: event.id, error: fallbackResult.error }, 'Dispatch failed for fallback decision');
    }
    await recordDecision(deps, event, {
      decidedBy: 'hard_rules',
      decision: 'dispatch',
      reason: `fallback_dispatch: ${reason}`,
      dispatchSuccess: fallbackResult.success,
      ...(fallbackResult.error !== undefined && { dispatchError: fallbackResult.error }),
    }, startTime, logger);
  } else {
    await recordDecision(deps, event, {
      decidedBy: 'hard_rules',
      decision: 'skip',
      reason: `fallback_skip: ${reason}`,
    }, startTime, logger);
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
    dispatchParams?: { taskId?: string; reviewTypes?: string[] };
    llmCostUsd?: number;
    llmModel?: string;
    llmToolCalls?: { tool: string; args: Record<string, unknown> }[];
    llmReasoning?: string;
    dispatchSuccess?: boolean;
    dispatchError?: string;
  },
  startTime: number,
  logger: Logger,
): Promise<void> {
  const input: CreateEventDecisionInput = {
    eventId: event.id,
    repository: event.repository,
    pullRequestNumber: event.pullRequestNumber,
    eventType: event.eventType,
    /* v8 ignore start -- ts-type: null coalescing for GitHubPRAction | null @preserve */
    eventAction: event.action ?? 'unknown',
    /* v8 ignore stop @preserve */
    senderLogin: event.senderLogin,
    decidedBy: fields.decidedBy,
    decision: fields.decision,
    reason: fields.reason,
    ...(fields.dispatchAction !== undefined && { dispatchAction: fields.dispatchAction }),
    ...(fields.dispatchParams !== undefined && { dispatchParams: fields.dispatchParams }),
    ...(fields.llmCostUsd !== undefined && { llmCostUsd: fields.llmCostUsd }),
    /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes compliance @preserve */
    ...(fields.llmModel !== undefined && { llmModel: fields.llmModel }),
    /* v8 ignore stop @preserve */
    ...(fields.llmToolCalls !== undefined && { llmToolCalls: fields.llmToolCalls }),
    ...(fields.llmReasoning !== undefined && { llmReasoning: fields.llmReasoning }),
    ...(fields.dispatchSuccess !== undefined && { dispatchSuccess: fields.dispatchSuccess }),
    ...(fields.dispatchError !== undefined && { dispatchError: fields.dispatchError }),
    decisionLatencyMs: Date.now() - startTime,
  };

  try {
    await deps.eventDecisionRepo.save(input);
  } catch (saveError) {
    logger.error(
      { eventId: event.id, error: saveError },
      'Failed to save event decision audit record'
    );
  }
}
