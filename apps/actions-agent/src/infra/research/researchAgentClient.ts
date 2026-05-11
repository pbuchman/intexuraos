import type { ResearchServiceClient } from '../../domain/ports/researchServiceClient.js';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { createResearchAgentServiceClient } from '@intexuraos/internal-clients';
import type { Result, ServiceFeedback } from '@intexuraos/common-core';

const logger = createAppLogger({ name: 'ResearchAgentClient' });

export interface ResearchAgentClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export function createResearchAgentClient(
  config: ResearchAgentClientConfig
): ResearchServiceClient {
  const client = createResearchAgentServiceClient({
    ...config,
    logger,
  });

  return {
    async createDraft(params): Promise<Result<ServiceFeedback>> {
      return await client.createDraft(params);
    },
  };
}
