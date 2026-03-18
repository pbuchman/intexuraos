import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher, WhatsAppInteractiveButton } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import { shouldAutoExecute } from './shouldAutoExecute.js';
import { buildApprovalButtons } from '../utils/approvalButtons.js';

/**
 * Configuration for the handle action template factory.
 * Defines action-specific behavior while the template handles the common flow.
 */
export interface HandleActionConfig {
  /** The action type identifier (e.g., 'note', 'todo', 'calendar') */
  actionType: string;
  /** Function to build the approval message. Receives the event, web app URL, and optional pre-process data. */
  buildMessage: (event: ActionCreatedEvent, webAppUrl: string, preProcessData?: Record<string, unknown>) => string;
  /** Optional function to provide additional buttons beyond Approve/Reject */
  extraButtons?: (event: ActionCreatedEvent) => WhatsAppInteractiveButton[];
  /** Optional async function to run before building the message (e.g., fetching calendar preview) */
  preProcess?: (
    event: ActionCreatedEvent,
    deps: Record<string, unknown>
  ) => Promise<Record<string, unknown> | undefined>;
  /** Optional callback invoked after successful auto-execution. Use for custom logging or handling special cases. */
  onAutoExecuteSuccess?: (result: unknown, event: ActionCreatedEvent, logger: Logger) => void;
}

/**
 * Dependencies required by the handle action template.
 * Handlers may extend this with additional dependencies via Record<string, unknown>.
 */
export interface HandleActionTemplateDeps {
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeAction?: (actionId: string) => Promise<Result<unknown>>;
}

/**
 * Factory function that creates a handle action use case.
 * Extracts common logic: logging, auto-execution check, WhatsApp notification, approval flow.
 *
 * @param config - Action-specific configuration
 * @param deps - Template dependencies including WhatsApp publisher, logger, and optional execute function
 * @returns Use case with execute method
 *
 * @example
 * ```typescript
 * return createHandleActionTemplate(
 *   {
 *     actionType: 'note',
 *     buildMessage: (event, webAppUrl) => `Note: ${event.title}\n${webAppUrl}`,
 *   },
 *   { whatsappPublisher, webAppUrl, logger, executeAction: deps.executeNoteAction }
 * );
 * ```
 */
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

        if (config.onAutoExecuteSuccess !== undefined) {
          config.onAutoExecuteSuccess(executeResult.value, event, logger);
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
