/**
 * Cleanup Worker.
 * Subscribes to media cleanup Pub/Sub topic and deletes GCS objects.
 *
 * This worker processes MediaCleanupEvent messages published when users delete
 * WhatsApp messages. It deletes the original media and thumbnail files from GCS.
 *
 * Reliability:
 * - Uses Pub/Sub pull subscription with automatic retries
 * - Failed messages go to DLQ after max_delivery_attempts (configured in Terraform)
 * - Idempotent: treats "file not found" as success (may have been deleted already)
 */
import { type Message, PubSub } from '@google-cloud/pubsub';
import { getErrorMessage } from '@intexuraos/common-core';
import type { MediaCleanupEvent, MediaStoragePort } from '../domain/inbox/index.js';

/**
 * Logger interface for the cleanup worker.
 */
export interface CleanupWorkerLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/**
 * Configuration for the cleanup worker.
 */
export interface CleanupWorkerConfig {
  projectId: string;
  topicName: string;
  subscriptionName: string;
}

/**
 * Cleanup worker instance.
 */
export class CleanupWorker {
  private readonly pubsub: PubSub;
  private readonly topicName: string;
  private readonly subscriptionName: string;
  private readonly mediaStorage: MediaStoragePort;
  private readonly logger: CleanupWorkerLogger;
  private isRunning = false;

  constructor(
    config: CleanupWorkerConfig,
    mediaStorage: MediaStoragePort,
    logger: CleanupWorkerLogger
  ) {
    this.pubsub = new PubSub({ projectId: config.projectId });
    this.topicName = config.topicName;
    this.subscriptionName = config.subscriptionName;
    this.mediaStorage = mediaStorage;
    this.logger = logger;
  }

  /**
   * Start listening for cleanup events.
   * In emulator mode, auto-creates topic/subscription if they don't exist.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Auto-create topic/subscription in emulator mode
    if (process.env['PUBSUB_EMULATOR_HOST'] !== undefined) {
      await this.ensureTopicAndSubscription();
    }

    const subscription = this.pubsub.subscription(this.subscriptionName);

    this.logger.info('Starting Pub/Sub subscription for media cleanup events', {
      subscription: this.subscriptionName,
    });

    subscription.on('message', (message: Message) => {
      this.logger.info('Received Pub/Sub message', {
        messageId: message.id,
        publishTime: message.publishTime.toISOString(),
        dataLength: message.data.length,
      });
      void this.handleMessage(message);
    });

    subscription.on('error', (error: Error) => {
      this.logger.error('Subscription error', {
        subscription: this.subscriptionName,
        error: getErrorMessage(error),
        stack: error.stack,
      });
    });

    this.logger.info('Cleanup worker started successfully', {
      subscription: this.subscriptionName,
    });
  }

  /**
   * Ensure topic and subscription exist (for emulator mode).
   */
  private async ensureTopicAndSubscription(): Promise<void> {
    const topic = this.pubsub.topic(this.topicName);
    const [topicExists] = await topic.exists();

    if (!topicExists) {
      await topic.create();
      this.logger.info('Created Pub/Sub topic (emulator mode)', { topic: this.topicName });
    }

    const subscription = topic.subscription(this.subscriptionName);
    const [subExists] = await subscription.exists();

    if (!subExists) {
      await subscription.create();
      this.logger.info('Created Pub/Sub subscription (emulator mode)', {
        subscription: this.subscriptionName,
      });
    }
  }

  /**
   * Stop the worker gracefully.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    const subscription = this.pubsub.subscription(this.subscriptionName);
    await subscription.close();
    this.logger.info('Stopped');
  }

  /**
   * Handle a single cleanup message.
   */
  private async handleMessage(message: Message): Promise<void> {
    let event: MediaCleanupEvent;

    try {
      const rawData = message.data.toString();
      event = JSON.parse(rawData) as MediaCleanupEvent;

      this.logger.info('Processing Pub/Sub message', {
        messageId: message.id,
        messageBody: event,
        action: 'process_media_cleanup_event',
      });
    } catch (error) {
      // Malformed message - ack to prevent infinite redelivery
      this.logger.error('Failed to parse message, acking to prevent redelivery', {
        messageId: message.id,
        error: getErrorMessage(error),
      });
      message.ack();
      return;
    }

    // Validate event type (defensive check for future event types)
    const eventType = event.type as string;
    if (eventType !== 'whatsapp.media.cleanup') {
      // Unknown event type - ack to prevent infinite redelivery
      this.logger.warn('Unknown event type, acking', {
        messageId: message.id,
        eventType,
        expectedType: 'whatsapp.media.cleanup',
      });
      message.ack();
      return;
    }

    this.logger.info('Processing cleanup', {
      messageId: event.messageId,
      pathCount: event.gcsPaths.length,
    });

    try {
      // Delete all GCS paths
      for (const gcsPath of event.gcsPaths) {
        const result = await this.mediaStorage.delete(gcsPath);

        if (!result.ok) {
          // Log but don't fail - GCS adapter already handles "not found" gracefully
          this.logger.warn('Failed to delete file', {
            gcsPath,
            error: result.error.message,
          });
        } else {
          this.logger.info('Deleted file', { gcsPath });
        }
      }

      // All deletions attempted - acknowledge the message
      message.ack();
      this.logger.info('Completed cleanup', { messageId: event.messageId });
    } catch (error) {
      // Unexpected error - nack for retry
      this.logger.error('Unexpected error processing cleanup', {
        messageId: event.messageId,
        error: getErrorMessage(error),
      });
      message.nack();
    }
  }
}

/**
 * Create a cleanup worker instance.
 */
export function createCleanupWorker(
  config: CleanupWorkerConfig,
  mediaStorage: MediaStoragePort,
  logger: CleanupWorkerLogger
): CleanupWorker {
  return new CleanupWorker(config, mediaStorage, logger);
}
