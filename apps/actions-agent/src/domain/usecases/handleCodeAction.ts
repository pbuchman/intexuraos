import type { Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteCodeActionUseCase } from './executeCodeAction.js';
import { createHandleActionTemplate, type HandleActionTemplateDeps } from './handleActionTemplate.js';

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

export function createHandleCodeActionUseCase(deps: HandleCodeActionDeps): HandleCodeActionUseCase {
  return createHandleActionTemplate(
    {
      actionType: 'code',
      emoji: '👻',
      buildMessage: (event, webAppUrl) => {
        const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
        const promptPreview = event.title.length > 100 ? `${event.title.substring(0, 100)}...` : event.title;
        return `👻 Code task: ${promptPreview}\n\nEstimated cost: $1-2\nEstimated time: 30-60 min\n\nReview: ${actionLink}`;
      },
      extraButtons: (event) => [
        {
          type: 'reply',
          reply: { id: `convert:${event.actionId}`, title: 'Convert to Issue' },
        },
      ],
    },
    {
      whatsappPublisher: deps.whatsappPublisher,
      webAppUrl: deps.webAppUrl,
      logger: deps.logger,
      executeAction: deps.executeCodeAction,
    } as HandleActionTemplateDeps & Record<string, unknown>
  );
}
