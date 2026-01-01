import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { ResearchServiceClient } from '../../domain/ports/researchServiceClient.js';
import type { LlmProvider } from '../../domain/models/actionEvent.js';

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
      selectedLlms: LlmProvider[];
      sourceActionId?: string;
    }): Promise<Result<{ id: string }>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/research/drafts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            userId: params.userId,
            title: params.title,
            prompt: params.prompt,
            selectedLlms: params.selectedLlms,
            sourceActionId: params.sourceActionId,
          }),
        });

        if (!response.ok) {
          return err(new Error(`HTTP ${String(response.status)}: Failed to create research draft`));
        }

        const data = (await response.json()) as CreateDraftResponse;

        if (!data.success || data.data === undefined) {
          return err(new Error(data.error?.message ?? 'Failed to create research draft'));
        }

        return ok({ id: data.data.id });
      } catch (error) {
        return err(new Error(`Network error: ${getErrorMessage(error)}`));
      }
    },
  };
}
