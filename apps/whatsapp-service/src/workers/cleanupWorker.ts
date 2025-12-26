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
import { PubSub, type Message } from '@google-cloud/pubsub';
import { getErrorMessage } from '@intexuraos/common';
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
  subscriptionName: string;
}

/**
 * Cleanup worker instance.
 */
export class CleanupWorker {
  private readonly pubsub: PubSub;
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
    this.subscriptionName = config.subscriptionName;
    this.mediaStorage = mediaStorage;
    this.logger = logger;
  }

  /**
   * Start listening for cleanup events.
   * Non-blocking - sets up subscription listener and returns immediately.
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    const subscription = this.pubsub.subscription(this.subscriptionName);

    subscription.on('message', (message: Message) => {
      void this.handleMessage(message);
    });

    subscription.on('error', (error: Error) => {
      this.logger.error('Subscription error', { error: getErrorMessage(error) });
    });

    this.logger.info('Started listening', { subscription: this.subscriptionName });
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
      event = JSON.parse(message.data.toString()) as MediaCleanupEvent;
    } catch (error) {
      // Malformed message - ack to prevent infinite redelivery
      this.logger.error('Failed to parse message, acking to prevent redelivery', {
        error: getErrorMessage(error),
      });
      message.ack();
      return;
    }

    // Validate event type (defensive check for future event types)
    const eventType = event.type as string;
    if (eventType !== 'whatsapp.media.cleanup') {
      // Unknown event type - ack to prevent infinite redelivery
      this.logger.warn('Unknown event type, acking', { eventType });
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
