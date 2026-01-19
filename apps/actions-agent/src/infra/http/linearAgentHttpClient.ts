/**
 * HTTP client for Linear Agent service.
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ServiceFeedback } from '@intexuraos/common-core';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import pino, { type Logger } from 'pino';

export interface LinearAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: Logger;
}

const defaultLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'linearAgentHttpClient',
});

interface ApiResponse {
  success: boolean;
  data?: {
    status: 'completed' | 'failed';
    message: string;
    resourceUrl?: string;
    errorCode?: string;
  };
  error?: { code: string; message: string };
}

export function createLinearAgentHttpClient(
  config: LinearAgentHttpClientConfig
): LinearAgentClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async processAction(
      actionId: string,
      userId: string,
      text: string,
      summary?: string
    ): Promise<Result<ServiceFeedback>> {
      const url = `${config.baseUrl}/internal/linear/process-action`;
      const timeoutMs = 60_000; // 60 second timeout

      logger.info(
        { url, actionId, userId, textLength: text.length, hasSummary: summary !== undefined },
        'Processing linear action via linear-agent'
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
            action: {
              id: actionId,
              userId,
              text,
              ...(summary !== undefined && { summary }),
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to call linear-agent');
        return err(new Error(`Failed to call linear-agent: ${getErrorMessage(error)}`));
      }

      let body: ApiResponse;
      try {
        body = (await response.json()) as ApiResponse;
      } catch {
        if (!response.ok) {
          logger.error(
            { httpStatus: response.status, statusText: response.statusText },
            'linear-agent returned error (non-JSON response)'
          );
          return err(new Error(`HTTP ${String(response.status)}: ${response.statusText}`));
        }
        logger.error({ httpStatus: response.status }, 'Invalid JSON response from linear-agent');
        return err(new Error('Invalid response from linear-agent'));
      }

      if (!response.ok) {
        const errorCode = body.error?.code;
        const errorMessage = body.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
        logger.error(
          { httpStatus: response.status, statusText: response.statusText, errorCode, errorMessage },
          'linear-agent returned error'
        );
        return ok({
          status: 'failed',
          message: errorMessage,
          ...(errorCode !== undefined && { errorCode }),
        });
      }
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from linear-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from linear-agent'));
      }

      const result: ServiceFeedback = {
        status: body.data.status,
        message: body.data.message,
        ...(body.data.resourceUrl !== undefined && { resourceUrl: body.data.resourceUrl }),
        ...(body.data.errorCode !== undefined && { errorCode: body.data.errorCode }),
      };

      logger.info({ actionId, status: result.status }, 'Linear action processed');
      return ok(result);
    },
  };
}
