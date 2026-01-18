import type { Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';

export interface SummarizeBookmarkEvent {
  type: 'bookmarks.summarize';
  bookmarkId: string;
  userId: string;
}

export interface SummarizePublisher {
  publishSummarizeBookmark(
    event: SummarizeBookmarkEvent
  ): Promise<Result<void, PublishError>>;
}
