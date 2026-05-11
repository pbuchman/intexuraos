import type { Result } from '@intexuraos/common-core';
import type { ServiceClientConfig, ServiceClientError } from '../shared/errors.js';

export interface ActionsAgentServiceConfig extends ServiceClientConfig {
  defaultTimeoutMs?: number;
}

export interface ActionsAgentRequestOptions {
  requestId?: string;
  timeoutMs?: number;
}

export interface ActionsAgentTraceOptions extends ActionsAgentRequestOptions {
  traceId?: string;
}

export interface CreateActionRequest {
  userId: string;
  commandId: string;
  type: string;
  title: string;
  confidence: number;
  payload?: Record<string, unknown>;
}

export interface UpdateActionRequest {
  status: string;
  payload?: Record<string, unknown>;
}

export interface UpdateActionResourceResult {
  prUrl?: string;
  error?: string;
}

export interface ActionsAgentServiceClient {
  createAction<TAction>(
    request: CreateActionRequest,
    options?: ActionsAgentRequestOptions
  ): Promise<Result<TAction>>;

  getAction<TAction>(
    actionId: string,
    options?: ActionsAgentRequestOptions
  ): Promise<Result<TAction | null>>;

  updateActionStatus(
    actionId: string,
    status: string,
    options?: ActionsAgentRequestOptions
  ): Promise<Result<void>>;

  updateAction(
    actionId: string,
    update: UpdateActionRequest,
    options?: ActionsAgentRequestOptions
  ): Promise<Result<void>>;

  updateResourceStatus(
    actionId: string,
    status: string,
    result?: UpdateActionResourceResult,
    options?: ActionsAgentTraceOptions
  ): Promise<Result<void, ServiceClientError>>;
}
