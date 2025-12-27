/**
 * Adapter for WhatsApp Cloud API port.
 * Wraps existing whatsappClient functions as a port implementation.
 */
import { ok, err, type Result } from '@intexuraos/common';
import type {
  WhatsAppCloudApiPort,
  MediaUrlInfo,
  SendMessageResult,
  InboxError,
} from '../../domain/inbox/index.js';
import {
  getMediaUrl as getMediaUrlFn,
  downloadMedia as downloadMediaFn,
  sendWhatsAppMessage,
} from '../../whatsappClient.js';

/**
 * WhatsApp Cloud API adapter implementation.
 */
export class WhatsAppCloudApiAdapter implements WhatsAppCloudApiPort {
  constructor(private readonly accessToken: string) {}

  async getMediaUrl(mediaId: string): Promise<Result<MediaUrlInfo, InboxError>> {
    const result = await getMediaUrlFn(mediaId, this.accessToken);

    if (!result.success || result.data === undefined) {
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error ?? 'Failed to get media URL',
      });
    }

    return ok({
      url: result.data.url,
      mimeType: result.data.mime_type,
      sha256: result.data.sha256,
      fileSize: result.data.file_size,
    });
  }

  async downloadMedia(url: string): Promise<Result<Buffer, InboxError>> {
    const result = await downloadMediaFn(url, this.accessToken);

    if (!result.success || result.buffer === undefined) {
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error ?? 'Failed to download media',
      });
    }

    return ok(result.buffer);
  }

  async sendMessage(
    phoneNumberId: string,
    recipientPhone: string,
    message: string,
    replyToMessageId?: string
  ): Promise<Result<SendMessageResult, InboxError>> {
    const result = await sendWhatsAppMessage(
      phoneNumberId,
      recipientPhone,
      message,
      this.accessToken,
      replyToMessageId
    );

    if (!result.success || result.messageId === undefined) {
      return err({
        code: 'INTERNAL_ERROR',
        message: result.error ?? 'Failed to send message',
      });
    }

    return ok({ messageId: result.messageId });
  }
}
