/**
 * Handle Code Action Use Case
 *
 * Processes code action creation requests by:
 * 1. Validating the action has required fields
 * 2. Setting defaults (workerType to 'auto' if not specified)
 * 3. Sending approval request via WhatsApp (with cost estimate)
 *
 * Based on design doc: docs/designs/INT-156-code-action-type.md
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteCodeActionUseCase } from './executeCodeAction.js';
import { shouldAutoExecute } from './shouldAutoExecute.js';

export interface HandleCodeActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeCodeAction?: ExecuteCodeActionUseCase;
}

export interface HandleCodeActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleCodeActionUseCase(
  deps: HandleCodeActionDeps
): HandleCodeActionUseCase {
  const { actionRepository, whatsappPublisher, webAppUrl, logger, executeCodeAction } = deps;

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
        'Processing code action'
      );

      if (shouldAutoExecute(event) && executeCodeAction !== undefined) {
        logger.info({ actionId: event.actionId }, 'Auto-executing code action');

        const executeResult = await executeCodeAction(event.actionId);

        if (!executeResult.ok) {
          logger.error(
            { actionId: event.actionId, error: getErrorMessage(executeResult.error) },
            'Failed to auto-execute code action'
          );
          return err(executeResult.error);
        }

        logger.info({ actionId: event.actionId }, 'Code action auto-executed successfully');
        return ok({ actionId: event.actionId });
      }

      // Idempotency check and status update handled by registerActionHandler decorator
      const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;

      // Get prompt from payload for the approval message
      const action = await actionRepository.getById(event.actionId);
      if (action === null) {
        logger.error({ actionId: event.actionId }, 'Action not found');
        return err(new Error('Action not found'));
      }

      const prompt = typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : event.title;
      const promptPreview = prompt.length > 100 ? `${prompt.substring(0, 100)}...` : prompt;

      // Design lines 349-361: Include prompt summary, estimated cost, worker type
      // Design lines 2220-2226: ~$1.17/task average
      const message = `Code task: ${promptPreview}\n\nEstimated cost: $1-2\n\nReview here: ${actionLink} or reply to approve.`;

      logger.info(
        { actionId: event.actionId, userId: event.userId },
        'Sending WhatsApp approval notification'
      );

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: event.userId,
        message,
        correlationId: `action-approval-${event.actionId}`,
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
        logger.info({ actionId: event.actionId }, 'WhatsApp approval notification sent');
      }

      return ok({ actionId: event.actionId });
    },
  };
}
