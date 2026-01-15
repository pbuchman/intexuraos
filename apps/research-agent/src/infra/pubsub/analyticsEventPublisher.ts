import type { Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';

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

export interface AnalyticsEventPublisher {
  publishLlmAnalytics(event: LlmAnalyticsEvent): Promise<Result<void, PublishError>>;
}

export interface AnalyticsEventPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}

export class AnalyticsEventPublisherImpl
  extends BasePubSubPublisher
  implements AnalyticsEventPublisher
{
  private readonly topicName: string;

  constructor(config: AnalyticsEventPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.topicName = config.topicName;
  }

  async publishLlmAnalytics(event: LlmAnalyticsEvent): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(
      this.topicName,
      event,
      { provider: event.provider, model: event.model },
      'LLM analytics'
    );
  }
}

export function createAnalyticsEventPublisher(
  config: AnalyticsEventPublisherConfig
): AnalyticsEventPublisher {
  return new AnalyticsEventPublisherImpl(config);
}
