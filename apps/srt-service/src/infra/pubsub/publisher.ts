/**
 * Pub/Sub Publisher for Transcription Completed Events.
 */
import { PubSub } from '@google-cloud/pubsub';
import { ok, err, type Result } from '@intexuraos/common';
import type {
  TranscriptionCompletedEvent,
  TranscriptionEventPublisher,
  TranscriptionError,
} from '../../domain/transcription/index.js';

/**
 * GCP Pub/Sub implementation of TranscriptionEventPublisher.
 */
export class GcpTranscriptionEventPublisher implements TranscriptionEventPublisher {
  private readonly pubsub: PubSub;
  private readonly topicName: string;

  constructor(projectId: string, topicName: string) {
    this.pubsub = new PubSub({ projectId });
    this.topicName = topicName;
  }

  async publishCompleted(
    event: TranscriptionCompletedEvent
  ): Promise<Result<void, TranscriptionError>> {
    try {
      const topic = this.pubsub.topic(this.topicName);
      const data = Buffer.from(JSON.stringify(event));

      await topic.publishMessage({ data });

      return ok(undefined);
    } catch (error) {
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to publish event: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }
}
