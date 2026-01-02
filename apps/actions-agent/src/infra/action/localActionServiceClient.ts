import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../../domain/ports/actionServiceClient.js';
import type { ActionRepository } from '../../domain/ports/actionRepository.js';
import type { Action } from '../../domain/models/action.js';
import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'localActionServiceClient',
});

export function createLocalActionServiceClient(
  actionRepository: ActionRepository
): ActionServiceClient {
  return {
    async updateActionStatus(actionId: string, status: string): Promise<Result<void>> {
      try {
        logger.info({ actionId, status }, 'Updating action status via local repository');

        const action = await actionRepository.getById(actionId);
        if (action === null) {
          logger.error({ actionId }, 'Action not found');
          return err(new Error(`Action not found: ${actionId}`));
        }

        const updatedAction: Action = {
          ...action,
          status: status as Action['status'],
          updatedAt: new Date().toISOString(),
        };

        await actionRepository.update(updatedAction);

        logger.info({ actionId, status }, 'Successfully updated action status');
        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error, 'Unknown error');
        logger.error({ actionId, status, error: message }, 'Failed to update action status');
        return err(new Error(`Failed to update action status: ${message}`));
      }
    },

    async updateAction(
      actionId: string,
      update: { status: string; payload?: Record<string, unknown> }
    ): Promise<Result<void>> {
      try {
        logger.info(
          { actionId, status: update.status, hasPayload: update.payload !== undefined },
          'Updating action via local repository'
        );

        const action = await actionRepository.getById(actionId);
        if (action === null) {
          logger.error({ actionId }, 'Action not found');
          return err(new Error(`Action not found: ${actionId}`));
        }

        const updatedAction: Action = {
          ...action,
          status: update.status as Action['status'],
          payload: update.payload ?? action.payload,
          updatedAt: new Date().toISOString(),
        };

        await actionRepository.update(updatedAction);

        logger.info({ actionId, status: update.status }, 'Successfully updated action');
        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error, 'Unknown error');
        logger.error(
          { actionId, status: update.status, error: message },
          'Failed to update action'
        );
        return err(new Error(`Failed to update action: ${message}`));
      }
    },
  };
}
