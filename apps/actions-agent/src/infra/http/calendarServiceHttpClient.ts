import { createCalendarAgentServiceClient } from '@intexuraos/internal-clients';
import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { InternalHttpClientLogger } from '@intexuraos/internal-clients';
import type {
  CalendarServiceClient,
  ProcessCalendarRequest,
  CalendarPreview,
  GeneratePreviewRequest,
} from '../../domain/ports/calendarServiceClient.js';

export interface CalendarServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
}

export function createCalendarServiceHttpClient(
  config: CalendarServiceHttpClientConfig
): CalendarServiceClient {
  const client = createCalendarAgentServiceClient(config);

  return {
    async processAction(request: ProcessCalendarRequest): Promise<Result<ServiceFeedback>> {
      return await client.processAction(request);
    },

    async getPreview(actionId: string): Promise<Result<CalendarPreview | null>> {
      return await client.getPreview(actionId);
    },

    async generatePreview(
      request: GeneratePreviewRequest
    ): Promise<Result<CalendarPreview | null>> {
      return await client.generatePreview(request);
    },
  };
}
