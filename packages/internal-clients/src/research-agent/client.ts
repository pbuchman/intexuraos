import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { postServiceFeedback } from '../shared/serviceFeedback.js';
import type {
  CreateResearchDraftRequest,
  ResearchAgentRequestOptions,
  ResearchAgentServiceClient,
  ResearchAgentServiceConfig,
} from './types.js';

export function createResearchAgentServiceClient(
  config: ResearchAgentServiceConfig
): ResearchAgentServiceClient {
  return {
    async createDraft(
      request: CreateResearchDraftRequest,
      options?: ResearchAgentRequestOptions
    ): Promise<Result<ServiceFeedback>> {
      return await postServiceFeedback(config, {
        path: '/internal/research/draft',
        body: request,
        options,
        invalidJsonMessage: 'Invalid response from research-agent',
        invalidEnvelopeMessage: 'Failed to create research draft',
        networkErrorPrefix: 'Network error',
        getDefaultHttpErrorMessage: (response) =>
          `HTTP ${String(response.status)}: Failed to create research draft`,
      });
    },
  };
}
