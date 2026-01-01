/**
 * WhatsApp Send Message Publisher.
 * Publishes SendMessageEvent to Pub/Sub for whatsapp-service to process.
 */
import { PubSub } from '@google-cloud/pubsub';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { PublishError, SendMessageEvent, WhatsAppSendPublisherConfig } from './types.js';

/**
 * Interface for publishing WhatsApp send message events.
 */
export interface WhatsAppSendPublisher {
  /**
   * Publish a send message event to Pub/Sub.
   * The event will be processed by whatsapp-service's SendMessageWorker.
   */
  publishSendMessage(params: {
    userId: string;
    phoneNumber: string;
    message: string;
    replyToMessageId?: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>>;
}

/**
 * Create a WhatsApp send message publisher.
 */
export function createWhatsAppSendPublisher(
  config: WhatsAppSendPublisherConfig
): WhatsAppSendPublisher {
  const pubsub = new PubSub({ projectId: config.projectId });
  const topic = pubsub.topic(config.topicName);

  return {
    async publishSendMessage(params): Promise<Result<void, PublishError>> {
      const event: SendMessageEvent = {
        type: 'whatsapp.message.send',
        userId: params.userId,
        phoneNumber: params.phoneNumber,
        message: params.message,
        correlationId: params.correlationId ?? crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };

      if (params.replyToMessageId !== undefined) {
        event.replyToMessageId = params.replyToMessageId;
      }

      try {
        const messageBuffer = Buffer.from(JSON.stringify(event));
        await topic.publishMessage({ data: messageBuffer });
        return ok(undefined);
      } catch (error) {
        const errorMessage = getErrorMessage(error);

        if (errorMessage.includes('NOT_FOUND')) {
          return err({
            code: 'TOPIC_NOT_FOUND',
            message: `Topic ${config.topicName} not found: ${errorMessage}`,
          });
        }

        if (errorMessage.includes('PERMISSION_DENIED')) {
          return err({
            code: 'PERMISSION_DENIED',
            message: `Permission denied for topic ${config.topicName}: ${errorMessage}`,
          });
        }

        return err({
          code: 'PUBLISH_FAILED',
          message: `Failed to publish message: ${errorMessage}`,
        });
      }
    },
  };
}
