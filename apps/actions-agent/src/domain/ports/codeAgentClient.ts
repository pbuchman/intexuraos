/**
 * Code Agent Client Port
 *
 * Defines the interface for communicating with code-agent service.
 * Based on design doc: docs/designs/INT-156-code-action-type.md lines 1454-1469
 */

import type { CodeActionPayload } from '../models/action.js';

export interface CodeAgentClient {
  submitTask(input: SubmitTaskInput): Promise<Result<SubmitTaskOutput, CodeAgentError>>;
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

import type { Result } from '@intexuraos/common-core';
