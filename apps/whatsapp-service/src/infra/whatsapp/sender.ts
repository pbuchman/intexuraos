/**
 * WhatsApp Cloud API Message Sender.
 * Sends messages using the WhatsApp Business Cloud API.
 */
import { err, getErrorMessage, getLogLevel, ok, type Result } from '@intexuraos/common-core';
import pino from 'pino';
import type { WhatsAppMessageSender, WhatsAppInteractiveButton } from '../../domain/whatsapp/index.js';
import type { WhatsAppError } from '../../domain/whatsapp/models/error.js';

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v22.0';
const REQUEST_TIMEOUT_MS = 30000;

const logger = pino({ name: 'whatsapp-sender', level: getLogLevel() });

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

  async sendTextMessage(
    phoneNumber: string,
    message: string
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    logger.info({ phoneNumber, messageLength: message.length }, 'Sending WhatsApp text message');
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
        logger.error(
          { phoneNumber, status: response.status, errorBody },
          'WhatsApp API returned error'
        );
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `WhatsApp API error: ${String(response.status)} - ${errorBody}`,
        });
      }

      // Parse response to get wamid
      const responseBody = (await response.json()) as {
        messages?: { id?: string }[];
      };
      const wamid = responseBody.messages?.[0]?.id ?? `unknown-${String(Date.now())}`;

      logger.info({ phoneNumber, normalizedPhone, wamid }, 'Message sent successfully');
      return ok({ wamid });
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.error({ phoneNumber, timeoutMs: REQUEST_TIMEOUT_MS }, 'WhatsApp request timed out');
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `WhatsApp request timed out after ${String(REQUEST_TIMEOUT_MS)}ms`,
        });
      }

      logger.error({ phoneNumber, error: getErrorMessage(error) }, 'Failed to send WhatsApp message');
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to send WhatsApp message: ${getErrorMessage(error)}`,
      });
    }
  }

  async sendInteractiveMessage(
    phoneNumber: string,
    message: string,
    buttons: WhatsAppInteractiveButton[]
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    logger.info({ phoneNumber, messageLength: message.length, buttonCount: buttons.length }, 'Sending WhatsApp interactive message');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      // Remove + prefix if present for WhatsApp API
      const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber;

      // WhatsApp limits button titles to 20 characters
      const truncatedButtons = buttons.map((btn) => ({
        type: btn.type,
        reply: {
          id: btn.reply.id,
          title: btn.reply.title.length > 20 ? btn.reply.title.substring(0, 20) : btn.reply.title,
        },
      }));

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
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              text: message,
            },
            action: {
              buttons: truncatedButtons,
            },
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(
          { phoneNumber, status: response.status, errorBody },
          'WhatsApp API returned error for interactive message'
        );
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `WhatsApp API error: ${String(response.status)} - ${errorBody}`,
        });
      }

      // Parse response to get wamid
      const responseBody = (await response.json()) as {
        messages?: { id?: string }[];
      };
      const wamid = responseBody.messages?.[0]?.id ?? `unknown-${String(Date.now())}`;

      logger.info({ phoneNumber, normalizedPhone, wamid }, 'Interactive message sent successfully');
      return ok({ wamid });
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.error({ phoneNumber, timeoutMs: REQUEST_TIMEOUT_MS }, 'WhatsApp request timed out');
        return err({
          code: 'PERSISTENCE_ERROR',
          message: `WhatsApp request timed out after ${String(REQUEST_TIMEOUT_MS)}ms`,
        });
      }

      logger.error({ phoneNumber, error: getErrorMessage(error) }, 'Failed to send WhatsApp interactive message');
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to send WhatsApp interactive message: ${getErrorMessage(error)}`,
      });
    }
  }
}
