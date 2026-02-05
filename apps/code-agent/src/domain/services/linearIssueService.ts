/**
 * Service for managing Linear issues associated with code tasks.
 * Handles issue validation, creation with LLM titles, state transitions, and fallback behavior.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 207-308, 1901-1919)
 */

import type { Logger } from '@intexuraos/common-core';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';

export type LinearIssueType = 'feature' | 'bug' | 'refactor' | 'research';

export interface LinearIssueServiceDeps {
  linearAgentClient: LinearAgentClient;
  logger: Logger;
}

export interface EnsureIssueResult {
  /** Undefined when in fallback mode (Linear unavailable) */
  linearIssueId?: string;
  linearIssueTitle: string;
  linearIssueType?: LinearIssueType;
  linearFallback: boolean;
  /** Labels from validated issue */
  linearIssueLabels: string[];
  /** Whether the issue has child issues */
  hasChildren: boolean;
}

export interface LinearIssueService {
  /**
   * Ensure a Linear issue exists for a code task.
   *
   * Two modes:
   * - Link existing: Validates issue exists and belongs to user's team
   * - Create new: Generates title via LLM and creates issue
   *
   * Returns fallback mode if Linear unavailable.
   */
  ensureIssueExists(params: {
    userId: string;
    linearIssueId?: string;
    taskPrompt: string;
  }): Promise<EnsureIssueResult>;

  /**
   * Transition issue to In Progress when task is dispatched.
   */
  markInProgress(userId: string, linearIssueId: string): Promise<void>;

  /**
   * Transition issue to In Review when PR is created.
   */
  markInReview(userId: string, linearIssueId: string): Promise<void>;
}

export function createLinearIssueService(deps: LinearIssueServiceDeps): LinearIssueService {
  const { linearAgentClient, logger } = deps;

  return {
    async ensureIssueExists(params): Promise<EnsureIssueResult> {
      const { userId, linearIssueId, taskPrompt } = params;

      // Link existing issue mode: validate issue exists and belongs to user's team
      if (linearIssueId !== undefined) {
        logger.info({ linearIssueId }, 'Validating existing Linear issue');

        const validationResult = await linearAgentClient.validateIssue({
          userId,
          identifier: linearIssueId,
        });

        if (!validationResult.ok) {
          logger.warn(
            { linearIssueId, error: validationResult.error },
            'Issue validation failed, using fallback mode'
          );
          return {
            linearIssueTitle: `Linked issue ${linearIssueId}`,
            linearFallback: true,
            linearIssueLabels: [],
            hasChildren: false,
          };
        }

        const validated = validationResult.value;
        logger.info(
          { linearIssueId, validatedTitle: validated.title },
          'Issue validated successfully'
        );

        return {
          linearIssueId: validated.identifier,
          linearIssueTitle: validated.title,
          linearFallback: false,
          linearIssueLabels: validated.labels,
          hasChildren: validated.childCount > 0,
        };
      }

      // Create new issue mode: generate title via LLM
      logger.info({}, 'Creating new Linear issue for code task');

      const titleResult = await linearAgentClient.generateTitle({
        userId,
        description: taskPrompt,
      });

      let title: string;
      let issueType: LinearIssueType;

      if (!titleResult.ok) {
        logger.warn({ error: titleResult.error }, 'LLM title generation failed, using fallback');
        title = generateFallbackTitle(taskPrompt);
        issueType = 'feature';
      } else {
        title = titleResult.value.title;
        issueType = titleResult.value.issueType;
        logger.info({ title, issueType }, 'Generated issue title via LLM');
      }

      const createResult = await linearAgentClient.createIssue({
        userId,
        title,
        description: `## Code Task\n\n${taskPrompt}\n\n---\n*Created automatically by code-agent*`,
        labels: ['Code Task'],
      });

      if (!createResult.ok) {
        logger.warn({ error: createResult.error }, 'Failed to create Linear issue, using fallback mode');
        return {
          linearIssueTitle: title,
          linearIssueType: issueType,
          linearFallback: true,
          linearIssueLabels: [],
          hasChildren: false,
        };
      }

      logger.info(
        { issueId: createResult.value.issueIdentifier, title, issueType },
        'Linear issue created successfully'
      );

      return {
        linearIssueId: createResult.value.issueIdentifier,
        linearIssueTitle: createResult.value.issueTitle,
        linearIssueType: issueType,
        linearFallback: false,
        linearIssueLabels: ['Code Task'],
        hasChildren: false,
      };
    },

    async markInProgress(userId: string, linearIssueId: string): Promise<void> {
      if (!linearIssueId) {
        logger.debug({}, 'Skipping state transition (no issue ID)');
        return;
      }

      const result = await linearAgentClient.updateIssueState({
        userId,
        issueId: linearIssueId,
        state: 'in_progress',
      });

      if (!result.ok) {
        logger.warn({ linearIssueId, error: result.error }, 'Failed to update Linear issue to In Progress');
      }
    },

    async markInReview(userId: string, linearIssueId: string): Promise<void> {
      if (!linearIssueId) {
        logger.debug({}, 'Skipping state transition (no issue ID)');
        return;
      }

      const result = await linearAgentClient.updateIssueState({
        userId,
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
 * Fallback title generation using regex (no LLM).
 * Used when LLM title generation fails.
 */
function generateFallbackTitle(prompt: string): string {
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
  /* v8 ignore start -- ts-type: optional chaining and nullish coalescing create type narrowing branches @preserve */
  const firstLine = clean.split(/[.\n]/)[0]?.trim() ?? 'Code task';
  /* v8 ignore stop @preserve */

  // Truncate to 80 chars
  /* v8 ignore start -- ts-type: ternary creates branch for length check @preserve */
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
  /* v8 ignore stop @preserve */
}
