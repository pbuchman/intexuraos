import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  CalendarServiceClient,
  ProcessCalendarRequest,
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
    message: string;
    resourceUrl?: string;
    errorCode?: string;
  };
  error?: { code: string; message: string };
}

export function createCalendarServiceHttpClient(
  config: CalendarServiceHttpClientConfig
): CalendarServiceClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async processAction(request: ProcessCalendarRequest): Promise<Result<ServiceFeedback>> {
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
        let errorMessage = `HTTP ${String(response.status)}: ${response.statusText}`;

        try {
          const errorBody = (await response.json()) as {
            error?: { message?: string; code?: string };
          };
          if (errorBody.error?.message !== undefined) {
            errorMessage = errorBody.error.message;
          }
        } catch {
          // Failed to parse error body, use generic message
        }

        logger.error(
          { httpStatus: response.status, statusText: response.statusText, errorMessage },
          'calendar-agent returned error'
        );
        return err(new Error(errorMessage));
      }

      const body = (await response.json()) as ApiResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from calendar-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from calendar-agent'));
      }

      const result: ServiceFeedback = {
        status: body.data.status,
        message: body.data.message,
        ...(body.data.resourceUrl !== undefined && { resourceUrl: body.data.resourceUrl }),
        ...(body.data.errorCode !== undefined && { errorCode: body.data.errorCode }),
      };

      logger.info({ actionId: request.action.id, status: result.status }, 'Calendar action processed');
      return ok(result);
    },
  };
}
