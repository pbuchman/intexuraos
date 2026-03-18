import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher, WhatsAppInteractiveButton } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import { shouldAutoExecute } from './shouldAutoExecute.js';
import { buildApprovalButtons } from '../utils/approvalButtons.js';

export interface HandleActionConfig {
  actionType: string;
  emoji: string;
  buildMessage: (event: ActionCreatedEvent, webAppUrl: string, preProcessData?: Record<string, unknown>) => string;
  extraButtons?: (event: ActionCreatedEvent) => WhatsAppInteractiveButton[];
  preProcess?: (
    event: ActionCreatedEvent,
    deps: Record<string, unknown>
  ) => Promise<Record<string, unknown> | undefined>;
  onAutoExecuteResult?: (result: Result<unknown>, event: ActionCreatedEvent, logger: Logger) => void;
}

export interface HandleActionTemplateDeps {
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeAction?: (actionId: string) => Promise<Result<unknown>>;
}

export function createHandleActionTemplate(
  config: HandleActionConfig,
  deps: HandleActionTemplateDeps & Record<string, unknown>
): { execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>> } {
  const { whatsappPublisher, webAppUrl, logger, executeAction } = deps;

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
        `Processing ${config.actionType} action`
      );

      if (shouldAutoExecute(event) && executeAction !== undefined) {
        logger.info({ actionId: event.actionId }, `Auto-executing ${config.actionType} action`);

        const executeResult = await executeAction(event.actionId);

        if (!executeResult.ok) {
          logger.error(
            { actionId: event.actionId, error: getErrorMessage(executeResult.error) },
            `Failed to auto-execute ${config.actionType} action`
          );
          return err(executeResult.error);
        }

        // Special case: handle code action failed status
        const resultValue = executeResult.value as Record<string, unknown> | undefined;
        if (resultValue?.['status'] === 'failed') {
          logger.warn(
            { actionId: event.actionId, message: resultValue['message'] },
            'Code action auto-executed but resulted in failure'
          );
        } else {
          logger.info({ actionId: event.actionId }, `${config.actionType} action auto-executed successfully`);
        }

        return ok({ actionId: event.actionId });
      }

      const preProcessData = await config.preProcess?.(event, deps);

      const message = config.buildMessage(event, webAppUrl, preProcessData);
      const extraButtons = config.extraButtons?.(event);

      const buttonConfig: { actionId: string; extraButtons?: WhatsAppInteractiveButton[] } = {
        actionId: event.actionId,
      };
      if (extraButtons !== undefined) {
        buttonConfig.extraButtons = extraButtons;
      }

      const buttons = buildApprovalButtons(buttonConfig);

      logger.info(
        { actionId: event.actionId, userId: event.userId },
        `Sending WhatsApp approval notification for ${config.actionType}`
      );

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: event.userId,
        message,
        buttons,
        correlationId: `action-${config.actionType}-approval-${event.actionId}`,
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
        logger.info({ actionId: event.actionId }, `WhatsApp approval notification sent for ${config.actionType}`);
      }

      return ok({ actionId: event.actionId });
    },
  };
}
