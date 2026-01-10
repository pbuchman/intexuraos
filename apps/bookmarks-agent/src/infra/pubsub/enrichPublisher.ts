import type { Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';

export interface EnrichBookmarkEvent {
  type: 'bookmarks.enrich';
  bookmarkId: string;
  userId: string;
  url: string;
}

export interface EnrichPublisher {
  publishEnrichBookmark(event: EnrichBookmarkEvent): Promise<Result<void, PublishError>>;
}

export interface EnrichPublisherConfig {
  projectId: string;
  topicName: string | null;
}

class EnrichPublisherImpl extends BasePubSubPublisher implements EnrichPublisher {
  private readonly topicName: string | null;

  constructor(config: EnrichPublisherConfig) {
    super({ projectId: config.projectId, loggerName: 'bookmark-enrich-publisher' });
    this.topicName = config.topicName;
  }

  async publishEnrichBookmark(event: EnrichBookmarkEvent): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(
      this.topicName,
      event,
      { bookmarkId: event.bookmarkId, userId: event.userId },
      'bookmark enrich'
    );
  }
}

export function createEnrichPublisher(config: EnrichPublisherConfig): EnrichPublisher {
  return new EnrichPublisherImpl(config);
}
