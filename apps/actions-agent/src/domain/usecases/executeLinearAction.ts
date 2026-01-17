/**
 * Execute Linear Action Use Case
 *
 * Handles the execution of Linear issue creation actions by:
 * 1. Retrieving the action from the repository
 * 2. Calling linear-agent to process the action
 * 3. Updating action status based on result
 * 4. Sending WhatsApp notification on completion
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';

export interface ExecuteLinearActionDeps {
  actionRepository: ActionRepository;
  linearAgentClient: LinearAgentClient;
  whatsappPublisher: WhatsAppSendPublisher;
  logger: Logger;
}

export interface ExecuteLinearActionResult {
  status: 'completed' | 'failed';
  message?: string;
  resourceUrl?: string;
  errorCode?: string;
}

export type ExecuteLinearActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteLinearActionResult>>;

export function createExecuteLinearActionUseCase(
  deps: ExecuteLinearActionDeps
): ExecuteLinearActionUseCase {
  const { actionRepository, linearAgentClient, whatsappPublisher, logger } = deps;

  return async (actionId: string): Promise<Result<ExecuteLinearActionResult>> => {
    logger.info({ actionId }, 'Executing linear action');

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

    const prompt =
      typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;
    const summary =
      typeof action.payload['summary'] === 'string' ? action.payload['summary'] : undefined;

    logger.info(
      { actionId, userId: action.userId, title: action.title, hasSummary: summary !== undefined },
      'Processing linear action via linear-agent'
    );

    const result = await linearAgentClient.processAction(
      actionId,
      action.userId,
      prompt,
      summary
    );

    if (!result.ok) {
      logger.error(
        { actionId, error: getErrorMessage(result.error) },
        'Failed to process linear action via linear-agent'
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

    const response = result.value;

    if (response.status === 'failed') {
      const errorMessage = response.message;
      logger.info({ actionId, message: errorMessage }, 'Linear action failed');
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
    logger.info({ actionId, resourceUrl }, 'Linear action completed successfully');

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
      const whatsappMessage = `${message} View it here: ${resourceUrl}`;

      logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: whatsappMessage,
        correlationId: `linear-complete-${actionId}`,
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
      'Linear action execution completed successfully'
    );

    return ok({
      status: 'completed',
      message,
      ...(resourceUrl !== undefined && { resourceUrl }),
    });
  };
}
