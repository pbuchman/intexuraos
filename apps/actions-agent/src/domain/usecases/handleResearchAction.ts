import type { Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteResearchActionUseCase } from './executeResearchAction.js';
import { createHandleActionTemplate, type HandleActionTemplateDeps } from './handleActionTemplate.js';

export interface HandleResearchActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
  executeResearchAction?: ExecuteResearchActionUseCase;
}

export interface HandleResearchActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleResearchActionUseCase(deps: HandleResearchActionDeps): HandleResearchActionUseCase {
  return createHandleActionTemplate(
    {
      actionType: 'research',
      buildMessage: (event, webAppUrl) => {
        const actionLink = `${webAppUrl}/#/inbox?action=${event.actionId}`;
        return `📚 New research request ready for approval\n\nReview: ${actionLink}`;
      },
    },
    {
      whatsappPublisher: deps.whatsappPublisher,
      webAppUrl: deps.webAppUrl,
      logger: deps.logger,
      executeAction: deps.executeResearchAction,
    } as HandleActionTemplateDeps & Record<string, unknown>
  );
}
