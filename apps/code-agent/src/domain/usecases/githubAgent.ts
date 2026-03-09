/**
 * Use case: GitHub Agent — evaluates PR events via tool-calling LLM.
 *
 * When a PR is opened or synchronized, this use case:
 * 1. Fetches PR context (files) via GitHubPRClient
 * 2. Builds a system prompt with the PR context
 * 3. Runs a tool-calling LLM agent loop
 * 4. The LLM decides what reviews to request via tools
 *
 * Tools are fire-and-forget: dispatching is done in the run callback,
 * and the result string is sent back to the LLM.
 */

import type { Logger, Result } from '@intexuraos/common-core';
import type { ToolCallingClient, ToolDefinition } from '@intexuraos/llm-contract';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import { githubAgentPrompt } from '../prompts/githubAgentPrompt.js';

export interface GitHubAgentDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
  toolCallingClient: ToolCallingClient;
}

export interface GitHubAgentResult {
  toolCallsMade: number;
  reviewsRequested: string[];
  skipped: boolean;
  skipReason?: string;
}

export interface GitHubAgentError {
  code: 'GITHUB_API_FAILED' | 'LLM_FAILED' | 'INVALID_EVENT';
  message: string;
}

/**
 * Evaluate a PR event using the GitHub Agent LLM.
 */
export async function evaluatePREvent(
  deps: GitHubAgentDeps,
  event: GitHubPREvent
): Promise<Result<GitHubAgentResult, GitHubAgentError>> {
  const { logger, gitHubPRClient, toolCallingClient } = deps;

  // Validate event is a PR opened/synchronize
  if (event.eventType !== 'pull_request') {
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Expected pull_request event, got ${event.eventType}` } };
  }
  if (event.action !== 'opened' && event.action !== 'synchronize') {
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Expected opened/synchronize action, got ${String(event.action)}` } };
  }

  const [owner, repo] = event.repository.split('/');
  if (owner === undefined || repo === undefined) {
    return { ok: false, error: { code: 'INVALID_EVENT', message: `Invalid repository format: ${event.repository}` } };
  }

  logger.info(
    { repository: event.repository, prNumber: event.pullRequestNumber, action: event.action },
    'GitHub Agent evaluating PR event'
  );

  // Fetch PR files for context
  const filesResult = await gitHubPRClient.getPullRequestFiles(
    owner, repo, event.pullRequestNumber
  );

  if (!filesResult.ok) {
    logger.error(
      { error: filesResult.error, prNumber: event.pullRequestNumber },
      'Failed to fetch PR files'
    );
    return { ok: false, error: { code: 'GITHUB_API_FAILED', message: `Failed to fetch PR files: ${filesResult.error.message}` } };
  }

  const files = filesResult.value; // @allow-result-access -- narrowed by !filesResult.ok

  // Build tool definitions
  const reviewsRequested: string[] = [];
  let skipped = false;
  let skipReason: string | undefined;

  const tools: ToolDefinition[] = [
    {
      name: 'request_review',
      description: 'Request a code review for this pull request. Call once per review type needed.',
      parameters: {
        type: 'object',
        properties: {
          review_type: {
            type: 'string',
            enum: ['code_quality', 'security', 'architecture'],
            description: 'The type of review to request',
          },
        },
        required: ['review_type'],
      },
      // TODO(INT-744): Replace with actual dispatch to orchestrator review pipeline
      run(args: Record<string, unknown>): Promise<string> {
        const rawReviewType = args['review_type'];
        const reviewType = typeof rawReviewType === 'string' ? rawReviewType : '';
        const validTypes = ['code_quality', 'security', 'architecture'];
        if (!validTypes.includes(reviewType)) {
          logger.warn({ reviewType }, 'GitHub Agent requested unknown review type');
          return Promise.resolve(JSON.stringify({ error: `Unknown review type: ${reviewType}` }));
        }
        reviewsRequested.push(reviewType);
        logger.info(
          { repository: event.repository, prNumber: event.pullRequestNumber, reviewType },
          'GitHub Agent requested review'
        );
        return Promise.resolve(JSON.stringify({ success: true, reviewType, message: `Review recorded: ${reviewType}` }));
      },
    },
    {
      name: 'skip_review',
      description: 'Skip review for this PR. Use when the PR is trivial (docs-only, config, auto-generated).',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why the review is being skipped',
          },
        },
        required: ['reason'],
      },
      run(args: Record<string, unknown>): Promise<string> {
        const rawReason = args['reason'];
        const reason = typeof rawReason === 'string' ? rawReason : '(no reason provided)';
        skipped = true;
        skipReason = reason;
        logger.info(
          { repository: event.repository, prNumber: event.pullRequestNumber, reason },
          'GitHub Agent skipped review'
        );
        return Promise.resolve(JSON.stringify({ success: true, message: `Review skipped: ${reason}` }));
      },
    },
  ];

  // Build system prompt
  const systemPrompt = githubAgentPrompt.build({
    repository: event.repository,
    prNumber: event.pullRequestNumber,
    prTitle: event.title ?? '(untitled)',
    prBody: event.body ?? '',
    action: event.action,
    senderLogin: event.senderLogin,
    files,
  });

  // Run the agent loop
  const agentResult = await toolCallingClient.run({
    systemPrompt,
    messages: [{ role: 'user', content: 'Evaluate this PR and decide what reviews to request.' }],
    tools,
    maxIterations: 5,
  });

  if (!agentResult.ok) {
    logger.error(
      { error: agentResult.error, prNumber: event.pullRequestNumber },
      'GitHub Agent LLM call failed'
    );
    return { ok: false, error: { code: 'LLM_FAILED', message: `LLM failed: ${agentResult.error.message}` } };
  }

  const result = agentResult.value; // @allow-result-access -- narrowed by !agentResult.ok

  logger.info(
    {
      repository: event.repository,
      prNumber: event.pullRequestNumber,
      toolCallsMade: result.toolCallsMade,
      reviewsRequested,
      skipped,
      costUsd: result.usage.costUsd,
    },
    'GitHub Agent evaluation complete'
  );

  return {
    ok: true,
    value: {
      toolCallsMade: result.toolCallsMade,
      reviewsRequested,
      skipped,
      ...(skipReason !== undefined && { skipReason }),
    },
  };
}

/**
 * Check if a GitHub PR event should be evaluated by the GitHub Agent.
 */
export function isGitHubAgentEvent(event: GitHubPREvent): boolean {
  return (
    event.eventType === 'pull_request' &&
    (event.action === 'opened' || event.action === 'synchronize')
  );
}
