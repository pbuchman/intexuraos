import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  ListLlmUsageEventsRequest,
  ListLlmUsageEventsResponse,
  GetUsageEventResponse,
  LlmUsageQueryRequest,
  LlmUsageQueryResponse,
} from '@/types';

export async function listLlmUsageEvents(
  accessToken: string,
  request: ListLlmUsageEventsRequest
): Promise<ListLlmUsageEventsResponse> {
  return await apiRequest<ListLlmUsageEventsResponse>(
    config.llmUsageServiceUrl,
    '/llm-usage/events/list',
    accessToken,
    { method: 'POST', body: request }
  );
}

export async function getLlmUsageEvent(
  accessToken: string,
  eventId: string
): Promise<GetUsageEventResponse> {
  return await apiRequest<GetUsageEventResponse>(
    config.llmUsageServiceUrl,
    `/llm-usage/events/${encodeURIComponent(eventId)}`,
    accessToken
  );
}

export async function queryLlmUsage(
  accessToken: string,
  request: LlmUsageQueryRequest
): Promise<LlmUsageQueryResponse> {
  return await apiRequest<LlmUsageQueryResponse>(
    config.llmUsageServiceUrl,
    '/llm-usage/query',
    accessToken,
    { method: 'POST', body: request }
  );
}
