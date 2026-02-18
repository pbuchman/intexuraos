/**
 * Status mirror service interface (domain port).
 *
 * Mirrors code task status to the corresponding action for Inbox UI.
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 309-348)
 */

import type { TaskStatus } from '../models/codeTask.js';

export interface StatusMirrorService {
  /**
   * Mirror code task status to the corresponding action.
   * Non-fatal: failures are logged but don't stop task execution.
   */
  mirrorStatus(params: {
    actionId: string | undefined; // @allow-undefined-type -- required param that may be undefined (distinct from optional)
    taskStatus: TaskStatus;
    resourceUrl?: string;
    errorMessage?: string;
    traceId?: string;
  }): Promise<void>;
}
