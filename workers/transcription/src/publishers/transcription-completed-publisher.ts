/**
 * Publisher for TranscriptionCompletedEvent.
 *
 * Extends BasePubSubPublisher to publish transcription results to Pub/Sub.
 */
import type { Logger } from 'pino';
import { BasePubSubPublisher } from '@intexuraos/infra-pubsub';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { Result } from '@intexuraos/common-core';
import type { TranscriptionCompletedEvent } from '../types.js';

/**
 * Configuration for TranscriptionCompletedPublisher.
 */
export interface TranscriptionCompletedPublisherConfig {
  projectId: string;
  topicName: string;
  logger: Logger;
}

/**
 * Publisher interface for transcription completed events.
 */
export interface TranscriptionCompletedPublisher {
  publishCompleted(event: TranscriptionCompletedEvent): Promise<Result<void, PublishError>>;
}

/**
 * Implementation of TranscriptionCompletedPublisher.
 */
class TranscriptionCompletedPublisherImpl
  extends BasePubSubPublisher
  implements TranscriptionCompletedPublisher
{
  private readonly topicName: string;

  constructor(config: TranscriptionCompletedPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.topicName = config.topicName;
  }

  async publishCompleted(event: TranscriptionCompletedEvent): Promise<Result<void, PublishError>> {
    return await this.publishToTopic(
      this.topicName,
      event,
      { userId: event.userId, messageId: event.messageId, jobId: event.jobId },
      'transcription completed'
    );
  }
}

/**
 * Create a TranscriptionCompletedPublisher.
 */
export function createTranscriptionCompletedPublisher(
  config: TranscriptionCompletedPublisherConfig
): TranscriptionCompletedPublisher {
  return new TranscriptionCompletedPublisherImpl(config);
}
