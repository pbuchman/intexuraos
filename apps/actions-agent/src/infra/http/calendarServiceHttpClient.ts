import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  CalendarServiceClient,
  ProcessCalendarRequest,
  ProcessCalendarResponse,
} from '../../domain/ports/calendarServiceClient.js';
import pino, { type Logger } from 'pino';

export interface CalendarServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: Logger;
}

const defaultLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'calendarServiceHttpClient',
});

interface ApiResponse {
  status: 'completed' | 'failed';
  resourceUrl?: string;
  error?: string;
}

function isValidApiResponse(value: unknown): value is ApiResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj['status'] === 'completed' || obj['status'] === 'failed';
}

export function createCalendarServiceHttpClient(
  config: CalendarServiceHttpClientConfig
): CalendarServiceClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async processAction(request: ProcessCalendarRequest): Promise<Result<ProcessCalendarResponse>> {
      const url = `${config.baseUrl}/internal/calendar/process-action`;
      const timeoutMs = 60_000; // 60 second timeout as specified

      logger.info(
        { url, actionId: request.action.id, userId: request.action.userId },
        'Processing calendar action via calendar-agent'
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
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to call calendar-agent');
        return err(new Error(`Failed to call calendar-agent: ${getErrorMessage(error)}`));
      }

      if (!response.ok) {
        logger.error(
          { httpStatus: response.status, statusText: response.statusText },
          'calendar-agent returned error'
        );
        return err(new Error(`HTTP ${String(response.status)}: ${response.statusText}`));
      }

      const body: unknown = await response.json();
      if (!isValidApiResponse(body)) {
        logger.error({ body }, 'Invalid response from calendar-agent');
        return err(new Error('Invalid response from calendar-agent: missing or invalid status'));
      }

      const result: ProcessCalendarResponse = {
        status: body.status,
        ...(body.resourceUrl !== undefined && { resource_url: body.resourceUrl }),
        ...(body.error !== undefined && { error: body.error }),
      };

      logger.info({ actionId: request.action.id, status: result.status }, 'Calendar action processed');
      return ok(result);
    },
  };
}
