/**
 * Port interfaces for data insights LLM services.
 * Domain layer defines these interfaces; infra layer implements them.
 */

import type { Result } from '@intexuraos/common-core';
import type { ChartTypeInfo, ParsedDataInsight, ParsedChartDefinition } from '@intexuraos/llm-common';

// ─────────────────────────────────────────────────────────────────────────────
// Data Analysis Service
// ─────────────────────────────────────────────────────────────────────────────

export interface DataAnalysisError {
  code: 'NO_API_KEY' | 'GENERATION_ERROR' | 'USER_SERVICE_ERROR' | 'PARSE_ERROR';
  message: string;
}

export interface DataAnalysisResult {
  insights: ParsedDataInsight[];
  noInsightsReason?: string;
}

export interface DataAnalysisService {
  analyzeData(
    userId: string,
    jsonSchema: object,
    snapshotData: object,
    chartTypes: ChartTypeInfo[]
  ): Promise<Result<DataAnalysisResult, DataAnalysisError>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart Definition Service
// ─────────────────────────────────────────────────────────────────────────────

export interface ChartDefinitionError {
  code: 'NO_API_KEY' | 'GENERATION_ERROR' | 'USER_SERVICE_ERROR' | 'PARSE_ERROR';
  message: string;
}

export interface ChartDefinitionService {
  generateChartDefinition(
    userId: string,
    jsonSchema: object,
    snapshotData: object,
    targetChartSchema: object,
    insight: {
      title: string;
      description: string;
      trackableMetric: string;
      suggestedChartType: string;
    }
  ): Promise<Result<ParsedChartDefinition, ChartDefinitionError>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Transform Service
// ─────────────────────────────────────────────────────────────────────────────

export interface DataTransformError {
  code: 'NO_API_KEY' | 'GENERATION_ERROR' | 'USER_SERVICE_ERROR' | 'PARSE_ERROR';
  message: string;
}

export interface DataTransformService {
  transformData(
    userId: string,
    jsonSchema: object,
    snapshotData: object,
    chartConfig: object,
    transformInstructions: string,
    insight: {
      title: string;
      trackableMetric: string;
    }
  ): Promise<Result<unknown[], DataTransformError>>;
}
