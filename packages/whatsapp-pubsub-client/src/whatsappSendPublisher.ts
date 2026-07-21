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
    idempotencyKey?: string;
  }): Promise<Result<void, PublishError>>;
}

export interface WhatsAppSendPublisherWithReceipt extends WhatsAppSendPublisher {
  publishSendMessageWithReceipt(
    params: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0]
  ): Promise<Result<string, PublishError>>;
}

/**
 * WhatsApp send message publisher using BasePubSubPublisher.
 */
class WhatsAppSendPublisherImpl
  extends BasePubSubPublisher
  implements WhatsAppSendPublisherWithReceipt
{
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
    const built = buildSendMessageEvent(params);
    if (!built.ok) return built;
    const { event, correlationId, userId } = built.value;

    return await this.publishToTopic(
      this.topicName,
      event,
      { correlationId, userId },
      'WhatsApp send message'
    );
  }

  async publishSendMessageWithReceipt(
    params: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0]
  ): Promise<Result<string, PublishError>> {
    const built = buildSendMessageEvent(params);
    if (!built.ok) return built;
    const { event, correlationId, userId } = built.value;
    return await this.publishToTopicWithSafeReceipt(
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
): WhatsAppSendPublisherWithReceipt {
  return new WhatsAppSendPublisherImpl(config);
}

function buildSendMessageEvent(
  params: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0]
): Result<
  Readonly<{ event: SendMessageEvent; correlationId: string; userId: string }>,
  PublishError
> {
  const userId = params.userId.trim();
  if (userId === '')
    return err({
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp send message userId is required',
    });
  const correlationId = params.correlationId ?? crypto.randomUUID();
  const event: SendMessageEvent = {
    type: 'whatsapp.message.send',
    userId,
    message: params.message,
    correlationId,
    timestamp: new Date().toISOString(),
    ...(params.replyToMessageId === undefined ? {} : { replyToMessageId: params.replyToMessageId }),
    ...(params.buttons === undefined ? {} : { buttons: params.buttons }),
    ...(params.ctaUrl === undefined ? {} : { ctaUrl: params.ctaUrl }),
    ...(params.important === undefined ? {} : { important: params.important }),
    ...(params.idempotencyKey === undefined ? {} : { idempotencyKey: params.idempotencyKey }),
  };
  return { ok: true, value: { event, correlationId, userId } };
}
