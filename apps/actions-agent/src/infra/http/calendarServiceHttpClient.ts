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
  success: boolean;
  data?: {
    status: 'completed' | 'failed';
    resource_url?: string;
    error?: string;
  };
  error?: { code: string; message: string };
}

export function createCalendarServiceHttpClient(
  config: CalendarServiceHttpClientConfig
): CalendarServiceClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async processAction(request: ProcessCalendarRequest): Promise<Result<ProcessCalendarResponse>> {
      const url = `${config.baseUrl}/internal/calendar/process`;
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

      const body = (await response.json()) as ApiResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from calendar-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from calendar-agent'));
      }

      const result: ProcessCalendarResponse = {
        status: body.data.status,
        ...(body.data.resource_url !== undefined && { resource_url: body.data.resource_url }),
        ...(body.data.error !== undefined && { error: body.data.error }),
      };

      logger.info({ actionId: request.action.id, status: result.status }, 'Calendar action processed');
      return ok(result);
    },
  };
}
