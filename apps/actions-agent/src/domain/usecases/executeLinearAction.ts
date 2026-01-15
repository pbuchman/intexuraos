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
  resourceUrl?: string;
  issueIdentifier?: string;
  error?: string;
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
      const issueIdentifier = action.payload['issue_identifier'] as
        | string
        | undefined;
      logger.info({ actionId, resourceUrl, issueIdentifier }, 'Action already completed, returning existing result');
      return ok({
        status: 'completed' as const,
        ...(resourceUrl !== undefined && { resourceUrl }),
        ...(issueIdentifier !== undefined && { issueIdentifier }),
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
      'Processing linear action via linear-agent'
    );

    const result = await linearAgentClient.processAction(
      actionId,
      action.userId,
      action.title
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
      logger.info({ actionId, error: errorMessage }, 'Linear action failed');
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

    const { resourceUrl, issueIdentifier } = response;
    logger.info({ actionId, resourceUrl, issueIdentifier }, 'Linear action completed successfully');

    const completedAction: Action = {
      ...action,
      status: 'completed',
      payload: {
        ...action.payload,
        ...(resourceUrl !== undefined && { resource_url: resourceUrl }),
        ...(issueIdentifier !== undefined && { issue_identifier: issueIdentifier }),
      },
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(completedAction);

    logger.info({ actionId, status: 'completed' }, 'Action marked as completed');

    if (resourceUrl !== undefined) {
      const identifier = issueIdentifier !== undefined ? ` (${issueIdentifier})` : '';
      const message = `Linear issue created: "${action.title}"${identifier}. View it here: ${resourceUrl}`;

      logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message,
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
      { actionId, resourceUrl, issueIdentifier, status: 'completed' },
      'Linear action execution completed successfully'
    );

    return ok({
      status: 'completed',
      ...(resourceUrl !== undefined && { resourceUrl }),
      ...(issueIdentifier !== undefined && { issueIdentifier }),
    });
  };
}
