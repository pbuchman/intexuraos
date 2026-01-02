/**
 * WhatsApp Send Message Publisher.
 * Publishes SendMessageEvent to Pub/Sub for whatsapp-service to process.
 */
import { type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher } from './basePublisher.js';
import type { PublishError, SendMessageEvent, WhatsAppSendPublisherConfig } from './types.js';

/**
 * Interface for publishing WhatsApp send message events.
 */
export interface WhatsAppSendPublisher {
  /**
   * Publish a send message event to Pub/Sub.
   * The event will be processed by whatsapp-service's SendMessageWorker.
   * whatsapp-service looks up the phone number internally using userId.
   */
  publishSendMessage(params: {
    userId: string;
    message: string;
    replyToMessageId?: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>>;
}

/**
 * WhatsApp send message publisher using BasePubSubPublisher.
 */
class WhatsAppSendPublisherImpl extends BasePubSubPublisher implements WhatsAppSendPublisher {
  private readonly topicName: string;

  constructor(config: WhatsAppSendPublisherConfig) {
    super({ projectId: config.projectId, loggerName: 'whatsapp-send-publisher' });
    this.topicName = config.topicName;
  }

  async publishSendMessage(params: {
    userId: string;
    message: string;
    replyToMessageId?: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>> {
    const correlationId = params.correlationId ?? crypto.randomUUID();

    const event: SendMessageEvent = {
      type: 'whatsapp.message.send',
      userId: params.userId,
      message: params.message,
      correlationId,
      timestamp: new Date().toISOString(),
    };

    if (params.replyToMessageId !== undefined) {
      event.replyToMessageId = params.replyToMessageId;
    }

    return await this.publishToTopic(
      this.topicName,
      event,
      { correlationId, userId: params.userId },
      'WhatsApp send message'
    );
  }
}

/**
 * Create a WhatsApp send message publisher.
 */
export function createWhatsAppSendPublisher(
  config: WhatsAppSendPublisherConfig
): WhatsAppSendPublisher {
  return new WhatsAppSendPublisherImpl(config);
}
