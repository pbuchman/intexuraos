/**
 * Execute Action Template
 *
 * Shared template for execute*Action use cases. Handles the common workflow:
 * - Get action by ID -> null check
 * - Idempotency check for completed actions
 * - Status validation
 * - Update to processing
 * - Call service
 * - Handle failure -> update to failed
 * - Handle success -> update to completed
 * - Send WhatsApp notification if resourceUrl exists
 *
 * Note: executeLinkAction and executeCodeAction are NOT migrated to this template
 * due to significant deviations (URL extraction logic in link, special error handling
 * like WORKER_UNAVAILABLE/DUPLICATE in code). They are candidates for future
 * migration if the template is extended to support these patterns.
 */

import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action, ActionStatus } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';

export interface ExecuteActionConfig {
  actionType: string;
  validStatuses: ActionStatus[];
  preparePayload: (action: Action) => Record<string, unknown>;
  callService: (
    action: Action,
    prepared: Record<string, unknown>
  ) => Promise<Result<ServiceFeedback>>;
  buildCompletionMessage?: (action: Action, response: ServiceFeedback) => string;
  correlationPrefix: string;
}

export interface ExecuteActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl?: string;
  logger: Logger;
}

export interface ExecuteActionResult {
  status: 'completed' | 'failed';
  message?: string;
  resourceUrl?: string;
  errorCode?: string;
}

export function createExecuteActionTemplate(
  deps: ExecuteActionDeps,
  config: ExecuteActionConfig
): (actionId: string) => Promise<Result<ExecuteActionResult>> {
  const { actionRepository, whatsappPublisher, logger } = deps;

  return async (actionId: string): Promise<Result<ExecuteActionResult>> => {
    logger.info({ actionId }, `Executing ${config.actionType} action`);

    const action = await actionRepository.getById(actionId);
    if (action === null) {
      logger.error({ actionId }, 'Action not found');
      return err(new Error('Action not found'));
    }

    logger.info(
      { actionId, userId: action.userId, status: action.status, title: action.title },
      'Retrieved action for execution'
    );

    // Idempotency: return existing result for completed actions
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

    // Status validation
    if (!config.validStatuses.includes(action.status)) {
      logger.error(
        { actionId, status: action.status },
        'Cannot execute action with invalid status'
      );
      return err(new Error(`Cannot execute action with status: ${action.status}`));
    }

    // Update to processing
    logger.info({ actionId }, 'Setting action to processing');
    const updatedAction: Action = {
      ...action,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(updatedAction);

    // Prepare payload for service call
    const prepared = config.preparePayload(action);

    // Call service
    logger.info(
      { actionId, userId: action.userId, title: action.title },
      `Processing ${config.actionType} action`
    );

    const result = await config.callService(action, prepared);

    // Handle service call error
    if (!result.ok) {
      logger.error(
        { actionId, error: getErrorMessage(result.error) },
        `Failed to process ${config.actionType} action`
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

    // @allow-result-access -- guarded by !result.ok check above
    const response = result.value; // @allow-result-access -- guarded by !result.ok check above

    // Handle service returned failure status
    if (response.status === 'failed') {
      const errorMessage = response.message;
      logger.info({ actionId, message: errorMessage }, `${config.actionType} action failed`);
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

    // Handle success
    const { resourceUrl, message } = response;
    logger.info({ actionId, resourceUrl }, `${config.actionType} action completed successfully`);

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

    // Send WhatsApp notification if resourceUrl exists
    if (resourceUrl !== undefined) {
      const whatsappMessage =
        config.buildCompletionMessage !== undefined
          ? config.buildCompletionMessage(action, response)
          : `${message} View it here: ${deps.webAppUrl ?? ''}${resourceUrl}`;

      logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: whatsappMessage,
        correlationId: `${config.correlationPrefix}-${actionId}`,
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
      `${config.actionType} action execution completed successfully`
    );

    return ok({
      status: 'completed',
      message,
      ...(resourceUrl !== undefined && { resourceUrl }),
    });
  };
}
