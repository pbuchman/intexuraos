import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import {
  createInternalHttpClient,
  type InternalHttpClient,
} from '../shared/createInternalHttpClient.js';
import type { ServiceClientError } from '../shared/errors.js';
import type {
  ActionsAgentServiceClient,
  ActionsAgentServiceConfig,
  ActionsAgentRequestOptions,
  ActionsAgentTraceOptions,
  CreateActionRequest,
  UpdateActionRequest,
  UpdateActionResourceResult,
} from './types.js';

function timeoutFor(
  config: ActionsAgentServiceConfig,
  options: ActionsAgentRequestOptions | undefined
): number | undefined {
  return options?.timeoutMs ?? config.defaultTimeoutMs;
}

async function sendActionMutation(
  config: ActionsAgentServiceConfig,
  httpClient: InternalHttpClient,
  path: string,
  body: unknown,
  options: ActionsAgentRequestOptions | undefined,
  actionDescription: string
): Promise<Result<void>> {
  const result = await httpClient.request<unknown>({
    path,
    method: 'PATCH',
    body,
    timeoutMs: timeoutFor(config, options),
    requestId: options?.requestId,
  });

  if (result.ok) {
    return ok(undefined);
  }

  if (result.error.code === 'MALFORMED_ENVELOPE') {
    return ok(undefined);
  }

  if (result.error.code === 'API_ERROR') {
    return err(new Error(`HTTP ${String(result.error.status)}: Failed to ${actionDescription}`));
  }

  return err(new Error(`Network error: ${result.error.message}`));
}

function mapTransportToServiceClientError(transportError: {
  code: 'TIMEOUT' | 'NETWORK_ERROR';
  message: string;
}): ServiceClientError {
  return {
    code: 'NETWORK_ERROR',
    message: transportError.message,
  };
}

export function createActionsAgentServiceClient(
  config: ActionsAgentServiceConfig
): ActionsAgentServiceClient {
  const httpClient = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  });

  return {
    async createAction<TAction>(
      request: CreateActionRequest,
      options?: ActionsAgentRequestOptions
    ): Promise<Result<TAction>> {
      const result = await httpClient.request<TAction>({
        path: '/internal/actions',
        method: 'POST',
        body: request,
        timeoutMs: timeoutFor(config, options),
        requestId: options?.requestId,
      });

      if (result.ok) {
        return ok(result.value);
      }

      if (result.error.code === 'API_ERROR') {
        return err(
          new Error(
            `Failed to create action: ${String(result.error.status)} ${result.error.statusText} - ${result.error.rawText}`
          )
        );
      }

      if (result.error.code === 'ENVELOPE_ERROR' || result.error.code === 'MALFORMED_ENVELOPE') {
        return err(new Error('Failed to create action: response.success is false'));
      }

      return err(new Error(`Failed to create action: ${result.error.message}`));
    },

    async getAction<TAction>(
      actionId: string,
      options?: ActionsAgentRequestOptions
    ): Promise<Result<TAction | null>> {
      const result = await httpClient.request<TAction>({
        path: `/internal/actions/${actionId}`,
        method: 'GET',
        extraHeaders: { 'Content-Type': 'application/json' },
        timeoutMs: timeoutFor(config, options),
        requestId: options?.requestId,
        allowRawSuccess: true,
      });

      if (result.ok) {
        return ok(result.value);
      }

      if (result.error.code === 'API_ERROR' && result.error.status === 404) {
        return ok(null);
      }

      if (result.error.code === 'API_ERROR') {
        return err(new Error(`HTTP ${String(result.error.status)}: Failed to get action`));
      }

      return err(new Error(`Network error: ${result.error.message}`));
    },

    async updateActionStatus(
      actionId: string,
      status: string,
      options?: ActionsAgentRequestOptions
    ): Promise<Result<void>> {
      return await sendActionMutation(
        config,
        httpClient,
        `/internal/actions/${actionId}`,
        { status },
        options,
        'update action status'
      );
    },

    async updateAction(
      actionId: string,
      update: UpdateActionRequest,
      options?: ActionsAgentRequestOptions
    ): Promise<Result<void>> {
      return await sendActionMutation(
        config,
        httpClient,
        `/internal/actions/${actionId}`,
        update,
        options,
        'update action'
      );
    },

    async updateResourceStatus(
      actionId: string,
      status: string,
      resourceResult?: UpdateActionResourceResult,
      options?: ActionsAgentTraceOptions
    ): Promise<Result<void, ServiceClientError>> {
      try {
        const result = await httpClient.request<unknown>({
          path: `/internal/actions/${actionId}/status`,
          method: 'PATCH',
          extraHeaders:
            options?.traceId === undefined ? undefined : { 'X-Trace-Id': options.traceId },
          body: {
            resource_status: status,
            ...(resourceResult !== undefined ? { resource_result: resourceResult } : {}),
          },
          timeoutMs: timeoutFor(config, options),
          requestId: options?.requestId,
        });

        if (result.ok) {
          return ok(undefined);
        }

        if (result.error.code === 'MALFORMED_ENVELOPE') {
          return ok(undefined);
        }

        if (result.error.code === 'TIMEOUT' || result.error.code === 'NETWORK_ERROR') {
          return err(mapTransportToServiceClientError(result.error));
        }

        if (result.error.code === 'API_ERROR') {
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(result.error.status)}`,
          });
        }

        return err({
          code: 'API_ERROR',
          message: result.error.message,
        });
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }
    },
  };
}
