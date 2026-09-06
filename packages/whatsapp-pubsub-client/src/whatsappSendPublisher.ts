/**
 * WhatsApp Send Message Publisher.
 * Publishes SendMessageEvent to Pub/Sub for whatsapp-service to process.
 */
import { err, type Result } from '@intexuraos/common-core';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type {
  SendMessageEvent,
  WhatsAppInteractiveButton,
  WhatsAppMessageDigestDeliveryAuthorization,
  WhatsAppMessageDigestPresentation,
  WhatsAppSendPublisherConfig,
} from './types.js';
import {
  MESSAGE_DIGEST_EVENT_MESSAGE,
  MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS,
  MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS,
} from './types.js';

const MESSAGE_DIGEST_RUN_URL_SUFFIX_PATTERN =
  /^#\/whatsapp\/message-digests\/md_[A-Za-z0-9_-]{3,120}\/history\/mdr_[A-Za-z0-9_-]{3,160}$/u;

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
    presentation?: WhatsAppMessageDigestPresentation;
    deliveryAuthorization?: WhatsAppMessageDigestDeliveryAuthorization;
    retainMessageText?: boolean;
    important?: boolean;
    correlationId?: string;
    idempotencyKey?: string;
    timestamp?: string;
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
    presentation?: WhatsAppMessageDigestPresentation;
    deliveryAuthorization?: WhatsAppMessageDigestDeliveryAuthorization;
    retainMessageText?: boolean;
    important?: boolean;
    correlationId?: string;
    idempotencyKey?: string;
    timestamp?: string;
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

export function buildSendMessageEvent(
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
  if (!isValidMessageDigestPresentation(params)) {
    return err({
      code: 'PUBLISH_FAILED',
      message: 'WhatsApp send message presentation is invalid',
    });
  }
  const correlationId = params.correlationId ?? crypto.randomUUID();
  const event: SendMessageEvent = {
    type: 'whatsapp.message.send',
    userId,
    message: params.message,
    correlationId,
    timestamp: params.timestamp ?? new Date().toISOString(),
    ...(params.replyToMessageId === undefined ? {} : { replyToMessageId: params.replyToMessageId }),
    ...(params.buttons === undefined ? {} : { buttons: params.buttons }),
    ...(params.ctaUrl === undefined ? {} : { ctaUrl: params.ctaUrl }),
    ...(params.presentation === undefined ? {} : { presentation: params.presentation }),
    ...(params.deliveryAuthorization === undefined
      ? {}
      : { deliveryAuthorization: params.deliveryAuthorization }),
    ...(params.retainMessageText === undefined
      ? {}
      : { retainMessageText: params.retainMessageText }),
    ...(params.important === undefined ? {} : { important: params.important }),
    ...(params.idempotencyKey === undefined ? {} : { idempotencyKey: params.idempotencyKey }),
  };
  return { ok: true, value: { event, correlationId, userId } };
}

function isValidMessageDigestPresentation(
  params: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0]
): boolean {
  const presentation = params.presentation as unknown;
  const deliveryAuthorization = params.deliveryAuthorization as unknown;
  if (presentation === undefined) return deliveryAuthorization === undefined;
  if (
    presentation === null ||
    typeof presentation !== 'object' ||
    Array.isArray(presentation) ||
    params.message !== MESSAGE_DIGEST_EVENT_MESSAGE ||
    params.retainMessageText !== false ||
    params.important !== true ||
    typeof params.idempotencyKey !== 'string' ||
    params.idempotencyKey.trim() === '' ||
    params.replyToMessageId !== undefined ||
    params.buttons !== undefined ||
    params.ctaUrl !== undefined ||
    deliveryAuthorization === null ||
    typeof deliveryAuthorization !== 'object' ||
    Array.isArray(deliveryAuthorization)
  ) {
    return false;
  }
  const record = presentation as Record<string, unknown>;
  const authorization = deliveryAuthorization as Record<string, unknown>;
  if (
    !isValidMessageDigestPresentationBody(record) ||
    typeof record['runUrlSuffix'] !== 'string' ||
    !MESSAGE_DIGEST_RUN_URL_SUFFIX_PATTERN.test(record['runUrlSuffix']) ||
    Object.keys(authorization).length !== 3 ||
    authorization['kind'] !== 'message_digest_delivery_v1' ||
    typeof authorization['definitionId'] !== 'string' ||
    !/^md_[A-Za-z0-9_-]{3,120}$/u.test(authorization['definitionId']) ||
    typeof authorization['runId'] !== 'string' ||
    !/^mdr_[A-Za-z0-9_-]{3,160}$/u.test(authorization['runId']) ||
    record['runUrlSuffix'] !==
      `#/whatsapp/message-digests/${authorization['definitionId']}/history/${authorization['runId']}` ||
    params.idempotencyKey !== `message-digest:${authorization['runId']}`
  ) {
    return false;
  }
  return true;
}

function isValidMessageDigestPresentationBody(record: Record<string, unknown>): boolean {
  if (record['kind'] === 'message_digest_v1') {
    return (
      Object.keys(record).length === 4 &&
      isBoundedPlainText(record['digestName'], MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS) &&
      isBoundedPlainText(record['digestExcerpt'], MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS)
    );
  }
  return (
    record['kind'] === 'message_digest_v2' &&
    Object.keys(record).length === 6 &&
    isBoundedPlainText(record['digestName'], MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS) &&
    isBoundedPlainText(
      record['windowLabel'],
      MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS
    ) &&
    isBoundedPlainText(record['headline'], MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS) &&
    isBoundedMultilineText(record['digestBody'], MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS)
  );
}

function isBoundedPlainText(value: unknown, maxCodePoints: number): value is string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    Array.from(value).length > maxCodePoints
  ) {
    return false;
  }
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return (
      codePoint === 10 ||
      codePoint === 13 ||
      (codePoint >= 0 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

function isBoundedMultilineText(value: unknown, maxCodePoints: number): value is string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    Array.from(value).length > maxCodePoints
  ) {
    return false;
  }
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return (
      codePoint === 13 ||
      (codePoint >= 0 && codePoint <= 9) ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}
