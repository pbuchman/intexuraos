import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../ports/actionServiceClient.js';
import type { ResearchServiceClient } from '../ports/researchServiceClient.js';
import type { NotificationSender } from '../ports/notificationSender.js';
import type { ActionCreatedEvent, LlmProvider } from '../models/actionEvent.js';

const WEB_APP_BASE_URL = 'https://app.intexuraos.com';
const DEFAULT_LLMS: LlmProvider[] = ['google', 'openai', 'anthropic'];

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

      // Step 1: Mark action as processing
      const processingResult = await actionServiceClient.updateActionStatus(
        event.actionId,
        'processing'
      );
      if (!processingResult.ok) {
        return err(
          new Error(
            `Failed to mark action as processing: ${getErrorMessage(processingResult.error)}`
          )
        );
      }

      // Step 2: Create draft research via LLM orchestrator
      const selectedLlms = event.payload.selectedLlms ?? DEFAULT_LLMS;
      const draftResult = await researchServiceClient.createDraft({
        userId: event.userId,
        title: event.title,
        prompt: event.payload.prompt,
        selectedLlms,
        sourceActionId: event.actionId,
      });

      if (!draftResult.ok) {
        await actionServiceClient.updateAction(event.actionId, {
          status: 'failed',
          payload: { error: getErrorMessage(draftResult.error) },
        });
        return err(
          new Error(`Failed to create research draft: ${getErrorMessage(draftResult.error)}`)
        );
      }

      const researchId = draftResult.value.id;

      // Step 3: Mark action as completed with research reference
      const completedResult = await actionServiceClient.updateAction(event.actionId, {
        status: 'completed',
        payload: { researchId },
      });
      if (!completedResult.ok) {
        return err(
          new Error(`Failed to mark action as completed: ${getErrorMessage(completedResult.error)}`)
        );
      }

      // Step 4: Send notification to user
      const draftUrl = `${WEB_APP_BASE_URL}/#/research/${researchId}`;
      const notificationResult = await notificationSender.sendDraftReady(
        event.userId,
        researchId,
        event.title,
        draftUrl
      );
      if (!notificationResult.ok) {
        return err(
          new Error(`Failed to send notification: ${getErrorMessage(notificationResult.error)}`)
        );
      }

      return ok({ researchId });
    },
  };
}
