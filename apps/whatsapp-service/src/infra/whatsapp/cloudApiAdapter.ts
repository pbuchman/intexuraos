/**
 * Adapter for WhatsApp Cloud API port.
 * Uses @intexuraos/infra-whatsapp for WhatsApp Graph API operations.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { createWhatsAppClient, type WhatsAppClient } from '@intexuraos/infra-whatsapp';
import type {
  WhatsAppError,
  MediaUrlInfo,
  SendMessageResult,
  WhatsAppCloudApiPort,
} from '../../domain/whatsapp/index.js';

const logger = createAppLogger({ name: 'whatsapp-cloud-api' });

/**
 * WhatsApp Cloud API adapter implementation.
 * Creates WhatsApp clients as needed for different operations.
 */
export class WhatsAppCloudApiAdapter implements WhatsAppCloudApiPort {
  private readonly mediaClient: WhatsAppClient;

  constructor(private readonly accessToken: string) {
    this.mediaClient = createWhatsAppClient({
      accessToken,
      phoneNumberId: '', // Not used for media operations
    });
  }

  async getMediaUrl(mediaId: string): Promise<Result<MediaUrlInfo, WhatsAppError>> {
    logger.info({}, 'Fetching media URL from WhatsApp');
    const result = await this.mediaClient.getMediaUrl(mediaId);

    if (!result.ok) {
      logger.error({ code: result.error.code }, 'Failed to fetch media URL');
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error.message,
      });
    }

    return ok(result.value);
  }

  async downloadMedia(url: string): Promise<Result<Buffer, WhatsAppError>> {
    logger.info({}, 'Downloading media from WhatsApp');
    const result = await this.mediaClient.downloadMedia(url);

    if (!result.ok) {
      logger.error({ code: result.error.code }, 'Failed to download media');
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error.message,
      });
    }

    logger.info({ contentLength: result.value.length }, 'Media downloaded successfully');
    return ok(result.value);
  }

  async sendMessage(
    phoneNumberId: string,
    recipientPhone: string,
    message: string,
    replyToMessageId?: string
  ): Promise<Result<SendMessageResult, WhatsAppError>> {
    logger.info(
      { messageLength: message.length, hasReplyToMessageId: replyToMessageId !== undefined },
      'Sending WhatsApp message'
    );
    const client = createWhatsAppClient({
      accessToken: this.accessToken,
      phoneNumberId,
    });

    const params: { to: string; message: string; replyToMessageId?: string } = {
      to: recipientPhone,
      message,
    };
    if (replyToMessageId !== undefined) {
      params.replyToMessageId = replyToMessageId;
    }
    const result = await client.sendTextMessage(params);

    if (!result.ok) {
      logger.error({ code: result.error.code }, 'Failed to send message');
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error.message,
      });
    }

    logger.info({}, 'Message sent successfully');
    return ok({ messageId: result.value.messageId });
  }

  async markAsRead(phoneNumberId: string, messageId: string): Promise<Result<void, WhatsAppError>> {
    logger.info({}, 'Marking message as read');
    const client = createWhatsAppClient({
      accessToken: this.accessToken,
      phoneNumberId,
    });

    const result = await client.markAsRead(messageId);

    if (!result.ok) {
      logger.error({ code: result.error.code }, 'Failed to mark message as read');
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error.message,
      });
    }

    logger.info({}, 'Message marked as read successfully');
    return ok(undefined);
  }

  async markAsReadWithTyping(
    phoneNumberId: string,
    messageId: string
  ): Promise<Result<void, WhatsAppError>> {
    logger.info({}, 'Marking message as read with typing indicator');
    const client = createWhatsAppClient({
      accessToken: this.accessToken,
      phoneNumberId,
    });

    const result = await client.markAsReadWithTyping(messageId);

    if (!result.ok) {
      logger.error(
        { code: result.error.code },
        'Failed to mark message as read with typing'
      );
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error.message,
      });
    }

    logger.info({}, 'Message marked as read with typing indicator successfully');
    return ok(undefined);
  }
}
