import type { WhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
import type { WhatsAppReplyPublisher } from '../../domain/messages/handleIncomingMessage.js';

export interface WhatsAppReplyPublisherDeps {
  sendPublisher: WhatsAppSendPublisher;
}

export function createWhatsAppReplyPublisher(
  deps: WhatsAppReplyPublisherDeps
): WhatsAppReplyPublisher {
  return {
    async publishReply(input): Promise<void> {
      const result = await deps.sendPublisher.publishSendMessage({
        userId: input.userId,
        message: input.message,
        replyToMessageId: input.replyToMessageId,
        correlationId: input.correlationId,
      });

      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
  };
}
