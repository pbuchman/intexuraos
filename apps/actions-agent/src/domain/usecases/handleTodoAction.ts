import type { Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteTodoActionUseCase } from './executeTodoAction.js';
import { createHandleActionTemplate, type HandleActionTemplateDeps } from './handleActionTemplate.js';

export interface HandleTodoActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeTodoAction?: ExecuteTodoActionUseCase;
}

export interface HandleTodoActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleTodoActionUseCase(deps: HandleTodoActionDeps): HandleTodoActionUseCase {
  return createHandleActionTemplate(
    {
      actionType: 'todo',
      buildMessage: (event, webAppUrl) => {
        const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
        return `👷 New todo ready for approval: "${event.title}"\n\nReview: ${actionLink}`;
      },
    },
    {
      whatsappPublisher: deps.whatsappPublisher,
      webAppUrl: deps.webAppUrl,
      logger: deps.logger,
      executeAction: deps.executeTodoAction,
    } as HandleActionTemplateDeps & Record<string, unknown>
  );
}
