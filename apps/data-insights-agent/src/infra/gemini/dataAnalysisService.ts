/**
 * Data analysis service using LLM client.
 * Analyzes composite feed data and generates up to 5 measurable insights.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import {
  dataAnalysisPrompt,
  parseInsightResponse,
  type ChartTypeInfo,
  type ParsedDataInsight,
} from '@intexuraos/llm-common';
import type { UserServiceClient } from '../user/userServiceClient.js';

/**
 * Error from data analysis operations.
 */
export interface DataAnalysisError {
  code: 'NO_API_KEY' | 'GENERATION_ERROR' | 'USER_SERVICE_ERROR' | 'PARSE_ERROR';
  message: string;
}

/**
 * Result of data analysis.
 */
export interface DataAnalysisResult {
  insights: ParsedDataInsight[];
  noInsightsReason?: string;
}

/**
 * Data analysis service interface.
 */
export interface DataAnalysisService {
  analyzeData(
    userId: string,
    jsonSchema: object,
    snapshotData: object,
    chartTypes: ChartTypeInfo[]
  ): Promise<Result<DataAnalysisResult, DataAnalysisError>>;
}

/**
 * Create a data analysis service.
 */
export function createDataAnalysisService(
  userServiceClient: UserServiceClient
): DataAnalysisService {
  return {
    async analyzeData(
      userId: string,
      jsonSchema: object,
      snapshotData: object,
      chartTypes: ChartTypeInfo[]
    ): Promise<Result<DataAnalysisResult, DataAnalysisError>> {
      const clientResult = await userServiceClient.getLlmClient(userId);

      if (!clientResult.ok) {
        const error = clientResult.error;
        if (error.code === 'NO_API_KEY') {
          return err({
            code: 'NO_API_KEY',
            message: 'Please configure your LLM API key in settings first',
          });
        }
        return err({
          code: 'USER_SERVICE_ERROR',
          message: error.message,
        });
      }

      const llmClient = clientResult.value;

      const prompt = dataAnalysisPrompt.build({
        jsonSchema,
        snapshotData,
        chartTypes,
      });

      const result = await llmClient.generate(prompt);

      if (!result.ok) {
        return err({
          code: 'GENERATION_ERROR',
          message: result.error.message,
        });
      }

      const responseContent = result.value.content.trim();

      try {
        const parsed = parseInsightResponse(responseContent);
        return ok(parsed);
      } catch (error) {
        return err({
          code: 'PARSE_ERROR',
          message: `Failed to parse LLM response: ${getErrorMessage(error, String(error))}`,
        });
      }
    },
  };
}
