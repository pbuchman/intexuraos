import { PubSub } from '@google-cloud/pubsub';
import pino, { type LevelWithSilent } from 'pino';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { EventPublisherPort, PublishError } from '../../domain/ports/eventPublisher.js';
import type { ActionCreatedEvent } from '../../domain/events/actionCreatedEvent.js';
import { ACTION_TOPICS } from './config.js';

export function getLogLevel(nodeEnv: string | undefined): LevelWithSilent {
  return nodeEnv === 'test' ? 'silent' : 'info';
}

const logger = pino({
  name: 'action-event-publisher',
  level: getLogLevel(process.env['NODE_ENV']),
});

export interface ActionEventPublisherConfig {
  projectId: string;
}

export class ActionEventPublisher implements EventPublisherPort {
  private readonly pubsub: PubSub;

  constructor(config: ActionEventPublisherConfig) {
    this.pubsub = new PubSub({ projectId: config.projectId });
  }

  async publishActionCreated(event: ActionCreatedEvent): Promise<Result<void, PublishError>> {
    const topicName = ACTION_TOPICS[event.actionType];

    if (topicName === null) {
      logger.debug(
        { actionType: event.actionType, actionId: event.actionId },
        'No topic configured for action type, skipping publish'
      );
      return ok(undefined);
    }

    try {
      const topic = this.pubsub.topic(topicName);
      const data = Buffer.from(JSON.stringify(event));

      logger.info(
        { topic: topicName, actionId: event.actionId, actionType: event.actionType },
        'Publishing action created event to Pub/Sub'
      );

      await topic.publishMessage({ data });

      logger.info(
        { topic: topicName, actionId: event.actionId },
        'Successfully published action created event'
      );

      return ok(undefined);
    } catch (error) {
      logger.error(
        { topic: topicName, actionId: event.actionId, error: getErrorMessage(error) },
        'Failed to publish action created event'
      );
      return err({
        code: 'PUBLISH_FAILED',
        message: `Failed to publish action created event: ${getErrorMessage(error, 'Unknown Pub/Sub error')}`,
      });
    }
  }
}

export function createActionEventPublisher(config: ActionEventPublisherConfig): EventPublisherPort {
  return new ActionEventPublisher(config);
}
