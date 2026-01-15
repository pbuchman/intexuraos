/**
 * Analyze data use case (User Story 1).
 * Analyzes composite feed snapshot and generates up to 5 data insights.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { CompositeFeedRepository } from '../../compositeFeed/index.js';
import type { SnapshotRepository } from '../../snapshot/index.js';
import type { DataAnalysisService } from '../ports.js';
import type { ChartTypeInfo } from '@intexuraos/llm-common';
import type { DataInsight } from '../types.js';
import { CHART_TYPES } from '../chartTypes.js';

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface AnalyzeDataDeps {
  compositeFeedRepository: CompositeFeedRepository;
  snapshotRepository: SnapshotRepository;
  dataAnalysisService: DataAnalysisService;
  logger: BasicLogger;
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
  const { compositeFeedRepository, snapshotRepository, dataAnalysisService, logger } = deps;

  logger.info({ feedId, userId }, 'Starting data analysis');

  const feedResult = await compositeFeedRepository.getById(feedId, userId);
  if (!feedResult.ok) {
    logger.error({ feedId, userId, error: feedResult.error }, 'Failed to fetch composite feed');
    return err({
      code: 'REPOSITORY_ERROR',
      message: feedResult.error,
    });
  }

  if (feedResult.value === null) {
    logger.warn({ feedId, userId }, 'Composite feed not found');
    return err({
      code: 'FEED_NOT_FOUND',
      message: 'Composite feed not found',
    });
  }

  const snapshotResult = await snapshotRepository.getByFeedId(feedId, userId);
  if (!snapshotResult.ok) {
    logger.error({ feedId, userId, error: snapshotResult.error }, 'Failed to fetch snapshot');
    return err({
      code: 'REPOSITORY_ERROR',
      message: snapshotResult.error,
    });
  }

  if (snapshotResult.value === null) {
    logger.warn({ feedId, userId }, 'Snapshot not found');
    return err({
      code: 'SNAPSHOT_NOT_FOUND',
      message: 'No snapshot available. Please refresh the feed first.',
    });
  }

  const snapshot = snapshotResult.value;
  const jsonSchema = buildCompositeFeedSchema();
  const chartTypes = buildChartTypesInfo();

  logger.info({ feedId, userId, snapshotId: snapshot.feedId }, 'Starting LLM analysis');

  const analysisResult = await dataAnalysisService.analyzeData(
    userId,
    jsonSchema,
    snapshot.data,
    chartTypes
  );

  if (!analysisResult.ok) {
    logger.error({ feedId, userId, error: analysisResult.error.message }, 'LLM analysis failed');
    return err({
      code: 'ANALYSIS_ERROR',
      message: analysisResult.error.message,
    });
  }

  const { insights: parsedInsights, noInsightsReason } = analysisResult.value;

  if (parsedInsights.length === 0 && noInsightsReason !== undefined) {
    logger.info({ feedId, userId, reason: noInsightsReason }, 'No insights generated');
    return err({
      code: 'NO_INSIGHTS',
      message: noInsightsReason,
    });
  }

  const now = new Date().toISOString();
  const insights: DataInsight[] = parsedInsights.map((pi, idx) => ({
    id: `${feedId}-insight-${String(idx + 1)}`,
    title: pi.title,
    description: pi.description,
    trackableMetric: pi.trackableMetric,
    suggestedChartType: pi.suggestedChartType as DataInsight['suggestedChartType'],
    generatedAt: now,
  }));

  logger.info({ feedId, userId, insightCount: insights.length }, 'Insights generated successfully');

  const updateResult = await compositeFeedRepository.updateDataInsights(feedId, userId, insights);

  if (!updateResult.ok) {
    logger.error({ feedId, userId, error: updateResult.error }, 'Failed to update insights in repository');
    return err({
      code: 'REPOSITORY_ERROR',
      message: updateResult.error,
    });
  }

  logger.info({ feedId, userId, insightCount: insights.length }, 'Data analysis completed successfully');

  const result: AnalyzeDataResult = { insights };
  if (noInsightsReason !== undefined) {
    result.noInsightsReason = noInsightsReason;
  }

  return ok(result);
}
