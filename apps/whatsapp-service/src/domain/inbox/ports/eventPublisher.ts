/**
 * Port for event publishing.
 * Abstracts Pub/Sub-specific operations for the domain layer.
 */
import type { Result } from '@intexuraos/common';
import type { InboxError } from './repositories.js';
import type { AudioStoredEvent, MediaCleanupEvent } from '../events/index.js';

/**
 * Port for publishing events to external systems.
 */
export interface EventPublisherPort {
  /**
   * Publish an audio stored event.
   * Triggers transcription in srt-service.
   *
   * @param event - Audio stored event data
   */
  publishAudioStored(event: AudioStoredEvent): Promise<Result<void, InboxError>>;

  /**
   * Publish a media cleanup event.
   * Triggers async media deletion.
   *
   * @param event - Media cleanup event data
   */
  publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, InboxError>>;
}
