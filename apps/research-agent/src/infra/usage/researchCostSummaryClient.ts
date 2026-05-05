import { err, getErrorMessage, ok, type Logger, type Result } from '@intexuraos/common-core';
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

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export function createResearchCostSummaryClient(
  config: ResearchCostSummaryClientConfig
): ResearchCostSummaryClient {
  return {
    async getResearchCostSummary(
      researchId: string,
      owner: { type: 'user' | 'system'; id: string },
      timeRange: ResearchCostSummaryTimeRange
    ): Promise<Result<ResearchCostSummary, { code: string; message: string }>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/usage/research-cost-summary`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({ researchId, owner, timeRange }),
        });

        if (!response.ok) {
          const body = await response.text();
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(response.status)}: ${body}`,
          });
        }

        const payload = (await response.json()) as ApiResponse<ResearchCostSummary>;
        return ok(payload.data);
      } catch (error) {
        config.logger.error({ error }, 'Failed to fetch research cost summary');
        return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
      }
    },
  };
}
