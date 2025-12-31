/**
 * Port for event publishing.
 * Abstracts Pub/Sub-specific operations for the domain layer.
 */
import type { Result } from '@intexuraos/common-core';
import type { InboxError } from './repositories.js';
import type { CommandIngestEvent, MediaCleanupEvent } from '../events/index.js';

/**
 * Port for publishing events to external systems.
 */
export interface EventPublisherPort {
  /**
   * Publish a media cleanup event.
   * Triggers async media deletion.
   *
   * @param event - Media cleanup event data
   */
  publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, InboxError>>;

  /**
   * Publish a command ingest event.
   * Triggers command classification in commands-router.
   *
   * @param event - Command ingest event data
   */
  publishCommandIngest(event: CommandIngestEvent): Promise<Result<void, InboxError>>;
}
