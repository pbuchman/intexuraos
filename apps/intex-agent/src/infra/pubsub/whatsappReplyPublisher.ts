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
      const limit = input.ctaUrl !== undefined || input.buttons !== undefined ? 1024 : 4096;
      const parts =
        input.notificationContext?.phase === 'final'
          ? splitReply(input.message, limit)
          : [input.message];
      for (const [partIndex, message] of parts.entries()) {
        const notificationContext =
          input.notificationContext === undefined
            ? undefined
            : input.notificationContext.phase === 'final'
              ? { ...input.notificationContext, partIndex, partCount: parts.length }
              : input.notificationContext;
        const result = await deps.sendPublisher.publishSendMessage({
          userId: input.userId,
          message,
          replyToMessageId: input.replyToMessageId,
          correlationId: input.correlationId,
          ...(notificationContext === undefined ? {} : { notificationContext }),
          ...(input.idempotencyKey === undefined
            ? {}
            : {
                idempotencyKey:
                  notificationContext === undefined
                    ? input.idempotencyKey
                    : `notification:${createHash('sha256')
                        .update(
                          JSON.stringify([notificationContext.source, notificationContext.runId])
                        )
                        .digest(
                          'hex'
                        )}:${notificationContext.phase}${notificationContext.phase === 'final' ? `:${String(partIndex)}` : ''}`,
              }),
          ...(partIndex === parts.length - 1 && input.ctaUrl !== undefined
            ? { ctaUrl: input.ctaUrl }
            : {}),
          ...(partIndex === parts.length - 1 && input.buttons !== undefined
            ? { buttons: input.buttons }
            : {}),
          important: true,
        });
        if (!result.ok) throw new Error(result.error.message);
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

function splitReply(message: string, limit: number): string[] {
  const parts: string[] = [];
  let offset = 0;
  while (offset < message.length) {
    let end = Math.min(offset + limit, message.length);
    const last = message.charCodeAt(end - 1);
    if (end < message.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(message.slice(offset, end));
    offset = end;
  }
  return parts.length === 0 ? [''] : parts;
}
