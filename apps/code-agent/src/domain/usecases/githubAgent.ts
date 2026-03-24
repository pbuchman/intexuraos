/**
 * Use case: GitHub Agent — evaluates webhook events via tool-calling LLM.
 *
 * Handles both pull_request and issue_comment events:
 * - PR events: fetches files, decides what reviews to request
 * - Comment events: triages whether to dispatch or skip
 *
 * Tools are fire-and-forget: dispatching is done in the run callback,
 * and the result string is sent back to the LLM.
 */

import type { Logger, Result } from '@intexuraos/common-core';
import type { ToolCallingClient, ToolDefinition } from '@intexuraos/llm-contract';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import { githubAgentPrompt } from '../prompts/githubAgentPrompt.js';
import { LLM_TOOL_REVIEW_TYPES } from '../constants/reviewTypes.js';
const VALID_DISPATCH_TEMPLATES = ['pr_comment', 'bot_review_edit'] as const;

export interface GitHubAgentDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
  toolCallingClient: ToolCallingClient;
  userServiceClient: UserServiceClient;
  allowedBots: Set<string>;
}

/**
 * Structured triage result from the GitHub Agent.
 */
export type GitHubAgentTriageResult =
  | { action: 'dispatch'; template: 'pr_comment' | 'bot_review_edit' }
  | { action: 'request_review'; reviewTypes: string[] }
  | { action: 'skip'; reason: string };

export interface GitHubAgentError {
  code: 'GITHUB_API_FAILED' | 'LLM_FAILED' | 'INVALID_EVENT' | 'USER_NOT_FOUND' | 'TOKEN_NOT_AVAILABLE';
  message: string;
}

/**
 * LLM usage data from the agent run.
 */
export interface GitHubAgentUsage {
  costUsd: number;
  model?: string;
  toolCalls: { tool: string; args: Record<string, unknown> }[];
}

/**
 * Full result including triage decision, usage data, and LLM reasoning.
 */
export interface GitHubAgentEvalResult {
  triage: GitHubAgentTriageResult;
  usage: GitHubAgentUsage;
  reasoning: string;
}

/**
 * Evaluate a webhook event using the GitHub Agent LLM.
 * Supports both pull_request and issue_comment events.
 */
export async function evaluateEvent(
  deps: GitHubAgentDeps,
  event: GitHubPREvent
): Promise<Result<GitHubAgentEvalResult, GitHubAgentError>> {
  const { logger } = deps;

  // Validate supported event types
  if (event.eventType !== 'pull_request' && event.eventType !== 'issue_comment') {
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Unsupported event type: ${event.eventType}` } };
  }

  if (event.eventType === 'pull_request' && event.action !== 'opened' && event.action !== 'synchronize') {
    /* v8 ignore start -- ts-type: null coalescing in error message for GitHubPRAction | null @preserve */
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Expected opened/synchronize action, got ${event.action ?? 'null'}` } };
    /* v8 ignore stop @preserve */
  }

  if (event.eventType === 'issue_comment' && event.action !== 'created' && event.action !== 'edited') {
    /* v8 ignore start -- ts-type: null coalescing in error message for GitHubPRAction | null @preserve */
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Expected created/edited action, got ${event.action ?? 'null'}` } };
    /* v8 ignore stop @preserve */
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
    return await evaluatePREventInternal(deps, event, owner, repo);
  }

  return await evaluateCommentEventInternal(deps, event);
}

async function evaluatePREventInternal(
  deps: GitHubAgentDeps,
  event: GitHubPREvent,
  owner: string,
  repo: string,
): Promise<Result<GitHubAgentEvalResult, GitHubAgentError>> {
  const { logger, gitHubPRClient, toolCallingClient, userServiceClient } = deps;

  // Resolve user and OAuth token
  const userResult = await userServiceClient.resolveGitHubUsername(event.senderLogin);
  if (!userResult.ok) {
    logger.warn({ senderLogin: event.senderLogin, error: userResult.error.code }, 'GitHub Agent: user resolution failed');
    return { ok: false, error: { code: 'USER_NOT_FOUND', message: `Failed to resolve GitHub user: ${event.senderLogin}` } };
  }

  const resolvedUser = userResult.value; // @allow-result-access -- narrowed by !userResult.ok
  if (resolvedUser === null) {
    logger.info({ senderLogin: event.senderLogin }, 'GitHub Agent: sender has no linked IntexuraOS account');
    return { ok: false, error: { code: 'USER_NOT_FOUND', message: `No IntexuraOS account linked for GitHub user: ${event.senderLogin}` } };
  }

  const tokenResult = await userServiceClient.getOAuthToken(resolvedUser.userId, 'github');
  if (!tokenResult.ok) {
    logger.info({ userId: resolvedUser.userId, error: tokenResult.error.code }, 'GitHub Agent: OAuth token not available');
    return { ok: false, error: { code: 'TOKEN_NOT_AVAILABLE', message: `GitHub OAuth token not available for user: ${resolvedUser.userId}` } };
  }

  const accessToken = tokenResult.value.accessToken; // @allow-result-access -- narrowed by !tokenResult.ok

  // Fetch PR files
  const filesResult = await gitHubPRClient.getPullRequestFiles(accessToken, owner, repo, event.pullRequestNumber);
  if (!filesResult.ok) {
    logger.error({ error: filesResult.error, prNumber: event.pullRequestNumber }, 'Failed to fetch PR files');
    return { ok: false, error: { code: 'GITHUB_API_FAILED', message: `Failed to fetch PR files: ${filesResult.error.message}` } };
  }

  const files = filesResult.value; // @allow-result-access -- narrowed by !filesResult.ok

  // Build tools for PR triage — state object avoids no-unnecessary-condition
  // lint errors since TypeScript doesn't narrow object properties across callbacks.
  const state = { skipped: false, skipReason: undefined as string | undefined };
  const reviewsRequested: string[] = [];
  const toolCalls: { tool: string; args: Record<string, unknown> }[] = [];

  const tools: ToolDefinition[] = [
    {
      name: 'request_review',
      description: 'Request a code review for this pull request. Call once per review type needed.',
      parameters: {
        type: 'object',
        properties: {
          review_type: {
            type: 'string',
            enum: [...LLM_TOOL_REVIEW_TYPES],
            description: 'The type of review to request',
          },
        },
        required: ['review_type'],
      },
      run(args: Record<string, unknown>): Promise<string> {
        toolCalls.push({ tool: 'request_review', args });
        const rawReviewType = args['review_type'];
        /* v8 ignore start -- schema: type guard for unknown tool arg @preserve */
        const reviewType = typeof rawReviewType === 'string' ? rawReviewType : '';
        /* v8 ignore stop @preserve */
        if (!(LLM_TOOL_REVIEW_TYPES as readonly string[]).includes(reviewType)) {
          logger.warn({ reviewType }, 'GitHub Agent requested unknown review type');
          return Promise.resolve(JSON.stringify({ error: `Unknown review type: ${reviewType}` }));
        }
        reviewsRequested.push(reviewType);
        logger.info({ repository: event.repository, prNumber: event.pullRequestNumber, reviewType }, 'GitHub Agent requested review');
        return Promise.resolve(JSON.stringify({ success: true, reviewType, message: `Review recorded: ${reviewType}` }));
      },
    },
    {
      name: 'skip',
      description: 'Skip this event. Use when the PR is trivial (docs-only, config, auto-generated).',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why this event is being skipped',
          },
        },
        required: ['reason'],
      },
      run(args: Record<string, unknown>): Promise<string> {
        toolCalls.push({ tool: 'skip', args });
        const rawReason = args['reason'];
        const reason = typeof rawReason === 'string' ? rawReason : '(no reason provided)';
        state.skipped = true;
        state.skipReason = reason;
        logger.info({ repository: event.repository, prNumber: event.pullRequestNumber, reason }, 'GitHub Agent skipped event');
        return Promise.resolve(JSON.stringify({ success: true, message: `Skipped: ${reason}` }));
      },
    },
  ];

  // Build prompt and run
  const systemPrompt = githubAgentPrompt.build({
    repository: event.repository,
    prNumber: event.pullRequestNumber,
    /* v8 ignore start -- ts-type: null coalescing for nullable event fields @preserve */
    prTitle: event.title ?? '(untitled)',
    prBody: event.body ?? '',
    /* v8 ignore stop @preserve */
    /* v8 ignore start -- ts-type: action validated as opened/synchronize before this function is called @preserve */
    action: event.action ?? '',
    /* v8 ignore stop @preserve */
    senderLogin: event.senderLogin,
    eventType: 'pull_request',
    files,
  });

  const agentResult = await toolCallingClient.run({
    systemPrompt,
    messages: [{ role: 'user', content: 'Evaluate this PR and decide what reviews to request.' }],
    tools,
    maxIterations: 5,
  });

  if (!agentResult.ok) {
    logger.error({ error: agentResult.error, prNumber: event.pullRequestNumber }, 'GitHub Agent LLM call failed');
    return { ok: false, error: { code: 'LLM_FAILED', message: `LLM failed: ${agentResult.error.message}` } };
  }

  const result = agentResult.value; // @allow-result-access -- narrowed by !agentResult.ok
  const reasoning = result.content;

  logger.info(
    { repository: event.repository, prNumber: event.pullRequestNumber, toolCallsMade: result.toolCallsMade, reviewsRequested, skipped: state.skipped, costUsd: result.usage.costUsd, reasoning },
    'GitHub Agent evaluation complete'
  );

  /* v8 ignore start -- ts-type: null coalescing for optional skip reason @preserve */
  const skipReason = state.skipReason ?? '(no reason)';
  /* v8 ignore stop @preserve */
  const dedupedReviewTypes = [...new Set(reviewsRequested)];
  const triage: GitHubAgentTriageResult = state.skipped
    ? { action: 'skip', reason: skipReason }
    : dedupedReviewTypes.length > 0
      ? { action: 'request_review', reviewTypes: dedupedReviewTypes }
      : { action: 'skip', reason: 'No tool called' };

  return {
    ok: true,
    value: {
      triage,
      usage: { costUsd: result.usage.costUsd, toolCalls },
      reasoning,
    },
  };
}

async function evaluateCommentEventInternal(
  deps: GitHubAgentDeps,
  event: GitHubPREvent,
): Promise<Result<GitHubAgentEvalResult, GitHubAgentError>> {
  const { logger, toolCallingClient, allowedBots } = deps;

  const state = { dispatchTemplate: undefined as 'pr_comment' | 'bot_review_edit' | undefined, skipped: false, skipReason: undefined as string | undefined };
  const toolCalls: { tool: string; args: Record<string, unknown> }[] = [];

  const tools: ToolDefinition[] = [
    {
      name: 'dispatch_to_task',
      description: 'Forward this comment to a task for processing.',
      parameters: {
        type: 'object',
        properties: {
          message_template: {
            type: 'string',
            enum: [...VALID_DISPATCH_TEMPLATES],
            description: 'The message template to use for dispatch',
          },
        },
        required: ['message_template'],
      },
      run(args: Record<string, unknown>): Promise<string> {
        toolCalls.push({ tool: 'dispatch_to_task', args });
        const rawTemplate = args['message_template'];
        /* v8 ignore start -- schema: type guard for unknown tool arg @preserve */
        const template = typeof rawTemplate === 'string' ? rawTemplate : '';
        /* v8 ignore stop @preserve */
        if (!(VALID_DISPATCH_TEMPLATES as readonly string[]).includes(template)) {
          logger.warn({ template }, 'GitHub Agent used unknown dispatch template');
          return Promise.resolve(JSON.stringify({ error: `Unknown template: ${template}` }));
        }
        state.dispatchTemplate = template as 'pr_comment' | 'bot_review_edit';
        logger.info({ repository: event.repository, prNumber: event.pullRequestNumber, template }, 'GitHub Agent dispatching comment');
        return Promise.resolve(JSON.stringify({ success: true, template, message: `Dispatch queued: ${template}` }));
      },
    },
    {
      name: 'skip',
      description: 'Skip this comment. Use when the comment is not actionable.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why this comment is being skipped',
          },
        },
        required: ['reason'],
      },
      run(args: Record<string, unknown>): Promise<string> {
        toolCalls.push({ tool: 'skip', args });
        const rawReason = args['reason'];
        /* v8 ignore start -- schema: type guard for unknown tool arg @preserve */
        const reason = typeof rawReason === 'string' ? rawReason : '(no reason provided)';
        /* v8 ignore stop @preserve */
        state.skipped = true;
        state.skipReason = reason;
        logger.info({ repository: event.repository, prNumber: event.pullRequestNumber, reason }, 'GitHub Agent skipped comment');
        return Promise.resolve(JSON.stringify({ success: true, message: `Skipped: ${reason}` }));
      },
    },
  ];

  const isBotSender = allowedBots.has(event.senderLogin);

  const systemPrompt = githubAgentPrompt.build({
    repository: event.repository,
    prNumber: event.pullRequestNumber,
    /* v8 ignore start -- ts-type: null coalescing for nullable event fields @preserve */
    prTitle: event.title ?? '(untitled)',
    prBody: '',
    /* v8 ignore start -- ts-type: action validated as created/edited before this function is called @preserve */
    action: event.action ?? '',
    /* v8 ignore stop @preserve */
    senderLogin: event.senderLogin,
    eventType: 'issue_comment',
    commentBody: event.body ?? '',
    /* v8 ignore stop @preserve */
    isEdit: event.action === 'edited',
    isBotSender,
  });

  const agentResult = await toolCallingClient.run({
    systemPrompt,
    messages: [{ role: 'user', content: 'Evaluate this comment and decide what action to take.' }],
    tools,
    maxIterations: 3,
  });

  if (!agentResult.ok) {
    logger.error({ error: agentResult.error, prNumber: event.pullRequestNumber }, 'GitHub Agent LLM call failed for comment');
    return { ok: false, error: { code: 'LLM_FAILED', message: `LLM failed: ${agentResult.error.message}` } };
  }

  const result = agentResult.value; // @allow-result-access -- narrowed by !agentResult.ok
  const reasoning = result.content;

  logger.info(
    { repository: event.repository, prNumber: event.pullRequestNumber, toolCallsMade: result.toolCallsMade, skipped: state.skipped, costUsd: result.usage.costUsd, reasoning },
    'GitHub Agent comment evaluation complete'
  );

  /* v8 ignore start -- ts-type: null coalescing for optional skip reason @preserve */
  const commentSkipReason = state.skipReason ?? '(no reason)';
  /* v8 ignore stop @preserve */
  const triage: GitHubAgentTriageResult = state.skipped
    ? { action: 'skip', reason: commentSkipReason }
    : state.dispatchTemplate !== undefined
      ? { action: 'dispatch', template: state.dispatchTemplate }
      : { action: 'skip', reason: 'No tool called' };

  return {
    ok: true,
    value: {
      triage,
      usage: { costUsd: result.usage.costUsd, toolCalls },
      reasoning,
    },
  };
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
    (event.action === 'opened' || event.action === 'synchronize')
  );
}
