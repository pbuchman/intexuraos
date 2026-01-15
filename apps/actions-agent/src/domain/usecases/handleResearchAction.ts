import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteResearchActionUseCase } from './executeResearchAction.js';
import { shouldAutoExecute } from './shouldAutoExecute.js';

export interface HandleResearchActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeResearchAction?: ExecuteResearchActionUseCase;
}

export interface HandleResearchActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleResearchActionUseCase(
  deps: HandleResearchActionDeps
): HandleResearchActionUseCase {
  const { actionRepository, whatsappPublisher, webAppUrl, logger, executeResearchAction } = deps;

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
        'Processing research action'
      );

      if (shouldAutoExecute(event) && executeResearchAction !== undefined) {
        logger.info({ actionId: event.actionId }, 'Auto-executing research action');

        const executeResult = await executeResearchAction(event.actionId);

        if (!executeResult.ok) {
          logger.error(
            { actionId: event.actionId, error: getErrorMessage(executeResult.error) },
            'Failed to auto-execute research action'
          );
          return err(executeResult.error);
        }

        logger.info({ actionId: event.actionId }, 'Research action auto-executed successfully');
        return ok({ actionId: event.actionId });
      }

      logger.info({ actionId: event.actionId }, 'Setting research action to awaiting_approval');

      // Atomically update status only if still 'pending' - prevents duplicate WhatsApp messages
      let updated: boolean;
      try {
        updated = await actionRepository.updateStatusIf(event.actionId, 'awaiting_approval', 'pending');
      } catch (error) {
        logger.error(
          { actionId: event.actionId, error: getErrorMessage(error) },
          'Failed to update action status'
        );
        return err(new Error('Failed to update action status'));
      }

      if (!updated) {
        logger.info(
          { actionId: event.actionId },
          'Action already processed by another handler (idempotent)'
        );
        return ok({ actionId: event.actionId });
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
