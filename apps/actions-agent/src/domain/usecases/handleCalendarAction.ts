import type { Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { CalendarServiceClient, CalendarPreview } from '../ports/calendarServiceClient.js';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { Logger } from 'pino';
import type { ExecuteCalendarActionUseCase } from './executeCalendarAction.js';
import { createHandleActionTemplate, type HandleActionTemplateDeps } from './handleActionTemplate.js';
import { formatCalendarApprovalMessage } from '../utils/formatCalendarApprovalMessage.js';

export interface HandleCalendarActionDeps {
  actionRepository: ActionRepository;
  whatsappPublisher: WhatsAppSendPublisher;
  calendarServiceClient: CalendarServiceClient;
  webAppUrl: string;
  logger: Logger;
  executeCalendarAction?: ExecuteCalendarActionUseCase;
}

export interface HandleCalendarActionUseCase {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export function createHandleCalendarActionUseCase(deps: HandleCalendarActionDeps): HandleCalendarActionUseCase {
  const { calendarServiceClient } = deps;

  return createHandleActionTemplate(
    {
      actionType: 'calendar',
      emoji: '📅',
      buildMessage: (event, webAppUrl, preProcessData) => {
        const preview = (preProcessData?.['preview'] as CalendarPreview | null) ?? null;
        return formatCalendarApprovalMessage({
          preview,
          actionTitle: event.title,
          actionId: event.actionId,
          webAppUrl,
        });
      },
      preProcess: async (event) => {
        const now = new Date();
        const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
        const currentDate = `${now.toISOString().substring(0, 10)} ${dayOfWeek}`;

        const previewResult = await calendarServiceClient.generatePreview({
          actionId: event.actionId,
          userId: event.userId,
          text: event.payload.prompt,
          currentDate,
        });

        return { preview: previewResult.ok ? previewResult.value : null };
      },
    },
    {
      whatsappPublisher: deps.whatsappPublisher,
      webAppUrl: deps.webAppUrl,
      logger: deps.logger,
      executeAction: deps.executeCalendarAction,
    } as HandleActionTemplateDeps & Record<string, unknown>
  );
}
