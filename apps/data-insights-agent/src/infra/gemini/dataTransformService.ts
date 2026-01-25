/**
 * Data transformation service using LLM client.
 * Transforms snapshot data according to chart definition instructions.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { dataTransformPrompt, parseTransformedData } from '@intexuraos/llm-prompts';
import type { UserServiceClient } from '@intexuraos/internal-clients/user-service';
import type {
  DataTransformService,
  DataTransformError,
} from '../../domain/dataInsights/ports.js';

export type { DataTransformService, DataTransformError };

/**
 * Create a data transformation service.
 */
export function createDataTransformService(
  userServiceClient: UserServiceClient
): DataTransformService {
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

      const prompt = dataTransformPrompt.build({
        jsonSchema,
        snapshotData,
        chartConfig,
        transformInstructions,
        insight,
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
