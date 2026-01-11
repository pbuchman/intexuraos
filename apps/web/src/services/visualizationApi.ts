import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { Visualization, CreateVisualizationRequest, UpdateVisualizationRequest } from '@/types';

export async function createVisualization(
  accessToken: string,
  feedId: string,
  request: CreateVisualizationRequest
): Promise<Visualization> {
  return await apiRequest<Visualization>(
    config.dataInsightsAgentUrl,
    `/composite-feeds/${feedId}/visualizations`,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function listVisualizations(
  accessToken: string,
  feedId: string
): Promise<Visualization[]> {
  return await apiRequest<Visualization[]>(
    config.dataInsightsAgentUrl,
    `/composite-feeds/${feedId}/visualizations`,
    accessToken
  );
}

export async function getVisualization(
  accessToken: string,
  feedId: string,
  visualizationId: string
): Promise<Visualization> {
  return await apiRequest<Visualization>(
    config.dataInsightsAgentUrl,
    `/composite-feeds/${feedId}/visualizations/${visualizationId}`,
    accessToken
  );
}

export async function updateVisualization(
  accessToken: string,
  feedId: string,
  visualizationId: string,
  request: UpdateVisualizationRequest
): Promise<Visualization> {
  return await apiRequest<Visualization>(
    config.dataInsightsAgentUrl,
    `/composite-feeds/${feedId}/visualizations/${visualizationId}`,
    accessToken,
    {
      method: 'PATCH',
      body: request,
    }
  );
}

export async function deleteVisualization(
  accessToken: string,
  feedId: string,
  visualizationId: string
): Promise<void> {
  await apiRequest<undefined>(
    config.dataInsightsAgentUrl,
    `/composite-feeds/${feedId}/visualizations/${visualizationId}`,
    accessToken,
    {
      method: 'DELETE',
    }
  );
}

export async function regenerateVisualization(
  accessToken: string,
  feedId: string,
  visualizationId: string
): Promise<Visualization> {
  return await apiRequest<Visualization>(
    config.dataInsightsAgentUrl,
    `/composite-feeds/${feedId}/visualizations/${visualizationId}/regenerate`,
    accessToken,
    {
      method: 'POST',
    }
  );
}
