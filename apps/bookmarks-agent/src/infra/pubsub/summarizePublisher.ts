import type { Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type {
  SummarizePublisher,
  SummarizeBookmarkEvent,
} from '../../domain/ports/summarizePublisher.js';

export type { SummarizePublisher, SummarizeBookmarkEvent };

export interface SummarizePublisherConfig {
  projectId: string;
  topicName: string | null;
  logger: Logger;
}

class SummarizePublisherImpl extends BasePubSubPublisher implements SummarizePublisher {
  private readonly topicName: string | null;

  constructor(config: SummarizePublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.topicName = config.topicName;
  }

  async publishSummarizeBookmark(
    event: SummarizeBookmarkEvent
  ): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(
      this.topicName,
      event,
      { bookmarkId: event.bookmarkId, userId: event.userId },
      'bookmark summarize'
    );
  }
}

export function createSummarizePublisher(
  config: SummarizePublisherConfig
): SummarizePublisher {
  return new SummarizePublisherImpl(config);
}
