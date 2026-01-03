import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { SupportedModel } from '@intexuraos/llm-contract';
import type { ResearchServiceClient } from '../../domain/ports/researchServiceClient.js';
import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'llmOrchestratorClient',
});

export interface LlmOrchestratorClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

interface CreateDraftResponse {
  success: boolean;
  data?: {
    id: string;
  };
  error?: {
    message: string;
  };
}

export function createLlmOrchestratorClient(
  config: LlmOrchestratorClientConfig
): ResearchServiceClient {
  return {
    async createDraft(params: {
      userId: string;
      title: string;
      prompt: string;
      selectedModels: SupportedModel[];
      sourceActionId?: string;
    }): Promise<Result<{ id: string }>> {
      try {
        logger.info(
          {
            userId: params.userId,
            title: params.title,
            selectedModels: params.selectedModels,
            promptLength: params.prompt.length,
            sourceActionId: params.sourceActionId,
            endpoint: `${config.baseUrl}/internal/research/draft`,
          },
          'Calling POST /internal/research/draft to create research draft'
        );

        const response = await fetch(`${config.baseUrl}/internal/research/draft`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            userId: params.userId,
            title: params.title,
            prompt: params.prompt,
            selectedModels: params.selectedModels,
            sourceActionId: params.sourceActionId,
          }),
        });

        if (!response.ok) {
          logger.error(
            {
              userId: params.userId,
              title: params.title,
              httpStatus: response.status,
              statusText: response.statusText,
            },
            'Failed to create research draft - HTTP error'
          );
          return err(new Error(`HTTP ${String(response.status)}: Failed to create research draft`));
        }

        const data = (await response.json()) as CreateDraftResponse;

        if (!data.success || data.data === undefined) {
          logger.error(
            {
              userId: params.userId,
              title: params.title,
              errorMessage: data.error?.message,
            },
            'Failed to create research draft - API error'
          );
          return err(new Error(data.error?.message ?? 'Failed to create research draft'));
        }

        logger.info(
          {
            userId: params.userId,
            researchId: data.data.id,
            title: params.title,
          },
          'Successfully created research draft'
        );

        return ok({ id: data.data.id });
      } catch (error) {
        logger.error(
          {
            userId: params.userId,
            title: params.title,
            error: getErrorMessage(error),
          },
          'Failed to create research draft - network error'
        );
        return err(new Error(`Network error: ${getErrorMessage(error)}`));
      }
    },
  };
}
