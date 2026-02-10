import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteCodeActionUseCase } from './executeCodeAction.js';
import { shouldAutoExecute } from './shouldAutoExecute.js';
import { buildApprovalButtons } from '../utils/approvalButtons.js';

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
  const { actionRepository: _actionRepository, whatsappPublisher, webAppUrl, logger, executeCodeAction } = deps;

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

      const promptPreview = event.title.length > 100 ? `${event.title.substring(0, 100)}...` : event.title;

      const message = `👻 Code task: ${promptPreview}

Estimated cost: $1-2
Estimated time: 30-60 min

Review: ${actionLink}`;

      const buttons = buildApprovalButtons({
        actionId: event.actionId,
        extraButtons: [{
          type: 'reply',
          reply: { id: `convert:${event.actionId}`, title: 'Convert to Issue' },
        }],
      });

      logger.info(
        { actionId: event.actionId, userId: event.userId },
        'Sending WhatsApp approval notification with interactive buttons'
      );

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: event.userId,
        message,
        buttons,
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
