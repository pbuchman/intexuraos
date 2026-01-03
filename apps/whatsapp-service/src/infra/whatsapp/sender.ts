/**
 * WhatsApp Cloud API Message Sender.
 * Sends messages using the WhatsApp Business Cloud API.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppMessageSender } from '../../domain/inbox/index.js';
import type { InboxError } from '../../domain/inbox/models/error.js';

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v22.0';
const REQUEST_TIMEOUT_MS = 30000;

/**
 * WhatsApp Cloud API implementation of message sender.
 */
export class WhatsAppCloudApiSender implements WhatsAppMessageSender {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;

  constructor(accessToken: string, phoneNumberId: string) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
  }

  async sendTextMessage(phoneNumber: string, message: string): Promise<Result<void, InboxError>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      // Remove + prefix if present for WhatsApp API
      const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber;

      const response = await fetch(`${WHATSAPP_API_BASE}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedPhone,
          type: 'text',
          text: {
            preview_url: false,
            body: message,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `WhatsApp API error: ${String(response.status)} - ${errorBody}`,
        });
      }

      return ok(undefined);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `WhatsApp request timed out after ${String(REQUEST_TIMEOUT_MS)}ms`,
        });
      }

      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to send WhatsApp message: ${getErrorMessage(error)}`,
      });
    }
  }
}
