import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { TodosServiceClient } from '../ports/todosServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';

export interface ExecuteTodoActionDeps {
  actionRepository: ActionRepository;
  todosServiceClient: TodosServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface ExecuteTodoActionResult {
  status: 'completed' | 'failed';
  message?: string;
  resourceUrl?: string;
  errorCode?: string;
}

export type ExecuteTodoActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteTodoActionResult>>;

export function createExecuteTodoActionUseCase(
  deps: ExecuteTodoActionDeps
): ExecuteTodoActionUseCase {
  const { actionRepository, todosServiceClient, whatsappPublisher, webAppUrl, logger } = deps;

  return async (actionId: string): Promise<Result<ExecuteTodoActionResult>> => {
    logger.info({ actionId }, 'Executing todo action');

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

    logger.info(
      { actionId, userId: action.userId, title: action.title },
      'Creating todo via todos-agent'
    );

    const result = await todosServiceClient.createTodo({
      userId: action.userId,
      title: action.title,
      description: prompt,
      tags: [],
      source: 'actions-agent',
      sourceId: action.id,
    });

    if (!result.ok) {
      logger.error(
        { actionId, error: getErrorMessage(result.error) },
        'Failed to create todo via todos-agent'
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
      logger.info({ actionId, message: errorMessage }, 'Todo action failed');
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
    logger.info({ actionId, resourceUrl }, 'Todo created successfully');

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
      const fullUrl = `${webAppUrl}${resourceUrl}`;
      const whatsappMessage = `${message} View it here: ${fullUrl}`;

      logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: whatsappMessage,
        correlationId: `todo-complete-${actionId}`,
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
      'Todo action execution completed successfully'
    );

    return ok({
      status: 'completed',
      message,
      ...(resourceUrl !== undefined && { resourceUrl }),
    });
  };
}
