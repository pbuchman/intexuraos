/**
 * Service for mirroring code task status to actions.
 * Ensures Inbox UI shows accurate task progress.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 309-348)
 */

import type { Logger } from '@intexuraos/common-core';
import type { ActionsAgentClient } from '../clients/actionsAgentClient.js';
import type { TaskStatus } from '../../domain/models/codeTask.js';

/**
 * Status of the associated resource (e.g., code task).
 * Must match actions-agent's ResourceStatus type exactly.
 * See: apps/actions-agent/src/domain/models/action.ts
 */
export type ResourceStatus =
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface StatusMirrorServiceDeps {
  actionsAgentClient: ActionsAgentClient;
  logger: Logger;
}

export interface StatusMirrorService {
  /**
   * Mirror code task status to the corresponding action.
   * Non-fatal: failures are logged but don't stop task execution.
   */
  mirrorStatus(params: {
    actionId: string | undefined;
    taskStatus: TaskStatus;
    resourceUrl?: string;
    errorMessage?: string;
    traceId?: string;
  }): Promise<void>;
}

export function createStatusMirrorService(deps: StatusMirrorServiceDeps): StatusMirrorService {
  const { actionsAgentClient, logger } = deps;

  // Identity mapping: TaskStatus values match ResourceStatus exactly
  const statusMapping: Record<TaskStatus, ResourceStatus> = {
    dispatched: 'dispatched',
    running: 'running',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    interrupted: 'interrupted',
  };

  return {
    async mirrorStatus(params): Promise<void> {
      const { actionId, taskStatus, resourceUrl, errorMessage, traceId } = params;

      if (actionId === undefined) {
        logger.debug({ taskStatus }, 'Skipping status mirror (no actionId)');
        return;
      }

      const resourceStatus = statusMapping[taskStatus];
      // Note: statusMapping covers all TaskStatus values, so this is exhaustive
      const result = await actionsAgentClient.updateActionStatus(
        actionId,
        resourceStatus,
        resourceUrl !== undefined ? { prUrl: resourceUrl } : errorMessage !== undefined ? { error: errorMessage } : undefined,
        traceId
      );

      if (!result.ok) {
        logger.warn(
          { actionId, taskStatus, error: result.error },
          'Failed to mirror status to action'
        );
      }
    },
  };
}
