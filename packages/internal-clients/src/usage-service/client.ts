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
  UsageListEventsRequest,
  UsageListEventsResponse,
  UsageGetEventResponse,
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

    /**
     * Query aggregated usage data via `POST /llm-usage/query`.
     *
     * **Auth caveat:** This route requires an Auth0 bearer token (`requireAuth`),
     * not `X-Internal-Auth`. These methods are intended for web-app consumption
     * and are NOT usable from backend service-to-service contexts.
     */
    async queryUsage(
      request: UsageQueryRequest,
      options?: { traceId?: string }
    ): Promise<Result<UsageQueryResponse, UsageServiceError>> {
      const result = await fetchWithAuth<ApiResponse<UsageQueryResponse>>(
        config,
        '/llm-usage/query',
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

    /**
     * List usage events via `POST /llm-usage/events/list`.
     *
     * **Auth caveat:** This route requires an Auth0 bearer token (`requireAuth`),
     * not `X-Internal-Auth`. These methods are intended for web-app consumption
     * and are NOT usable from backend service-to-service contexts.
     */
    async listUsageEvents(
      request: UsageListEventsRequest,
      options?: { traceId?: string }
    ): Promise<Result<UsageListEventsResponse, UsageServiceError>> {
      const result = await fetchWithAuth<ApiResponse<UsageListEventsResponse>>(
        config,
        '/llm-usage/events/list',
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

    /**
     * Get a single usage event via `GET /llm-usage/events/:eventId`.
     *
     * **Auth caveat:** This route requires an Auth0 bearer token (`requireAuth`),
     * not `X-Internal-Auth`. These methods are intended for web-app consumption
     * and are NOT usable from backend service-to-service contexts.
     */
    async getUsageEvent(
      eventId: string,
      options?: { traceId?: string }
    ): Promise<Result<UsageGetEventResponse, UsageServiceError>> {
      const result = await fetchWithAuth<ApiResponse<UsageGetEventResponse>>(
        config,
        `/llm-usage/events/${eventId}`,
        {
          method: 'GET',
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
