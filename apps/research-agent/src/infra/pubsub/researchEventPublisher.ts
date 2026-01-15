import type { Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';

export interface ResearchProcessEvent {
  type: 'research.process';
  researchId: string;
  userId: string;
  triggeredBy: 'create' | 'approve';
}

export interface ResearchEventPublisher {
  publishProcessResearch(event: ResearchProcessEvent): Promise<Result<void, PublishError>>;
}

export interface ResearchEventPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}

export class ResearchEventPublisherImpl
  extends BasePubSubPublisher
  implements ResearchEventPublisher
{
  private readonly topicName: string;

  constructor(config: ResearchEventPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.topicName = config.topicName;
  }

  async publishProcessResearch(event: ResearchProcessEvent): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(
      this.topicName,
      event,
      { researchId: event.researchId, triggeredBy: event.triggeredBy },
      'research process'
    );
  }
}

export function createResearchEventPublisher(
  config: ResearchEventPublisherConfig
): ResearchEventPublisher {
  return new ResearchEventPublisherImpl(config);
}
