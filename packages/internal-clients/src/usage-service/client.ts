import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import { fetchWithAuth } from '../shared/errors.js';
import type {
  UsageServiceConfig,
  UsageServiceError,
  UsageServiceClient,
  UsageIngestRequest,
  UsageIngestResponse,
  UsageQueryRequest,
  UsageQueryResponse,
  PricingResponse,
} from './types.js';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export function createUsageServiceClient(config: UsageServiceConfig): UsageServiceClient {
  return {
    async ingestEvents(
      request: UsageIngestRequest,
      options?: { traceId?: string }
    ): Promise<Result<UsageIngestResponse, UsageServiceError>> {
      const result = await fetchWithAuth<ApiResponse<UsageIngestResponse>>(
        config,
        '/internal/usage/events',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          ...(options?.traceId !== undefined ? { traceId: options.traceId } : {}),
        }
      );
      if (!result.ok) {
        return err({ code: result.error.code, message: result.error.message });
      }
      return ok(result.value.data);
    },

    async queryUsage(
      request: UsageQueryRequest,
      options?: { traceId?: string }
    ): Promise<Result<UsageQueryResponse, UsageServiceError>> {
      const result = await fetchWithAuth<ApiResponse<UsageQueryResponse>>(
        config,
        '/internal/usage/query',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          ...(options?.traceId !== undefined ? { traceId: options.traceId } : {}),
        }
      );
      if (!result.ok) {
        return err({ code: result.error.code, message: result.error.message });
      }
      return ok(result.value.data);
    },

    async fetchPricing(options?: {
      traceId?: string;
    }): Promise<Result<PricingResponse, UsageServiceError>> {
      const result = await fetchWithAuth<ApiResponse<PricingResponse>>(
        config,
        '/internal/pricing',
        {
          ...(options?.traceId !== undefined ? { traceId: options.traceId } : {}),
        }
      );
      if (!result.ok) {
        return err({ code: result.error.code, message: result.error.message });
      }
      return ok(result.value.data);
    },
  };
}
