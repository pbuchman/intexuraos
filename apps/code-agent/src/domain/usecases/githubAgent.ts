/**
 * Use case: GitHub Agent — evaluates webhook events via tool-calling LLM.
 *
 * Thin orchestrator that validates event type/action, parses owner/repo,
 * dispatches via dispatchPRAgent / dispatchCommentAgent, and post-processes
 * the outcome via processPRResponse / processCommentResponse.
 */

import type { Result } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import {
  dispatchCommentAgent,
  dispatchPRAgent,
  type GitHubAgentDeps,
  type GitHubAgentError,
  type GitHubAgentTriageResult,
} from './githubAgent/dispatchAgent.js';
import {
  processCommentResponse,
  processPRResponse,
  type GitHubAgentEvalResult,
  type GitHubAgentUsage,
} from './githubAgent/processResponse.js';

export type { GitHubAgentDeps, GitHubAgentError, GitHubAgentEvalResult, GitHubAgentTriageResult, GitHubAgentUsage };

function isSupportedPullRequestAction(action: GitHubPREvent['action']): boolean {
  return action === 'opened' || action === 'synchronize' || action === 'ready_for_review';
}

/**
 * Evaluate a webhook event using the GitHub Agent LLM.
 * Supports both pull_request and issue_comment events.
 */
export async function evaluateEvent(
  deps: GitHubAgentDeps,
  event: GitHubPREvent,
  correctionContext?: string,
): Promise<Result<GitHubAgentEvalResult, GitHubAgentError>> {
  const { logger } = deps;

  // Validate supported event types
  if (event.eventType !== 'pull_request' && event.eventType !== 'issue_comment') {
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Unsupported event type: ${event.eventType}` } };
  }

  if (event.eventType === 'pull_request' && !isSupportedPullRequestAction(event.action)) {
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Expected opened/synchronize/ready_for_review action, got ${event.action ?? 'null'}` } };
  }

  if (event.eventType === 'issue_comment' && event.action !== 'created' && event.action !== 'edited') {
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Expected created/edited action, got ${event.action ?? 'null'}` } };
  }

  const [owner, repo] = event.repository.split('/');
  if (owner === undefined || repo === undefined) {
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Invalid repository format: ${event.repository}` } };
  }

  logger.info(
    { repository: event.repository, prNumber: event.pullRequestNumber, action: event.action, eventType: event.eventType },
    'GitHub Agent evaluating event'
  );

  if (event.eventType === 'pull_request') {
    const outcome = await dispatchPRAgent(deps, event, owner, repo, correctionContext);
    if (!outcome.ok) return outcome;
    return processPRResponse(logger, event, outcome.value); // @allow-result-access -- narrowed by !outcome.ok
  }

  const outcome = await dispatchCommentAgent(deps, event, correctionContext);
  if (!outcome.ok) return outcome;
  return processCommentResponse(logger, event, outcome.value); // @allow-result-access -- narrowed by !outcome.ok
}

/**
 * Legacy wrapper: evaluate a PR event using the GitHub Agent LLM.
 * TODO(INT-744): Remove in Step 6 when UnifiedEvaluator is wired.
 */
export async function evaluatePREvent(
  deps: GitHubAgentDeps,
  event: GitHubPREvent
): Promise<Result<{ toolCallsMade: number; reviewsRequested: string[]; skipped: boolean; skipReason?: string }, GitHubAgentError>> {
  const result = await evaluateEvent(deps, event);
  if (!result.ok) return result;

  const { triage, usage } = result.value; // @allow-result-access -- narrowed by !result.ok
  return {
    ok: true,
    value: {
      toolCallsMade: usage.toolCalls.length,
      reviewsRequested: triage.action === 'request_review' ? triage.reviewTypes : [],
      skipped: triage.action === 'skip',
      ...(triage.action === 'skip' ? { skipReason: triage.reason } : {}),
    },
  };
}

/**
 * Check if a GitHub PR event should be evaluated by the GitHub Agent.
 * TODO(INT-744): Remove in Step 6 when UnifiedEvaluator is wired.
 */
export function isGitHubAgentEvent(event: GitHubPREvent): boolean {
  return (
    event.eventType === 'pull_request' &&
    isSupportedPullRequestAction(event.action)
  );
}
