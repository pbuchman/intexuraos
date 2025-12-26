/**
 * GCP Pub/Sub Publisher Adapter.
 * Implements EventPublisherPort for publishing events to Pub/Sub topics.
 */
import { PubSub } from '@google-cloud/pubsub';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common';
import type {
  EventPublisherPort,
  AudioStoredEvent,
  MediaCleanupEvent,
  InboxError,
} from '../../domain/inbox/index.js';

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

      await topic.publishMessage({ data });

      return ok(undefined);
    } catch (error) {
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

      await topic.publishMessage({ data });

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to publish media cleanup event: ${getErrorMessage(error, 'Unknown Pub/Sub error')}`,
      });
    }
  }
}
