/**
 * Data analysis service using Gemini.
 * Analyzes composite feed data and generates up to 5 measurable insights using user's Gemini API key.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';
import {
  dataAnalysisPrompt,
  parseInsightResponse,
  type ChartTypeInfo,
  type ParsedDataInsight,
} from '@intexuraos/llm-common';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import type { UserServiceClient } from '../user/userServiceClient.js';

const DATA_ANALYSIS_MODEL: FastModel = LlmModels.Gemini25Flash;

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
  userServiceClient: UserServiceClient,
  pricingContext: IPricingContext
): DataAnalysisService {
  const pricing = pricingContext.getPricing(DATA_ANALYSIS_MODEL);

  return {
    async analyzeData(
      userId: string,
      jsonSchema: object,
      snapshotData: object,
      chartTypes: ChartTypeInfo[]
    ): Promise<Result<DataAnalysisResult, DataAnalysisError>> {
      const keyResult = await userServiceClient.getGeminiApiKey(userId);

      if (!keyResult.ok) {
        const error = keyResult.error;
        if (error.code === 'NO_API_KEY') {
          return err({
            code: 'NO_API_KEY',
            message: 'Please configure your Gemini API key in settings first',
          });
        }
        return err({
          code: 'USER_SERVICE_ERROR',
          message: error.message,
        });
      }

      const apiKey = keyResult.value;
      const geminiClient = createGeminiClient({
        apiKey,
        model: DATA_ANALYSIS_MODEL,
        userId,
        pricing,
      });

      const prompt = dataAnalysisPrompt.build({
        jsonSchema,
        snapshotData,
        chartTypes,
      });

      const result = await geminiClient.generate(prompt);

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
