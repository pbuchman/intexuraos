import type { Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type { ActionCreatedEvent } from '../../domain/models/actionEvent.js';
import { getActionsQueueTopic } from './config.js';

export interface ActionEventPublisher {
  publishActionCreated(event: ActionCreatedEvent): Promise<Result<void, PublishError>>;
}

export interface ActionEventPublisherConfig {
  projectId: string;
  logger: Logger;
}

class ActionEventPublisherImpl extends BasePubSubPublisher implements ActionEventPublisher {
  constructor(config: ActionEventPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
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
