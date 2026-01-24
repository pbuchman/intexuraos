/**
 * Data analysis service using LLM client.
 * Analyzes composite feed data and generates up to 5 measurable insights.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import {
  buildInsightRepairPrompt,
  dataAnalysisPrompt,
  parseInsightResponse,
  type ChartTypeInfo,
} from '@intexuraos/llm-prompts';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { UserServiceClient } from '../user/userServiceClient.js';
import type {
  DataAnalysisService,
  DataAnalysisError,
  DataAnalysisResult,
} from '../../domain/dataInsights/ports.js';

export type { DataAnalysisService, DataAnalysisError, DataAnalysisResult };

async function attemptRepair(
  llmClient: LlmGenerateClient,
  originalPrompt: string,
  invalidResponse: string,
  parseError: string
): Promise<Result<DataAnalysisResult, DataAnalysisError>> {
  const repairPrompt = buildInsightRepairPrompt(originalPrompt, invalidResponse, parseError);
  const repairResult = await llmClient.generate(repairPrompt);

  if (!repairResult.ok) {
    return err({
      code: 'GENERATION_ERROR',
      message: `Repair generation failed: ${repairResult.error.message}`,
    });
  }

  const repairedContent = repairResult.value.content.trim();

  try {
    const parsed = parseInsightResponse(repairedContent);
    return ok(parsed);
  } catch (repairParseError) {
    return err({
      code: 'PARSE_ERROR',
      message: `Failed to parse LLM response after repair attempt: ${getErrorMessage(repairParseError, String(repairParseError))}`,
    });
  }
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
        const parseError = getErrorMessage(error, String(error));
        return await attemptRepair(llmClient, prompt, responseContent, parseError);
      }
    },
  };
}
