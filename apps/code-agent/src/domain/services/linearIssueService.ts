/**
 * Service for managing Linear issues associated with code tasks.
 * Handles issue creation, state transitions, and fallback behavior.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 207-308, 1901-1919)
 */

import type { Logger } from '@intexuraos/common-core';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';

export interface LinearIssueServiceDeps {
  linearAgentClient: LinearAgentClient;
  logger: Logger;
}

export interface EnsureIssueResult {
  linearIssueId: string;
  linearIssueTitle: string;
  linearFallback: boolean;
}

export interface LinearIssueService {
  /**
   * Ensure a Linear issue exists for a code task.
   * If linearIssueId is provided, use it. Otherwise, create a new issue.
   * If creation fails, return fallback mode.
   */
  ensureIssueExists(params: {
    linearIssueId?: string;
    linearIssueTitle?: string;
    taskPrompt: string;
  }): Promise<EnsureIssueResult>;

  /**
   * Transition issue to In Progress when task is dispatched.
   */
  markInProgress(linearIssueId: string): Promise<void>;

  /**
   * Transition issue to In Review when PR is created.
   */
  markInReview(linearIssueId: string): Promise<void>;
}

export function createLinearIssueService(deps: LinearIssueServiceDeps): LinearIssueService {
  const { linearAgentClient, logger } = deps;

  return {
    async ensureIssueExists(params): Promise<EnsureIssueResult> {
      const { linearIssueId, linearIssueTitle, taskPrompt } = params;

      // If linearIssueId provided, use existing issue (title optional - use fallback if missing)
      if (linearIssueId !== undefined) {
        const title = linearIssueTitle ?? `Linked issue ${linearIssueId}`;
        logger.info({ linearIssueId }, 'Using existing Linear issue');
        return {
          linearIssueId,
          linearIssueTitle: title,
          linearFallback: false,
        };
      }

      logger.info({}, 'Creating new Linear issue for code task');

      const generatedTitle = generateIssueTitle(taskPrompt);

      const result = await linearAgentClient.createIssue({
        title: generatedTitle,
        description: `## Code Task\n\n${taskPrompt}\n\n---\n*Created automatically by code-agent*`,
        labels: ['Code Task'],
      });

      if (!result.ok) {
        logger.warn({ error: result.error }, 'Failed to create Linear issue, using fallback mode');
        return {
          linearIssueId: '',
          linearIssueTitle: generatedTitle,
          linearFallback: true,
        };
      }

      return {
        linearIssueId: result.value.issueId,
        linearIssueTitle: result.value.issueTitle,
        linearFallback: false,
      };
    },

    async markInProgress(linearIssueId: string): Promise<void> {
      if (linearIssueId === '') {
        logger.debug({}, 'Skipping state transition (fallback mode)');
        return;
      }

      const result = await linearAgentClient.updateIssueState({
        issueId: linearIssueId,
        state: 'in_progress',
      });

      if (!result.ok) {
        logger.warn({ linearIssueId, error: result.error }, 'Failed to update Linear issue to In Progress');
      }
    },

    async markInReview(linearIssueId: string): Promise<void> {
      if (linearIssueId === '') {
        logger.debug({}, 'Skipping state transition (fallback mode)');
        return;
      }

      const result = await linearAgentClient.updateIssueState({
        issueId: linearIssueId,
        state: 'in_review',
      });

      if (!result.ok) {
        logger.warn({ linearIssueId, error: result.error }, 'Failed to update Linear issue to In Review');
      }
    },
  };
}

/**
 * Generate a concise issue title from the task prompt.
 * - Max 80 characters
 * - Remove markdown, URLs, code blocks
 * - Use first sentence or phrase
 */
function generateIssueTitle(prompt: string): string {
  let clean = prompt;

  // Remove code blocks
  clean = clean.replace(/```[\s\S]*?```/g, '');

  // Remove inline code
  clean = clean.replace(/`[^`]+`/g, '');

  // Remove URLs
  clean = clean.replace(/https?:\/\/\S+/g, '');

  // Remove markdown formatting
  clean = clean.replace(/[#*_~]/g, '');

  // Get first line or sentence
  const firstLine = clean.split(/[.\n]/)[0]?.trim() ?? 'Code task';

  // Truncate to 80 chars
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}
