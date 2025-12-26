/**
 * Pub/Sub Subscriber for Audio Stored Events.
 */
import { PubSub, type Message } from '@google-cloud/pubsub';
import pino from 'pino';

const logger = pino({ name: 'pubsub-subscriber' });

/**
 * Audio stored event from whatsapp-service.
 */
export interface AudioStoredEvent {
  type: 'whatsapp.audio.stored';
  userId: string;
  messageId: string;
  mediaId: string;
  gcsPath: string;
  mimeType: string;
  timestamp: string;
}

/**
 * Handler for audio stored events.
 */
export type AudioStoredHandler = (event: AudioStoredEvent) => Promise<void>;

/**
 * Pub/Sub pull subscriber for audio stored events.
 */
export class AudioStoredSubscriber {
  private readonly pubsub: PubSub;
  private readonly subscriptionName: string;
  private readonly projectId: string;
  private handler: AudioStoredHandler | null = null;
  private isRunning = false;

  constructor(projectId: string, subscriptionName: string) {
    this.pubsub = new PubSub({ projectId });
    this.projectId = projectId;
    this.subscriptionName = subscriptionName;
  }

  /**
   * Set the handler for audio stored events.
   */
  setHandler(handler: AudioStoredHandler): void {
    this.handler = handler;
  }

  /**
   * Start listening for messages.
   */
  start(): void {
    if (this.isRunning) return;
    if (this.handler === null) {
      throw new Error('Handler must be set before starting subscriber');
    }

    this.isRunning = true;
    const subscription = this.pubsub.subscription(this.subscriptionName);

    logger.info(
      {
        projectId: this.projectId,
        subscriptionName: this.subscriptionName,
      },
      'Starting Pub/Sub subscription for audio stored events'
    );

    subscription.on('message', (message: Message) => {
      logger.info(
        {
          messageId: message.id,
          publishTime: message.publishTime.toISOString(),
          dataLength: message.data.length,
        },
        'Received Pub/Sub message'
      );
      void this.handleMessage(message);
    });

    subscription.on('error', (error: Error) => {
      logger.error(
        {
          subscriptionName: this.subscriptionName,
          error: error.message,
          stack: error.stack,
        },
        'Pub/Sub subscription error'
      );
    });

    logger.info(
      { subscriptionName: this.subscriptionName },
      'Pub/Sub subscription started successfully'
    );
  }

  /**
   * Stop listening for messages.
   */
  stop(): void {
    this.isRunning = false;
    logger.info({ subscriptionName: this.subscriptionName }, 'Stopping Pub/Sub subscription');
  }

  /**
   * Handle an incoming message.
   */
  private async handleMessage(message: Message): Promise<void> {
    if (this.handler === null) {
      logger.warn({ messageId: message.id }, 'No handler set, nacking message');
      message.nack();
      return;
    }

    try {
      const rawData = message.data.toString();
      const data = JSON.parse(rawData) as unknown;

      logger.info(
        {
          messageId: message.id,
          messageBody: data,
          action: 'process_audio_stored_event',
        },
        'Processing Pub/Sub message'
      );

      // Validate event structure
      if (
        typeof data !== 'object' ||
        data === null ||
        !('type' in data) ||
        data.type !== 'whatsapp.audio.stored'
      ) {
        logger.warn(
          {
            messageId: message.id,
            messageBody: data,
            expectedType: 'whatsapp.audio.stored',
          },
          'Unexpected event type, acknowledging to prevent redelivery'
        );
        message.ack();
        return;
      }

      await this.handler(data as AudioStoredEvent);

      logger.info({ messageId: message.id }, 'Message processed successfully, acknowledging');
      message.ack();
    } catch (error) {
      logger.error(
        {
          messageId: message.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Failed to process message, nacking for retry'
      );
      message.nack();
    }
  }
}
