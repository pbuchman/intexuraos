/**
 * HTTP client for Code Agent service.
 *
 * Based on design doc: docs/designs/INT-156-code-action-type.md
 * - API contract: lines 1454-1469
 * - Internal authentication: lines 1585-1598
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { CodeAgentClient, CodeAgentError, CancelTaskError, CancelTaskWithNonceInput, CancelTaskWithNonceOutput } from '../../domain/ports/codeAgentClient.js';
import type { CodeActionPayload } from '../../domain/models/action.js';
import pino, { type Logger } from 'pino';

export interface CodeAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: Logger;
}

const defaultLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'codeAgentHttpClient',
});

interface ApiResponse {
  codeTaskId: string;
  resourceUrl: string;
}

interface ErrorResponse {
  error?: string;
  existingTaskId?: string;
}

export function createCodeAgentHttpClient(
  config: CodeAgentHttpClientConfig
): CodeAgentClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async submitTask(input: {
      actionId: string;
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
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, timeoutMs);

        // Design line 1591: Authentication via X-Internal-Auth header
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            actionId: input.actionId,
            approvalEventId: input.approvalEventId,
            payload: input.payload,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
      } catch (error) {
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
          logger.info(
            { codeTaskId: body.codeTaskId, resourceUrl: body.resourceUrl },
            'Code task created successfully'
          );
          return ok({
            codeTaskId: body.codeTaskId,
            resourceUrl: body.resourceUrl,
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
          logger.info({ existingTaskId: body.existingTaskId }, 'Duplicate task detected');
          const error: CodeAgentError = {
            code: 'DUPLICATE',
            message: 'Task already exists for this approval',
          };
          if (body.existingTaskId !== undefined) {
            error.existingTaskId = body.existingTaskId;
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
          logger.warn({ error: body.error }, 'Code-agent worker unavailable');
          return err({
            code: 'WORKER_UNAVAILABLE',
            message: body.error ?? 'No workers available',
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
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, timeoutMs);

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

      if (response.status === 400) {
        // Map specific error codes from response
        const codeMap: Record<string, CancelTaskError['code']> = {
          'invalid_nonce': 'INVALID_NONCE',
          'nonce_expired': 'NONCE_EXPIRED',
          'not_owner': 'NOT_OWNER',
          'task_not_cancellable': 'TASK_NOT_CANCELLABLE',
        };
        const mappedCode = codeMap[errorCode] ?? 'UNKNOWN';
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
  };
}
