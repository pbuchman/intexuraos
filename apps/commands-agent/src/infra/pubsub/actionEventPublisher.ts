import type { Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type { EventPublisherPort } from '../../domain/ports/eventPublisher.js';
import type { ActionCreatedEvent } from '../../domain/events/actionCreatedEvent.js';
import { getActionsQueueTopic } from './config.js';

export interface ActionEventPublisherConfig {
  projectId: string;
}

export class ActionEventPublisher extends BasePubSubPublisher implements EventPublisherPort {
  constructor(config: ActionEventPublisherConfig) {
    super({ projectId: config.projectId, loggerName: 'action-event-publisher' });
  }

  async publishActionCreated(event: ActionCreatedEvent): Promise<Result<void, PublishError>> {
    const topicName = getActionsQueueTopic();

    return await this.publishToTopic(
      topicName,
      event,
      { actionId: event.actionId, actionType: event.actionType },
      'action created'
    );
  }
}

export function createActionEventPublisher(config: ActionEventPublisherConfig): EventPublisherPort {
  return new ActionEventPublisher(config);
}
