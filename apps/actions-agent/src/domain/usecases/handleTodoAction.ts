import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../ports/actionServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';

export interface HandleTodoActionDeps {
  actionServiceClient: ActionServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface HandleTodoActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleTodoActionUseCase(deps: HandleTodoActionDeps): HandleTodoActionUseCase {
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
        'Setting todo action to awaiting_approval'
      );

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
          'Failed to set todo action to awaiting_approval'
        );
        return err(new Error(`Failed to update action status: ${getErrorMessage(result.error)}`));
      }

      logger.info({ actionId: event.actionId }, 'Todo action set to awaiting_approval');

      const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
      const message = `New todo ready for approval: "${event.title}". Review it here: ${actionLink}`;

      logger.info(
        { actionId: event.actionId, userId: event.userId },
        'Sending WhatsApp approval notification for todo'
      );

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: event.userId,
        message,
        correlationId: `action-todo-approval-${event.actionId}`,
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
        logger.info({ actionId: event.actionId }, 'WhatsApp approval notification sent for todo');
      }

      return ok({ actionId: event.actionId });
    },
  };
}
