/**
 * Audit + automation-log utilities used by UnifiedEvaluator.
 *
 * - recordDecision:       Persist EventDecision and complete gitHubEventLogEntry
 * - dispatchAndRecord:    Dispatch a hard-rule decision and record the outcome
 * - recordLog:            Fire-and-forget automation log event emission
 * - resolveUserId:        Resolve senderLogin → platform userId (best-effort)
 * - deduplicateToolCalls: Collapse repeat tool calls into unique summaries
 */

import type { Logger } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import type { CreateEventDecisionInput } from '../../models/eventDecision.js';
import type { AutomationLog } from '../../ports/automationLog.js';
import type { RuleOutcome } from '../gitHubWebhookRules.js';
import { resolveLoginForTaskCreation } from '../gitHubDispatchService.js';
import type { UnifiedEvaluatorDeps } from './types.js';

/** Deduplicate tool calls into string summaries for automation log events. */
export function deduplicateToolCalls(toolCalls: { tool: string; args: Record<string, unknown> }[]): string[] {
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

/** Resolve senderLogin → platform userId for OAuth token lookup. Best-effort; returns undefined on failure. */
export async function resolveUserId(deps: UnifiedEvaluatorDeps, event: GitHubPREvent): Promise<string | undefined> {
  if (deps.resolveTokenUserId === undefined) return undefined;
  try {
    const login = resolveLoginForTaskCreation(event.senderLogin, event.repository, deps.allowedBots);
    return await deps.resolveTokenUserId(login);
  } catch {
    return undefined;
  }
}

/** Best-effort automation log recording. Never throws. */
export function recordLog(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  automationEvent: Parameters<AutomationLog['record']>[1],
  userId?: string,
): void {
  const prRef = { repository: event.repository, prNumber: event.pullRequestNumber };
  void deps.automationLog.record(prRef, automationEvent, userId).catch((recordErr: unknown) => {
    // Fire-and-forget — automation log failures must not affect webhook processing
    void recordErr;
  });
}

export interface RecordDecisionFields {
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
}

export async function recordDecision(
  deps: UnifiedEvaluatorDeps,
  event: GitHubPREvent,
  fields: RecordDecisionFields,
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
    eventAction: event.action ?? 'unknown',
    senderLogin: event.senderLogin,
    decidedBy: fields.decidedBy,
    decision: fields.decision,
    reason: fields.reason,
    ...(fields.dispatchAction !== undefined && { dispatchAction: fields.dispatchAction }),
    ...(fields.dispatchParams !== undefined && { dispatchParams: fields.dispatchParams }),
    ...(fields.llmCostUsd !== undefined && { llmCostUsd: fields.llmCostUsd }),
    ...(fields.llmModel !== undefined && { llmModel: fields.llmModel }),
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

export async function dispatchAndRecord(
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
