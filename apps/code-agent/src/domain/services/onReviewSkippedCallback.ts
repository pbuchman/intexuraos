import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { AutomationLog } from '../ports/automationLog.js';
import type { TaskGroupSummaryRepository } from '../ports/taskGroupSummaryRepository.js';

export interface OnReviewSkippedDeps {
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  automationLog: AutomationLog;
  groupSummaryRepo: TaskGroupSummaryRepository;
  logger: Logger;
}

/**
 * Factory that creates the `onReviewSkipped` callback for `UnifiedEvaluatorDeps`.
 *
 * The callback fires when LLM triage skips a PR review (e.g. documentation-only
 * change). It finds the origin task, validates it is an execution (not planning)
 * task, sets the `ready-to-merge` label on the Linear issue, records an
 * automation log entry, and recomputes the group summary.
 *
 * All operations are best-effort: failures are logged but never propagate.
 */
export function createOnReviewSkippedCallback(deps: OnReviewSkippedDeps): (args: { repository: string; prNumber: number }) => Promise<void> {
  const { codeTaskRepo, linearAgentClient, automationLog, groupSummaryRepo, logger } = deps;

  return async function onReviewSkipped(args: { repository: string; prNumber: number }): Promise<void> {
    const { repository, prNumber } = args;
    try {
      const originResult = await codeTaskRepo.findOriginTaskByPR(repository, prNumber);
      if (!originResult.ok || originResult.value === null) {
        logger.debug({ repository, prNumber }, 'No origin task found for skipped review — skipping label');
        return;
      }

      const origin = originResult.value;
      if (origin.linearIssueId === undefined) {
        logger.debug({ repository, prNumber }, 'Origin task has no Linear issue — skipping label');
        return;
      }

      if (origin.agentType === 'planning') {
        logger.info({ repository, prNumber, linearIssueId: origin.linearIssueId },
          'Skipped review for planning-origin task — not setting ready-to-merge');
        return;
      }

      // Validate issue exists and get current labels
      const issueValidation = await linearAgentClient.validateIssue({
        userId: origin.userId,
        identifier: origin.linearIssueId,
      });
      if (!issueValidation.ok) {
        logger.warn({ linearIssueId: origin.linearIssueId, error: issueValidation.error },
          'Failed to validate issue for skipped-review label');
        return;
      }

      // Set ready-to-merge label
      const labelResult = await linearAgentClient.updateIssueMetadata({
        userId: origin.userId,
        issueId: issueValidation.value.id,
        addLabels: ['ready-to-merge'],
      });
      if (!labelResult.ok) {
        logger.warn({ linearIssueId: origin.linearIssueId, error: labelResult.error },
          'Failed to set ready-to-merge label for skipped review');
        return;
      }
      if (labelResult.value.droppedLabels.length > 0) {
        logger.warn({ linearIssueId: origin.linearIssueId, droppedLabels: labelResult.value.droppedLabels },
          'ready-to-merge label not found in Linear team');
        return;
      }

      logger.info({ repository, prNumber, linearIssueId: origin.linearIssueId },
        'Set ready-to-merge label for skipped review');

      // Record in the PR automation comment for visibility
      void automationLog.record(
        { repository, prNumber },
        {
          type: 'remediation_decision',
          required: false,
          source: 'review_result',
          signal: '0',
        },
      ).catch((logErr: unknown) => {
        logger.warn({ error: logErr, repository, prNumber }, 'Failed to record automation log for skipped-review label');
      });

      // Best-effort: recompute group summary so cached aggregateStatus reflects actionable state
      const baseLabels = issueValidation.value.labels.map((l) => ({ id: '', name: l }));
      /* v8 ignore start -- source-map: ternary type guards have source map alignment issues @preserve */
      const updatedLabels = issueValidation.value.labels.includes('ready-to-merge')
        ? baseLabels
        : [...baseLabels, { id: '', name: 'ready-to-merge' }];
      /* v8 ignore stop @preserve */
      void groupSummaryRepo.recomputeWithLabels(
        origin.userId, origin.linearIssueId, updatedLabels, new Date().toISOString(),
      ).catch((recomputeErr: unknown) => {
        logger.warn({ linearIssueId: origin.linearIssueId, error: recomputeErr },
          'Failed to recompute group summary after skipped-review label (best-effort)');
      });
    } catch (error: unknown) {
      logger.warn({ error, repository, prNumber }, 'onReviewSkipped failed (best-effort)');
    }
  };
}