import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { Visualization, CreateVisualizationRequest } from '@/types';

export async function createVisualization(
  accessToken: string,
  request: CreateVisualizationRequest
): Promise<Visualization> {
  return await apiRequest<Visualization>(
    config.dataInsightsAgentUrl,
    '/visualizations',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function listVisualizations(
  accessToken: string
): Promise<Visualization[]> {
  return await apiRequest<Visualization[]>(
    config.dataInsightsAgentUrl,
    '/visualizations',
    accessToken
  );
}

export async function getVisualization(
  accessToken: string,
  id: string
): Promise<Visualization> {
  return await apiRequest<Visualization>(
    config.dataInsightsAgentUrl,
    `/visualizations/${id}`,
    accessToken
  );
}

export async function deleteVisualization(
  accessToken: string,
  id: string
): Promise<void> {
  await apiRequest<Record<string, never>>(
    config.dataInsightsAgentUrl,
    `/visualizations/${id}`,
    accessToken,
    {
      method: 'DELETE',
    }
  );
}

export async function refreshVisualization(
  accessToken: string,
  id: string
): Promise<Visualization> {
  return await apiRequest<Visualization>(
    config.dataInsightsAgentUrl,
    `/visualizations/${id}/refresh`,
    accessToken,
    {
      method: 'POST',
    }
  );
}
