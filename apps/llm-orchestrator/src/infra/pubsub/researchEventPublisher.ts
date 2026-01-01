import { PubSub } from '@google-cloud/pubsub';
import pino, { type LevelWithSilent } from 'pino';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';

export interface ResearchProcessEvent {
  type: 'research.process';
  researchId: string;
  userId: string;
  triggeredBy: 'create' | 'approve';
}

export interface PublishError {
  code: 'PUBLISH_FAILED';
  message: string;
}

export interface ResearchEventPublisher {
  publishProcessResearch(event: ResearchProcessEvent): Promise<Result<void, PublishError>>;
}

function getLogLevel(nodeEnv: string | undefined): LevelWithSilent {
  return nodeEnv === 'test' ? 'silent' : 'info';
}

const logger = pino({
  name: 'research-event-publisher',
  level: getLogLevel(process.env['NODE_ENV']),
});

export interface ResearchEventPublisherConfig {
  projectId: string;
  topicName: string;
}

export class ResearchEventPublisherImpl implements ResearchEventPublisher {
  private readonly pubsub: PubSub;
  private readonly topicName: string;

  constructor(config: ResearchEventPublisherConfig) {
    this.pubsub = new PubSub({ projectId: config.projectId });
    this.topicName = config.topicName;
  }

  async publishProcessResearch(event: ResearchProcessEvent): Promise<Result<void, PublishError>> {
    try {
      const topic = this.pubsub.topic(this.topicName);
      const data = Buffer.from(JSON.stringify(event));

      logger.info(
        { topic: this.topicName, researchId: event.researchId, triggeredBy: event.triggeredBy },
        'Publishing research process event to Pub/Sub'
      );

      await topic.publishMessage({ data });

      logger.info(
        { topic: this.topicName, researchId: event.researchId },
        'Successfully published research process event'
      );

      return ok(undefined);
    } catch (error) {
      logger.error(
        { topic: this.topicName, researchId: event.researchId, error: getErrorMessage(error) },
        'Failed to publish research process event'
      );
      return err({
        code: 'PUBLISH_FAILED',
        message: `Failed to publish research process event: ${getErrorMessage(error, 'Unknown Pub/Sub error')}`,
      });
    }
  }
}

export function createResearchEventPublisher(
  config: ResearchEventPublisherConfig
): ResearchEventPublisher {
  return new ResearchEventPublisherImpl(config);
}
