import type { CalendarPreview as ContractCalendarPreview } from '@intexuraos/http-contracts';
import { err, ok, type Result, type ServiceFeedback } from '@intexuraos/common-core';
import {
  createInternalHttpClient,
  type InternalHttpClient,
} from '../shared/createInternalHttpClient.js';
import { postServiceFeedback } from '../shared/serviceFeedback.js';
import type {
  CalendarAgentRequestOptions,
  CalendarAgentServiceClient,
  CalendarAgentServiceConfig,
  CalendarPreview,
  GeneratePreviewRequest,
  ProcessCalendarRequest,
} from './types.js';

const PROCESS_ACTION_TIMEOUT_MS = 60_000;
const GENERATE_PREVIEW_TIMEOUT_MS = 30_000;

interface CalendarErrorEnvelope {
  success?: boolean;
  error?: {
    message?: string;
  };
}

function resolveTimeoutMs(
  fallbackMs: number,
  config: CalendarAgentServiceConfig,
  options: CalendarAgentRequestOptions | undefined
): number;
function resolveTimeoutMs(
  fallbackMs: number | undefined,
  config: CalendarAgentServiceConfig,
  options: CalendarAgentRequestOptions | undefined
): number | undefined;
function resolveTimeoutMs(
  fallbackMs: number | undefined,
  config: CalendarAgentServiceConfig,
  options: CalendarAgentRequestOptions | undefined
): number | undefined {
  return options?.timeoutMs ?? fallbackMs ?? config.defaultTimeoutMs;
}

function toCalendarPreview(preview: ContractCalendarPreview | null): CalendarPreview | null {
  if (preview === null) {
    return null;
  }

  return {
    actionId: preview.actionId,
    userId: preview.userId,
    status: preview.status,
    generatedAt: preview.generatedAt,
    ...(preview.summary !== undefined ? { summary: preview.summary } : {}),
    ...(preview.start !== undefined ? { start: preview.start } : {}),
    ...(preview.end !== undefined ? { end: preview.end } : {}),
    ...(preview.location !== undefined ? { location: preview.location } : {}),
    ...(preview.description !== undefined ? { description: preview.description } : {}),
    ...(preview.duration !== undefined ? { duration: preview.duration } : {}),
    ...(preview.isAllDay !== undefined ? { isAllDay: preview.isAllDay } : {}),
    ...(preview.error !== undefined ? { error: preview.error } : {}),
    ...(preview.reasoning !== undefined ? { reasoning: preview.reasoning } : {}),
  };
}

async function readPreviewResponse(
  config: CalendarAgentServiceConfig,
  httpClient: InternalHttpClient,
  path: string,
  errorPrefix: string,
  body: unknown,
  method: 'GET' | 'POST',
  options: CalendarAgentRequestOptions | undefined,
  fallbackTimeoutMs?: number
): Promise<Result<CalendarPreview | null>> {
  const result = await httpClient.request<{ preview: ContractCalendarPreview | null }>({
    path,
    method,
    ...(body !== undefined ? { body } : {}),
    timeoutMs: resolveTimeoutMs(fallbackTimeoutMs, config, options),
    requestId: options?.requestId,
  });

  if (result.ok) {
    return ok(toCalendarPreview(result.value.preview));
  }

  if (result.error.code === 'API_ERROR') {
    const responseBody = result.error.body as CalendarErrorEnvelope;
    const message =
      (responseBody.success === true ? undefined : responseBody.error?.message) ??
      `HTTP ${String(result.error.status)}: ${result.error.statusText}`;
    return err(new Error(message));
  }

  if (result.error.code === 'ENVELOPE_ERROR' || result.error.code === 'MALFORMED_ENVELOPE') {
    const responseBody = result.error.body as CalendarErrorEnvelope;
    return err(
      new Error(
        (responseBody.success === true ? undefined : responseBody.error?.message) ??
          'Invalid response from calendar-agent'
      )
    );
  }

  return err(new Error(`${errorPrefix}: ${result.error.message}`));
}

export function createCalendarAgentServiceClient(
  config: CalendarAgentServiceConfig
): CalendarAgentServiceClient {
  const httpClient = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  });

  return {
    async processAction(
      request: ProcessCalendarRequest,
      options?: CalendarAgentRequestOptions
    ): Promise<Result<ServiceFeedback>> {
      const timeoutMs = resolveTimeoutMs(PROCESS_ACTION_TIMEOUT_MS, config, options);
      const serviceFeedbackOptions: CalendarAgentRequestOptions = {};
      if (options?.requestId !== undefined) {
        serviceFeedbackOptions.requestId = options.requestId;
      }
      serviceFeedbackOptions.timeoutMs = timeoutMs;

      return await postServiceFeedback(config, {
        path: '/internal/calendar/process-action',
        body: {
          action: {
            id: request.action.id,
            userId: request.action.userId,
            title: request.action.title,
          },
          text: request.text,
        },
        options: serviceFeedbackOptions,
        invalidJsonMessage: 'Invalid response from calendar-agent',
        invalidEnvelopeMessage: 'Invalid response from calendar-agent',
        networkErrorPrefix: 'Failed to call calendar-agent',
        getDefaultHttpErrorMessage: (response) =>
          `HTTP ${String(response.status)}: ${response.statusText}`,
      });
    },

    async getPreview(
      actionId: string,
      options?: CalendarAgentRequestOptions
    ): Promise<Result<CalendarPreview | null>> {
      return await readPreviewResponse(
        config,
        httpClient,
        `/internal/calendar/preview/${actionId}`,
        'Failed to fetch calendar preview',
        undefined,
        'GET',
        options
      );
    },

    async generatePreview(
      request: GeneratePreviewRequest,
      options?: CalendarAgentRequestOptions
    ): Promise<Result<CalendarPreview | null>> {
      return await readPreviewResponse(
        config,
        httpClient,
        '/internal/calendar/preview',
        'Failed to generate calendar preview',
        request,
        'POST',
        options,
        GENERATE_PREVIEW_TIMEOUT_MS
      );
    },
  };
}
