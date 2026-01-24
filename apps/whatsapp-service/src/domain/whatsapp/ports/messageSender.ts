/**
 * WhatsApp Message Sender Port.
 * Defines the interface for sending WhatsApp messages.
 */
import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from './repositories.js';

/**
 * Result of sending a WhatsApp text message.
 */
export interface TextMessageSendResult {
  /** WhatsApp message ID (wamid) assigned by the API */
  wamid: string;
}

/**
 * Port for sending WhatsApp messages.
 */
export interface WhatsAppMessageSender {
  /**
   * Send a text message reply to a user.
   * @param phoneNumber - User's phone number in E.164 format (e.g., +48123456789)
   * @param message - Text message to send
   * @returns The wamid of the sent message
   */
  sendTextMessage(
    phoneNumber: string,
    message: string
  ): Promise<Result<TextMessageSendResult, WhatsAppError>>;
}
