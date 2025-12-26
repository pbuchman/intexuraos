/**
 * WhatsApp Message Sender Port.
 * Defines the interface for sending WhatsApp messages.
 */
import type { Result } from '@intexuraos/common';
import type { InboxError } from './repositories.js';

/**
 * Port for sending WhatsApp messages.
 */
export interface WhatsAppMessageSender {
  /**
   * Send a text message reply to a user.
   * @param phoneNumber - User's phone number in E.164 format (e.g., +48123456789)
   * @param message - Text message to send
   */
  sendTextMessage(phoneNumber: string, message: string): Promise<Result<void, InboxError>>;
}
