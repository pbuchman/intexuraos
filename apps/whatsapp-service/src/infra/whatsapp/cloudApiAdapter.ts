/**
 * Adapter for WhatsApp Cloud API port.
 * Uses @intexuraos/infra-whatsapp for WhatsApp Graph API operations.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import { createWhatsAppClient, type WhatsAppClient } from '@intexuraos/infra-whatsapp';
import type {
  InboxError,
  MediaUrlInfo,
  SendMessageResult,
  WhatsAppCloudApiPort,
} from '../../domain/inbox/index.js';

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

  async getMediaUrl(mediaId: string): Promise<Result<MediaUrlInfo, InboxError>> {
    const result = await this.mediaClient.getMediaUrl(mediaId);

    if (!result.ok) {
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error.message,
      });
    }

    return ok(result.value);
  }

  async downloadMedia(url: string): Promise<Result<Buffer, InboxError>> {
    const result = await this.mediaClient.downloadMedia(url);

    if (!result.ok) {
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error.message,
      });
    }

    return ok(result.value);
  }

  async sendMessage(
    phoneNumberId: string,
    recipientPhone: string,
    message: string,
    replyToMessageId?: string
  ): Promise<Result<SendMessageResult, InboxError>> {
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
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error.message,
      });
    }

    return ok({ messageId: result.value.messageId });
  }
}
