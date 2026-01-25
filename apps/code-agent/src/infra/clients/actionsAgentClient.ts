/**
 * HTTP client for calling actions-agent internal API.
 *
 * Notifies actions-agent when code tasks complete, fail, or are cancelled.
 * Design reference: Lines 309-347
 */

import type { Result } from '@intexuraos/common-core';
import { fetchWithAuth, type ServiceClientConfig, type ServiceClientError } from '@intexuraos/internal-clients';

export type ClientError = ServiceClientError;

export interface ActionsAgentClient {
  /**
   * Update action status in actions-agent.
   *
   * @param actionId - The action ID to update
   * @param status - New status (completed, failed, or cancelled)
   * @param result - Optional result object with PR URL or error message
   * @returns Ok(undefined) on success, Err on failure
   */
  updateActionStatus(
    actionId: string,
    status: 'completed' | 'failed' | 'cancelled',
    result?: { prUrl?: string; error?: string }
  ): Promise<Result<void, ClientError>>;
}

/**
 * Factory function to create ActionsAgentClient.
 */
export function createActionsAgentClient(config: ServiceClientConfig): ActionsAgentClient {
  return {
    async updateActionStatus(
      actionId: string,
      status: 'completed' | 'failed' | 'cancelled',
      result?: { prUrl?: string; error?: string }
    ): Promise<Result<void, ClientError>> {
      const response = await fetchWithAuth(
        config,
        `/internal/actions/${actionId}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            resource_status: status,
            resource_result: result,
          }),
        }
      );

      return response as Result<void, ClientError>;
    },
  };
}
