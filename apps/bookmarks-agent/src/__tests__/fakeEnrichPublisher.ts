import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type {
  EnrichPublisher,
  EnrichBookmarkEvent,
} from '../infra/pubsub/enrichPublisher.js';

export class FakeEnrichPublisher implements EnrichPublisher {
  public publishedEvents: EnrichBookmarkEvent[] = [];
  private nextError: PublishError | null = null;

  setNextError(error: PublishError): void {
    this.nextError = error;
  }

  async publishEnrichBookmark(event: EnrichBookmarkEvent): Promise<Result<void, PublishError>> {
    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      return { ok: false, error };
    }

    this.publishedEvents.push(event);
    return ok(undefined);
  }

  clear(): void {
    this.publishedEvents = [];
    this.nextError = null;
  }
}
