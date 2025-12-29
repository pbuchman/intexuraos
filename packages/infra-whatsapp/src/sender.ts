import { ok, err, type Result } from '@intexuraos/common-core';
import type { WhatsAppConfig, SendMessageParams, WhatsAppError } from './types.js';

export interface WhatsAppSender {
  sendTextMessage(params: SendMessageParams): Promise<Result<void, WhatsAppError>>;
}

export function createWhatsAppSender(config: WhatsAppConfig): WhatsAppSender {
  return {
    async sendTextMessage(params: SendMessageParams): Promise<Result<void, WhatsAppError>> {
      const url = `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: params.to,
            type: 'text',
            text: { body: params.message },
          }),
        });

        if (!response.ok) {
          return err({
            code: 'API_ERROR',
            message: `WhatsApp API error: ${String(response.status)}`,
            statusCode: response.status,
          });
        }

        return ok(undefined);
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        });
      }
    },
  };
}
