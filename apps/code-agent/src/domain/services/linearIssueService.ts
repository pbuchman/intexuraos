/**
 * Service for managing Linear issues associated with code tasks.
 * Handles issue validation, creation with LLM titles, and state transitions.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 207-308, 1901-1919)
 */

import type { Logger } from '@intexuraos/common-core';
import type { LinearAgentClient, UpdateIssueStateRequest } from '../ports/linearAgentClient.js';

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
  /** Error message when linearFallback is true */
  linearFallbackError?: string;
  /** Labels from validated issue */
  linearIssueLabels: string[];
  /** Whether the issue has child issues */
  hasChildren: boolean;
  /** Direct URL to the Linear issue */
  linearIssueUrl?: string;
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

  /**
   * Transition issue to Todo when a plan-only PR is merged.
   */
  markTodo(userId: string, linearIssueId: string): Promise<void>;

  /**
   * Transition issue to QA when PR is merged.
   */
  markQa(userId: string, linearIssueId: string): Promise<void>;

  /**
   * Remove a label from an issue by name. Best-effort: logs and swallows errors.
   */
  removeLabel(userId: string, linearIssueId: string, labelName: string): Promise<void>;

  /**
   * Add a label to an issue by name. Best-effort: logs and swallows errors.
   */
  addLabel(userId: string, linearIssueId: string, labelName: string): Promise<void>;
}

export function createLinearIssueService(deps: LinearIssueServiceDeps): LinearIssueService {
  const { linearAgentClient, logger } = deps;

  async function transitionState(
    userId: string,
    linearIssueId: string,
    state: UpdateIssueStateRequest['state'],
    label: string,
  ): Promise<void> {
    if (!linearIssueId) {
      logger.debug({}, 'Skipping state transition (no issue ID)');
      return;
    }

    const result = await linearAgentClient.updateIssueState({
      userId,
      issueId: linearIssueId,
      state,
    });

    if (!result.ok) {
      logger.warn({ linearIssueId, error: result.error }, `Failed to update Linear issue to ${label}`);
    }
  }

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
            linearFallbackError: validationResult.error.message,
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
          linearIssueUrl: validated.url,
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
        logger.error({ error: titleResult.error }, 'LLM title generation failed, using raw prompt');
        const trimmed = taskPrompt.trim();
        title = trimmed.length > 80
          ? trimmed.slice(0, 77) + '...'
          : (trimmed || 'Code task');
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
      });

      if (!createResult.ok) {
        logger.warn({ error: createResult.error }, 'Failed to create Linear issue, using fallback mode');
        return {
          linearIssueTitle: title,
          linearIssueType: issueType,
          linearFallback: true,
          linearFallbackError: createResult.error.message,
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
        linearIssueLabels: [],
        hasChildren: false,
        linearIssueUrl: createResult.value.issueUrl,
      };
    },

    async markInProgress(userId: string, linearIssueId: string): Promise<void> {
      await transitionState(userId, linearIssueId, 'in_progress', 'In Progress');
    },

    async markInReview(userId: string, linearIssueId: string): Promise<void> {
      await transitionState(userId, linearIssueId, 'in_review', 'In Review');
    },

    async markTodo(userId: string, linearIssueId: string): Promise<void> {
      await transitionState(userId, linearIssueId, 'todo', 'Todo');
    },

    async markQa(userId: string, linearIssueId: string): Promise<void> {
      await transitionState(userId, linearIssueId, 'qa', 'QA');
    },

    async removeLabel(userId: string, linearIssueId: string, labelName: string): Promise<void> {
      if (!linearIssueId) {
        return;
      }

      const result = await linearAgentClient.updateIssueMetadata({
        userId,
        issueId: linearIssueId,
        removeLabels: [labelName],
      });

      if (!result.ok) {
        logger.warn({ linearIssueId, labelName, error: result.error }, 'Failed to remove label from Linear issue');
      }
    },

    async addLabel(userId: string, linearIssueId: string, labelName: string): Promise<void> {
      if (!linearIssueId) {
        return;
      }

      const result = await linearAgentClient.updateIssueMetadata({
        userId,
        issueId: linearIssueId,
        addLabels: [labelName],
      });

      if (!result.ok) {
        logger.warn({ linearIssueId, labelName, error: result.error }, 'Failed to add label to Linear issue');
      }
    },
  };
}

