/**
 * Port for WhatsApp Cloud API client operations.
 * Abstracts media downloading and URL fetching from the domain.
 */
import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from './repositories.js';

/**
 * Media URL information from WhatsApp.
 */
export interface MediaUrlInfo {
  url: string;
  mimeType?: string;
  sha256?: string;
  fileSize?: number;
}

/**
 * Result of sending a WhatsApp message.
 */
export interface SendMessageResult {
  messageId: string;
}

/**
 * Port for WhatsApp Cloud API operations.
 */
export interface WhatsAppCloudApiPort {
  /**
   * Get the URL for a media item.
   * @param mediaId - WhatsApp media ID
   * @returns Media URL information
   */
  getMediaUrl(mediaId: string): Promise<Result<MediaUrlInfo, WhatsAppError>>;

  /**
   * Download media content from a URL.
   * @param url - Media URL from getMediaUrl
   * @returns Media content as Buffer
   */
  downloadMedia(url: string): Promise<Result<Buffer, WhatsAppError>>;

  /**
   * Send a text message via WhatsApp.
   * @param phoneNumberId - Business phone number ID to send from
   * @param recipientPhone - Recipient phone number
   * @param message - Text message content
   * @param replyToMessageId - Optional message ID to quote/reply to
   * @returns Message ID of sent message
   */
  sendMessage(
    phoneNumberId: string,
    recipientPhone: string,
    message: string,
    replyToMessageId?: string
  ): Promise<Result<SendMessageResult, WhatsAppError>>;

  /**
   * Mark a message as read. This displays two blue check marks on the message.
   * @param phoneNumberId - Business phone number ID
   * @param messageId - The ID of the message to mark as read
   */
  markAsRead(phoneNumberId: string, messageId: string): Promise<Result<void, WhatsAppError>>;

  /**
   * Mark a message as read and show typing indicator.
   * Combines mark-as-read with a typing indicator that shows for up to 25 seconds
   * or until a message is sent.
   * @param phoneNumberId - Business phone number ID
   * @param messageId - The ID of the message to mark as read
   */
  markAsReadWithTyping(
    phoneNumberId: string,
    messageId: string
  ): Promise<Result<void, WhatsAppError>>;
}
