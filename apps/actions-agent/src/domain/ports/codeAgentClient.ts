/**
 * Code Agent Client Port
 *
 * Defines the interface for communicating with code-agent service.
 * Based on design doc: docs/designs/INT-156-code-action-type.md lines 1454-1469
 */

import type { Result } from '@intexuraos/common-core';
import type { CodeActionPayload } from '../models/action.js';

export interface CodeAgentClient {
  submitTask(input: SubmitTaskInput): Promise<Result<SubmitTaskOutput, CodeAgentError>>;
  cancelTaskWithNonce(input: CancelTaskWithNonceInput): Promise<Result<CancelTaskWithNonceOutput, CancelTaskError>>;
  submitToPhase2(input: SubmitToPhase2Input): Promise<Result<SubmitToPhase2Output, SubmitToPhase2Error>>;
}

export interface SubmitTaskInput {
  actionId: string;
  userId: string;
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

/** Input for submit-to-phase2 request (INT-628) */
export interface SubmitToPhase2Input {
  taskId: string;
  userId: string;
}

/** Output for submit-to-phase2 request (INT-628) */
export interface SubmitToPhase2Output {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: string;
  implementationOf: string;
}

/** Error from submit-to-phase2 request (INT-628) */
export interface SubmitToPhase2Error {
  code: 'TASK_NOT_FOUND' | 'INVALID_STATUS' | 'NO_LINEAR_ISSUE' | 'LABEL_NOT_READY' | 'ALREADY_IMPLEMENTED' | 'ACTIVE_TASK_EXISTS' | 'WORKER_NOT_CONFIGURED' | 'NETWORK_ERROR' | 'UNKNOWN';
  message: string;
  existingTaskId?: string;
}
