import type { Result } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { CalendarServiceClient, CalendarPreview } from '../ports/calendarServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';
import { formatCalendarCompletionMessage } from '../utils/formatCalendarCompletionMessage.js';

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
      return { ok: false, error: new Error('Action not found') };
    }

    logger.info(
      { actionId, userId: action.userId, status: action.status, title: action.title },
      'Retrieved action for execution'
    );

    // Idempotency check
    if (action.status === 'completed') {
      const resourceUrl = action.payload['resource_url'] as string | undefined;
      const message = action.payload['message'] as string | undefined;
      logger.info({ actionId, resourceUrl }, 'Action already completed, returning existing result');
      return {
        ok: true,
        value: {
          status: 'completed',
          ...(message !== undefined && { message }),
          ...(resourceUrl !== undefined && { resourceUrl }),
        },
      };
    }

    // Status validation
    const validStatuses = ['pending', 'awaiting_approval', 'failed'];
    if (!validStatuses.includes(action.status)) {
      logger.error(
        { actionId, status: action.status },
        'Cannot execute action with invalid status'
      );
      return {
        ok: false,
        error: new Error(`Cannot execute action with status: ${action.status}`),
      };
    }

    // Update to processing
    logger.info({ actionId }, 'Setting action to processing');
    const updatedAction: Action = {
      ...action,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(updatedAction);

    // Get text for processing
    const text =
      typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;

    // Fetch preview BEFORE processAction — the real calendar-agent deletes the preview
    // from Firestore after creating the event, so fetching after would always return null.
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

    logger.info(
      { actionId, userId: action.userId, title: action.title, textLength: text.length },
      'Processing calendar action via calendar-agent'
    );

    // Call service
    const result = await calendarServiceClient.processAction({ action, text });

    // Handle service call error
    if (!result.ok) {
      logger.error({ actionId, error: result.error.message }, 'Failed to process calendar action');
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
      return {
        ok: true,
        value: {
          status: 'failed',
          message: result.error.message,
        },
      };
    }

    const response = result.value; // @allow-result-access -- guarded by !result.ok check above

    // Handle service returned failure status
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
      return {
        ok: true,
        value: {
          status: 'failed',
          message: errorMessage,
          ...(response.errorCode !== undefined && { errorCode: response.errorCode }),
        },
      };
    }

    // Handle success
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

    // Send WhatsApp notification with calendar-specific message formatting
    if (resourceUrl !== undefined) {
      const isAbsoluteUrl = resourceUrl.startsWith('http');
      const fullUrl = isAbsoluteUrl ? resourceUrl : `${webAppUrl}${resourceUrl}`;

      const whatsappMessage = formatCalendarCompletionMessage({
        preview: previewForMessage,
        fallbackMessage: message,
      });

      logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: whatsappMessage,
        ctaUrl: { displayText: '\u{1F4C5} View in Calendar', url: fullUrl },
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

    return {
      ok: true,
      value: {
        status: 'completed',
        message,
        ...(resourceUrl !== undefined && { resourceUrl }),
      },
    };
  };
}
