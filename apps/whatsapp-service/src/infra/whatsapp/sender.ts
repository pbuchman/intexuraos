/**
 * WhatsApp Cloud API Message Sender.
 * Sends messages using the WhatsApp Business Cloud API.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { createAppLogger } from '@intexuraos/infra-sentry';
import type { WhatsAppMessageSender, WhatsAppInteractiveButton } from '../../domain/whatsapp/index.js';
import type { WhatsAppError } from '../../domain/whatsapp/models/error.js';

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v22.0';
const REQUEST_TIMEOUT_MS = 30000;

const logger = createAppLogger({ name: 'whatsapp-sender' });

type WhatsAppMessageBody =
  | { type: 'text'; text: { preview_url: boolean; body: string } }
  | {
      type: 'interactive';
      interactive:
        | { type: 'button'; body: { text: string }; action: { buttons: { type: string; reply: { id: string; title: string } }[] } }
        | { type: 'cta_url'; body: { text: string }; action: { name: 'cta_url'; parameters: { display_text: string; url: string } } };
    };

type MessageTypeLabel = 'text' | 'interactive' | 'CTA URL';

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
    return await this.sendRequest(phoneNumber, {
      type: 'text',
      text: { preview_url: false, body: message },
    }, 'text');
  }

  async sendInteractiveMessage(
    phoneNumber: string,
    message: string,
    buttons: WhatsAppInteractiveButton[]
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    // WhatsApp limits button titles to 20 characters
    const truncatedButtons = buttons.map((btn) => ({
      type: btn.type,
      reply: {
        id: btn.reply.id,
        title: btn.reply.title.length > 20 ? btn.reply.title.substring(0, 20) : btn.reply.title,
      },
    }));

    const interactiveBody = {
      type: 'interactive' as const,
      interactive: {
        type: 'button' as const,
        body: { text: message },
        action: { buttons: truncatedButtons },
      },
    };

    return await this.sendRequest(phoneNumber, interactiveBody, 'interactive');
  }

  async sendCtaUrlMessage(
    phoneNumber: string,
    message: string,
    ctaUrl: { displayText: string; url: string }
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    const ctaUrlBody = {
      type: 'interactive' as const,
      interactive: {
        type: 'cta_url' as const,
        body: { text: message },
        action: { name: 'cta_url' as const, parameters: { display_text: ctaUrl.displayText, url: ctaUrl.url } },
      },
    };

    return await this.sendRequest(phoneNumber, ctaUrlBody, 'CTA URL');
  }

  private async sendRequest(
    phoneNumber: string,
    body: WhatsAppMessageBody,
    messageTypeLabel: MessageTypeLabel
  ): Promise<Result<{ wamid: string }, WhatsAppError>> {
    logger.info({ phoneNumber, messageType: messageTypeLabel }, `Sending WhatsApp ${messageTypeLabel} message`);
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
          ...body,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error({ phoneNumber, status: response.status, errorBody }, `WhatsApp API returned error for ${messageTypeLabel}`);
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

      logger.info({ phoneNumber, normalizedPhone, wamid }, `${messageTypeLabel} message sent successfully`);
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

      logger.error({ phoneNumber, error: getErrorMessage(error) }, `Failed to send WhatsApp ${messageTypeLabel} message`);
      return err({
        code: 'PERSISTENCE_ERROR',
        message: `Failed to send WhatsApp ${messageTypeLabel} message: ${getErrorMessage(error)}`,
      });
    }
  }
}
