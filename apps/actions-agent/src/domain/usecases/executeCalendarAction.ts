import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { CalendarServiceClient } from '../ports/calendarServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
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
  resource_url?: string;
  error?: string;
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
      logger.info({ actionId, resourceUrl }, 'Action already completed, returning existing result');
      return ok({
        status: 'completed' as const,
        ...(resourceUrl !== undefined && { resource_url: resourceUrl }),
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

    logger.info(
      { actionId, userId: action.userId, title: action.title },
      'Processing calendar action via calendar-agent'
    );

    const result = await calendarServiceClient.processAction({ action });

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
          error: result.error.message,
        },
        updatedAt: new Date().toISOString(),
      };
      await actionRepository.update(failedAction);
      logger.info({ actionId, status: 'failed' }, 'Action marked as failed');
      return ok({
        status: 'failed',
        error: result.error.message,
      });
    }

    const response = result.value;

    if (response.status === 'failed') {
      const errorMessage = response.error ?? 'Unknown error';
      logger.info({ actionId, error: errorMessage }, 'Calendar action failed');
      const failedAction: Action = {
        ...action,
        status: 'failed',
        payload: {
          ...action.payload,
          error: errorMessage,
        },
        updatedAt: new Date().toISOString(),
      };
      await actionRepository.update(failedAction);
      return ok({
        status: 'failed',
        error: errorMessage,
      });
    }

    const resourceUrl = response.resource_url;
    logger.info({ actionId, resourceUrl }, 'Calendar action completed successfully');

    const completedAction: Action = {
      ...action,
      status: 'completed',
      payload: {
        ...action.payload,
        ...(resourceUrl !== undefined && { resource_url: resourceUrl }),
      },
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(completedAction);

    logger.info({ actionId, status: 'completed' }, 'Action marked as completed');

    if (resourceUrl !== undefined) {
      const fullUrl = `${webAppUrl}${resourceUrl}`;
      const message = `Calendar event created: "${action.title}". View it here: ${fullUrl}`;

      logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message,
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
      ...(resourceUrl !== undefined && { resource_url: resourceUrl }),
    });
  };
}
