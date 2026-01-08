import type { Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../../domain/models/actionEvent.js';
import { getActionsQueueTopic } from './config.js';

export interface ActionEventPublisher {
  publishActionCreated(event: ActionCreatedEvent): Promise<Result<void, PublishError>>;
}

export interface ActionEventPublisherConfig {
  projectId: string;
}

class ActionEventPublisherImpl extends BasePubSubPublisher implements ActionEventPublisher {
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

export function createActionEventPublisher(
  config: ActionEventPublisherConfig
): ActionEventPublisher {
  return new ActionEventPublisherImpl(config);
}
