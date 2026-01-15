/**
 * HTTP client for Linear Agent service.
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type {
  LinearAgentClient,
  ProcessLinearActionResponse,
} from '../../domain/ports/linearAgentClient.js';
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
    resourceUrl?: string;
    issueIdentifier?: string;
    error?: string;
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
      title: string
    ): Promise<Result<ProcessLinearActionResponse>> {
      const url = `${config.baseUrl}/internal/linear/process-action`;
      const timeoutMs = 60_000; // 60 second timeout

      logger.info(
        { url, actionId, userId, title },
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
            action: { id: actionId, userId, title },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to call linear-agent');
        return err(new Error(`Failed to call linear-agent: ${getErrorMessage(error)}`));
      }

      if (!response.ok) {
        logger.error(
          { httpStatus: response.status, statusText: response.statusText },
          'linear-agent returned error'
        );
        return err(new Error(`HTTP ${String(response.status)}: ${response.statusText}`));
      }

      const body = (await response.json()) as ApiResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from linear-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from linear-agent'));
      }

      const result: ProcessLinearActionResponse = {
        status: body.data.status,
        ...(body.data.resourceUrl !== undefined && { resourceUrl: body.data.resourceUrl }),
        ...(body.data.issueIdentifier !== undefined && { issueIdentifier: body.data.issueIdentifier }),
        ...(body.data.error !== undefined && { error: body.data.error }),
      };

      logger.info({ actionId, status: result.status }, 'Linear action processed');
      return ok(result);
    },
  };
}
