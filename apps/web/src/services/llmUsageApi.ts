import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  ListLlmUsageEventsRequest,
  ListLlmUsageEventsResponse,
  GetUsageEventResponse,
  LlmUsageQueryRequest,
  LlmUsageQueryResponse,
  AllProvidersPricing,
} from '@/types';

export async function listLlmUsageEvents(
  accessToken: string,
  request: ListLlmUsageEventsRequest
): Promise<ListLlmUsageEventsResponse> {
  return await apiRequest<ListLlmUsageEventsResponse>(
    config.llmUsageServiceUrl,
    '/events/list',
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
    `/events/${encodeURIComponent(eventId)}`,
    accessToken
  );
}

export async function queryLlmUsage(
  accessToken: string,
  request: LlmUsageQueryRequest
): Promise<LlmUsageQueryResponse> {
  return await apiRequest<LlmUsageQueryResponse>(
    config.llmUsageServiceUrl,
    '/query',
    accessToken,
    { method: 'POST', body: request }
  );
}

export async function getLlmPricing(accessToken: string): Promise<AllProvidersPricing> {
  return await apiRequest<AllProvidersPricing>(
    config.llmUsageServiceUrl,
    '/pricing',
    accessToken
  );
}
