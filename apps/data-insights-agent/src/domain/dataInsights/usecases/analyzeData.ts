/**
 * Analyze data use case (User Story 1).
 * Analyzes composite feed snapshot and generates up to 5 data insights.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { CompositeFeedRepository } from '../../compositeFeed/index.js';
import type { SnapshotRepository } from '../../snapshot/index.js';
import type { DataAnalysisService } from '../../../infra/gemini/dataAnalysisService.js';
import type { ChartTypeInfo } from '@intexuraos/llm-common';
import type { DataInsight } from '../types.js';
import { CHART_TYPES } from '../chartTypes.js';

export interface AnalyzeDataDeps {
  compositeFeedRepository: CompositeFeedRepository;
  snapshotRepository: SnapshotRepository;
  dataAnalysisService: DataAnalysisService;
}

export interface AnalyzeDataError {
  code:
    | 'FEED_NOT_FOUND'
    | 'SNAPSHOT_NOT_FOUND'
    | 'REPOSITORY_ERROR'
    | 'ANALYSIS_ERROR'
    | 'NO_INSIGHTS';
  message: string;
}

export interface AnalyzeDataResult {
  insights: DataInsight[];
  noInsightsReason?: string;
}

/**
 * Build JSON schema representation of composite feed data.
 * Returns a simplified schema that describes the structure.
 */
function buildCompositeFeedSchema(): object {
  return {
    type: 'object',
    properties: {
      feedId: { type: 'string' },
      feedName: { type: 'string' },
      purpose: { type: 'string' },
      generatedAt: { type: 'string', format: 'date-time' },
      staticSources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
      notifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string' },
            criteria: {
              type: 'object',
              properties: {
                app: { type: 'array', items: { type: 'string' } },
                source: { type: 'string' },
                title: { type: 'string' },
              },
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  app: { type: 'string' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  timestamp: { type: 'string' },
                  source: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Convert CHART_TYPES to ChartTypeInfo format for LLM.
 */
function buildChartTypesInfo(): ChartTypeInfo[] {
  return CHART_TYPES.map((ct) => ({
    id: ct.id,
    name: ct.name,
    bestFor: ct.bestFor,
    vegaLiteSchema: ct.vegaLiteSchema,
  }));
}

/**
 * Analyze composite feed data and generate insights.
 */
export async function analyzeData(
  feedId: string,
  userId: string,
  deps: AnalyzeDataDeps
): Promise<Result<AnalyzeDataResult, AnalyzeDataError>> {
  const { compositeFeedRepository, snapshotRepository, dataAnalysisService } = deps;

  const feedResult = await compositeFeedRepository.getById(feedId, userId);
  if (!feedResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: feedResult.error,
    });
  }

  if (feedResult.value === null) {
    return err({
      code: 'FEED_NOT_FOUND',
      message: 'Composite feed not found',
    });
  }

  const snapshotResult = await snapshotRepository.getByFeedId(feedId, userId);
  if (!snapshotResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: snapshotResult.error,
    });
  }

  if (snapshotResult.value === null) {
    return err({
      code: 'SNAPSHOT_NOT_FOUND',
      message: 'No snapshot available. Please refresh the feed first.',
    });
  }

  const snapshot = snapshotResult.value;
  const jsonSchema = buildCompositeFeedSchema();
  const chartTypes = buildChartTypesInfo();

  const analysisResult = await dataAnalysisService.analyzeData(
    userId,
    jsonSchema,
    snapshot.data,
    chartTypes
  );

  if (!analysisResult.ok) {
    return err({
      code: 'ANALYSIS_ERROR',
      message: analysisResult.error.message,
    });
  }

  const { insights: parsedInsights, noInsightsReason } = analysisResult.value;

  if (parsedInsights.length === 0 && noInsightsReason !== undefined) {
    return err({
      code: 'NO_INSIGHTS',
      message: noInsightsReason,
    });
  }

  const now = new Date().toISOString();
  const insights: DataInsight[] = parsedInsights.map((pi, idx) => ({
    id: `${feedId}-insight-${idx + 1}`,
    title: pi.title,
    description: pi.description,
    trackableMetric: pi.trackableMetric,
    suggestedChartType: pi.suggestedChartType as DataInsight['suggestedChartType'],
    generatedAt: now,
  }));

  const updateResult = await compositeFeedRepository.updateDataInsights(feedId, userId, insights);

  if (!updateResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: updateResult.error,
    });
  }

  return ok({ insights, noInsightsReason });
}
