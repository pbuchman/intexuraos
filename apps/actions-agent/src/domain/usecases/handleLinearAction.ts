import type { Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import { createHandleActionTemplate, type HandleActionTemplateDeps } from './handleActionTemplate.js';

export interface HandleLinearActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface HandleLinearActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleLinearActionUseCase(deps: HandleLinearActionDeps): HandleLinearActionUseCase {
  return createHandleActionTemplate(
    {
      actionType: 'linear',
      emoji: '🎯',
      buildMessage: (event, webAppUrl) => {
        const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
        return `🎯 New Linear issue ready for approval: "${event.title}"\n\nReview: ${actionLink}`;
      },
    },
    {
      whatsappPublisher: deps.whatsappPublisher,
      webAppUrl: deps.webAppUrl,
      logger: deps.logger,
    } as HandleActionTemplateDeps & Record<string, unknown>
  );
}
