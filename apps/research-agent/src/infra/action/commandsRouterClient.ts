import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../../domain/ports/actionServiceClient.js';

export interface CommandsRouterClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export function createCommandsRouterClient(
  config: CommandsRouterClientConfig
): ActionServiceClient {
  return {
    async updateActionStatus(actionId: string, status: string): Promise<Result<void>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/actions/${actionId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({ status }),
        });

        if (!response.ok) {
          return err(new Error(`HTTP ${String(response.status)}: Failed to update action status`));
        }

        return ok(undefined);
      } catch (error) {
        return err(new Error(`Network error: ${getErrorMessage(error)}`));
      }
    },

    async updateAction(
      actionId: string,
      update: { status: string; payload?: Record<string, unknown> }
    ): Promise<Result<void>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/actions/${actionId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify(update),
        });

        if (!response.ok) {
          return err(new Error(`HTTP ${String(response.status)}: Failed to update action`));
        }

        return ok(undefined);
      } catch (error) {
        return err(new Error(`Network error: ${getErrorMessage(error)}`));
      }
    },
  };
}
