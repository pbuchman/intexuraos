/**
 * Transcription Worker.
 * Listens to transcription completed events and updates messages with transcription.
 */
import { PubSub, type Message } from '@google-cloud/pubsub';
import type {
  WhatsAppMessageRepository,
  TranscriptionCompletedEvent,
  WhatsAppMessageSender,
} from '../domain/inbox/index.js';

/**
 * Logger interface for worker.
 */
interface WorkerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Transcription completed event worker.
 * Subscribes to srt.transcription.completed events and updates messages.
 */
export class TranscriptionWorker {
  private readonly pubsub: PubSub;
  private readonly subscriptionName: string;
  private readonly messageRepository: WhatsAppMessageRepository;
  private readonly messageSender: WhatsAppMessageSender;
  private readonly logger: WorkerLogger;
  private isRunning = false;

  constructor(
    projectId: string,
    subscriptionName: string,
    messageRepository: WhatsAppMessageRepository,
    messageSender: WhatsAppMessageSender,
    logger: WorkerLogger
  ) {
    this.pubsub = new PubSub({ projectId });
    this.subscriptionName = subscriptionName;
    this.messageRepository = messageRepository;
    this.messageSender = messageSender;
    this.logger = logger;
  }

  /**
   * Start listening for messages.
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    const subscription = this.pubsub.subscription(this.subscriptionName);

    subscription.on('message', (message: Message) => {
      void this.handleMessage(message);
    });

    subscription.on('error', (error: Error) => {
      this.logger.error('Subscription error', { error: error.message });
    });

    this.logger.info('Transcription worker started', {
      subscription: this.subscriptionName,
    });
  }

  /**
   * Stop listening for messages.
   */
  stop(): void {
    this.isRunning = false;
    this.logger.info('Transcription worker stopped');
  }

  /**
   * Handle an incoming message.
   */
  private async handleMessage(message: Message): Promise<void> {
    try {
      const data = JSON.parse(message.data.toString()) as unknown;

      // Validate event structure
      if (
        typeof data !== 'object' ||
        data === null ||
        !('type' in data) ||
        data.type !== 'srt.transcription.completed'
      ) {
        // Unexpected event type, acknowledge to prevent redelivery
        this.logger.error('Unexpected event type', { type: (data as { type?: unknown }).type });
        message.ack();
        return;
      }

      const event = data as TranscriptionCompletedEvent;

      this.logger.info('Processing transcription completed event', {
        messageId: event.messageId,
        jobId: event.jobId,
        status: event.status,
      });

      // Get the message by ID
      const messageResult = await this.messageRepository.findById(event.userId, event.messageId);

      if (!messageResult.ok) {
        this.logger.error('Failed to find message', {
          messageId: event.messageId,
          error: messageResult.error.message,
        });
        // Nack to retry
        message.nack();
        return;
      }

      if (messageResult.value === null) {
        // Message not found (might have been deleted), ack and skip
        this.logger.info('Message not found, skipping', { messageId: event.messageId });
        message.ack();
        return;
      }

      const originalMessage = messageResult.value;

      // Update message with transcription
      const transcriptionUpdate: {
        transcriptionJobId: string;
        transcriptionStatus: 'pending' | 'processing' | 'completed' | 'failed';
        transcription?: string;
      } = {
        transcriptionJobId: event.jobId,
        transcriptionStatus: event.status,
      };

      if (event.transcript !== undefined) {
        transcriptionUpdate.transcription = event.transcript;
      }

      const updateResult = await this.messageRepository.updateTranscription(
        event.userId,
        event.messageId,
        transcriptionUpdate
      );

      if (!updateResult.ok) {
        this.logger.error('Failed to update message transcription', {
          messageId: event.messageId,
          error: updateResult.error.message,
        });
        // Nack to retry
        message.nack();
        return;
      }

      this.logger.info('Message transcription updated', {
        messageId: event.messageId,
        status: event.status,
        hasTranscript: event.transcript !== undefined,
      });

      // Send reply with transcription if successful
      if (event.status === 'completed' && event.transcript !== undefined) {
        const replyText = `📝 Transcription:\n\n${event.transcript}`;

        const sendResult = await this.messageSender.sendTextMessage(
          originalMessage.fromNumber,
          replyText
        );

        if (sendResult.ok) {
          this.logger.info('Transcription reply sent', {
            messageId: event.messageId,
            toNumber: originalMessage.fromNumber,
          });
        } else {
          // Log but don't fail - the transcription was saved
          this.logger.error('Failed to send transcription reply', {
            messageId: event.messageId,
            error: sendResult.error.message,
          });
        }
      }

      message.ack();
    } catch (error) {
      this.logger.error('Error processing message', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      message.nack();
    }
  }
}
