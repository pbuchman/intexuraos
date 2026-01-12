import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { DataInsight } from '@/types';

/**
 * Response from analyze endpoint.
 */
export interface AnalyzeDataResponse {
  insights: DataInsight[];
  noInsightsReason?: string;
}

/**
 * Chart definition response (ephemeral, not persisted).
 */
export interface ChartDefinition {
  vegaLiteConfig: object;
  dataTransformInstructions: string;
}

/**
 * Preview request body.
 */
export interface PreviewChartRequest {
  chartConfig: object;
  transformInstructions: string;
  insightId: string;
}

/**
 * Preview response.
 */
export interface PreviewChartResponse {
  chartData: unknown[];
}

/**
 * Analyze composite feed data and generate up to 5 data insights.
 */
export async function analyzeCompositeFeed(
  accessToken: string,
  feedId: string
): Promise<AnalyzeDataResponse> {
  return await apiRequest<AnalyzeDataResponse>(
    config.dataInsightsAgentUrl,
    `/composite-feeds/${feedId}/analyze`,
    accessToken,
    {
      method: 'POST',
    }
  );
}

/**
 * Generate ephemeral chart configuration for a specific insight.
 * Chart definition is not persisted (stored in React state only).
 */
export async function generateChartDefinition(
  accessToken: string,
  feedId: string,
  insightId: string
): Promise<ChartDefinition> {
  return await apiRequest<ChartDefinition>(
    config.dataInsightsAgentUrl,
    `/composite-feeds/${feedId}/insights/${insightId}/chart-definition`,
    accessToken,
    {
      method: 'POST',
    }
  );
}

/**
 * Transform snapshot data for chart preview.
 */
export async function previewChart(
  accessToken: string,
  feedId: string,
  request: PreviewChartRequest
): Promise<PreviewChartResponse> {
  return await apiRequest<PreviewChartResponse>(
    config.dataInsightsAgentUrl,
    `/composite-feeds/${feedId}/preview`,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}
