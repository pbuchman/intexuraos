import type { Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type { LlmProvider } from '../../domain/research/models/Research.js';

export interface LlmCallEvent {
  type: 'llm.call';
  researchId: string;
  userId: string;
  provider: LlmProvider;
  prompt: string;
}

export interface LlmCallPublisher {
  publishLlmCall(event: LlmCallEvent): Promise<Result<void, PublishError>>;
}

export interface LlmCallPublisherConfig {
  projectId: string;
  topicName: string;
}

export class LlmCallPublisherImpl extends BasePubSubPublisher implements LlmCallPublisher {
  private readonly topicName: string;

  constructor(config: LlmCallPublisherConfig) {
    super({ projectId: config.projectId, loggerName: 'llm-call-publisher' });
    this.topicName = config.topicName;
  }

  async publishLlmCall(event: LlmCallEvent): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(
      this.topicName,
      event,
      { researchId: event.researchId, provider: event.provider },
      'LLM call'
    );
  }
}

export function createLlmCallPublisher(config: LlmCallPublisherConfig): LlmCallPublisher {
  return new LlmCallPublisherImpl(config);
}
