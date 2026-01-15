/**
 * Handle Linear Action Use Case
 *
 * Handles incoming Linear action events by:
 * 1. Checking if action exists and is in valid state
 * 2. Setting to awaiting_approval
 * 3. Sending WhatsApp notification for approval
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../ports/actionServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';

export interface HandleLinearActionDeps {
  actionServiceClient: ActionServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface HandleLinearActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleLinearActionUseCase(
  deps: HandleLinearActionDeps
): HandleLinearActionUseCase {
  const { actionServiceClient, whatsappPublisher, webAppUrl, logger } = deps;

  return {
    async execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>> {
      logger.info(
        {
          actionId: event.actionId,
          userId: event.userId,
          commandId: event.commandId,
          title: event.title,
          actionType: event.actionType,
        },
        'Processing linear action'
      );

      const actionResult = await actionServiceClient.getAction(event.actionId);
      if (!actionResult.ok) {
        logger.warn({ actionId: event.actionId }, 'Action not found, may have been deleted');
        return ok({ actionId: event.actionId });
      }

      const action = actionResult.value;
      if (action === null) {
        logger.warn({ actionId: event.actionId }, 'Action not found, may have been deleted');
        return ok({ actionId: event.actionId });
      }

      if (action.status !== 'pending') {
        logger.info(
          { actionId: event.actionId, currentStatus: action.status },
          'Action already processed, skipping (idempotent)'
        );
        return ok({ actionId: event.actionId });
      }

      logger.info({ actionId: event.actionId }, 'Setting linear action to awaiting_approval');

      const result = await actionServiceClient.updateActionStatus(
        event.actionId,
        'awaiting_approval'
      );

      if (!result.ok) {
        logger.error(
          {
            actionId: event.actionId,
            error: getErrorMessage(result.error),
          },
          'Failed to set linear action to awaiting_approval'
        );
        return err(new Error(`Failed to update action status: ${getErrorMessage(result.error)}`));
      }

      logger.info({ actionId: event.actionId }, 'Linear action set to awaiting_approval');

      const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
      const message = `New Linear issue ready for approval: "${event.title}". Review it here: ${actionLink}`;

      logger.info(
        { actionId: event.actionId, userId: event.userId },
        'Sending WhatsApp approval notification for linear'
      );

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: event.userId,
        message,
        correlationId: `action-linear-approval-${event.actionId}`,
      });

      if (!publishResult.ok) {
        logger.error(
          {
            actionId: event.actionId,
            userId: event.userId,
            error: publishResult.error.message,
          },
          'Failed to publish WhatsApp message (non-fatal)'
        );
      } else {
        logger.info({ actionId: event.actionId }, 'WhatsApp approval notification sent for linear');
      }

      return ok({ actionId: event.actionId });
    },
  };
}
