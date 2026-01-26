/**
 * HTTP client for Code Agent service.
 *
 * Based on design doc: docs/designs/INT-156-code-action-type.md
 * - API contract: lines 1454-1469
 * - Internal authentication: lines 1585-1598
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { CodeAgentClient, CodeAgentError } from '../../domain/ports/codeAgentClient.js';
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
  };
}
