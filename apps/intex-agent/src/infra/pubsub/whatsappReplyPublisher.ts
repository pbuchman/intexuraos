import { createHash } from 'node:crypto';

import type { WhatsAppSendPublisherWithReceipt } from '@intexuraos/whatsapp-pubsub-client';
import type {
  MatrixCorpusWhatsAppReplyPublisher,
  WhatsAppReplyPublisher,
} from '../../domain/messages/handleIncomingMessage.js';

export interface WhatsAppReplyPublisherDeps {
  sendPublisher: WhatsAppSendPublisherWithReceipt;
}

export function createWhatsAppReplyPublisher(
  deps: WhatsAppReplyPublisherDeps
): WhatsAppReplyPublisher & MatrixCorpusWhatsAppReplyPublisher {
  return {
    async publishReply(input): Promise<void> {
      const result = await deps.sendPublisher.publishSendMessage({
        userId: input.userId,
        message: input.message,
        replyToMessageId: input.replyToMessageId,
        correlationId: input.correlationId,
        ...(input.ctaUrl !== undefined ? { ctaUrl: input.ctaUrl } : {}),
        ...(input.buttons !== undefined ? { buttons: input.buttons } : {}),
        important: true,
      });

      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    async publishReplyWithReceipt(input): Promise<Readonly<{ publicationReceiptId: string }>> {
      const result = await deps.sendPublisher.publishSendMessageWithReceipt({
        userId: input.userId,
        message: input.message,
        replyToMessageId: input.replyToMessageId,
        correlationId: matrixReplyCorrelationId(input.idempotencyKey),
        idempotencyKey: input.idempotencyKey,
        ...(input.buttons === undefined ? {} : { buttons: input.buttons }),
        important: true,
      });
      if (!result.ok) throw new Error('WhatsApp reply publication failed');
      return { publicationReceiptId: result.value };
    },
  };
}

function matrixReplyCorrelationId(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 32);
  return `imc_reply_${digest}`;
}
