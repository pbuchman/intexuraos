/**
 * HTTP client for Code Agent service.
 *
 * Based on design doc: docs/designs/INT-156-code-action-type.md
 * - API contract: lines 1454-1469
 * - Internal authentication: lines 1585-1598
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { CodeAgentClient, CodeAgentError, CancelTaskError, CancelTaskWithNonceInput, CancelTaskWithNonceOutput, SubmitToPhase2Input, SubmitToPhase2Output, SubmitToPhase2Error } from '../../domain/ports/codeAgentClient.js';
import type { CodeActionPayload } from '../../domain/models/action.js';
import { createAppLogger } from '@intexuraos/infra-sentry';

type LogMethod = (obj: unknown, msg?: string) => void;

interface HttpLogger {
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
}

export interface CodeAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: HttpLogger;
}

const defaultLogger = createAppLogger({ name: 'codeAgentHttpClient' }) as unknown as HttpLogger;

interface ApiResponse {
  success: boolean;
  data?: {
    codeTaskId: string;
    resourceUrl: string;
  };
  error?: { code?: string; message?: string };
}

interface ErrorResponse {
  success: boolean;
  error?: {
    code?: string;
    message?: string;
    details?: {
      existingTaskId?: string;
    };
  };
}

export function createCodeAgentHttpClient(
  config: CodeAgentHttpClientConfig
): CodeAgentClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async submitTask(input: {
      actionId: string;
      userId: string;
      approvalEventId: string;
      payload: CodeActionPayload;
    }): Promise<Result<{ codeTaskId: string; resourceUrl: string }, CodeAgentError>> {
      const url = `${config.baseUrl}/internal/code/process`;
      const timeoutMs = 60_000; // 60 second timeout

      logger.info(
        {
          url,
          actionId: input.actionId,
          approvalEventId: input.approvalEventId,
          prompt: input.payload.prompt.substring(0, 50),
        },
        'Calling code-agent'
      );

      let response: Response;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        // Design line 1591: Authentication via X-Internal-Auth header
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            actionId: input.actionId,
            userId: input.userId,
            approvalEventId: input.approvalEventId,
            payload: input.payload,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        logger.error({ error: getErrorMessage(error) }, 'Failed to call code-agent');
        return err({
          code: 'NETWORK_ERROR',
          message: `Failed to call code-agent: ${getErrorMessage(error)}`,
        });
      }

      // Design lines 1462-1466: Success response (200)
      if (response.status === 200) {
        try {
          const body = (await response.json()) as ApiResponse;
          if (!body.success || body.data === undefined) {
            logger.error({ body }, 'Invalid response from code-agent');
            return err({
              code: 'UNKNOWN',
              message: 'Invalid response from code-agent',
            });
          }
          logger.info(
            { codeTaskId: body.data.codeTaskId, resourceUrl: body.data.resourceUrl },
            'Code task created successfully'
          );
          return ok({
            codeTaskId: body.data.codeTaskId,
            resourceUrl: body.data.resourceUrl,
          });
        } catch (error) {
          logger.error({ error: getErrorMessage(error) }, 'Invalid JSON response from code-agent');
          return err({
            code: 'UNKNOWN',
            message: 'Invalid response from code-agent',
          });
        }
      }

      // Design line 1467: Duplicate (409)
      if (response.status === 409) {
        try {
          const body = (await response.json()) as ErrorResponse;
          const existingTaskId = body.error?.details?.existingTaskId;
          logger.info({ existingTaskId }, 'Duplicate task detected');
          const error: CodeAgentError = {
            code: 'DUPLICATE',
            message: 'Task already exists for this approval',
          };
          if (existingTaskId !== undefined) {
            error.existingTaskId = existingTaskId;
          }
          return err(error);
        } catch {
          return err({
            code: 'DUPLICATE',
            message: 'Task already exists for this approval',
          });
        }
      }

      // Design line 1468: Worker unavailable (503)
      if (response.status === 503) {
        try {
          const body = (await response.json()) as ErrorResponse;
          const errorMessage = body.error?.message ?? 'No workers available';
          logger.warn({ error: errorMessage }, 'Code-agent worker unavailable');
          return err({
            code: 'WORKER_UNAVAILABLE',
            message: errorMessage,
          });
        } catch {
          return err({
            code: 'WORKER_UNAVAILABLE',
            message: 'No workers available',
          });
        }
      }

      // Unknown error
      logger.error(
        { httpStatus: response.status, statusText: response.statusText },
        'Unexpected response from code-agent'
      );
      return err({
        code: 'UNKNOWN',
        message: `Unexpected response: ${String(response.status)}`,
      });
    },

    async cancelTaskWithNonce(input: CancelTaskWithNonceInput): Promise<Result<CancelTaskWithNonceOutput, CancelTaskError>> {
      const url = `${config.baseUrl}/internal/code/cancel-with-nonce`;
      const timeoutMs = 30_000; // 30 second timeout

      logger.info(
        { url, taskId: input.taskId, userId: input.userId },
        'Calling code-agent cancel-with-nonce'
      );

      let response: Response;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            taskId: input.taskId,
            nonce: input.nonce,
            userId: input.userId,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        logger.error({ error: getErrorMessage(error), taskId: input.taskId }, 'Failed to call code-agent cancel-with-nonce');
        return err({
          code: 'NETWORK_ERROR',
          message: `Failed to call code-agent: ${getErrorMessage(error)}`,
        });
      }

      // Success response (200)
      if (response.status === 200) {
        logger.info({ taskId: input.taskId }, 'Task cancelled successfully via nonce');
        return ok({ cancelled: true });
      }

      // Parse error response
      let errorBody: { error?: { code?: string; message?: string } } = {};
      try {
        errorBody = (await response.json()) as typeof errorBody;
      } catch {
        // Ignore JSON parsing errors, use status-based defaults
      }

      const errorCode = errorBody.error?.code ?? '';
      const errorMessage = errorBody.error?.message ?? 'Unknown error';

      // Map HTTP status to error codes
      if (response.status === 404) {
        logger.info({ taskId: input.taskId }, 'Task not found for cancellation');
        return err({ code: 'TASK_NOT_FOUND', message: errorMessage });
      }

      if (response.status === 403) {
        // NOT_OWNER - user doesn't own the task
        logger.warn({ taskId: input.taskId, errorCode, errorMessage }, 'Cancel-with-nonce authorization failed');
        return err({ code: 'NOT_OWNER', message: errorMessage });
      }

      if (response.status === 400) {
        // Map specific error codes from response (now uppercase)
        const codeMap: Record<string, CancelTaskError['code']> = {
          'INVALID_NONCE': 'INVALID_NONCE',
          'NONCE_EXPIRED': 'NONCE_EXPIRED',
          'TASK_NOT_CANCELLABLE': 'TASK_NOT_CANCELLABLE',
        };
        const mappedCode = codeMap[errorCode];
        if (mappedCode === undefined) {
          // Protocol error: code-agent returned error code we don't recognize
          logger.error(
            { taskId: input.taskId, errorCode, errorMessage },
            'Unknown error code from code-agent - possible protocol version mismatch'
          );
          return err({
            code: 'UNKNOWN',
            message: `Code-agent returned unrecognized error code: ${errorCode}. Original message: ${errorMessage}`,
          });
        }
        logger.warn({ taskId: input.taskId, errorCode, errorMessage }, 'Cancel-with-nonce validation failed');
        return err({ code: mappedCode, message: errorMessage });
      }

      // Unknown error
      logger.error(
        { httpStatus: response.status, statusText: response.statusText, taskId: input.taskId },
        'Unexpected response from code-agent cancel-with-nonce'
      );
      return err({
        code: 'UNKNOWN',
        message: `Unexpected response: ${String(response.status)}`,
      });
    },

    async submitToPhase2(input: SubmitToPhase2Input): Promise<Result<SubmitToPhase2Output, SubmitToPhase2Error>> {
      const url = `${config.baseUrl}/internal/code/submit-phase2`;
      const timeoutMs = 30_000; // 30 second timeout

      logger.info(
        { url, taskId: input.taskId, userId: input.userId },
        'Calling code-agent submit-to-phase2'
      );

      let response: Response;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            taskId: input.taskId,
            userId: input.userId,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        logger.error({ error: getErrorMessage(error), taskId: input.taskId }, 'Failed to call code-agent submit-to-phase2');
        return err({
          code: 'NETWORK_ERROR',
          message: `Failed to call code-agent: ${getErrorMessage(error)}`,
        });
      }

      // Success response (200)
      if (response.status === 200) {
        try {
          const body = await response.json() as { success: boolean; data?: SubmitToPhase2Output };
          if (!body.success || body.data === undefined) {
            logger.error({ body }, 'Invalid response from code-agent submit-to-phase2');
            return err({
              code: 'UNKNOWN',
              message: 'Invalid response from code-agent',
            });
          }
          logger.info({ codeTaskId: body.data.codeTaskId }, 'Phase 2 submitted successfully');
          return ok({
            codeTaskId: body.data.codeTaskId,
            resourceUrl: body.data.resourceUrl,
            workerLocation: body.data.workerLocation,
            implementationOf: body.data.implementationOf,
          });
        } catch (error) {
          logger.error({ error: getErrorMessage(error) }, 'Invalid JSON response from code-agent submit-to-phase2');
          return err({
            code: 'UNKNOWN',
            message: 'Invalid response from code-agent',
          });
        }
      }

      // Parse error response
      let errorBody: { error?: { code?: string; message?: string; details?: { existingTaskId?: string; serverCode?: string } } } = {};
      try {
        errorBody = await response.json() as typeof errorBody;
      } catch {
        // Ignore JSON parsing errors
      }

      const errorCode = errorBody.error?.code ?? '';
      const errorMessage = errorBody.error?.message ?? 'Unknown error';
      const serverCode = errorBody.error?.details?.serverCode;

      // Map HTTP status to error codes
      if (response.status === 404) {
        logger.info({ taskId: input.taskId }, 'Task not found for submit-to-phase2');
        return err({ code: 'TASK_NOT_FOUND', message: errorMessage });
      }

      if (response.status === 400) {
        // Use serverCode from details (preserved by route handler) for precise mapping
        const serverCodeMap: Record<string, SubmitToPhase2Error['code']> = {
          'invalid_status': 'INVALID_STATUS',
          'no_linear_issue': 'NO_LINEAR_ISSUE',
          'label_not_ready': 'LABEL_NOT_READY',
        };
        if (serverCode !== undefined && serverCodeMap[serverCode] !== undefined) {
          return err({ code: serverCodeMap[serverCode], message: errorMessage });
        }
        // Fallback: map framework error code
        if (errorCode === 'INVALID_REQUEST') {
          return err({ code: 'INVALID_STATUS', message: errorMessage });
        }
        logger.warn({ taskId: input.taskId, errorCode, serverCode, errorMessage }, 'Unknown error from submit-to-phase2');
        return err({ code: 'UNKNOWN', message: errorMessage });
      }

      if (response.status === 409) {
        // Use serverCode to differentiate CONFLICT (active_task_exists) from already_implemented
        if (serverCode === 'active_task_exists') {
          return err({ code: 'ACTIVE_TASK_EXISTS', message: errorMessage });
        }
        const existingId = errorBody.error?.details?.existingTaskId;
        return err({
          code: 'ALREADY_IMPLEMENTED',
          message: errorMessage,
          ...(existingId !== undefined && { existingTaskId: existingId }),
        });
      }

      if (response.status === 503) {
        logger.warn({ taskId: input.taskId }, 'Worker not configured for submit-to-phase2');
        return err({ code: 'WORKER_NOT_CONFIGURED', message: errorMessage });
      }

      // Unknown error
      logger.error(
        { httpStatus: response.status, statusText: response.statusText, taskId: input.taskId },
        'Unexpected response from code-agent submit-to-phase2'
      );
      return err({
        code: 'UNKNOWN',
        message: `Unexpected response: ${String(response.status)}`,
      });
    },
  };
}
