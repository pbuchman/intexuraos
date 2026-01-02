import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../ports/actionServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'handleResearchAction',
});

export interface HandleResearchActionDeps {
  actionServiceClient: ActionServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
}

export interface HandleResearchActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleResearchActionUseCase(
  deps: HandleResearchActionDeps
): HandleResearchActionUseCase {
  return {
    async execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>> {
      const { actionServiceClient, whatsappPublisher, webAppUrl } = deps;

      logger.info(
        {
          actionId: event.actionId,
          userId: event.userId,
          commandId: event.commandId,
          title: event.title,
          actionType: event.actionType,
        },
        'Setting action to awaiting_approval'
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
          'Failed to set action to awaiting_approval'
        );
        return err(new Error(`Failed to update action status: ${getErrorMessage(result.error)}`));
      }

      logger.info({ actionId: event.actionId }, 'Action set to awaiting_approval');

      const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
      const message = `Your research request is ready for approval. Review it here: ${actionLink}`;

      logger.info(
        { actionId: event.actionId, userId: event.userId },
        'Sending WhatsApp approval notification'
      );

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: event.userId,
        message,
        correlationId: `action-approval-${event.actionId}`,
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
        /* Best-effort notification - don't fail the action if notification fails */
      } else {
        logger.info({ actionId: event.actionId }, 'WhatsApp approval notification sent');
      }

      return ok({ actionId: event.actionId });
    },
  };
}
