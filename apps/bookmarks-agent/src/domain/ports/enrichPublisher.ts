import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';

export interface EnrichBookmarkEvent {
  type: 'bookmarks.enrich';
  bookmarkId: string;
  userId: string;
  url: string;
}

export interface EnrichPublisher {
  publishEnrichBookmark(
    event: EnrichBookmarkEvent
  ): Promise<Result<void, PublishError>>;
}
