import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { sendInternalRequest } from '../shared/request.js';
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

interface CreateActionEnvelope<TAction> {
  success: boolean;
  data?: TAction;
}

function timeoutFor(
  config: ActionsAgentServiceConfig,
  options: ActionsAgentRequestOptions | undefined
): number | undefined {
  return options?.timeoutMs ?? config.defaultTimeoutMs;
}

async function sendActionMutation(
  config: ActionsAgentServiceConfig,
  path: string,
  body: unknown,
  options: ActionsAgentRequestOptions | undefined,
  actionDescription: string
): Promise<Result<void>> {
  const transport = await sendInternalRequest({
    baseUrl: config.baseUrl,
    path,
    method: 'PATCH',
    token: config.internalAuthToken,
    logger: config.logger,
    jsonBody: body,
    timeoutMs: timeoutFor(config, options),
    requestId: options?.requestId,
  });

  if (!transport.ok) {
    return err(new Error(`Network error: ${transport.error.message}`));
  }

  if (!transport.response.ok) {
    return err(
      new Error(`HTTP ${String(transport.response.status)}: Failed to ${actionDescription}`)
    );
  }

  return ok(undefined);
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
  return {
    async createAction<TAction>(
      request: CreateActionRequest,
      options?: ActionsAgentRequestOptions
    ): Promise<Result<TAction>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: '/internal/actions',
        method: 'POST',
        token: config.internalAuthToken,
        logger: config.logger,
        jsonBody: request,
        timeoutMs: timeoutFor(config, options),
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err(new Error(`Failed to create action: ${transport.error.message}`));
      }

      if (!transport.response.ok) {
        return err(
          new Error(
            `Failed to create action: ${String(transport.response.status)} ${transport.response.statusText} - ${transport.rawText}`
          )
        );
      }

      const body = transport.body as CreateActionEnvelope<TAction>;
      if (!body.success || body.data === undefined) {
        return err(new Error('Failed to create action: response.success is false'));
      }

      return ok(body.data);
    },

    async getAction<TAction>(
      actionId: string,
      options?: ActionsAgentRequestOptions
    ): Promise<Result<TAction | null>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: `/internal/actions/${actionId}`,
        method: 'GET',
        token: config.internalAuthToken,
        logger: config.logger,
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: timeoutFor(config, options),
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err(new Error(`Network error: ${transport.error.message}`));
      }

      if (transport.response.status === 404) {
        return ok(null);
      }

      if (!transport.response.ok) {
        return err(new Error(`HTTP ${String(transport.response.status)}: Failed to get action`));
      }

      return ok(transport.body as TAction);
    },

    async updateActionStatus(
      actionId: string,
      status: string,
      options?: ActionsAgentRequestOptions
    ): Promise<Result<void>> {
      return await sendActionMutation(
        config,
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
        `/internal/actions/${actionId}`,
        update,
        options,
        'update action'
      );
    },

    async updateResourceStatus(
      actionId: string,
      status: string,
      result?: UpdateActionResourceResult,
      options?: ActionsAgentTraceOptions
    ): Promise<Result<void, ServiceClientError>> {
      try {
        const transport = await sendInternalRequest({
          baseUrl: config.baseUrl,
          path: `/internal/actions/${actionId}/status`,
          method: 'PATCH',
          token: config.internalAuthToken,
          logger: config.logger,
          headers: options?.traceId === undefined ? undefined : { 'X-Trace-Id': options.traceId },
          jsonBody: {
            resource_status: status,
            ...(result !== undefined ? { resource_result: result } : {}),
          },
          timeoutMs: timeoutFor(config, options),
          requestId: options?.requestId,
        });

        if (!transport.ok) {
          return err(mapTransportToServiceClientError(transport.error));
        }

        if (!transport.response.ok) {
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(transport.response.status)}`,
          });
        }

        return ok(undefined);
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }
    },
  };
}
