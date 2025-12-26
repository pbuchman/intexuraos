/**
 * Pub/Sub Publisher for Transcription Completed Events.
 */
import { PubSub } from '@google-cloud/pubsub';
import pino from 'pino';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common';
import type {
  TranscriptionCompletedEvent,
  TranscriptionEventPublisher,
  TranscriptionError,
} from '../../domain/transcription/index.js';

const logger = pino({ name: 'pubsub-publisher' });

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

      logger.info(
        { topic: this.topicName, event, messageBody: event },
        'Publishing transcription completed event to Pub/Sub'
      );

      await topic.publishMessage({ data });

      logger.info(
        { topic: this.topicName, messageId: event.messageId, jobId: event.jobId },
        'Successfully published transcription completed event'
      );

      return ok(undefined);
    } catch (error) {
      logger.error(
        { topic: this.topicName, error: getErrorMessage(error) },
        'Failed to publish transcription completed event'
      );
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to publish event: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }
}
