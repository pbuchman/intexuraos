/**
 * Code Agent Client Port
 *
 * Defines the interface for communicating with code-agent service.
 * Based on design doc: docs/designs/INT-156-code-action-type.md lines 1454-1469
 */

import type { CodeActionPayload } from '../models/action.js';

export interface CodeAgentClient {
  submitTask(input: SubmitTaskInput): Promise<Result<SubmitTaskOutput, CodeAgentError>>;
  cancelTaskWithNonce(input: CancelTaskWithNonceInput): Promise<Result<CancelTaskWithNonceOutput, CancelTaskError>>;
}

export interface SubmitTaskInput {
  actionId: string;
  approvalEventId: string;
  payload: CodeActionPayload;
}

export interface SubmitTaskOutput {
  codeTaskId: string;
  resourceUrl: string;
}

export interface CodeAgentError {
  code: 'WORKER_UNAVAILABLE' | 'DUPLICATE' | 'NETWORK_ERROR' | 'UNKNOWN';
  message: string;
  existingTaskId?: string; // Present when code is 'DUPLICATE' (design line 1467)
}

/** Input for cancel-task-with-nonce request (INT-379) */
export interface CancelTaskWithNonceInput {
  taskId: string;
  nonce: string;
  userId: string;
}

/** Output for cancel-task-with-nonce request (INT-379) */
export interface CancelTaskWithNonceOutput {
  cancelled: true;
}

/** Error from cancel-task-with-nonce request (INT-379) */
export interface CancelTaskError {
  code: 'TASK_NOT_FOUND' | 'INVALID_NONCE' | 'NONCE_EXPIRED' | 'NOT_OWNER' | 'TASK_NOT_CANCELLABLE' | 'NETWORK_ERROR' | 'UNKNOWN';
  message: string;
}

import type { Result } from '@intexuraos/common-core';
