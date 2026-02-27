import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  CalendarServiceClient,
  ProcessCalendarRequest,
  CalendarPreview,
  GeneratePreviewRequest,
} from '../../domain/ports/calendarServiceClient.js';
import { createAppLogger } from '@intexuraos/infra-sentry';

type LogMethod = (obj: unknown, msg?: string) => void;

interface HttpLogger {
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
}

export interface CalendarServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: HttpLogger;
}

const defaultLogger = createAppLogger({ name: 'calendarServiceHttpClient' }) as unknown as HttpLogger;

interface ApiResponse {
  success: boolean;
  data?: {
    status: 'completed' | 'failed';
    message: string;
/* v8 ignore start -- test-infra: test mock for http responses always returns `ok: true` @preserve */
    resourceUrl?: string;
    /* v8 ignore stop @preserve */
    errorCode?: string;
  };
  error?: { code: string; message: string };
}

interface PreviewApiResponse {
  success: boolean;
  data?: {
    preview: CalendarPreview | null;
  };
  error?: { code: string; message: string };
}

interface FetchInternalOptions {
  method: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Shared HTTP fetch helper that handles timeout, auth headers, JSON parsing,
 * and common error cases for all calendar-agent HTTP calls.
 * Callers cast the returned `body` to the expected response type.
 */
async function fetchInternal(
  url: string,
  options: FetchInternalOptions,
  authToken: string,
  logger: HttpLogger,
  context: Record<string, unknown>,
  errorPrefix: string,
): Promise<Result<{ response: Response; body: unknown }>> {
  let response: Response;
  try {
    const headers: Record<string, string> = {
      'X-Internal-Auth': authToken,
    };
    if (options.method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const fetchInit: RequestInit = {
      method: options.method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    };

    if (options.timeoutMs !== undefined) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs);
      fetchInit.signal = controller.signal;
      response = await fetch(url, fetchInit);
      clearTimeout(timeoutId);
    } else {
      response = await fetch(url, fetchInit);
    }
  } catch (error) {
    logger.error({ error: getErrorMessage(error), ...context }, errorPrefix);
    return err(new Error(`${errorPrefix}: ${getErrorMessage(error)}`));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (!response.ok) {
      logger.error(
        { httpStatus: response.status, statusText: response.statusText, ...context },
        'calendar-agent returned error (non-JSON response)'
      );
      return err(new Error(`HTTP ${String(response.status)}: ${response.statusText}`));
    }
    logger.error({ httpStatus: response.status, ...context }, 'Invalid JSON response from calendar-agent');
    return err(new Error('Invalid response from calendar-agent'));
  }

  return ok({ response, body });
}

export function createCalendarServiceHttpClient(
  config: CalendarServiceHttpClientConfig
): CalendarServiceClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async processAction(request: ProcessCalendarRequest): Promise<Result<ServiceFeedback>> {
      const url = `${config.baseUrl}/internal/calendar/process-action`;
      const context = { url, actionId: request.action.id, userId: request.action.userId };

      logger.info(context, 'Processing calendar action via calendar-agent');

      const requestBody = {
        action: {
          id: request.action.id,
          userId: request.action.userId,
          title: request.action.title,
        },
        text: request.text,
      };

      const fetchResult = await fetchInternal(
        url,
        { method: 'POST', body: requestBody, timeoutMs: 60_000 },
        config.internalAuthToken,
        logger,
        context,
        'Failed to call calendar-agent',
      );

      if (!fetchResult.ok) {
        return fetchResult;
      }

      const { response } = fetchResult.value;
      const body = fetchResult.value.body as ApiResponse;

      if (!response.ok) {
        const errorCode = body.error?.code;
        const errorMessage = body.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
        logger.error(
          { httpStatus: response.status, statusText: response.statusText, errorCode, errorMessage },
          'calendar-agent returned error'
        );
        return ok({
          status: 'failed',
          message: errorMessage,
          ...(errorCode !== undefined && { errorCode }),
        });
      }
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

    async getPreview(actionId: string): Promise<Result<CalendarPreview | null>> {
      const url = `${config.baseUrl}/internal/calendar/preview/${actionId}`;
      const context = { url, actionId };

      logger.debug(context, 'Fetching calendar preview');

      const fetchResult = await fetchInternal(
        url,
        { method: 'GET' },
        config.internalAuthToken,
        logger,
        context,
        'Failed to fetch calendar preview',
      );

      if (!fetchResult.ok) {
        return fetchResult;
      }

      const { response } = fetchResult.value;
      const body = fetchResult.value.body as PreviewApiResponse;

      if (!response.ok) {
        /* v8 ignore start -- ts-type: API always returns error object with message @preserve */
        const errorMessage = body.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
        /* v8 ignore stop @preserve */
        logger.error(
          { httpStatus: response.status, statusText: response.statusText, errorMessage, actionId },
          'calendar-agent returned error'
        );
        return err(new Error(errorMessage));
      }

      if (!body.success || body.data === undefined) {
        logger.error({ body, actionId }, 'Invalid response from calendar-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from calendar-agent'));
      }

      logger.debug({ actionId, hasPreview: body.data.preview !== null }, 'Calendar preview fetched');
      return ok(body.data.preview);
    },

    async generatePreview(request: GeneratePreviewRequest): Promise<Result<CalendarPreview | null>> {
      const url = `${config.baseUrl}/internal/calendar/preview`;
      const context = { url, actionId: request.actionId, userId: request.userId };

      logger.info(context, 'Generating calendar preview via calendar-agent');

      // 30-second timeout for synchronous LLM-based preview generation.
      // This is on the approval flow critical path; if the LLM takes longer,
      // the caller (handleCalendarAction) falls back to a basic approval message.
      // Monitor approval message latency in production.
      const fetchResult = await fetchInternal(
        url,
        { method: 'POST', body: request, timeoutMs: 30_000 },
        config.internalAuthToken,
        logger,
        context,
        'Failed to generate calendar preview',
      );

      if (!fetchResult.ok) {
        return fetchResult;
      }

      const { response } = fetchResult.value;
      const body = fetchResult.value.body as PreviewApiResponse;

      if (!response.ok) {
        /* v8 ignore start -- ts-type: API always returns error object with message @preserve */
        const errorMessage = body.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
        /* v8 ignore stop @preserve */
        logger.error(
          { httpStatus: response.status, statusText: response.statusText, errorMessage, actionId: request.actionId },
          'calendar-agent returned error'
        );
        return err(new Error(errorMessage));
      }

      if (!body.success || body.data === undefined) {
        logger.error({ body, actionId: request.actionId }, 'Invalid response from calendar-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from calendar-agent'));
      }

      logger.info(
        { actionId: request.actionId, hasPreview: body.data.preview !== null },
        'Calendar preview generated'
      );
      return ok(body.data.preview);
    },
  };
}
