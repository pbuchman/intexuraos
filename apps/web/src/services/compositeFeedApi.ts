import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  CompositeFeed,
  CreateCompositeFeedRequest,
  UpdateCompositeFeedRequest,
  CompositeFeedData,
  CompositeFeedSnapshot,
} from '@/types';

/**
 * Create a new composite feed.
 */
export async function createCompositeFeed(
  accessToken: string,
  request: CreateCompositeFeedRequest
): Promise<CompositeFeed> {
  return await apiRequest<CompositeFeed>(
    config.dataInsightsServiceUrl,
    '/composite-feeds',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

/**
 * List all composite feeds for the authenticated user.
 */
export async function listCompositeFeeds(accessToken: string): Promise<CompositeFeed[]> {
  return await apiRequest<CompositeFeed[]>(
    config.dataInsightsServiceUrl,
    '/composite-feeds',
    accessToken
  );
}

/**
 * Get a single composite feed by ID.
 */
export async function getCompositeFeed(accessToken: string, id: string): Promise<CompositeFeed> {
  return await apiRequest<CompositeFeed>(
    config.dataInsightsServiceUrl,
    `/composite-feeds/${id}`,
    accessToken
  );
}

/**
 * Update an existing composite feed.
 */
export async function updateCompositeFeed(
  accessToken: string,
  id: string,
  request: UpdateCompositeFeedRequest
): Promise<CompositeFeed> {
  return await apiRequest<CompositeFeed>(
    config.dataInsightsServiceUrl,
    `/composite-feeds/${id}`,
    accessToken,
    {
      method: 'PUT',
      body: request,
    }
  );
}

/**
 * Delete a composite feed.
 */
export async function deleteCompositeFeed(accessToken: string, id: string): Promise<void> {
  await apiRequest<undefined>(
    config.dataInsightsServiceUrl,
    `/composite-feeds/${id}`,
    accessToken,
    {
      method: 'DELETE',
    }
  );
}

/**
 * Get the JSON Schema for composite feed data.
 */
export async function getCompositeFeedSchema(accessToken: string, id: string): Promise<object> {
  return await apiRequest<object>(
    config.dataInsightsServiceUrl,
    `/composite-feeds/${id}/schema`,
    accessToken
  );
}

/**
 * Get aggregated data for a composite feed.
 */
export async function getCompositeFeedData(
  accessToken: string,
  id: string
): Promise<CompositeFeedData> {
  return await apiRequest<CompositeFeedData>(
    config.dataInsightsServiceUrl,
    `/composite-feeds/${id}/data`,
    accessToken
  );
}

/**
 * Get pre-computed snapshot for a composite feed.
 * Returns cached data computed by scheduler (refreshed every 15 minutes).
 * Use refresh=true to force recalculation.
 */
export async function getCompositeFeedSnapshot(
  accessToken: string,
  id: string,
  options?: { refresh?: boolean }
): Promise<CompositeFeedSnapshot | null> {
  try {
    const queryParams = options?.refresh === true ? '?refresh=true' : '';
    return await apiRequest<CompositeFeedSnapshot>(
      config.dataInsightsServiceUrl,
      `/composite-feeds/${id}/snapshot${queryParams}`,
      accessToken
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('NOT_FOUND')) {
      return null;
    }
    throw error;
  }
}
