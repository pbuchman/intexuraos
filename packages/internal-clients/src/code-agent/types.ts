import type { Result } from '@intexuraos/common-core';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';

export interface CodeAgentServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export interface CodeAgentRequestOptions {
  requestId?: string;
  timeoutMs?: number;
}

export interface SubmitTaskRequest {
  actionId: string;
  userId: string;
  approvalEventId: string;
  payload: unknown;
}

export interface SubmitTaskResponse {
  codeTaskId: string;
  resourceUrl: string;
}

export interface CreateCodeTaskRequest {
  userId: string;
  prompt: string;
  workerType?: string;
  linearIssueId?: string;
  taskMode?: 'planning' | 'execution';
}

export type SubmitTaskError =
  | { code: 'DUPLICATE'; message: string; status: 409; existingTaskId?: string }
  | { code: 'WORKER_UNAVAILABLE'; message: string; status: 503 }
  | { code: 'NETWORK_ERROR'; message: string }
  | { code: 'INVALID_REQUEST'; message: string; status: number }
  | { code: 'UNAVAILABLE'; message: string; status: number }
  | { code: 'UNKNOWN'; message: string; status?: number };

export interface CancelTaskWithNonceInput {
  taskId: string;
  nonce: string;
  userId: string;
}

export interface CancelTaskWithNonceOutput {
  cancelled: true;
}

export interface CancelTaskError {
  code:
    | 'TASK_NOT_FOUND'
    | 'INVALID_NONCE'
    | 'NONCE_EXPIRED'
    | 'NOT_OWNER'
    | 'TASK_NOT_CANCELLABLE'
    | 'NETWORK_ERROR'
    | 'UNKNOWN';
  message: string;
}

export interface SubmitToPhase2Input {
  taskId: string;
  userId: string;
}

export interface SubmitToPhase2Output {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: string;
  implementationOf: string;
}

export interface SubmitToPhase2Error {
  code:
    | 'TASK_NOT_FOUND'
    | 'INVALID_STATUS'
    | 'NO_LINEAR_ISSUE'
    | 'LABEL_NOT_READY'
    | 'ALREADY_IMPLEMENTED'
    | 'ACTIVE_TASK_EXISTS'
    | 'WORKER_NOT_CONFIGURED'
    | 'NETWORK_ERROR'
    | 'UNKNOWN';
  message: string;
  existingTaskId?: string;
}

export interface NotifyGroupSummaryRecomputeRequest {
  userId: string;
  linearIssueId: string;
  labels: { id: string; name: string }[];
  sourceTimestamp: string;
}

export interface NotifyGroupSummaryRecomputeError {
  code: 'INVALID_REQUEST' | 'UNAVAILABLE' | 'UNKNOWN';
  message: string;
  status?: number;
}

export interface CodeAgentServiceClient {
  submitTask(
    input: SubmitTaskRequest,
    options?: CodeAgentRequestOptions
  ): Promise<Result<SubmitTaskResponse, SubmitTaskError>>;

  createCodeTask(
    input: CreateCodeTaskRequest,
    options?: CodeAgentRequestOptions
  ): Promise<Result<SubmitTaskResponse, SubmitTaskError>>;

  cancelTaskWithNonce(
    input: CancelTaskWithNonceInput,
    options?: CodeAgentRequestOptions
  ): Promise<Result<CancelTaskWithNonceOutput, CancelTaskError>>;

  submitToPhase2(
    input: SubmitToPhase2Input,
    options?: CodeAgentRequestOptions
  ): Promise<Result<SubmitToPhase2Output, SubmitToPhase2Error>>;

  notifyGroupSummaryRecompute(
    request: NotifyGroupSummaryRecomputeRequest,
    options?: CodeAgentRequestOptions
  ): Promise<Result<void, NotifyGroupSummaryRecomputeError>>;
}
