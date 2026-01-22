import { ok, type Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher, CalendarPreviewPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';

export interface HandleCalendarActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  calendarPreviewPublisher: CalendarPreviewPublisher;
  webAppUrl: string;
  logger: Logger;
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
    calendarPreviewPublisher,
    webAppUrl,
    logger,
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

      // Trigger preview generation asynchronously via Pub/Sub
      const currentDate = new Date().toISOString().substring(0, 10);
      const previewResult = await calendarPreviewPublisher.publishGeneratePreview({
        actionId: event.actionId,
        userId: event.userId,
        text: event.payload.prompt,
        currentDate,
        correlationId: `action-calendar-preview-${event.actionId}`,
      });

      if (!previewResult.ok) {
        logger.warn(
          {
            actionId: event.actionId,
            userId: event.userId,
            error: previewResult.error.message,
          },
          'Failed to trigger preview generation (non-fatal, preview may not be available)'
        );
      } else {
        logger.info(
          { actionId: event.actionId },
          'Calendar preview generation triggered'
        );
      }

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
        logger.warn(
          {
            actionId: event.actionId,
            userId: event.userId,
            error: publishResult.error.message,
          },
          'Failed to publish WhatsApp message (non-fatal, best-effort notification)'
        );
      } else {
        logger.info({ actionId: event.actionId }, 'WhatsApp approval notification sent for calendar');
      }

      return ok({ actionId: event.actionId });
    },
  };
}
