/**
 * GCP Pub/Sub Publisher Adapter.
 * Implements EventPublisherPort for publishing events to Pub/Sub topics.
 */
import { PubSub } from '@google-cloud/pubsub';
import pino from 'pino';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common';
import type {
  EventPublisherPort,
  AudioStoredEvent,
  MediaCleanupEvent,
  InboxError,
} from '../../domain/inbox/index.js';

const logger = pino({ name: 'pubsub-publisher' });

/**
 * GCP Pub/Sub implementation of EventPublisherPort.
 */
export class GcpPubSubPublisher implements EventPublisherPort {
  private readonly pubsub: PubSub;
  private readonly audioStoredTopic: string;
  private readonly mediaCleanupTopic: string;

  constructor(projectId: string, audioStoredTopic: string, mediaCleanupTopic: string) {
    this.pubsub = new PubSub({ projectId });
    this.audioStoredTopic = audioStoredTopic;
    this.mediaCleanupTopic = mediaCleanupTopic;
  }

  async publishAudioStored(event: AudioStoredEvent): Promise<Result<void, InboxError>> {
    try {
      const topic = this.pubsub.topic(this.audioStoredTopic);
      const data = Buffer.from(JSON.stringify(event));

      logger.info(
        { topic: this.audioStoredTopic, event, messageBody: event },
        'Publishing audio stored event to Pub/Sub'
      );

      await topic.publishMessage({ data });

      logger.info(
        { topic: this.audioStoredTopic, messageId: event.messageId },
        'Successfully published audio stored event'
      );

      return ok(undefined);
    } catch (error) {
      logger.error(
        { topic: this.audioStoredTopic, error: getErrorMessage(error) },
        'Failed to publish audio stored event'
      );
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to publish audio stored event: ${getErrorMessage(error, 'Unknown Pub/Sub error')}`,
      });
    }
  }

  async publishMediaCleanup(event: MediaCleanupEvent): Promise<Result<void, InboxError>> {
    try {
      const topic = this.pubsub.topic(this.mediaCleanupTopic);
      const data = Buffer.from(JSON.stringify(event));

      logger.info(
        { topic: this.mediaCleanupTopic, event, messageBody: event },
        'Publishing media cleanup event to Pub/Sub'
      );

      await topic.publishMessage({ data });

      logger.info(
        { topic: this.mediaCleanupTopic, messageId: event.messageId },
        'Successfully published media cleanup event'
      );

      return ok(undefined);
    } catch (error) {
      logger.error(
        { topic: this.mediaCleanupTopic, error: getErrorMessage(error) },
        'Failed to publish media cleanup event'
      );
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to publish media cleanup event: ${getErrorMessage(error, 'Unknown Pub/Sub error')}`,
      });
    }
  }
}
