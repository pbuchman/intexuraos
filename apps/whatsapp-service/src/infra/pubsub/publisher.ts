/**
 * GCP Pub/Sub Publisher Adapter.
 * Implements EventPublisherPort for publishing events to Pub/Sub topics.
 */
import { PubSub } from '@google-cloud/pubsub';
import pino, { type LevelWithSilent } from 'pino';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  CommandIngestEvent,
  EventPublisherPort,
  InboxError,
  MediaCleanupEvent,
} from '../../domain/inbox/index.js';

/**
 * Gets the pino log level based on the current environment.
 * Exported for testing.
 */
export function getLogLevel(nodeEnv: string | undefined): LevelWithSilent {
  return nodeEnv === 'test' ? 'silent' : 'info';
}

const logger = pino({
  name: 'pubsub-publisher',
  level: getLogLevel(process.env['NODE_ENV']),
});

/**
 * GCP Pub/Sub implementation of EventPublisherPort.
 */
export class GcpPubSubPublisher implements EventPublisherPort {
  private readonly pubsub: PubSub;
  private readonly mediaCleanupTopic: string;
  private readonly commandsIngestTopic: string | null;

  constructor(projectId: string, mediaCleanupTopic: string, commandsIngestTopic?: string) {
    this.pubsub = new PubSub({ projectId });
    this.mediaCleanupTopic = mediaCleanupTopic;
    this.commandsIngestTopic = commandsIngestTopic ?? null;
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

  async publishCommandIngest(event: CommandIngestEvent): Promise<Result<void, InboxError>> {
    if (this.commandsIngestTopic === null) {
      logger.debug({ event }, 'Commands ingest topic not configured, skipping publish');
      return ok(undefined);
    }

    try {
      const topic = this.pubsub.topic(this.commandsIngestTopic);
      const data = Buffer.from(JSON.stringify(event));

      logger.info(
        { topic: this.commandsIngestTopic, event },
        'Publishing command ingest event to Pub/Sub'
      );

      await topic.publishMessage({ data });

      logger.info(
        { topic: this.commandsIngestTopic, externalId: event.externalId },
        'Successfully published command ingest event'
      );

      return ok(undefined);
    } catch (error) {
      logger.error(
        { topic: this.commandsIngestTopic, error: getErrorMessage(error) },
        'Failed to publish command ingest event'
      );
      return err({
        code: 'INTERNAL_ERROR',
        message: `Failed to publish command ingest event: ${getErrorMessage(error, 'Unknown Pub/Sub error')}`,
      });
    }
  }
}
