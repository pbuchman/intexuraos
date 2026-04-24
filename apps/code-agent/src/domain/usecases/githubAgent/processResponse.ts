/**
 * GitHub Agent response processor — validates triage state after LLM dispatch.
 *
 * Consumes DispatchOutcome values from dispatchAgent and produces a
 * GitHubAgentEvalResult or a structured GitHubAgentError.
 */

import type { Logger, Result } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import type { ZodError } from 'zod';
import { TriageSkipSchema, TriageReviewSchema } from '../../validation/triageSchema.js';
import type {
  CommentTriageState,
  DispatchOutcome,
  GitHubAgentError,
  GitHubAgentTriageResult,
  PRTriageState,
  ToolCall,
} from './dispatchAgent.js';

/**
 * LLM usage data from the agent run.
 */
export interface GitHubAgentUsage {
  costUsd: number;
  model?: string;
  toolCalls: ToolCall[];
}

/**
 * Full result including triage decision, usage data, and LLM reasoning.
 */
export interface GitHubAgentEvalResult {
  triage: GitHubAgentTriageResult;
  usage: GitHubAgentUsage;
  reasoning: string;
}

export function formatZodErrors(error: ZodError): string {
  return error.issues.map((i) => i.message).join('; ');
}

export function validateTriageState(
  state: PRTriageState,
  reviewsRequested: string[],
): { ok: true; value: GitHubAgentTriageResult } | { ok: false; error: string } {
  const dedupedReviewTypes = [...new Set(reviewsRequested)];

  if (state.skipped) {
    /* v8 ignore start -- ts-type: Zod safeParse ?? fallback unreachable — LLM output pre-validated @preserve */
    const parsed = TriageSkipSchema.safeParse({ action: 'skip', reason: state.skipReason ?? '' });
    if (!parsed.success) return { ok: false, error: formatZodErrors(parsed.error) };
    /* v8 ignore stop @preserve */
    return { ok: true, value: { action: 'skip', reason: parsed.data.reason } };
  }

  if (dedupedReviewTypes.length > 0) {
    /* v8 ignore start -- ts-type: Zod safeParse ?? fallback unreachable — LLM output pre-validated @preserve */
    const parsed = TriageReviewSchema.safeParse({ action: 'request_review', reviewTypes: dedupedReviewTypes });
    if (!parsed.success) return { ok: false, error: formatZodErrors(parsed.error) };
    /* v8 ignore stop @preserve */
    return { ok: true, value: { action: 'request_review', reviewTypes: parsed.data.reviewTypes } };
  }

  return { ok: false, error: 'No triage tool was called. You must call either request_review or skip.' };
}

export function validateCommentTriageState(
  state: CommentTriageState,
): { ok: true; value: GitHubAgentTriageResult } | { ok: false; error: string } {
  if (state.skipped) {
    /* v8 ignore start -- ts-type: Zod safeParse ?? fallback unreachable — LLM output pre-validated @preserve */
    const parsed = TriageSkipSchema.safeParse({ action: 'skip', reason: state.skipReason ?? '' });
    if (!parsed.success) return { ok: false, error: formatZodErrors(parsed.error) };
    /* v8 ignore stop @preserve */
    return { ok: true, value: { action: 'skip', reason: parsed.data.reason } };
  }

  const dedupedReviewTypes = [...new Set(state.reviewTypes)];
  if (dedupedReviewTypes.length > 0) {
    /* v8 ignore start -- ts-type: Zod safeParse ?? fallback unreachable — LLM output pre-validated @preserve */
    const parsed = TriageReviewSchema.safeParse({ action: 'request_review', reviewTypes: dedupedReviewTypes });
    if (!parsed.success) return { ok: false, error: formatZodErrors(parsed.error) };
    /* v8 ignore stop @preserve */
    return {
      ok: true,
      value: {
        action: 'request_review',
        reviewTypes: parsed.data.reviewTypes,
        ...(state.reviewWorkerType !== undefined && { workerType: state.reviewWorkerType }),
      },
    };
  }

  if (state.dispatchTemplate !== undefined) {
    return { ok: true, value: { action: 'dispatch', template: state.dispatchTemplate } };
  }

  return { ok: false, error: 'No triage tool was called. You must call a tool to make your decision.' };
}

/**
 * Process the dispatch outcome for a pull_request event into an eval result.
 */
export function processPRResponse(
  logger: Logger,
  event: GitHubPREvent,
  outcome: Extract<DispatchOutcome, { kind: 'deterministic' | 'llm' }>,
): Result<GitHubAgentEvalResult, GitHubAgentError> {
  if (outcome.kind === 'deterministic') {
    return {
      ok: true,
      value: {
        triage: outcome.triage,
        usage: { costUsd: 0, toolCalls: [] },
        reasoning: outcome.reasoning,
      },
    };
  }

  const { runResult, state, toolCalls, reviewsRequested } = outcome;
  const reasoning = runResult.content;

  logger.info(
    { repository: event.repository, prNumber: event.pullRequestNumber, toolCallsMade: runResult.toolCallsMade, reviewsRequested, skipped: state.skipped, costUsd: runResult.usage.costUsd, reasoning },
    'GitHub Agent evaluation complete'
  );

  const triageOrError = validateTriageState(state, reviewsRequested);
  if (!triageOrError.ok) {
    logger.error(
      { prNumber: event.pullRequestNumber, error: triageOrError.error, toolCalls },
      'GitHub Agent triage validation failed after repair'
    );
    return { ok: false, error: { code: 'LLM_FAILED', message: `Triage invalid: ${triageOrError.error}` } };
  }
  const triage = triageOrError.value;

  return {
    ok: true,
    value: {
      triage,
      usage: { costUsd: runResult.usage.costUsd, toolCalls },
      reasoning,
    },
  };
}

/**
 * Process the dispatch outcome for an issue_comment event into an eval result.
 */
export function processCommentResponse(
  logger: Logger,
  event: GitHubPREvent,
  outcome: Extract<DispatchOutcome, { kind: 'comment-llm' }>,
): Result<GitHubAgentEvalResult, GitHubAgentError> {
  const { runResult, state, toolCalls } = outcome;
  const reasoning = runResult.content;

  logger.info(
    { repository: event.repository, prNumber: event.pullRequestNumber, toolCallsMade: runResult.toolCallsMade, skipped: state.skipped, costUsd: runResult.usage.costUsd, reasoning },
    'GitHub Agent comment evaluation complete'
  );

  const commentTriageOrError = validateCommentTriageState(state);
  if (!commentTriageOrError.ok) {
    logger.error(
      { prNumber: event.pullRequestNumber, error: commentTriageOrError.error, toolCalls },
      'GitHub Agent comment triage validation failed after repair'
    );
    return { ok: false, error: { code: 'LLM_FAILED', message: `Triage invalid: ${commentTriageOrError.error}` } };
  }
  const triage = commentTriageOrError.value;

  return {
    ok: true,
    value: {
      triage,
      usage: { costUsd: runResult.usage.costUsd, toolCalls },
      reasoning,
    },
  };
}
