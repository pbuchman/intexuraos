import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { CalendarServiceClient, CalendarPreview } from '../ports/calendarServiceClient.js';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteCalendarActionUseCase } from './executeCalendarAction.js';
import { shouldAutoExecute } from './shouldAutoExecute.js';
import { buildApprovalButtons } from '../utils/approvalButtons.js';
import { formatCalendarApprovalMessage } from '../utils/formatCalendarApprovalMessage.js';

export interface HandleCalendarActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  calendarServiceClient: CalendarServiceClient;
  webAppUrl: string;
  logger: Logger;
  executeCalendarAction?: ExecuteCalendarActionUseCase;
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
    calendarServiceClient,
    webAppUrl,
    logger,
    executeCalendarAction,
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

      if (shouldAutoExecute(event) && executeCalendarAction !== undefined) {
        logger.info({ actionId: event.actionId }, 'Auto-executing calendar action');

        const executeResult = await executeCalendarAction(event.actionId);

        if (!executeResult.ok) {
          logger.error(
            { actionId: event.actionId, error: getErrorMessage(executeResult.error) },
            'Failed to auto-execute calendar action'
          );
          return err(executeResult.error);
        }

        logger.info({ actionId: event.actionId }, 'Calendar action auto-executed successfully');
        return ok({ actionId: event.actionId });
      }

      // Generate preview synchronously via HTTP call to calendar-agent
      // Include day of week so LLM can calculate relative dates like "następny czwartek" (next Thursday)
      const now = new Date();
      const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
      const currentDate = `${now.toISOString().substring(0, 10)} ${dayOfWeek}`;

      let previewForMessage: CalendarPreview | null = null;

      const previewResult = await calendarServiceClient.generatePreview({
        actionId: event.actionId,
        userId: event.userId,
        text: event.payload.prompt,
        currentDate,
      });

      if (!previewResult.ok) {
        logger.warn(
          {
            actionId: event.actionId,
            userId: event.userId,
            error: previewResult.error.message,
          },
          'Failed to generate preview synchronously (non-fatal, will use basic message)'
        );
      } else {
        previewForMessage = previewResult.value;
        logger.info(
          { actionId: event.actionId, previewStatus: previewForMessage?.status },
          'Calendar preview generated synchronously'
        );
      }

      // Build approval message with rich preview (or fallback)
      const message = formatCalendarApprovalMessage({
        preview: previewForMessage,
        actionTitle: event.title,
        actionId: event.actionId,
        webAppUrl,
      });
      const buttons = buildApprovalButtons({ actionId: event.actionId });

      logger.info(
        { actionId: event.actionId, userId: event.userId },
        'Sending WhatsApp approval notification for calendar'
      );

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: event.userId,
        message,
        buttons,
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
