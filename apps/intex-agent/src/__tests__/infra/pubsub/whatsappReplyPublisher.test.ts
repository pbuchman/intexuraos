import { err, ok, type Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import type { WhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
import { describe, expect, it } from 'vitest';
import { createWhatsAppReplyPublisher } from '../../../infra/pubsub/whatsappReplyPublisher.js';

describe('createWhatsAppReplyPublisher', () => {
  it('publishes WhatsApp replies through the shared send-message publisher', async () => {
    const sendPublisher = new FakeWhatsAppSendPublisher();
    const publisher = createWhatsAppReplyPublisher({ sendPublisher });
    const ctaUrl = {
      displayText: 'Open Note',
      url: 'https://intexuraos.cloud/#/notes/note-1',
    };

    await publisher.publishReply({
      userId: 'user-1',
      message: 'New session started.',
      replyToMessageId: 'wamid-1',
      correlationId: 'session-1',
      ctaUrl,
    });

    expect(sendPublisher.calls).toEqual([
      {
        userId: 'user-1',
        message: 'New session started.',
        replyToMessageId: 'wamid-1',
        correlationId: 'session-1',
        ctaUrl,
        important: true,
      },
    ]);
  });

  it('throws when the shared send-message publisher fails', async () => {
    const sendPublisher = new FakeWhatsAppSendPublisher();
    sendPublisher.result = err({ code: 'PUBLISH_FAILED', message: 'Pub/Sub unavailable' });
    const publisher = createWhatsAppReplyPublisher({ sendPublisher });

    await expect(
      publisher.publishReply({
        userId: 'user-1',
        message: 'New session started.',
        replyToMessageId: 'wamid-1',
        correlationId: 'session-1',
      })
    ).rejects.toThrow('Pub/Sub unavailable');
  });
});

class FakeWhatsAppSendPublisher implements WhatsAppSendPublisher {
  readonly calls: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0][] = [];
  result: Result<void, PublishError> = ok(undefined);

  publishSendMessage(
    params: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0]
  ): Promise<Result<void, PublishError>> {
    this.calls.push(params);
    return Promise.resolve(this.result);
  }
}
