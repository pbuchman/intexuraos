import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteNoteActionUseCase } from './executeNoteAction.js';
import { shouldAutoExecute } from './shouldAutoExecute.js';

export interface HandleNoteActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeNoteAction?: ExecuteNoteActionUseCase;
}

export interface HandleNoteActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleNoteActionUseCase(deps: HandleNoteActionDeps): HandleNoteActionUseCase {
  const { actionRepository: _actionRepository, whatsappPublisher, webAppUrl, logger, executeNoteAction } = deps;

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
        'Processing note action'
      );

      if (shouldAutoExecute(event) && executeNoteAction !== undefined) {
        logger.info({ actionId: event.actionId }, 'Auto-executing note action');

        const executeResult = await executeNoteAction(event.actionId);

        if (!executeResult.ok) {
          logger.error(
            { actionId: event.actionId, error: getErrorMessage(executeResult.error) },
            'Failed to auto-execute note action'
          );
          return err(executeResult.error);
        }

        logger.info({ actionId: event.actionId }, 'Note action auto-executed successfully');
        return ok({ actionId: event.actionId });
      }

      // Idempotency check and status update handled by registerActionHandler decorator
      const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
      const message = `New note ready for approval: "${event.title}". Review here: ${actionLink} or reply to approve/reject.`;

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
        logger.warn(
          {
            actionId: event.actionId,
            userId: event.userId,
            error: publishResult.error.message,
          },
          'Failed to publish WhatsApp message (non-fatal, best-effort notification)'
        );
      } else {
        logger.info({ actionId: event.actionId }, 'WhatsApp approval notification sent for note');
      }

      return ok({ actionId: event.actionId });
    },
  };
}
