/**
 * GitHub Agent dispatch — sets up tools/prompts and invokes the LLM.
 *
 * Handles user/token resolution, tool-calling-client resolve, PR-files fetch,
 * deterministic plan-only early-return, and LLM invocation. The resulting
 * DispatchOutcome is consumed by processResponse for triage validation.
 */

import type { Logger, Result } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { ToolCallingClient, ToolCallingResult, ToolDefinition } from '@intexuraos/llm-contract';
import type { GitHubPRClient } from '../../ports/gitHubPRClient.js';
import type { WorkerType } from '../../models/codeTask.js';
import type { GitHubPREvent } from '../../models/gitHubPREvent.js';
import { githubAgentPrompt } from '../../prompts/githubAgentPrompt.js';
import { resolveLoginForTaskCreation } from '../../services/gitHubDispatchService.js';
import { isReviewCommandComment, normalizeReviewWorkerType, SUPPORTED_REVIEW_WORKER_TYPES } from '../../utils/reviewTriage.js';
import { buildTriageRepairMessage } from '../../validation/buildTriageRepairMessage.js';
import { evaluatePlanFiles } from '../../utils/planDetection.js';
import { LLM_TOOL_REVIEW_TYPES } from '../../constants/reviewTypes.js';

const VALID_DISPATCH_TEMPLATES = ['pr_comment', 'bot_review_edit'] as const;

export interface GitHubAgentDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
  resolveToolCallingClient: (userId: string) => Promise<Result<ToolCallingClient, GitHubAgentError>>;
  userServiceClient: UserServiceClient;
  allowedBots: Set<string>;
}

/**
 * Structured triage result from the GitHub Agent.
 */
export type GitHubAgentTriageResult =
  | { action: 'dispatch'; template: 'pr_comment' | 'bot_review_edit' }
  | { action: 'request_review'; reviewTypes: string[]; workerType?: WorkerType }
  | { action: 'skip'; reason: string };

export interface GitHubAgentError {
  code: 'GITHUB_API_FAILED' | 'LLM_FAILED' | 'INVALID_EVENT' | 'USER_NOT_FOUND' | 'TOKEN_NOT_AVAILABLE';
  message: string;
}

export interface PRTriageState {
  skipped: boolean;
  skipReason: string | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes: property is always present but nullable
}

export interface CommentTriageState {
  skipped: boolean;
  skipReason: string | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes: property is always present but nullable
  reviewTypes: string[];
  reviewWorkerType: WorkerType | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes: property is always present but nullable
  dispatchTemplate: 'pr_comment' | 'bot_review_edit' | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes: property is always present but nullable
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export type DispatchOutcome =
  | { kind: 'deterministic'; triage: GitHubAgentTriageResult; reasoning: string }
  | { kind: 'llm'; runResult: ToolCallingResult; state: PRTriageState; toolCalls: ToolCall[]; reviewsRequested: string[] }
  | { kind: 'comment-llm'; runResult: ToolCallingResult; state: CommentTriageState; toolCalls: ToolCall[] };

/**
 * Dispatch the GitHub Agent for a pull_request event.
 * Resolves the user + token, fetches PR files, short-circuits for plan-only PRs,
 * and otherwise invokes the LLM with the PR triage tools.
 */
export async function dispatchPRAgent(
  deps: GitHubAgentDeps,
  event: GitHubPREvent,
  owner: string,
  repo: string,
  correctionContext?: string,
): Promise<Result<Extract<DispatchOutcome, { kind: 'deterministic' | 'llm' }>, GitHubAgentError>> {
  const { logger, gitHubPRClient, userServiceClient, allowedBots } = deps;

  // Resolve bot login to repo owner before user lookup (e.g. intexuraos-code-worker[bot] → pbuchman)
  const resolvedLogin = resolveLoginForTaskCreation(event.senderLogin, event.repository, allowedBots);

  // Resolve user and OAuth token
  const userResult = await userServiceClient.resolveGitHubUsername(resolvedLogin);
  if (!userResult.ok) {
    logger.warn({ senderLogin: resolvedLogin, error: userResult.error.code }, 'GitHub Agent: user resolution failed');
    return { ok: false, error: { code: 'USER_NOT_FOUND', message: `Failed to resolve GitHub user: ${resolvedLogin}` } };
  }

  const resolvedUser = userResult.value; // @allow-result-access -- narrowed by !userResult.ok
  if (resolvedUser === null) {
    logger.info({ senderLogin: resolvedLogin }, 'GitHub Agent: sender has no linked IntexuraOS account');
    return { ok: false, error: { code: 'USER_NOT_FOUND', message: `No IntexuraOS account linked for GitHub user: ${resolvedLogin}` } };
  }

  const tokenResult = await userServiceClient.getOAuthToken(resolvedUser.userId, 'github');
  if (!tokenResult.ok) {
    logger.info({ userId: resolvedUser.userId, error: tokenResult.error.code }, 'GitHub Agent: OAuth token not available');
    return { ok: false, error: { code: 'TOKEN_NOT_AVAILABLE', message: `GitHub OAuth token not available for user: ${resolvedUser.userId}` } };
  }

  const accessToken = tokenResult.value.accessToken; // @allow-result-access -- narrowed by !tokenResult.ok

  const toolCallingResult = await deps.resolveToolCallingClient(resolvedUser.userId);
  if (!toolCallingResult.ok) {
    logger.warn({ userId: resolvedUser.userId, error: toolCallingResult.error }, 'GitHub Agent: failed to resolve tool calling client');
    return { ok: false, error: toolCallingResult.error };
  }
  const toolCallingClient = toolCallingResult.value;

  // Fetch PR files
  const filesResult = await gitHubPRClient.getPullRequestFiles(accessToken, owner, repo, event.pullRequestNumber);
  if (!filesResult.ok) {
    logger.error({ error: filesResult.error, prNumber: event.pullRequestNumber }, 'Failed to fetch PR files');
    return { ok: false, error: { code: 'GITHUB_API_FAILED', message: `Failed to fetch PR files: ${filesResult.error.message}` } };
  }

  const files = filesResult.value; // @allow-result-access -- narrowed by !filesResult.ok

  // Deterministic plan-only PR detection — no LLM triage needed
  const planResult = evaluatePlanFiles(files);
  if (planResult.action === 'dispatch') {
    logger.info(
      { repository: event.repository, prNumber: event.pullRequestNumber, fileCount: files.length },
      'Plan-only PR detected — dispatching plan_review without LLM triage'
    );
    return {
      ok: true,
      value: {
        kind: 'deterministic',
        triage: { action: 'request_review', reviewTypes: ['plan_review'] },
        reasoning: 'Plan-only PR detected — deterministic dispatch to plan_review',
      },
    };
  }

  // Build tools for PR triage — state object avoids no-unnecessary-condition
  // lint errors since TypeScript doesn't narrow object properties across callbacks.
  const state: PRTriageState = { skipped: false, skipReason: undefined };
  const reviewsRequested: string[] = [];
  const toolCalls: ToolCall[] = [];

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
        const reviewType = typeof rawReviewType === 'string' ? rawReviewType : '';
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
      description: 'Skip this event. Use when the PR is trivial (non-plan docs, config, auto-generated).',
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
    prTitle: event.title ?? '(untitled)',
    prBody: event.body ?? '',
    /* v8 ignore start -- ts-type: event.action ?? fallback unreachable — caller always provides action @preserve */
    action: event.action ?? '',
    /* v8 ignore stop @preserve */
    senderLogin: event.senderLogin,
    eventType: 'pull_request',
    files,
  });

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: 'Evaluate this PR and decide what reviews to request.' },
  ];
  if (correctionContext !== undefined) {
    messages.push({ role: 'user', content: correctionContext });
  }

  const agentResult = await toolCallingClient.run({
    systemPrompt,
    messages,
    tools,
    maxIterations: 5,
    onExhausted: () => buildTriageRepairMessage(
      { skipped: state.skipped, skipReason: state.skipReason, reviewsRequested },
    ),
    repairIterations: 2,
  });

  if (!agentResult.ok) {
    logger.error({ error: agentResult.error, prNumber: event.pullRequestNumber }, 'GitHub Agent LLM call failed');
    return { ok: false, error: { code: 'LLM_FAILED', message: `LLM failed: ${agentResult.error.message}` } };
  }

  const runResult = agentResult.value; // @allow-result-access -- narrowed by !agentResult.ok

  return {
    ok: true,
    value: { kind: 'llm', runResult, state, toolCalls, reviewsRequested },
  };
}

/**
 * Dispatch the GitHub Agent for an issue_comment event.
 * Resolves the user, picks the right tool set (@review vs dispatch) and invokes the LLM.
 */
export async function dispatchCommentAgent(
  deps: GitHubAgentDeps,
  event: GitHubPREvent,
  correctionContext?: string,
): Promise<Result<Extract<DispatchOutcome, { kind: 'comment-llm' }>, GitHubAgentError>> {
  const { logger, userServiceClient, allowedBots } = deps;
  const commentBody = event.body ?? '';
  const isReviewCommand = isReviewCommandComment(commentBody);

  // Resolve user for this comment sender
  const resolvedLogin = resolveLoginForTaskCreation(event.senderLogin, event.repository, allowedBots);
  const userResult = await userServiceClient.resolveGitHubUsername(resolvedLogin);
  if (!userResult.ok) {
    logger.warn({ senderLogin: resolvedLogin, error: userResult.error.code }, 'GitHub Agent: user resolution failed for comment');
    return { ok: false, error: { code: 'USER_NOT_FOUND', message: `Failed to resolve GitHub user: ${resolvedLogin}` } };
  }

  const resolvedUser = userResult.value;
  if (resolvedUser === null) {
    logger.info({ senderLogin: resolvedLogin }, 'GitHub Agent: comment sender has no linked IntexuraOS account');
    return { ok: false, error: { code: 'USER_NOT_FOUND', message: `No IntexuraOS account linked for GitHub user: ${resolvedLogin}` } };
  }

  const toolCallingResult = await deps.resolveToolCallingClient(resolvedUser.userId);
  if (!toolCallingResult.ok) {
    logger.warn({ userId: resolvedUser.userId, error: toolCallingResult.error }, 'GitHub Agent: failed to resolve tool calling client for comment');
    return { ok: false, error: toolCallingResult.error };
  }
  const toolCallingClient = toolCallingResult.value;
  const state: CommentTriageState = {
    dispatchTemplate: undefined,
    reviewTypes: [],
    reviewWorkerType: undefined,
    skipped: false,
    skipReason: undefined,
  };
  const toolCalls: ToolCall[] = [];
  const tools: ToolDefinition[] = [];

  if (isReviewCommand) {
    tools.push({
      name: 'request_review',
      description: 'Request a review for this @review comment. Call once per review type, always with a worker type.',
      parameters: {
        type: 'object',
        properties: {
          review_type: {
            type: 'string',
            enum: [...LLM_TOOL_REVIEW_TYPES],
            description: 'The review scope to request',
          },
          worker_type: {
            type: 'string',
            enum: [...SUPPORTED_REVIEW_WORKER_TYPES],
            description: 'The worker type to use. Optional — omit to use the user\'s default.',
          },
        },
        required: ['review_type'],
      },
      run(args: Record<string, unknown>): Promise<string> {
        toolCalls.push({ tool: 'request_review', args });
        const rawReviewType = args['review_type'];
        const rawWorkerType = args['worker_type'];
        const reviewType = typeof rawReviewType === 'string' ? rawReviewType : '';

        if (!(LLM_TOOL_REVIEW_TYPES as readonly string[]).includes(reviewType)) {
          logger.warn({ reviewType }, 'GitHub Agent requested unknown review type');
          return Promise.resolve(JSON.stringify({ error: `Unknown review type: ${reviewType}` }));
        }

        // worker_type is optional — omit to use user's default
        if (typeof rawWorkerType === 'string' && rawWorkerType !== '') {
          const normalizedWorkerType = normalizeReviewWorkerType(rawWorkerType);
          if (normalizedWorkerType === undefined) {
            logger.warn({ workerType: rawWorkerType }, 'GitHub Agent used unknown review worker type');
            return Promise.resolve(JSON.stringify({ error: `Unknown worker type: ${rawWorkerType}` }));
          }

          if (state.reviewWorkerType !== undefined && state.reviewWorkerType !== normalizedWorkerType) {
            logger.warn(
              { existingWorkerType: state.reviewWorkerType, workerType: normalizedWorkerType },
              'GitHub Agent requested conflicting review worker types'
            );
            return Promise.resolve(JSON.stringify({ error: `Conflicting worker type: ${normalizedWorkerType}` }));
          }

          state.reviewWorkerType = normalizedWorkerType;
        }

        state.reviewTypes.push(reviewType);
        logger.info(
          { repository: event.repository, prNumber: event.pullRequestNumber, reviewType, workerType: state.reviewWorkerType },
          'GitHub Agent requested review from comment'
        );
        return Promise.resolve(JSON.stringify({
          success: true,
          reviewType,
          ...(state.reviewWorkerType !== undefined && { workerType: state.reviewWorkerType }),
          message: `Review recorded: ${reviewType}${state.reviewWorkerType !== undefined ? ` on ${state.reviewWorkerType}` : ''}`,
        }));
      },
    });
  } else {
    tools.push({
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
        const template = typeof rawTemplate === 'string' ? rawTemplate : '';
        if (!(VALID_DISPATCH_TEMPLATES as readonly string[]).includes(template)) {
          logger.warn({ template }, 'GitHub Agent used unknown dispatch template');
          return Promise.resolve(JSON.stringify({ error: `Unknown template: ${template}` }));
        }
        state.dispatchTemplate = template as 'pr_comment' | 'bot_review_edit';
        logger.info({ repository: event.repository, prNumber: event.pullRequestNumber, template }, 'GitHub Agent dispatching comment');
        return Promise.resolve(JSON.stringify({ success: true, template, message: `Dispatch queued: ${template}` }));
      },
    });
  }

  tools.push({
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
      const reason = typeof rawReason === 'string' ? rawReason : '(no reason provided)';
      state.skipped = true;
      state.skipReason = reason;
      logger.info({ repository: event.repository, prNumber: event.pullRequestNumber, reason }, 'GitHub Agent skipped comment');
      return Promise.resolve(JSON.stringify({ success: true, message: `Skipped: ${reason}` }));
    },
  });

  const isBotSender = allowedBots.has(event.senderLogin);

  const systemPrompt = githubAgentPrompt.build({
    repository: event.repository,
    prNumber: event.pullRequestNumber,
    prTitle: event.title ?? '(untitled)',
    prBody: '',
    /* v8 ignore start -- ts-type: event.action ?? fallback unreachable — caller always provides action @preserve */
    action: event.action ?? '',
    /* v8 ignore stop @preserve */
    senderLogin: event.senderLogin,
    eventType: 'issue_comment',
    commentBody,
    isEdit: event.action === 'edited',
    isBotSender,
  });

  const commentMessages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: 'Evaluate this comment and decide what action to take.' },
  ];
  if (correctionContext !== undefined) {
    commentMessages.push({ role: 'user', content: correctionContext });
  }

  const agentResult = await toolCallingClient.run({
    systemPrompt,
    messages: commentMessages,
    tools,
    maxIterations: 5,
    onExhausted: () => buildTriageRepairMessage(
      { skipped: state.skipped, skipReason: state.skipReason, reviewsRequested: state.reviewTypes },
    ),
    repairIterations: 2,
  });

  if (!agentResult.ok) {
    logger.error({ error: agentResult.error, prNumber: event.pullRequestNumber }, 'GitHub Agent LLM call failed for comment');
    return { ok: false, error: { code: 'LLM_FAILED', message: `LLM failed: ${agentResult.error.message}` } };
  }

  const runResult = agentResult.value; // @allow-result-access -- narrowed by !agentResult.ok

  return {
    ok: true,
    value: { kind: 'comment-llm', runResult, state, toolCalls },
  };
}
