import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { CalendarServiceClient, CalendarPreview } from '../ports/calendarServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { formatCalendarCompletionMessage } from '../utils/formatCalendarCompletionMessage.js';
import type { Logger } from 'pino';

export interface ExecuteCalendarActionDeps {
  actionRepository: ActionRepository;
  calendarServiceClient: CalendarServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface ExecuteCalendarActionResult {
  status: 'completed' | 'failed';
  message?: string;
  resourceUrl?: string;
  errorCode?: string;
}

export type ExecuteCalendarActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteCalendarActionResult>>;

export function createExecuteCalendarActionUseCase(
  deps: ExecuteCalendarActionDeps
): ExecuteCalendarActionUseCase {
  const { actionRepository, calendarServiceClient, whatsappPublisher, webAppUrl, logger } = deps;

  return async (actionId: string): Promise<Result<ExecuteCalendarActionResult>> => {
    logger.info({ actionId }, 'Executing calendar action');

    const action = await actionRepository.getById(actionId);
    if (action === null) {
      logger.error({ actionId }, 'Action not found');
      return err(new Error('Action not found'));
    }

    logger.info(
      { actionId, userId: action.userId, status: action.status, title: action.title },
      'Retrieved action for execution'
    );

    if (action.status === 'completed') {
      const resourceUrl = action.payload['resource_url'] as string | undefined;
      const message = action.payload['message'] as string | undefined;
      logger.info({ actionId, resourceUrl }, 'Action already completed, returning existing result');
      return ok({
        status: 'completed' as const,
        ...(message !== undefined && { message }),
        ...(resourceUrl !== undefined && { resourceUrl }),
      });
    }

    const validStatuses = ['pending', 'awaiting_approval', 'failed'];
    if (!validStatuses.includes(action.status)) {
      logger.error(
        { actionId, status: action.status },
        'Cannot execute action with invalid status'
      );
      return err(new Error(`Cannot execute action with status: ${action.status}`));
    }

    logger.info({ actionId }, 'Setting action to processing');
    const updatedAction: Action = {
      ...action,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(updatedAction);

    const text =
      typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;

    logger.info(
      { actionId, userId: action.userId, title: action.title, textLength: text.length },
      'Processing calendar action via calendar-agent'
    );

    const result = await calendarServiceClient.processAction({ action, text });

    if (!result.ok) {
      logger.error(
        { actionId, error: getErrorMessage(result.error) },
        'Failed to process calendar action via calendar-agent'
      );
      const failedAction: Action = {
        ...action,
        status: 'failed',
        payload: {
          ...action.payload,
          message: result.error.message,
        },
        updatedAt: new Date().toISOString(),
      };
      await actionRepository.update(failedAction);
      logger.info({ actionId, status: 'failed' }, 'Action marked as failed');
      return ok({
        status: 'failed',
        message: result.error.message,
      });
    }

    const response = result.value; // @allow-result-access -- guarded by !result.ok at line 85

    if (response.status === 'failed') {
      const errorMessage = response.message;
      logger.info({ actionId, message: errorMessage }, 'Calendar action failed');
      const failedAction: Action = {
        ...action,
        status: 'failed',
        payload: {
          ...action.payload,
          message: errorMessage,
          ...(response.errorCode !== undefined && { errorCode: response.errorCode }),
        },
        updatedAt: new Date().toISOString(),
      };
      await actionRepository.update(failedAction);
      return ok({
        status: 'failed',
        message: errorMessage,
        ...(response.errorCode !== undefined && { errorCode: response.errorCode }),
      });
    }

    const { resourceUrl, message } = response;
    logger.info({ actionId, resourceUrl }, 'Calendar action completed successfully');

    const completedAction: Action = {
      ...action,
      status: 'completed',
      payload: {
        ...action.payload,
        message,
        ...(resourceUrl !== undefined && { resource_url: resourceUrl }),
      },
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(completedAction);

    logger.info({ actionId, status: 'completed' }, 'Action marked as completed');

    if (resourceUrl !== undefined) {
      const isAbsoluteUrl = resourceUrl.startsWith('http');
      const fullUrl = isAbsoluteUrl ? resourceUrl : `${webAppUrl}${resourceUrl}`;

      // Fetch cached preview for rich message (best-effort)
      let previewForMessage: CalendarPreview | null = null;
      const previewResult = await calendarServiceClient.getPreview(actionId);
      if (previewResult.ok) {
        previewForMessage = previewResult.value; // @allow-result-access -- guarded by previewResult.ok check above
      } else {
        logger.warn(
          { actionId, error: previewResult.error.message },
          'Failed to fetch preview for completion message (non-fatal, using basic message)'
        );
      }

      const whatsappMessage = formatCalendarCompletionMessage({
        preview: previewForMessage,
        fallbackMessage: message,
        eventUrl: fullUrl,
      });

      logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: whatsappMessage,
        correlationId: `calendar-complete-${actionId}`,
      });

      if (!publishResult.ok) {
        logger.warn(
          { actionId, userId: action.userId, error: publishResult.error.message },
          'Failed to send WhatsApp notification (non-fatal)'
        );
      } else {
        logger.info({ actionId }, 'WhatsApp completion notification sent');
      }
    }

    logger.info(
      { actionId, resourceUrl, status: 'completed' },
      'Calendar action execution completed successfully'
    );

    return ok({
      status: 'completed',
      message,
      ...(resourceUrl !== undefined && { resourceUrl }),
    });
  };
}
