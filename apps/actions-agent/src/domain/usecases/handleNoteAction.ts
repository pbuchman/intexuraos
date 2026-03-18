import type { Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteNoteActionUseCase } from './executeNoteAction.js';
import { createHandleActionTemplate, type HandleActionTemplateDeps } from './handleActionTemplate.js';

export interface HandleNoteActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeNoteAction?: ExecuteNoteActionUseCase;
}

export interface HandleNoteActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleNoteActionUseCase(deps: HandleNoteActionDeps): HandleNoteActionUseCase {
  return createHandleActionTemplate(
    {
      actionType: 'note',
      buildMessage: (event, webAppUrl) => {
        const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
        return `📒 New note ready for approval: "${event.title}"\n\nReview: ${actionLink}`;
      },
    },
    {
      whatsappPublisher: deps.whatsappPublisher,
      webAppUrl: deps.webAppUrl,
      logger: deps.logger,
      executeAction: deps.executeNoteAction,
    } as HandleActionTemplateDeps & Record<string, unknown>
  );
}
