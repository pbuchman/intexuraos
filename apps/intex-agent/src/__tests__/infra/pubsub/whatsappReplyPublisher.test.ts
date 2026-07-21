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
      displayText: 'Open note',
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

  it('forwards WhatsApp reply buttons through the shared send-message publisher', async () => {
    const sendPublisher = new FakeWhatsAppSendPublisher();
    const publisher = createWhatsAppReplyPublisher({ sendPublisher });
    const buttons = [
      { type: 'reply' as const, reply: { id: 'intex_confirm:confirm-1:yes', title: 'Tak' } },
      { type: 'reply' as const, reply: { id: 'intex_confirm:confirm-1:no', title: 'Nie' } },
    ];

    await publisher.publishReply({
      userId: 'user-1',
      message: 'Czy dodać notatkę?',
      replyToMessageId: 'wamid-1',
      correlationId: 'session-1',
      buttons,
    });

    expect(sendPublisher.calls).toEqual([
      {
        userId: 'user-1',
        message: 'Czy dodać notatkę?',
        replyToMessageId: 'wamid-1',
        correlationId: 'session-1',
        buttons,
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

  it('returns a durable acknowledgement only for the explicit Matrix corpus method', async () => {
    const sendPublisher = new FakeWhatsAppSendPublisher();
    const publisher = createWhatsAppReplyPublisher({ sendPublisher });

    await expect(
      publisher.publishReplyWithReceipt({
        userId: 'user-1',
        message: 'Synthetic reply',
        replyToMessageId: 'wamid-1',
        idempotencyKey: 'imc_reply_key_1',
      })
    ).resolves.toEqual({ publicationReceiptId: 'pubsub-message-1' });
    expect(sendPublisher.receiptCalls).toEqual([
      {
        userId: 'user-1',
        message: 'Synthetic reply',
        replyToMessageId: 'wamid-1',
        correlationId: expect.stringMatching(/^imc_reply_[0-9a-f]{32}$/u),
        idempotencyKey: 'imc_reply_key_1',
        important: true,
      },
    ]);
    expect(sendPublisher.receiptCalls[0]?.correlationId).not.toBe('imc_reply_key_1');
  });

  it('forwards Matrix reply buttons and fails closed when durable publication fails', async () => {
    const sendPublisher = new FakeWhatsAppSendPublisher();
    const publisher = createWhatsAppReplyPublisher({ sendPublisher });
    const buttons = [
      { type: 'reply' as const, reply: { id: 'intex_confirm:confirm-1:yes', title: 'Tak' } },
    ];

    await publisher.publishReplyWithReceipt({
      userId: 'user-1',
      message: 'Synthetic reply',
      replyToMessageId: 'wamid-1',
      idempotencyKey: 'imc_reply_key_2',
      buttons,
    });
    expect(sendPublisher.receiptCalls[0]).toMatchObject({ buttons });

    sendPublisher.receiptResult = err({
      code: 'PUBLISH_FAILED',
      message: 'private provider detail',
    });
    await expect(
      publisher.publishReplyWithReceipt({
        userId: 'user-1',
        message: 'Synthetic reply',
        replyToMessageId: 'wamid-1',
        idempotencyKey: 'imc_reply_key_3',
      })
    ).rejects.toThrowError('WhatsApp reply publication failed');
  });
});

class FakeWhatsAppSendPublisher implements WhatsAppSendPublisher {
  readonly calls: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0][] = [];
  result: Result<void, PublishError> = ok(undefined);
  receiptResult: Result<string, PublishError> = ok('pubsub-message-1');
  readonly receiptCalls: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0][] = [];

  publishSendMessage(
    params: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0]
  ): Promise<Result<void, PublishError>> {
    this.calls.push(params);
    return Promise.resolve(this.result);
  }

  publishSendMessageWithReceipt(
    params: Parameters<WhatsAppSendPublisher['publishSendMessage']>[0]
  ): Promise<Result<string, PublishError>> {
    this.receiptCalls.push(params);
    return Promise.resolve(this.receiptResult);
  }
}
