/**
 * Handle Code Action Use Case
 *
 * Processes code action creation requests by:
 * 1. Validating the action has required fields
 * 2. Setting defaults (workerType to 'auto' if not specified)
 * 3. Generating an approval nonce for interactive buttons
 * 4. Sending approval request via WhatsApp with interactive buttons
 *
 * Based on design doc: docs/designs/INT-156-code-action-type.md
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { WhatsAppInteractiveButton } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Action } from '../models/action.js';
import type { Logger } from 'pino';
import type { ExecuteCodeActionUseCase } from './executeCodeAction.js';
import { shouldAutoExecute } from './shouldAutoExecute.js';
import { generateApprovalNonce, generateNonceExpiration } from '../utils/approvalNonce.js';

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

      // Get action for nonce generation
      const action = await actionRepository.getById(event.actionId);
      if (action === null) {
        logger.error({ actionId: event.actionId }, 'Action not found');
        return err(new Error('Action not found'));
      }

      // Generate approval nonce and expiration
      const approvalNonce = generateApprovalNonce();
      const approvalNonceExpiresAt = generateNonceExpiration();

      // Update action with nonce fields (single-use approval token)
      const updatedAction: Action = {
        ...action,
        approvalNonce,
        approvalNonceExpiresAt,
      };
      await actionRepository.update(updatedAction);

      // Idempotency check and status update handled by registerActionHandler decorator
      const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;

      // Get prompt from payload for the approval message
      const prompt = typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : event.title;
      const promptPreview = prompt.length > 100 ? `${prompt.substring(0, 100)}...` : prompt;

      // Design lines 349-361: Include prompt summary, estimated cost, worker type
      // Design lines 2220-2226: ~$1.17/task average
      const message = `Code task: ${promptPreview}

Estimated cost: $1-2
Estimated time: 30-60 min

Review: ${actionLink}`;

      // Create interactive buttons for approval
      const buttons: WhatsAppInteractiveButton[] = [
        {
          type: 'reply',
          reply: {
            id: `approve:${event.actionId}:${approvalNonce}`,
            title: `Approve: ${approvalNonce}`,
          },
        },
        {
          type: 'reply',
          reply: {
            id: `cancel:${event.actionId}`,
            title: 'Cancel',
          },
        },
        {
          type: 'reply',
          reply: {
            id: `convert:${event.actionId}`,
            title: 'Convert to Issue',
          },
        },
      ];

      logger.info(
        { actionId: event.actionId, userId: event.userId, nonce: approvalNonce },
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
