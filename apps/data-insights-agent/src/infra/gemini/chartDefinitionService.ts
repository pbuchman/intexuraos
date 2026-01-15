/**
 * Chart definition service using LLM client.
 * Generates chart configuration for a specific data insight using user's LLM client.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import {
  chartDefinitionPrompt,
  parseChartDefinition,
  type ParsedChartDefinition,
} from '@intexuraos/llm-common';
import type { UserServiceClient } from '../user/userServiceClient.js';
import type {
  ChartDefinitionService,
  ChartDefinitionError,
} from '../../domain/dataInsights/ports.js';

export type { ChartDefinitionService, ChartDefinitionError };

/**
 * Create a chart definition service.
 */
export function createChartDefinitionService(
  userServiceClient: UserServiceClient
): ChartDefinitionService {
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

      const prompt = chartDefinitionPrompt.build({
        jsonSchema,
        snapshotData,
        targetChartSchema,
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
