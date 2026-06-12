import type { Logger } from '@intexuraos/common-core';
import type { Result } from '@intexuraos/common-core';
import { createUsageServiceClient } from '@intexuraos/internal-clients';
import type {
  ResearchCostSummary,
  ResearchCostSummaryClient,
  ResearchCostSummaryTimeRange,
} from '../../domain/research/ports/researchCostSummary.js';

export interface ResearchCostSummaryClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

export function createResearchCostSummaryClient(
  config: ResearchCostSummaryClientConfig
): ResearchCostSummaryClient {
  const client = createUsageServiceClient(config);

  return {
    async getResearchCostSummary(
      researchId: string,
      owner: { type: 'user' | 'system'; id: string },
      timeRange: ResearchCostSummaryTimeRange
    ): Promise<Result<ResearchCostSummary, { code: string; message: string }>> {
      return await client.getResearchCostSummary(researchId, owner, timeRange);
    },
  };
}
