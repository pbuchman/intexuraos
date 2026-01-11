/**
 * Data transformation service using Gemini.
 * Transforms snapshot data according to chart definition instructions using user's Gemini API key.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { LlmModels, type FastModel } from '@intexuraos/llm-contract';
import { dataTransformPrompt, parseTransformedData } from '@intexuraos/llm-common';
import type { IPricingContext } from '@intexuraos/llm-pricing';
import type { UserServiceClient } from '../user/userServiceClient.js';

const DATA_TRANSFORM_MODEL: FastModel = LlmModels.Gemini25Flash;

/**
 * Error from data transformation operations.
 */
export interface DataTransformError {
  code: 'NO_API_KEY' | 'GENERATION_ERROR' | 'USER_SERVICE_ERROR' | 'PARSE_ERROR';
  message: string;
}

/**
 * Data transformation service interface.
 */
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

/**
 * Create a data transformation service.
 */
export function createDataTransformService(
  userServiceClient: UserServiceClient,
  pricingContext: IPricingContext
): DataTransformService {
  const pricing = pricingContext.getPricing(DATA_TRANSFORM_MODEL);

  return {
    async transformData(
      userId: string,
      jsonSchema: object,
      snapshotData: object,
      chartConfig: object,
      transformInstructions: string,
      insight: {
        title: string;
        trackableMetric: string;
      }
    ): Promise<Result<unknown[], DataTransformError>> {
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
        model: DATA_TRANSFORM_MODEL,
        userId,
        pricing,
      });

      const prompt = dataTransformPrompt()({
        jsonSchema,
        snapshotData,
        chartConfig,
        transformInstructions,
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
        const parsed = parseTransformedData(responseContent);
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
