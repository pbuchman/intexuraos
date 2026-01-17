import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionHandler } from './actionHandlerRegistry.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';

/**
 * Factory function type for action handlers.
 * Matches the pattern of factory functions like createHandleResearchActionUseCase.
 */
export type ActionHandlerFactory<Deps, Handler> = (deps: Deps) => Handler;

/**
 * Wraps an action handler with idempotency protection.
 * Prevents duplicate WhatsApp messages by atomically checking/updating status
 * before invoking the wrapped handler.
 *
 * Note: Handlers that auto-execute are responsible for their own idempotency
 * during auto-execution (via updateStatusIf) since they skip the approval flow.
 */
function createIdempotentActionHandler(
  handler: ActionHandler,
  deps: { actionRepository: ActionRepository; logger: Logger }
): ActionHandler {
  const { actionRepository, logger } = deps;

  return {
    async execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>> {
      const updateResult = await actionRepository.updateStatusIf(
        event.actionId,
        'awaiting_approval',
        ['pending', 'failed']
      );

      switch (updateResult.outcome) {
        case 'updated':
          return await handler.execute(event);

        case 'status_mismatch':
          logger.info(
            { actionId: event.actionId, currentStatus: updateResult.currentStatus },
            'Action already processed by another handler (idempotent)'
          );
          return ok({ actionId: event.actionId });

        case 'not_found':
          logger.warn(
            { actionId: event.actionId },
            'Action not found (may have been deleted between creation and handling)'
          );
          return ok({ actionId: event.actionId });

        case 'error':
          logger.error(
            { actionId: event.actionId, error: getErrorMessage(updateResult.error) },
            'Failed to update action status'
          );
          return err(new Error('Failed to update action status'));
      }
    },
  };
}

/**
 * Factory registration function that creates AND wraps a handler with idempotency.
 * This enforces idempotency at the API level - you cannot create a handler without it.
 *
 * Usage:
 *   const handler = registerActionHandler(createHandleXxxActionUseCase, deps);
 */
export function registerActionHandler<
  Deps extends { actionRepository: ActionRepository; logger: Logger },
>(factory: ActionHandlerFactory<Deps, ActionHandler>, deps: Deps): ActionHandler {
  const handler = factory(deps);
  return createIdempotentActionHandler(handler, {
    actionRepository: deps.actionRepository,
    logger: deps.logger,
  });
}
