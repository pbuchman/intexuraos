import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteTodoActionUseCase } from './executeTodoAction.js';
import { shouldAutoExecute } from './shouldAutoExecute.js';

export interface HandleTodoActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeTodoAction?: ExecuteTodoActionUseCase;
}

export interface HandleTodoActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleTodoActionUseCase(deps: HandleTodoActionDeps): HandleTodoActionUseCase {
  const { actionRepository, whatsappPublisher, webAppUrl, logger, executeTodoAction } = deps;

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
        'Processing todo action'
      );

      if (shouldAutoExecute(event) && executeTodoAction !== undefined) {
        logger.info({ actionId: event.actionId }, 'Auto-executing todo action');

        const executeResult = await executeTodoAction(event.actionId);

        if (!executeResult.ok) {
          logger.error(
            { actionId: event.actionId, error: getErrorMessage(executeResult.error) },
            'Failed to auto-execute todo action'
          );
          return err(executeResult.error);
        }

        logger.info({ actionId: event.actionId }, 'Todo action auto-executed successfully');
        return ok({ actionId: event.actionId });
      }

      logger.info({ actionId: event.actionId }, 'Setting todo action to awaiting_approval');

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
