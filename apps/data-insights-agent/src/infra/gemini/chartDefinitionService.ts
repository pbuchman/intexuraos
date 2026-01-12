/**
 * Chart definition service using Gemini.
 * Generates chart configuration for a specific data insight using user's Gemini API key.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';
import {
  chartDefinitionPrompt,
  parseChartDefinition,
  type ParsedChartDefinition,
} from '@intexuraos/llm-common';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import type { UserServiceClient } from '../user/userServiceClient.js';

const CHART_DEFINITION_MODEL: FastModel = LlmModels.Gemini25Flash;

/**
 * Error from chart definition operations.
 */
export interface ChartDefinitionError {
  code: 'NO_API_KEY' | 'GENERATION_ERROR' | 'USER_SERVICE_ERROR' | 'PARSE_ERROR';
  message: string;
}

/**
 * Chart definition service interface.
 */
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

/**
 * Create a chart definition service.
 */
export function createChartDefinitionService(
  userServiceClient: UserServiceClient,
  pricingContext: IPricingContext
): ChartDefinitionService {
  const pricing = pricingContext.getPricing(CHART_DEFINITION_MODEL);

  return {
    async generateChartDefinition(
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
    ): Promise<Result<ParsedChartDefinition, ChartDefinitionError>> {
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
        model: CHART_DEFINITION_MODEL,
        userId,
        pricing,
      });

      const prompt = chartDefinitionPrompt.build({
        jsonSchema,
        snapshotData,
        targetChartSchema,
        insight,
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
        const parsed = parseChartDefinition(responseContent);
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
