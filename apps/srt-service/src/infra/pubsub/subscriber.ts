/**
 * Pub/Sub Subscriber for Audio Stored Events.
 */
import { PubSub, type Message } from '@google-cloud/pubsub';

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
  private handler: AudioStoredHandler | null = null;
  private isRunning = false;

  constructor(projectId: string, subscriptionName: string) {
    this.pubsub = new PubSub({ projectId });
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

    subscription.on('message', (message: Message) => {
      void this.handleMessage(message);
    });

    subscription.on('error', (error: Error) => {
      // Error handler for subscription errors
      void error; // Log handled by Pub/Sub library
    });
  }

  /**
   * Stop listening for messages.
   */
  stop(): void {
    this.isRunning = false;
    // Note: Subscription cleanup handled by GC
  }

  /**
   * Handle an incoming message.
   */
  private async handleMessage(message: Message): Promise<void> {
    if (this.handler === null) {
      message.nack();
      return;
    }

    try {
      const data = JSON.parse(message.data.toString()) as unknown;

      // Validate event structure
      if (
        typeof data !== 'object' ||
        data === null ||
        !('type' in data) ||
        data.type !== 'whatsapp.audio.stored'
      ) {
        // Unexpected event type, acknowledge to prevent redelivery
        message.ack();
        return;
      }

      await this.handler(data as AudioStoredEvent);
      message.ack();
    } catch {
      // Failed to process message, nack for retry
      message.nack();
    }
  }
}
