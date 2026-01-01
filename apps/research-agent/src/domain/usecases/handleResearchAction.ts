import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../ports/actionServiceClient.js';
import type { ResearchServiceClient } from '../ports/researchServiceClient.js';
import type { NotificationSender } from '../ports/notificationSender.js';
import type { ActionCreatedEvent, LlmProvider } from '../models/actionEvent.js';
import pino from 'pino';

const WEB_APP_BASE_URL = 'https://app.intexuraos.com';
const DEFAULT_LLMS: LlmProvider[] = ['google', 'openai', 'anthropic'];

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'handleResearchAction',
});

export interface HandleResearchActionDeps {
  actionServiceClient: ActionServiceClient;
  researchServiceClient: ResearchServiceClient;
  notificationSender: NotificationSender;
}

export interface HandleResearchActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ researchId: string }>>;
}

export function createHandleResearchActionUseCase(
  deps: HandleResearchActionDeps
): HandleResearchActionUseCase {
  return {
    async execute(event: ActionCreatedEvent): Promise<Result<{ researchId: string }>> {
      const { actionServiceClient, researchServiceClient, notificationSender } = deps;

      logger.info(
        {
          actionId: event.actionId,
          userId: event.userId,
          commandId: event.commandId,
          title: event.title,
          actionType: event.actionType,
        },
        'Starting research action processing'
      );

      // Step 1: Mark action as processing
      logger.info({ actionId: event.actionId }, 'Step 1: Marking action as processing');
      const processingResult = await actionServiceClient.updateActionStatus(
        event.actionId,
        'processing'
      );
      if (!processingResult.ok) {
        logger.error(
          {
            actionId: event.actionId,
            error: getErrorMessage(processingResult.error),
          },
          'Step 1 failed: Could not mark action as processing'
        );
        return err(
          new Error(
            `Failed to mark action as processing: ${getErrorMessage(processingResult.error)}`
          )
        );
      }
      logger.info({ actionId: event.actionId }, 'Step 1 completed: Action marked as processing');

      // Step 2: Create draft research via LLM orchestrator
      const selectedLlms = event.payload.selectedLlms ?? DEFAULT_LLMS;
      logger.info(
        {
          actionId: event.actionId,
          selectedLlms,
          promptLength: event.payload.prompt.length,
        },
        'Step 2: Creating research draft via LLM orchestrator'
      );
      const draftResult = await researchServiceClient.createDraft({
        userId: event.userId,
        title: event.title,
        prompt: event.payload.prompt,
        selectedLlms,
        sourceActionId: event.actionId,
      });

      if (!draftResult.ok) {
        logger.error(
          {
            actionId: event.actionId,
            error: getErrorMessage(draftResult.error),
          },
          'Step 2 failed: Research draft creation failed'
        );
        await actionServiceClient.updateAction(event.actionId, {
          status: 'failed',
          payload: { error: getErrorMessage(draftResult.error) },
        });
        return err(
          new Error(`Failed to create research draft: ${getErrorMessage(draftResult.error)}`)
        );
      }

      const researchId = draftResult.value.id;
      logger.info(
        { actionId: event.actionId, researchId },
        'Step 2 completed: Research draft created'
      );

      // Step 3: Mark action as completed with research reference
      logger.info({ actionId: event.actionId, researchId }, 'Step 3: Marking action as completed');
      const completedResult = await actionServiceClient.updateAction(event.actionId, {
        status: 'completed',
        payload: { researchId },
      });
      if (!completedResult.ok) {
        logger.error(
          {
            actionId: event.actionId,
            researchId,
            error: getErrorMessage(completedResult.error),
          },
          'Step 3 failed: Could not mark action as completed'
        );
        return err(
          new Error(`Failed to mark action as completed: ${getErrorMessage(completedResult.error)}`)
        );
      }
      logger.info(
        { actionId: event.actionId, researchId },
        'Step 3 completed: Action marked as completed'
      );

      // Step 4: Send notification to user
      const draftUrl = `${WEB_APP_BASE_URL}/#/research/${researchId}`;
      logger.info(
        { actionId: event.actionId, userId: event.userId, researchId },
        'Step 4: Sending notification to user'
      );
      const notificationResult = await notificationSender.sendDraftReady(
        event.userId,
        researchId,
        event.title,
        draftUrl
      );
      if (!notificationResult.ok) {
        logger.error(
          {
            actionId: event.actionId,
            userId: event.userId,
            researchId,
            error: getErrorMessage(notificationResult.error),
          },
          'Step 4 failed: Could not send notification'
        );
        return err(
          new Error(`Failed to send notification: ${getErrorMessage(notificationResult.error)}`)
        );
      }
      logger.info(
        { actionId: event.actionId, userId: event.userId, researchId },
        'Step 4 completed: Notification sent'
      );

      logger.info(
        { actionId: event.actionId, researchId },
        'Research action processing completed successfully'
      );

      return ok({ researchId });
    },
  };
}
