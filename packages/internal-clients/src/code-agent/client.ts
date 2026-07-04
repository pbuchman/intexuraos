import { err, ok, type Result } from '@intexuraos/common-core';
import {
  createInternalHttpClient,
  type InternalHttpClientError,
} from '../shared/createInternalHttpClient.js';
import type {
  CancelTaskError,
  CancelTaskWithNonceInput,
  CancelTaskWithNonceOutput,
  CodeAgentRequestOptions,
  CodeAgentServiceClient,
  CodeAgentServiceConfig,
  CreateCodeTaskRequest,
  NotifyGroupSummaryRecomputeError,
  NotifyGroupSummaryRecomputeRequest,
  SubmitTaskError,
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

interface SubmitTaskData {
  codeTaskId?: string;
  resourceUrl?: string;
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

function isSuccessWithoutDataEnvelope(error: { body?: unknown }): boolean {
  return (
    error.body !== null &&
    typeof error.body === 'object' &&
    'success' in error.body &&
    error.body.success === true &&
    !('data' in error.body)
  );
}

function toSubmitTaskSuccess(data: SubmitTaskData): Result<SubmitTaskResponse, SubmitTaskError> {
  if (data.codeTaskId === undefined || data.resourceUrl === undefined) {
    return err({
      code: 'UNKNOWN',
      message: 'Invalid response from code-agent',
      status: 200,
    });
  }
  return ok({
    codeTaskId: data.codeTaskId,
    resourceUrl: data.resourceUrl,
  });
}

function toSubmitTaskError(error: InternalHttpClientError): SubmitTaskError {
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
    return {
      code: 'NETWORK_ERROR',
      message: toNetworkErrorMessage(error.message),
    };
  }

  if (error.code !== 'API_ERROR') {
    return {
      code: 'UNKNOWN',
      message: 'Invalid response from code-agent',
    };
  }

  if (error.status === 409) {
    const message = readErrorMessage(error.body, 'Task already exists for this request');
    const { existingTaskId } = readErrorDetails(error.body);
    return {
      code: 'DUPLICATE',
      message,
      status: 409,
      ...(existingTaskId !== undefined ? { existingTaskId } : {}),
    };
  }

  if (error.status === 424 || error.status === 503) {
    return {
      code: 'WORKER_UNAVAILABLE',
      message: readErrorMessage(error.body, 'No workers available'),
      status: 503,
    };
  }

  if (error.status >= 500) {
    return {
      code: 'UNAVAILABLE',
      message: 'code-agent unavailable',
      status: error.status,
    };
  }

  return {
    code: 'INVALID_REQUEST',
    message: error.rawText !== '' ? error.rawText : `Unexpected response: ${String(error.status)}`,
    status: error.status,
  };
}

export function createCodeAgentServiceClient(
  config: CodeAgentServiceConfig
): CodeAgentServiceClient {
  const httpClient = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  });

  return {
    async createCodeTask(
      input: CreateCodeTaskRequest,
      options?: CodeAgentRequestOptions
    ): Promise<Result<SubmitTaskResponse, SubmitTaskError>> {
      const result = await httpClient.request<SubmitTaskData>({
        path: '/internal/code/submit',
        method: 'POST',
        body: input,
        timeoutMs: resolveTimeoutMs(60_000, config, options),
        requestId: options?.requestId,
      });

      if (result.ok) {
        return toSubmitTaskSuccess(result.value);
      }

      return err(toSubmitTaskError(result.error));
    },

    async cancelTaskWithNonce(
      input: CancelTaskWithNonceInput,
      options?: CodeAgentRequestOptions
    ): Promise<Result<CancelTaskWithNonceOutput, CancelTaskError>> {
      const result = await httpClient.request<unknown>({
        path: '/internal/code/cancel-with-nonce',
        method: 'POST',
        body: input,
        timeoutMs: resolveTimeoutMs(30_000, config, options),
        requestId: options?.requestId,
        allowRawSuccess: true,
      });

      if (result.ok) {
        return ok({ cancelled: true });
      }

      if (
        result.error.code === 'MALFORMED_ENVELOPE' &&
        isSuccessWithoutDataEnvelope(result.error)
      ) {
        return ok({ cancelled: true });
      }

      if (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT') {
        return err({
          code: 'NETWORK_ERROR',
          message: toNetworkErrorMessage(result.error.message),
        });
      }

      if (result.error.code !== 'API_ERROR') {
        return err({
          code: 'UNKNOWN',
          message: result.error.message,
        });
      }

      const errorCode = readErrorCode(result.error.body) ?? '';
      const errorMessage = readErrorMessage(result.error.body, 'Unknown error');

      if (result.error.status === 404) {
        return err({ code: 'TASK_NOT_FOUND', message: errorMessage });
      }

      if (result.error.status === 403) {
        return err({ code: 'NOT_OWNER', message: errorMessage });
      }

      if (result.error.status === 400) {
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
        message: `Unexpected response: ${String(result.error.status)}`,
      });
    },

    async submitToPhase2(
      input: SubmitToPhase2Input,
      options?: CodeAgentRequestOptions
    ): Promise<Result<SubmitToPhase2Output, SubmitToPhase2Error>> {
      const result = await httpClient.request<SubmitToPhase2Output>({
        path: '/internal/code/submit-phase2',
        method: 'POST',
        body: input,
        timeoutMs: resolveTimeoutMs(30_000, config, options),
        requestId: options?.requestId,
      });

      if (result.ok) {
        return ok(result.value);
      }

      if (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT') {
        return err({
          code: 'NETWORK_ERROR',
          message: toNetworkErrorMessage(result.error.message),
        });
      }

      if (result.error.code !== 'API_ERROR') {
        return err({
          code: 'UNKNOWN',
          message: result.error.message,
        });
      }

      const errorCode = readErrorCode(result.error.body) ?? '';
      const errorMessage = readErrorMessage(result.error.body, 'Unknown error');
      const { existingTaskId, serverCode } = readErrorDetails(result.error.body);

      if (result.error.status === 404) {
        return err({ code: 'TASK_NOT_FOUND', message: errorMessage });
      }

      if (result.error.status === 400) {
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

      if (result.error.status === 409) {
        if (serverCode === 'active_task_exists') {
          return err({ code: 'ACTIVE_TASK_EXISTS', message: errorMessage });
        }
        return err({
          code: 'ALREADY_IMPLEMENTED',
          message: errorMessage,
          ...(existingTaskId !== undefined ? { existingTaskId } : {}),
        });
      }

      if (result.error.status === 503) {
        return err({ code: 'WORKER_NOT_CONFIGURED', message: errorMessage });
      }

      if (result.error.status === 422 && errorCode === 'PLAN_PR_MERGE_FAILED') {
        return err({ code: 'PLAN_PR_MERGE_FAILED', message: errorMessage });
      }

      return err({
        code: 'UNKNOWN',
        message: `Unexpected response: ${String(result.error.status)}`,
      });
    },

    async notifyGroupSummaryRecompute(
      request: NotifyGroupSummaryRecomputeRequest,
      options?: CodeAgentRequestOptions
    ): Promise<Result<void, NotifyGroupSummaryRecomputeError>> {
      const result = await httpClient.request<unknown>({
        path: '/internal/code/group-summary/recompute',
        method: 'POST',
        body: request,
        timeoutMs: resolveTimeoutMs(30_000, config, options),
        requestId: options?.requestId,
        skipSentry: true,
      });

      if (result.ok) {
        return ok(undefined);
      }

      if (
        result.error.code === 'MALFORMED_ENVELOPE' &&
        isSuccessWithoutDataEnvelope(result.error)
      ) {
        return ok(undefined);
      }

      if (result.error.code === 'NETWORK_ERROR' || result.error.code === 'TIMEOUT') {
        return err({
          code: result.error.code === 'TIMEOUT' ? 'UNAVAILABLE' : 'UNKNOWN',
          message: result.error.code === 'TIMEOUT' ? 'Request timed out' : result.error.message,
        });
      }

      if (result.error.code === 'API_ERROR') {
        if (result.error.status >= 500) {
          return err({
            code: 'UNAVAILABLE',
            message: 'code-agent unavailable',
          });
        }
        return err({
          code: 'INVALID_REQUEST',
          message:
            result.error.rawText !== ''
              ? result.error.rawText
              : `HTTP ${String(result.error.status)}: ${result.error.statusText}`,
          status: result.error.status,
        });
      }

      return err({
        code: 'INVALID_REQUEST',
        message: result.error.message,
      });
    },
  };
}
