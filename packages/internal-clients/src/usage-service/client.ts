import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type {
  UsageServiceConfig,
  UsageServiceError,
  UsageServiceClient,
  UsageIngestRequest,
  UsageIngestResponse,
  UsageQueryRequest,
  UsageQueryResponse,
} from './types.js';

export function createUsageServiceClient(config: UsageServiceConfig): UsageServiceClient {
  return {
    async ingestEvents(
      request: UsageIngestRequest,
      options?: { traceId?: string },
    ): Promise<Result<UsageIngestResponse, UsageServiceError>> {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Internal-Auth': config.internalAuthToken,
        };
        if (options?.traceId !== undefined) {
          headers['X-Trace-Id'] = options.traceId;
        }

        const response = await fetch(`${config.baseUrl}/internal/usage/events`, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          return err({
            code: 'API_ERROR' as const,
            message: `HTTP ${String(response.status)}`,
          });
        }

        const body = (await response.json()) as { success: boolean; data: UsageIngestResponse };
        return ok(body.data);
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR' as const,
          message: getErrorMessage(error),
        });
      }
    },

    async queryUsage(
      request: UsageQueryRequest,
      options?: { traceId?: string },
    ): Promise<Result<UsageQueryResponse, UsageServiceError>> {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Internal-Auth': config.internalAuthToken,
        };
        if (options?.traceId !== undefined) {
          headers['X-Trace-Id'] = options.traceId;
        }

        const response = await fetch(`${config.baseUrl}/internal/usage/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          return err({
            code: 'API_ERROR' as const,
            message: `HTTP ${String(response.status)}`,
          });
        }

        const body = (await response.json()) as { success: boolean; data: UsageQueryResponse };
        return ok(body.data);
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR' as const,
          message: getErrorMessage(error),
        });
      }
    },
  };
}
