import type { Result } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { NotesServiceClient } from '../ports/notesServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';
import {
  createExecuteActionTemplate,
  type ExecuteActionResult,
} from './executeActionTemplate.js';

export interface ExecuteNoteActionDeps {
  actionRepository: ActionRepository;
  notesServiceClient: NotesServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export type ExecuteNoteActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteActionResult>>;

export function createExecuteNoteActionUseCase(
  deps: ExecuteNoteActionDeps
): ExecuteNoteActionUseCase {
  const { notesServiceClient, webAppUrl } = deps;

  return createExecuteActionTemplate(deps, {
    actionType: 'note',
    validStatuses: ['pending', 'awaiting_approval', 'failed'],
    preparePayload: (action: Action) => {
      const prompt =
        typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;
      const summary =
        typeof action.payload['summary'] === 'string' ? action.payload['summary'] : undefined;

      const contentWithKeyPoints =
        summary !== undefined ? `## Key Points\n\n${summary}\n\n---\n\n${prompt}` : prompt;

      return {
        userId: action.userId,
        title: action.title,
        content: contentWithKeyPoints,
        tags: [],
        source: 'actions-agent',
        sourceId: action.id,
      };
    },
    callService: async (_action: Action, prepared: Record<string, unknown>) =>
      await notesServiceClient.createNote({
        userId: prepared['userId'] as string,
        title: prepared['title'] as string,
        content: prepared['content'] as string,
        tags: prepared['tags'] as string[],
        source: prepared['source'] as string,
        sourceId: prepared['sourceId'] as string,
      }),
    buildCompletionMessage: (_action: Action, response) =>
      /* v8 ignore start -- ts-type: nullish coalescing fallback guard for undefined resourceUrl @preserve */
      `✨ ${response.message} View it here: ${webAppUrl}${response.resourceUrl ?? ''}`,
    /* v8 ignore stop @preserve */
    correlationPrefix: 'note-complete',
  });
}
