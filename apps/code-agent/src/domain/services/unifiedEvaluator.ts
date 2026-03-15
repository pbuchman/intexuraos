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
import type { EventDecisionReviewType } from '../models/eventDecision.js';
import type { WebhookRulesService, RuleOutcome } from './gitHubWebhookRules.js';
import type { WebhookDispatchService } from './gitHubDispatchService.js';
import { resolveLoginForTaskCreation } from './gitHubDispatchService.js';
import type { EventDecisionRepository } from '../repositories/eventDecisionRepository.js';
import type { GitHubAgentEvalResult, GitHubAgentError } from '../usecases/githubAgent.js';
import type {
  CreateReviewTaskRequest,
  CreateReviewTaskError,
  CreateReviewTaskResult,
} from '../usecases/createReviewTask.js';
import { isReviewCommandComment, extractReviewWorkerType } from '../utils/reviewTriage.js';
import type { WorkerType } from '../models/codeTask.js';
import type { GitHubEventLogEntryRepository } from '../repositories/gitHubEventLogEntryRepository.js';
import type { AutomationLog } from '../ports/automationLog.js';

export interface UnifiedEvaluatorDeps {
  webhookRules: WebhookRulesService;
  dispatchService: WebhookDispatchService;
  eventDecisionRepo: EventDecisionRepository;
  gitHubEventLogEntryRepo?: GitHubEventLogEntryRepository;
  evaluateEvent?: ((event: GitHubPREvent) => Promise<Result<GitHubAgentEvalResult, GitHubAgentError>>) | undefined;
  /** Pre-bound review task creator. Logger is injected at call time; all other deps are closed over at wiring. */
  createReviewTask: (logger: Logger, request: CreateReviewTaskRequest) => Promise<Result<CreateReviewTaskResult, CreateReviewTaskError>>;
  postTriageComment?: ((
    senderLogin: string,
    repository: string,
    prNumber: number,
    body: string,
  ) => Promise<Result<{ commentId: number }, { code: string; message: string }>>) | undefined;
  automationLog: AutomationLog;
  /** Resolve a GitHub login to a platform userId for OAuth token lookup. */
  resolveTokenUserId?: ((senderLogin: string) => Promise<string | undefined>) | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
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
  options?: { workerType?: string; taskId?: string },
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
  const workerTypeLine = options?.workerType !== undefined
    ? `**Worker type:** \`${options.workerType}\``
    : null;

  return [
    '@ignore',
    '### Automated Code Review Triage Decision',
    '',
    '**Action:** Dispatching review',
    `**Review types:** ${reviewTypesStr}`,
    ...(workerTypeLine !== null ? [workerTypeLine] : []),
    `**Cost:** ${costStr}`,
    '',
    '**Tool calls:**',
    toolCallLines === '' ? '- None' : toolCallLines,
    '',
    '**Reasoning:**',
    reasoning.split('\n').map((line) => `> ${line}`).join('\n'),
    ...(options?.taskId !== undefined ? [
      '',
      `**Task ID:** \`${options.taskId}\``,
      `[View in IntexuraOS](https://intexuraos.cloud/#/code-tasks/${options.taskId})`,
    ] : []),
  ].join('\n');
}

export function buildSkipCommentBody(
  reason: string,
  costUsd: number,
  toolCalls: { tool: string; args: Record<string, unknown> }[],
  reasoning: string,
): string {
  const costStr = `$${String(costUsd)}`;

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

  return [
    '@ignore',
    '### Automated Code Review Triage Decision',
    '',
    '**Action:** Skipped (no review needed)',
    `**Reason:** ${reason}`,
    `**Cost:** ${costStr}`,
    '',
    '**Tool calls:**',
    toolCallLines === '' ? '- None' : toolCallLines,
    '',
    '**Reasoning:**',
    reasoning.split('\n').map((line) => `> ${line}`).join('\n'),
  ].join('\n');
}

export function createUnifiedEvaluator(deps: UnifiedEvaluatorDeps): UnifiedEvaluator {
  const prRef = (event: GitHubPREvent): { repository: string; prNumber: number } => ({ repository: event.repository, prNumber: event.pullRequestNumber });

  /** Best-effort automation log recording. Never throws. */
  const recordLog = (event: GitHubPREvent, automationEvent: Parameters<AutomationLog['record']>[1], userId?: string): void => {
    void deps.automationLog.record(prRef(event), automationEvent, userId).catch((recordErr: unknown) => {
      // Fire-and-forget — automation log failures must not affect webhook processing
      void recordErr;
    });
  };

  /** Resolve senderLogin → platform userId for OAuth token lookup. Best-effort; returns undefined on failure. */
  const resolveUserId = async (event: GitHubPREvent): Promise<string | undefined> => {
    if (deps.resolveTokenUserId === undefined) return undefined;
    try {
      const login = resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots);
      return await deps.resolveTokenUserId(login);
    } catch {
      return undefined;
    }
  };

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
        // Record automation log: hard_rules skip
        const userId = await resolveUserId(event);
        recordLog(event, {
          type: 'skipped',
          decidedBy: 'hard_rules',
          reason: ruleOutcome.reason,
          ruleName: ruleOutcome.reason,
        }, userId);

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
        await handleFallback(deps, event, 'no_llm_configured', startTime, logger, recordLog, resolveUserId);
        return;
      }

      const llmResult = await deps.evaluateEvent(event);

      if (!llmResult.ok) {
        logger.warn(
          { eventId: event.id, error: llmResult.error },
          'LLM triage failed'
        );

        // Fail closed for explicit @review commands - do not fallback dispatch
        if (event.eventType === 'issue_comment' && isReviewCommandComment(event.body ?? '')) {
          /* v8 ignore start -- ts-type: defensive null coalescing, body is truthy when isReviewCommandComment passes @preserve */
          const workerType = extractReviewWorkerType(event.body ?? '');
          /* v8 ignore stop @preserve */

          // Record automation log: triage_failed for @review
          const userId = await resolveUserId(event);
          recordLog(event, {
            type: 'triage_failed',
            error: llmResult.error.message,
            fallbackAction: 'skip',
          }, userId);

          await handleReviewTriageFailure(deps, event, llmResult.error.message, workerType, startTime, logger);
          return;
        }

        await handleFallback(deps, event, llmResult.error.message, startTime, logger, recordLog, resolveUserId);
        return;
      }

      const { triage, usage, reasoning } = llmResult.value; // @allow-result-access -- narrowed by !llmResult.ok
      const toolCallSummaries = deduplicateToolCalls(usage.toolCalls);

      if (triage.action === 'dispatch') {
        const llmDispatchResult = await deps.dispatchService.dispatch({
          event,
          decision: { action: 'dispatch', reason: 'LLM_DISPATCH' },
          logger,
        });
        if (!llmDispatchResult.success) {
          logger.warn({ eventId: event.id, error: llmDispatchResult.error }, 'Dispatch failed for LLM decision');
        }

        // Record automation log: triage_dispatch (LLM dispatch)
        const userId = await resolveUserId(event);
        recordLog(event, {
          type: 'triage_dispatch',
          cost: usage.costUsd,
          reasoning,
          toolCalls: toolCallSummaries,
        }, userId);

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
        const reviewResult = await deps.createReviewTask(
          logger,
          {
            repository: event.repository,
            prNumber: event.pullRequestNumber,
            senderLogin: resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
            reviewTypes: triage.reviewTypes,
            ...(triage.workerType !== undefined && { workerType: triage.workerType }),
            eventId: event.id,
            ...(event.title !== null && { prTitle: event.title }),
            ...(event.eventType === 'pull_request' && event.body !== null && { prBody: event.body }),
            ...(event.eventType === 'issue_comment' && event.body !== null && { reviewComment: event.body }),
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

          // Record automation log: triage_failed for review task creation failure
          const userId = await resolveUserId(event);
          recordLog(event, {
            type: 'triage_failed',
            error: `review_task_failed: ${reviewResult.error.message}`,
            fallbackAction: 'skip',
          }, userId);

          // Post error comment (best-effort)
          if (deps.postTriageComment !== undefined) {
            try {
              const errorBody = [
                '@ignore',
                '### Automated Code Review Triage Decision',
                '',
                '**Action:** Review task creation failed',
                `**Error code:** ${reviewResult.error.code}`,
                ...(reviewResult.error.taskId !== undefined
                  ? [`**Task ID:** \`${reviewResult.error.taskId}\``]
                  : []),
                '',
                'The triage agent decided to request a review but the review task could not be created.',
                '**Status:** Task was NOT queued. Review is not currently in progress.',
                '',
                ...(reviewResult.error.taskId !== undefined
                  ? [`[View in IntexuraOS](https://intexuraos.cloud/#/code-tasks/${reviewResult.error.taskId})`]
                  : []),
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

        // Record automation log: triage_dispatch for review
        const userId = await resolveUserId(event);
        recordLog(event, {
          type: 'triage_dispatch',
          reviewTypes: triage.reviewTypes,
          workerType: reviewResult.value.workerType, // @allow-result-access -- narrowed by !reviewResult.ok above
          cost: usage.costUsd,
          reasoning,
          toolCalls: toolCallSummaries,
        }, userId);

        await postReviewTriageComment(
          deps,
          event,
          logger,
          buildTriageCommentBody(
            triage.reviewTypes,
            usage.costUsd,
            usage.toolCalls,
            reasoning,
            { workerType: reviewResult.value.workerType, taskId: reviewResult.value.taskId }, // @allow-result-access -- narrowed by !reviewResult.ok above
          ),
        );

        await recordDecision(deps, event, {
          decidedBy: 'github_agent',
          decision: 'request_review',
          reason: `LLM request_review: ${triage.reviewTypes.join(', ')}`,
          dispatchAction: 'create_review_task',
          dispatchParams: {
            taskId: reviewResult.value.taskId,
            reviewTypes: triage.reviewTypes as EventDecisionReviewType[],
            workerType: reviewResult.value.workerType,
          }, // @allow-result-access -- narrowed by !reviewResult.ok above
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

      // Record automation log: llm_triage skip
      const userId = await resolveUserId(event);
      recordLog(event, {
        type: 'skipped',
        decidedBy: 'llm_triage',
        reason: triage.reason,
        cost: usage.costUsd,
        reasoning,
        toolCalls: toolCallSummaries,
      }, userId);

      // Post skip comment to PR (pull_request events only)
      if (event.eventType === 'pull_request' && deps.postTriageComment !== undefined) {
        try {
          const skipBody = buildSkipCommentBody(triage.reason, usage.costUsd, usage.toolCalls, reasoning);
          await deps.postTriageComment(
            resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
            event.repository,
            event.pullRequestNumber,
            skipBody,
          );
        } catch (commentError: unknown) {
          logger.warn({ eventId: event.id, error: commentError }, 'Failed to post skip comment');
        }
      }

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

async function postReviewTriageComment(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  logger: Logger,
  body: string,
): Promise<void> {
  if (deps.postTriageComment === undefined) {
    return;
  }

  try {
    const commentResult = await deps.postTriageComment(
      resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
      event.repository,
      event.pullRequestNumber,
      body,
    );
    if (!commentResult.ok) {
      logger.warn(
        { eventId: event.id, error: commentResult.error },
        'Failed to post triage comment'
      );
    }
  } catch (commentError: unknown) {
    logger.warn(
      { eventId: event.id, error: commentError },
      'Unexpected error posting triage comment'
    );
  }
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
  recordLog: (event: GitHubPREvent, automationEvent: Parameters<AutomationLog['record']>[1], userId?: string) => void,
  resolveUserId: (event: GitHubPREvent) => Promise<string | undefined>,
): Promise<void> {
  if (event.eventType === 'issue_comment' || event.eventType === 'pull_request_review' || event.eventType === 'pull_request_review_comment') {
    logger.warn({ eventId: event.id }, 'Fallback: dispatching comment event');

    // Record automation log: triage_failed with fallback dispatch
    const userId = await resolveUserId(event);
    recordLog(event, {
      type: 'triage_failed',
      error: reason,
      fallbackAction: 'dispatch',
    }, userId);

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
    // Record automation log: triage_failed with fallback skip
    const userId = await resolveUserId(event);
    recordLog(event, {
      type: 'triage_failed',
      error: reason,
      fallbackAction: 'skip',
    }, userId);

    await recordDecision(deps, event, {
      decidedBy: 'hard_rules',
      decision: 'skip',
      reason: `fallback_skip: ${reason}`,
    }, startTime, logger);
  }
}

/**
 * Fail-closed handling for explicit @review triage failures.
 * Posts a failure comment and records a skip decision - does NOT fallback dispatch.
 */
async function handleReviewTriageFailure(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  errorMessage: string,
  workerType: WorkerType | undefined, // @allow-undefined-type -- function parameter, not optional property
  startTime: number,
  logger: Logger,
): Promise<void> {
  // Post failure comment (best-effort)
  if (deps.postTriageComment !== undefined) {
    try {
      const lines = [
        '@ignore',
        '### Automated Code Review Triage Decision',
        '',
        '**Action:** Review triage failed',
        `**Error:** ${errorMessage}`,
      ];

      if (workerType !== undefined) {
        lines.push(`**Worker type:** \`${workerType}\``);
      }

      lines.push('', 'The review request could not be processed. Please try again.');

      await deps.postTriageComment(
        resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots),
        event.repository,
        event.pullRequestNumber,
        lines.join('\n'),
      );
    } catch (commentError: unknown) {
      logger.warn(
        { eventId: event.id, error: commentError },
        'Failed to post review triage failure comment (best-effort)'
      );
    }
  }

  await recordDecision(deps, event, {
    decidedBy: 'github_agent',
    decision: 'skip',
    reason: `review_triage_failed: ${errorMessage}`,
    ...(workerType !== undefined && { dispatchParams: { workerType } }),
  }, startTime, logger);
}

async function recordDecision(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  fields: {
    decidedBy: 'hard_rules' | 'github_agent';
    decision: 'dispatch' | 'skip' | 'request_review';
    reason: string;
    dispatchAction?: 'create_task' | 'send_message' | 'create_review_task';
    dispatchParams?: CreateEventDecisionInput['dispatchParams'];
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
  const eventId = event.auditEventId ?? event.id;
  const input: CreateEventDecisionInput = {
    eventId,
    ...(event.auditEventId !== undefined && { normalizedEventId: event.id }),
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
    const decisionResult = await deps.eventDecisionRepo.save(input);
    if (!decisionResult.ok) {
      logger.error(
        { eventId: event.id, auditEventId: event.auditEventId, error: decisionResult.error },
        'Failed to save event decision audit record'
      );
      return;
    }

    if (event.auditEventId !== undefined && deps.gitHubEventLogEntryRepo !== undefined) {
      const completeResult = await deps.gitHubEventLogEntryRepo.complete({
        id: event.auditEventId,
        decisionId: decisionResult.value.id,
        decisionState: 'completed',
        decisionOutcome: fields.decision,
        updatedAt: new Date(),
        rowVersion: 2,
      });

      if (!completeResult.ok) {
        logger.error(
          { eventId: event.id, auditEventId: event.auditEventId, error: completeResult.error },
          'Failed to complete GitHub event log entry'
        );
      }
    }
  } catch (saveError) {
    logger.error(
      { eventId: event.id, error: saveError },
      'Failed to save event decision audit record'
    );
  }
}

/** Deduplicate tool calls into string summaries for automation log events. */
function deduplicateToolCalls(toolCalls: { tool: string; args: Record<string, unknown> }[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tc of toolCalls) {
    const key = `${tc.tool}(${JSON.stringify(tc.args)})`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}
