import type { Result } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { TodosServiceClient } from '../ports/todosServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';
import {
  createExecuteActionTemplate,
  type ExecuteActionResult,
} from './executeActionTemplate.js';

export interface ExecuteTodoActionDeps {
  actionRepository: ActionRepository;
  todosServiceClient: TodosServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export type ExecuteTodoActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteActionResult>>;

export function createExecuteTodoActionUseCase(
  deps: ExecuteTodoActionDeps
): ExecuteTodoActionUseCase {
  const { todosServiceClient, webAppUrl } = deps;

  return createExecuteActionTemplate(deps, {
    actionType: 'todo',
    validStatuses: ['pending', 'awaiting_approval', 'failed'],
    preparePayload: (action: Action) => {
      const prompt =
        typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;

      return {
        userId: action.userId,
        title: action.title,
        description: prompt,
        tags: [],
        source: 'actions-agent',
        sourceId: action.id,
      };
    },
    callService: async (_action: Action, prepared: Record<string, unknown>) =>
      await todosServiceClient.createTodo({
        userId: prepared['userId'] as string,
        title: prepared['title'] as string,
        description: prepared['description'] as string,
        tags: prepared['tags'] as string[],
        source: prepared['source'] as string,
        sourceId: prepared['sourceId'] as string,
      }),
    buildCompletionMessage: (_action: Action, response) =>
      `✨ ${response.message} View it here: ${webAppUrl}${response.resourceUrl ?? ''}`,
    correlationPrefix: 'todo-complete',
  });
}
