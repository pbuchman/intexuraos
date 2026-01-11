import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  DataSource,
  CreateDataSourceRequest,
  UpdateDataSourceRequest,
  GenerateTitleResponse,
} from '@/types';

/**
 * Create a new data source.
 */
export async function createDataSource(
  accessToken: string,
  request: CreateDataSourceRequest
): Promise<DataSource> {
  return await apiRequest<DataSource>(config.dataInsightsAgentUrl, '/data-sources', accessToken, {
    method: 'POST',
    body: request,
  });
}

/**
 * List all data sources for the authenticated user.
 */
export async function listDataSources(accessToken: string): Promise<DataSource[]> {
  return await apiRequest<DataSource[]>(
    config.dataInsightsAgentUrl,
    '/data-sources',
    accessToken
  );
}

/**
 * Get a single data source by ID.
 */
export async function getDataSource(accessToken: string, id: string): Promise<DataSource> {
  return await apiRequest<DataSource>(
    config.dataInsightsAgentUrl,
    `/data-sources/${id}`,
    accessToken
  );
}

/**
 * Update an existing data source.
 */
export async function updateDataSource(
  accessToken: string,
  id: string,
  request: UpdateDataSourceRequest
): Promise<DataSource> {
  return await apiRequest<DataSource>(
    config.dataInsightsAgentUrl,
    `/data-sources/${id}`,
    accessToken,
    {
      method: 'PUT',
      body: request,
    }
  );
}

/**
 * Delete a data source.
 */
export async function deleteDataSource(accessToken: string, id: string): Promise<void> {
  await apiRequest<undefined>(config.dataInsightsAgentUrl, `/data-sources/${id}`, accessToken, {
    method: 'DELETE',
  });
}

/**
 * Generate a title for content using AI.
 */
export async function generateTitle(
  accessToken: string,
  content: string
): Promise<GenerateTitleResponse> {
  return await apiRequest<GenerateTitleResponse>(
    config.dataInsightsAgentUrl,
    '/data-sources/generate-title',
    accessToken,
    {
      method: 'POST',
      body: { content },
    }
  );
}
