/**
 * HTTP client for calling intex-agent internal API.
 *
 * Notifies intex-agent when code tasks complete, fail, or are cancelled.
 * Design reference: Lines 309-347
 */

import type { Result } from '@intexuraos/common-core';
import type { ResourceStatus } from '../services/statusMirrorServiceImpl.js';
import { fetchWithAuth, type ServiceClientConfig, type ServiceClientError } from '@intexuraos/internal-clients';

export type ClientError = ServiceClientError;

export interface IntexAgentClient {
  /**
   * Update action status in intex-agent.
   *
   * @param actionId - The action ID to update
   * @param status - New resource status (dispatched, running, completed, failed, cancelled, interrupted)
   * @param result - Optional result object with PR URL or error message
   * @param traceId - Optional trace ID for distributed tracing
   * @returns Ok(undefined) on success, Err on failure
   */
  updateActionStatus(
    actionId: string,
    status: ResourceStatus,
    result?: { prUrl?: string; error?: string },
    traceId?: string
  ): Promise<Result<void, ClientError>>;
}

/**
 * Factory function to create IntexAgentClient.
 */
export function createIntexAgentClient(config: ServiceClientConfig): IntexAgentClient {
  return {
    async updateActionStatus(
      actionId: string,
      status: ResourceStatus,
      result?: { prUrl?: string; error?: string },
      traceId?: string
    ): Promise<Result<void, ClientError>> {
      const options: {
        method: string;
        headers: { 'Content-Type': string };
        body: string;
        traceId?: string;
      } = {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resource_status: status,
          resource_result: result,
        }),
      };

      if (traceId !== undefined) {
        options.traceId = traceId;
      }

      const response = await fetchWithAuth(
        config,
        `/internal/intex-agent/actions/${actionId}/status`,
        options
      );

      return response as Result<void, ClientError>;
    },
  };
}
