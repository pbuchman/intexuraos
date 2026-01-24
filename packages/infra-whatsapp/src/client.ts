/**
 * Unified WhatsApp Cloud API client.
 * Provides sendTextMessage, getMediaUrl, and downloadMedia operations.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  MediaUrlInfo,
  SendMessageParams,
  SendMessageResult,
  WhatsAppConfig,
  WhatsAppError,
} from './types.js';

const WHATSAPP_API_VERSION = 'v22.0';
const MEDIA_DOWNLOAD_TIMEOUT_MS = 30000;
const MARK_AS_READ_TIMEOUT_MS = 30000; // Increased to match media download timeout for slow networks

export interface WhatsAppClient {
  sendTextMessage(params: SendMessageParams): Promise<Result<SendMessageResult, WhatsAppError>>;
  getMediaUrl(mediaId: string): Promise<Result<MediaUrlInfo, WhatsAppError>>;
  downloadMedia(url: string): Promise<Result<Buffer, WhatsAppError>>;
  /**
   * Mark a message as read. This displays two blue check marks on the message.
   * @param messageId - The ID of the message to mark as read
   */
  markAsRead(messageId: string): Promise<Result<void, WhatsAppError>>;
  /**
   * Mark a message as read and show typing indicator.
   * Combines mark-as-read with a typing indicator that shows for up to 25 seconds
   * or until a message is sent.
   * @param messageId - The ID of the message to mark as read
   */
  markAsReadWithTyping(messageId: string): Promise<Result<void, WhatsAppError>>;
}

export function createWhatsAppClient(config: WhatsAppConfig): WhatsAppClient {
  return {
    async sendTextMessage(
      params: SendMessageParams
    ): Promise<Result<SendMessageResult, WhatsAppError>> {
      const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${config.phoneNumberId}/messages`;

      const payload: {
        messaging_product: string;
        to: string;
        type: string;
        text: { body: string };
        context?: { message_id: string };
      } = {
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'text',
        text: { body: params.message },
      };

      if (params.replyToMessageId !== undefined) {
        payload.context = { message_id: params.replyToMessageId };
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          return err({
            code: 'API_ERROR',
            message: `WhatsApp API error: ${String(response.status)} - ${errorBody}`,
            statusCode: response.status,
          });
        }

        const data = (await response.json()) as {
          messaging_product: string;
          contacts: { input: string; wa_id: string }[];
          messages: { id: string }[];
        };

        const messageId = data.messages[0]?.id;
        if (messageId === undefined) {
          return err({
            code: 'API_ERROR',
            message: 'No message ID returned from WhatsApp API',
          });
        }

        return ok({ messageId });
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: `Failed to send WhatsApp message: ${getErrorMessage(error)}`,
        });
      }
    },

    async getMediaUrl(mediaId: string): Promise<Result<MediaUrlInfo, WhatsAppError>> {
      const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}`;

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
          },
        });

        if (!response.ok) {
          const errorBody = await response.text();
          return err({
            code: 'API_ERROR',
            message: `WhatsApp API error: ${String(response.status)} - ${errorBody}`,
            statusCode: response.status,
          });
        }

        const data = (await response.json()) as {
          url: string;
          mime_type: string;
          sha256: string;
          file_size: number;
        };

        return ok({
          url: data.url,
          mimeType: data.mime_type,
          sha256: data.sha256,
          fileSize: data.file_size,
        });
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: `Failed to get media URL: ${getErrorMessage(error)}`,
        });
      }
    },

    async downloadMedia(mediaUrl: string): Promise<Result<Buffer, WhatsAppError>> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, MEDIA_DOWNLOAD_TIMEOUT_MS);

      try {
        const response = await fetch(mediaUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text();
          return err({
            code: 'API_ERROR',
            message: `Media download error: ${String(response.status)} - ${errorBody}`,
            statusCode: response.status,
          });
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        return ok(buffer);
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          return err({
            code: 'TIMEOUT',
            message: `Media download timed out after ${String(MEDIA_DOWNLOAD_TIMEOUT_MS)}ms`,
          });
        }

        return err({
          code: 'NETWORK_ERROR',
          message: `Failed to download media: ${getErrorMessage(error)}`,
        });
      }
    },

    async markAsRead(messageId: string): Promise<Result<void, WhatsAppError>> {
      const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${config.phoneNumberId}/messages`;

      const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, MARK_AS_READ_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text();
          return err({
            code: 'API_ERROR',
            message: `WhatsApp API error: ${String(response.status)} - ${errorBody}`,
            statusCode: response.status,
          });
        }

        return ok(undefined);
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          return err({
            code: 'TIMEOUT',
            message: `Mark as read timed out after ${String(MARK_AS_READ_TIMEOUT_MS)}ms`,
          });
        }

        return err({
          code: 'NETWORK_ERROR',
          message: `Failed to mark message as read: ${getErrorMessage(error)}`,
        });
      }
    },

    async markAsReadWithTyping(messageId: string): Promise<Result<void, WhatsAppError>> {
      const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${config.phoneNumberId}/messages`;

      const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: {
          type: 'text',
        },
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, MARK_AS_READ_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text();
          return err({
            code: 'API_ERROR',
            message: `WhatsApp API error: ${String(response.status)} - ${errorBody}`,
            statusCode: response.status,
          });
        }

        return ok(undefined);
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          return err({
            code: 'TIMEOUT',
            message: `Mark as read with typing timed out after ${String(MARK_AS_READ_TIMEOUT_MS)}ms`,
          });
        }

        return err({
          code: 'NETWORK_ERROR',
          message: `Failed to mark message as read with typing: ${getErrorMessage(error)}`,
        });
      }
    },
  };
}
