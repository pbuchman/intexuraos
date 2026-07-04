/**
 * Shared request/error types for the submitToExecutionAgent use case family.
 *
 * Extracted into a sibling module so prepareSubmission.ts, dispatchSubmission.ts,
 * and the submitToExecutionAgent.ts facade can all depend on the same
 * definitions without forming an import cycle.
 */

import type { WorkerType } from '../../models/codeTask.js';
import type { WorkerLocation } from '../../models/worker.js';

/**
 * Prompt sent to the Execution Agent worker.
 *
 * Intentionally generic — the worker reads the Linear issue (description +
 * comments) at run time for the actual requirements.
 */
export const EXECUTION_AGENT_PROMPT =
  'Implement the requirements defined in the linked Linear issue, its comments (newest first), and the referenced plan document if present. Deliver the plan in one branch and one PR. Use internal subagents for consecutive plan tasks; do not create Linear child issues or split the plan into multiple code tasks.';

/**
 * Request to start Execution Agent implementation.
 */
export interface SubmitToExecutionAgentRequest {
  /** The ID of any task in the issue group. If not a planning task, the planning task is resolved automatically via linearIssueId. */
  originalTaskId: string;
  /** User ID submitting the request */
  userId: string;
  /** Optional worker type to use for the implementation */
  workerType?: WorkerType;
}

/**
 * Successful result of submitting to Execution Agent.
 */
export interface SubmitToExecutionAgentResult {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: WorkerLocation;
  implementationOf: string;
}

/**
 * Error codes for submit to Execution Agent.
 */
export type SubmitToExecutionAgentErrorCode =
  | 'task_not_found'
  | 'invalid_status'
  | 'no_linear_issue'
  | 'already_implemented'
  | 'active_task_exists'
  | 'label_not_ready'
  | 'worker_not_configured'
  | 'queue_full'
  | 'plan_pr_merge_failed'
  | 'internal_error';

/**
 * Error result from submitting to Execution Agent.
 */
export interface SubmitToExecutionAgentError {
  code: SubmitToExecutionAgentErrorCode;
  message: string;
  /** Only set for already_implemented */
  existingTaskId?: string;
}
