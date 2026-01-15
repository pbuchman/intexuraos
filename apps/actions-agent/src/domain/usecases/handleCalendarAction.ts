import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '../infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteCalendarActionUseCase } from './executeCalendarAction.js';
import { shouldAutoExecute as defaultShouldAutoExecute } from './shouldAutoExecute.js';

export type ShouldAutoExecute = (event: ActionCreatedEvent) => boolean;

export interface HandleCalendarActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeCalendarAction?: ExecuteCalendarActionUseCase;
  shouldAutoExecute?: ShouldAutoExecute;
}

export interface HandleCalendarActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleCalendarActionUseCase(
  deps: HandleCalendarActionDeps
): HandleCalendarActionUseCase {
  const {
    actionRepository: _actionRepository,
    whatsappPublisher,
    webAppUrl,
    logger,
    executeCalendarAction,
    shouldAutoExecute = defaultShouldAutoExecute,
  } = deps;

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
        'Processing calendar action'
      );

      // Idempotency check and status update handled by registerActionHandler decorator
      const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
      const message = `New calendar event ready for approval: "${event.title}". Review it here: ${actionLink}`;

      logger.info(
        { actionId: event.actionId, userId: event.userId },
        'Sending WhatsApp approval notification for calendar'
      );

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: event.userId,
        message,
        correlationId: `action-calendar-approval-${event.actionId}`,
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
        logger.info({ actionId: event.actionId }, 'WhatsApp approval notification sent for calendar');
      }

      return ok({ actionId: event.actionId });
    },
  };
}
