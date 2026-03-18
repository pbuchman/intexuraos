import type { Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteLinkActionUseCase } from './executeLinkAction.js';
import { createHandleActionTemplate, type HandleActionTemplateDeps } from './handleActionTemplate.js';

export interface HandleLinkActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeLinkAction?: ExecuteLinkActionUseCase;
}

export interface HandleLinkActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleLinkActionUseCase(deps: HandleLinkActionDeps): HandleLinkActionUseCase {
  return createHandleActionTemplate(
    {
      actionType: 'link',
      emoji: '📑',
      buildMessage: (event, webAppUrl) => {
        const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
        return `📑 New link ready to save: "${event.title}"\n\nReview: ${actionLink}`;
      },
    },
    {
      whatsappPublisher: deps.whatsappPublisher,
      webAppUrl: deps.webAppUrl,
      logger: deps.logger,
      executeAction: deps.executeLinkAction,
    } as HandleActionTemplateDeps & Record<string, unknown>
  );
}
