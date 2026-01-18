import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { ResearchModel } from '@intexuraos/llm-contract';
import type { ResearchServiceClient } from '../../domain/ports/researchServiceClient.js';
import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'ResearchAgentClient',
});

export interface ResearchAgentClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

interface ApiResponse {
  success: boolean;
  data?: {
    status: 'completed' | 'failed';
    message: string;
    resourceUrl?: string;
    errorCode?: string;
  };
  error?: {
    code?: string;
    message: string;
  };
}

export function createResearchAgentClient(
  config: ResearchAgentClientConfig
): ResearchServiceClient {
  return {
    async createDraft(params: {
      userId: string;
      title: string;
      prompt: string;
      selectedModels: ResearchModel[];
      sourceActionId?: string;
    }): Promise<Result<ServiceFeedback>> {
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

        let data: ApiResponse;
        try {
          data = (await response.json()) as ApiResponse;
        } catch {
          if (!response.ok) {
            logger.error(
              {
                userId: params.userId,
                title: params.title,
                httpStatus: response.status,
                statusText: response.statusText,
              },
              'Failed to create research draft - HTTP error (non-JSON response)'
            );
            return err(new Error(`HTTP ${String(response.status)}: Failed to create research draft`));
          }
          logger.error(
            { userId: params.userId, title: params.title },
            'Invalid JSON response from research-agent'
          );
          return err(new Error('Invalid response from research-agent'));
        }

        if (!response.ok) {
          const errorCode = data.error?.code;
          const errorMessage = data.error?.message ?? `HTTP ${String(response.status)}: Failed to create research draft`;
          logger.error(
            {
              userId: params.userId,
              title: params.title,
              httpStatus: response.status,
              statusText: response.statusText,
              errorCode,
              errorMessage,
            },
            'Failed to create research draft - HTTP error'
          );
          return ok({
            status: 'failed',
            message: errorMessage,
            ...(errorCode !== undefined && { errorCode }),
          });
        }

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

        const result: ServiceFeedback = {
          status: data.data.status,
          message: data.data.message,
          ...(data.data.resourceUrl !== undefined && { resourceUrl: data.data.resourceUrl }),
          ...(data.data.errorCode !== undefined && { errorCode: data.data.errorCode }),
        };

        logger.info(
          {
            userId: params.userId,
            title: params.title,
            status: result.status,
          },
          'Research draft action processed'
        );

        return ok(result);
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
