/**
 * WhatsApp Send Message Publisher.
 * Publishes SendMessageEvent to Pub/Sub for whatsapp-service to process.
 */
import { err, type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type {
  SendMessageEvent,
  WhatsAppInteractiveButton,
  WhatsAppSendPublisherConfig,
} from './types.js';

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
    buttons?: WhatsAppInteractiveButton[];
    ctaUrl?: { displayText: string; url: string };
    important?: boolean;
    correlationId?: string;
  }): Promise<Result<void, PublishError>>;
}

/**
 * WhatsApp send message publisher using BasePubSubPublisher.
 */
class WhatsAppSendPublisherImpl extends BasePubSubPublisher implements WhatsAppSendPublisher {
  private readonly topicName: string;

  constructor(config: WhatsAppSendPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.topicName = config.topicName;
  }

  async publishSendMessage(params: {
    userId: string;
    message: string;
    replyToMessageId?: string;
    buttons?: WhatsAppInteractiveButton[];
    ctaUrl?: { displayText: string; url: string };
    important?: boolean;
    correlationId?: string;
  }): Promise<Result<void, PublishError>> {
    const userId = params.userId.trim();
    if (userId === '') {
      return err({
        code: 'PUBLISH_FAILED',
        message: 'WhatsApp send message userId is required',
      });
    }

    const correlationId = params.correlationId ?? crypto.randomUUID();

    const event: SendMessageEvent = {
      type: 'whatsapp.message.send',
      userId,
      message: params.message,
      correlationId,
      timestamp: new Date().toISOString(),
    };

    if (params.replyToMessageId !== undefined) {
      event.replyToMessageId = params.replyToMessageId;
    }

    if (params.buttons !== undefined) {
      event.buttons = params.buttons;
    }

    /* v8 ignore start -- upstream: ctaUrl passthrough to Pub/Sub event, tested via consuming services @preserve */
    if (params.ctaUrl !== undefined) {
      event.ctaUrl = params.ctaUrl;
    }
    /* v8 ignore stop @preserve */

    if (params.important !== undefined) {
      event.important = params.important;
    }

    return await this.publishToTopic(
      this.topicName,
      event,
      { correlationId, userId },
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
