import { err, ok, type Result } from '@intexuraos/common-core';
import { sendInternalRequest } from '../shared/request.js';
import type {
  CancelTaskError,
  CancelTaskWithNonceInput,
  CancelTaskWithNonceOutput,
  CodeAgentRequestOptions,
  CodeAgentServiceClient,
  CodeAgentServiceConfig,
  NotifyGroupSummaryRecomputeError,
  NotifyGroupSummaryRecomputeRequest,
  SubmitTaskError,
  SubmitTaskRequest,
  SubmitTaskResponse,
  SubmitToPhase2Error,
  SubmitToPhase2Input,
  SubmitToPhase2Output,
} from './types.js';

interface ErrorBody {
  success?: boolean;
  error?:
    | {
        code?: string;
        message?: string;
        details?: {
          existingTaskId?: string;
          serverCode?: string;
        };
      }
    | string;
}

interface SubmitTaskBody {
  success?: boolean;
  data?: {
    codeTaskId?: string;
    taskId?: string;
    resourceUrl?: string;
  };
}

function resolveTimeoutMs(
  fallbackMs: number,
  config: CodeAgentServiceConfig,
  options: CodeAgentRequestOptions | undefined
): number {
  return options?.timeoutMs ?? config.defaultTimeoutMs ?? fallbackMs;
}

function readErrorMessage(body: unknown, fallback: string): string {
  if (body === null || typeof body !== 'object') {
    return fallback;
  }

  const errorBody = body as ErrorBody;
  if (typeof errorBody.error === 'string') {
    return errorBody.error;
  }
  return errorBody.error?.message ?? fallback;
}

function readErrorCode(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }

  const errorBody = body as ErrorBody;
  return typeof errorBody.error === 'object' ? errorBody.error.code : undefined;
}

function readErrorDetails(body: unknown): { existingTaskId?: string; serverCode?: string } {
  if (body === null || typeof body !== 'object') {
    return {};
  }

  const errorBody = body as ErrorBody;
  if (typeof errorBody.error !== 'object') {
    return {};
  }

  return {
    ...(errorBody.error.details?.existingTaskId !== undefined
      ? { existingTaskId: errorBody.error.details.existingTaskId }
      : {}),
    ...(errorBody.error.details?.serverCode !== undefined
      ? { serverCode: errorBody.error.details.serverCode }
      : {}),
  };
}

function toNetworkErrorMessage(errorMessage: string): string {
  return `Failed to call code-agent: ${errorMessage}`;
}

export function createCodeAgentServiceClient(
  config: CodeAgentServiceConfig
): CodeAgentServiceClient {
  return {
    async submitTask(
      input: SubmitTaskRequest,
      options?: CodeAgentRequestOptions
    ): Promise<Result<SubmitTaskResponse, SubmitTaskError>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: '/internal/code/process',
        method: 'POST',
        token: config.internalAuthToken,
        logger: config.logger,
        jsonBody: input,
        timeoutMs: resolveTimeoutMs(60_000, config, options),
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err({
          code: 'NETWORK_ERROR',
          message: toNetworkErrorMessage(transport.error.message),
        });
      }

      if (transport.response.status === 200) {
        const body = transport.body as SubmitTaskBody;
        const responseData = body.data;
        const legacyTaskId = responseData?.taskId;
        const codeTaskId = responseData?.codeTaskId ?? responseData?.taskId;
        if (
          body.success !== true ||
          codeTaskId === undefined ||
          (responseData?.resourceUrl === undefined && legacyTaskId === undefined)
        ) {
          return err({
            code: 'UNKNOWN',
            message: 'Invalid response from code-agent',
            status: 200,
          });
        }
        return ok({
          codeTaskId,
          // INT-1531 compatibility: older linear-agent tests still mock
          // `taskId` without `resourceUrl`; actions-agent callers still
          // receive the real resourceUrl from the route implementation.
          resourceUrl: responseData?.resourceUrl ?? '',
        });
      }

      if (transport.response.status === 409) {
        const message = readErrorMessage(transport.body, 'Task already exists for this approval');
        const { existingTaskId } = readErrorDetails(transport.body);
        return err({
          code: 'DUPLICATE',
          message,
          status: 409,
          ...(existingTaskId !== undefined ? { existingTaskId } : {}),
        });
      }

      if (transport.response.status === 503) {
        return err({
          code: 'WORKER_UNAVAILABLE',
          message: readErrorMessage(transport.body, 'No workers available'),
          status: 503,
        });
      }

      if (transport.response.status >= 500) {
        return err({
          code: 'UNAVAILABLE',
          message: 'code-agent unavailable',
          status: transport.response.status,
        });
      }

      return err({
        code: 'INVALID_REQUEST',
        message:
          transport.rawText !== ''
            ? transport.rawText
            : `Unexpected response: ${String(transport.response.status)}`,
        status: transport.response.status,
      });
    },

    async cancelTaskWithNonce(
      input: CancelTaskWithNonceInput,
      options?: CodeAgentRequestOptions
    ): Promise<Result<CancelTaskWithNonceOutput, CancelTaskError>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: '/internal/code/cancel-with-nonce',
        method: 'POST',
        token: config.internalAuthToken,
        logger: config.logger,
        jsonBody: input,
        timeoutMs: resolveTimeoutMs(30_000, config, options),
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err({
          code: 'NETWORK_ERROR',
          message: toNetworkErrorMessage(transport.error.message),
        });
      }

      if (transport.response.status === 200) {
        return ok({ cancelled: true });
      }

      const errorCode = readErrorCode(transport.body) ?? '';
      const errorMessage = readErrorMessage(transport.body, 'Unknown error');

      if (transport.response.status === 404) {
        return err({ code: 'TASK_NOT_FOUND', message: errorMessage });
      }

      if (transport.response.status === 403) {
        return err({ code: 'NOT_OWNER', message: errorMessage });
      }

      if (transport.response.status === 400) {
        const codeMap: Record<string, CancelTaskError['code']> = {
          INVALID_NONCE: 'INVALID_NONCE',
          NONCE_EXPIRED: 'NONCE_EXPIRED',
          TASK_NOT_CANCELLABLE: 'TASK_NOT_CANCELLABLE',
        };
        const mappedCode = codeMap[errorCode];
        if (mappedCode !== undefined) {
          return err({ code: mappedCode, message: errorMessage });
        }
        return err({
          code: 'UNKNOWN',
          message: `Code-agent returned unrecognized error code: ${errorCode}. Original message: ${errorMessage}`,
        });
      }

      return err({
        code: 'UNKNOWN',
        message: `Unexpected response: ${String(transport.response.status)}`,
      });
    },

    async submitToPhase2(
      input: SubmitToPhase2Input,
      options?: CodeAgentRequestOptions
    ): Promise<Result<SubmitToPhase2Output, SubmitToPhase2Error>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: '/internal/code/submit-phase2',
        method: 'POST',
        token: config.internalAuthToken,
        logger: config.logger,
        jsonBody: input,
        timeoutMs: resolveTimeoutMs(30_000, config, options),
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err({
          code: 'NETWORK_ERROR',
          message: toNetworkErrorMessage(transport.error.message),
        });
      }

      if (transport.response.status === 200) {
        const body = transport.body as { success?: boolean; data?: SubmitToPhase2Output };
        if (body.success !== true || body.data === undefined) {
          return err({
            code: 'UNKNOWN',
            message: 'Invalid response from code-agent',
          });
        }
        return ok(body.data);
      }

      const errorCode = readErrorCode(transport.body) ?? '';
      const errorMessage = readErrorMessage(transport.body, 'Unknown error');
      const { existingTaskId, serverCode } = readErrorDetails(transport.body);

      if (transport.response.status === 404) {
        return err({ code: 'TASK_NOT_FOUND', message: errorMessage });
      }

      if (transport.response.status === 400) {
        const serverCodeMap: Record<string, SubmitToPhase2Error['code']> = {
          invalid_status: 'INVALID_STATUS',
          no_linear_issue: 'NO_LINEAR_ISSUE',
          label_not_ready: 'LABEL_NOT_READY',
        };
        const mappedFromServerCode =
          serverCode !== undefined ? serverCodeMap[serverCode] : undefined;
        if (mappedFromServerCode !== undefined) {
          return err({ code: mappedFromServerCode, message: errorMessage });
        }
        if (errorCode === 'INVALID_REQUEST') {
          return err({ code: 'INVALID_STATUS', message: errorMessage });
        }
        return err({ code: 'UNKNOWN', message: errorMessage });
      }

      if (transport.response.status === 409) {
        if (serverCode === 'active_task_exists') {
          return err({ code: 'ACTIVE_TASK_EXISTS', message: errorMessage });
        }
        return err({
          code: 'ALREADY_IMPLEMENTED',
          message: errorMessage,
          ...(existingTaskId !== undefined ? { existingTaskId } : {}),
        });
      }

      if (transport.response.status === 503) {
        return err({ code: 'WORKER_NOT_CONFIGURED', message: errorMessage });
      }

      return err({
        code: 'UNKNOWN',
        message: `Unexpected response: ${String(transport.response.status)}`,
      });
    },

    async notifyGroupSummaryRecompute(
      request: NotifyGroupSummaryRecomputeRequest,
      options?: CodeAgentRequestOptions
    ): Promise<Result<void, NotifyGroupSummaryRecomputeError>> {
      const transport = await sendInternalRequest({
        baseUrl: config.baseUrl,
        path: '/internal/code/group-summary/recompute',
        method: 'POST',
        token: config.internalAuthToken,
        logger: config.logger,
        jsonBody: request,
        timeoutMs: resolveTimeoutMs(30_000, config, options),
        requestId: options?.requestId,
      });

      if (!transport.ok) {
        return err({
          code: transport.error.code === 'TIMEOUT' ? 'UNAVAILABLE' : 'UNKNOWN',
          message:
            transport.error.code === 'TIMEOUT' ? 'Request timed out' : transport.error.message,
        });
      }

      if (!transport.response.ok) {
        if (transport.response.status >= 500) {
          return err({
            code: 'UNAVAILABLE',
            message: 'code-agent unavailable',
          });
        }
        return err({
          code: 'INVALID_REQUEST',
          message:
            transport.rawText !== ''
              ? transport.rawText
              : `HTTP ${String(transport.response.status)}: ${transport.response.statusText}`,
          status: transport.response.status,
        });
      }

      return ok(undefined);
    },
  };
}
