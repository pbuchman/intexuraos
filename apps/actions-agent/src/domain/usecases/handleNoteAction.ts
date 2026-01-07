import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../ports/actionServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';

export interface HandleNoteActionDeps {
  actionServiceClient: ActionServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface HandleNoteActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleNoteActionUseCase(deps: HandleNoteActionDeps): HandleNoteActionUseCase {
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
        'Setting note action to awaiting_approval'
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
          'Failed to set note action to awaiting_approval'
        );
        return err(new Error(`Failed to update action status: ${getErrorMessage(result.error)}`));
      }

      logger.info({ actionId: event.actionId }, 'Note action set to awaiting_approval');

      const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
      const message = `New note ready for approval: "${event.title}". Review it here: ${actionLink}`;

      logger.info(
        { actionId: event.actionId, userId: event.userId },
        'Sending WhatsApp approval notification for note'
      );

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: event.userId,
        message,
        correlationId: `action-note-approval-${event.actionId}`,
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
        logger.info({ actionId: event.actionId }, 'WhatsApp approval notification sent for note');
      }

      return ok({ actionId: event.actionId });
    },
  };
}
