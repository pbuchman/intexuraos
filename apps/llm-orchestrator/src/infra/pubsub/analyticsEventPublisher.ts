import { PubSub } from '@google-cloud/pubsub';
import pino, { type LevelWithSilent } from 'pino';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';

export interface LlmAnalyticsEvent {
  type: 'llm.report';
  researchId: string;
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface PublishError {
  code: 'PUBLISH_FAILED';
  message: string;
}

export interface AnalyticsEventPublisher {
  publishLlmAnalytics(event: LlmAnalyticsEvent): Promise<Result<void, PublishError>>;
}

function getLogLevel(nodeEnv: string | undefined): LevelWithSilent {
  return nodeEnv === 'test' ? 'silent' : 'info';
}

const logger = pino({
  name: 'analytics-event-publisher',
  level: getLogLevel(process.env['NODE_ENV']),
});

export interface AnalyticsEventPublisherConfig {
  projectId: string;
  topicName: string;
}

export class AnalyticsEventPublisherImpl implements AnalyticsEventPublisher {
  private readonly pubsub: PubSub;
  private readonly topicName: string;

  constructor(config: AnalyticsEventPublisherConfig) {
    this.pubsub = new PubSub({ projectId: config.projectId });
    this.topicName = config.topicName;
  }

  async publishLlmAnalytics(event: LlmAnalyticsEvent): Promise<Result<void, PublishError>> {
    try {
      const topic = this.pubsub.topic(this.topicName);
      const data = Buffer.from(JSON.stringify(event));

      logger.debug(
        { topic: this.topicName, provider: event.provider, model: event.model },
        'Publishing LLM analytics event to Pub/Sub'
      );

      await topic.publishMessage({ data });

      logger.debug(
        { topic: this.topicName, provider: event.provider },
        'Successfully published LLM analytics event'
      );

      return ok(undefined);
    } catch (error) {
      logger.error(
        { topic: this.topicName, provider: event.provider, error: getErrorMessage(error) },
        'Failed to publish LLM analytics event'
      );
      return err({
        code: 'PUBLISH_FAILED',
        message: `Failed to publish LLM analytics event: ${getErrorMessage(error, 'Unknown Pub/Sub error')}`,
      });
    }
  }
}

export function createAnalyticsEventPublisher(
  config: AnalyticsEventPublisherConfig
): AnalyticsEventPublisher {
  return new AnalyticsEventPublisherImpl(config);
}
