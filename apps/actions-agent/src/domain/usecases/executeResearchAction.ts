import type { Result } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ResearchServiceClient } from '../ports/researchServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';
import {
  createExecuteActionTemplate,
  type ExecuteActionResult,
} from './executeActionTemplate.js';

export interface ExecuteResearchActionDeps {
  actionRepository: ActionRepository;
  researchServiceClient: ResearchServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export type ExecuteResearchActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteActionResult>>;

export function createExecuteResearchActionUseCase(
  deps: ExecuteResearchActionDeps
): ExecuteResearchActionUseCase {
  const { researchServiceClient, webAppUrl } = deps;

  return createExecuteActionTemplate(deps, {
    actionType: 'research',
    // Research is different: only awaiting_approval and failed are valid (NOT pending)
    validStatuses: ['awaiting_approval', 'failed'],
    preparePayload: (action: Action) => {
      const originalMessage =
        typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;
      const summary =
        typeof action.payload['summary'] === 'string' ? action.payload['summary'] : undefined;

      // Create the modified prompt with key points prepended
      const promptWithKeyPoints =
        summary !== undefined
          ? `## Key Points\n\n${summary}\n\n---\n\n${originalMessage}`
          : originalMessage;

      return {
        userId: action.userId,
        title: action.title,
        prompt: promptWithKeyPoints,
        originalMessage,
        sourceActionId: action.id,
      };
    },
    callService: async (_action: Action, prepared: Record<string, unknown>) =>
      await researchServiceClient.createDraft({
        userId: prepared['userId'] as string,
        title: prepared['title'] as string,
        prompt: prepared['prompt'] as string,
        originalMessage: prepared['originalMessage'] as string,
        sourceActionId: prepared['sourceActionId'] as string,
      }),
    buildCompletionMessage: (_action: Action, response) =>
      `📚 ${response.message} View it here: ${webAppUrl}${response.resourceUrl ?? ''}`,
    correlationPrefix: 'research-complete',
  });
}
