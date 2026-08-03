/**
 * Tests for WhatsApp Send Publisher.
 * Mocks @google-cloud/pubsub SDK to test publishing without real Pub/Sub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { buildSendMessageEvent, createWhatsAppSendPublisher } from '../whatsappSendPublisher.js';
import {
  MESSAGE_DIGEST_EVENT_MESSAGE,
  MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS,
  type WhatsAppSendPublisherConfig,
} from '../types.js';

const mockPublishMessage = vi.fn();

function buildUncheckedSendMessageEvent(input: unknown): ReturnType<typeof buildSendMessageEvent> {
  return buildSendMessageEvent(input as Parameters<typeof buildSendMessageEvent>[0]);
}

vi.mock('@google-cloud/pubsub', () => {
  class MockTopic {
    publishMessage = mockPublishMessage;
  }

  class MockPubSub {
    topic(): MockTopic {
      return new MockTopic();
    }
  }

  return {
    PubSub: MockPubSub,
  };
});

describe('createWhatsAppSendPublisher', () => {
  const mockLogger = pino({ name: 'test', level: 'silent' });
  const config: WhatsAppSendPublisherConfig = {
    projectId: 'test-project',
    topicName: 'test-whatsapp-send-topic',
    logger: mockLogger,
  };

  beforeEach(() => {
    mockPublishMessage.mockReset();
    mockPublishMessage.mockResolvedValue('message-id-123');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exports a pure builder for a caller-frozen send event', async () => {
    const publisherModule = (await import('../whatsappSendPublisher.js')) as unknown as {
      buildSendMessageEvent?: (params: {
        userId: string;
        message: string;
        correlationId: string;
        idempotencyKey: string;
        timestamp: string;
      }) => unknown;
    };

    expect(publisherModule.buildSendMessageEvent).toBeTypeOf('function');
    expect(
      publisherModule.buildSendMessageEvent?.({
        userId: ' user-123 ',
        message: 'Stable digest payload',
        correlationId: 'digest-run-123',
        idempotencyKey: 'digest-run-123',
        timestamp: '2026-07-27T12:34:56.000Z',
      })
    ).toEqual({
      ok: true,
      value: {
        correlationId: 'digest-run-123',
        userId: 'user-123',
        event: {
          type: 'whatsapp.message.send',
          userId: 'user-123',
          message: 'Stable digest payload',
          correlationId: 'digest-run-123',
          idempotencyKey: 'digest-run-123',
          timestamp: '2026-07-27T12:34:56.000Z',
        },
      },
    });
  });

  it('builds the exact caller-frozen Message Digest template presentation', () => {
    const params = {
      userId: ' user-123 ',
      message: MESSAGE_DIGEST_EVENT_MESSAGE,
      correlationId: 'mdr_run_123',
      idempotencyKey: 'message-digest:mdr_run_123',
      timestamp: '2026-07-28T07:00:00.000Z',
      important: true,
      presentation: {
        kind: 'message_digest_v1' as const,
        digestName: 'Daily fishing digest',
        digestExcerpt: 'Meet at the lake at 07:00.',
        runUrlSuffix: '#/whatsapp/message-digests/md_definition_123/history/mdr_run_123',
      },
      deliveryAuthorization: {
        kind: 'message_digest_delivery_v1' as const,
        definitionId: 'md_definition_123',
        runId: 'mdr_run_123',
      },
      retainMessageText: false,
    };
    expect(buildSendMessageEvent(params)).toEqual({
      ok: true,
      value: {
        correlationId: 'mdr_run_123',
        userId: 'user-123',
        event: {
          type: 'whatsapp.message.send',
          userId: 'user-123',
          message: MESSAGE_DIGEST_EVENT_MESSAGE,
          correlationId: 'mdr_run_123',
          timestamp: '2026-07-28T07:00:00.000Z',
          important: true,
          idempotencyKey: 'message-digest:mdr_run_123',
          presentation: {
            kind: 'message_digest_v1',
            digestName: 'Daily fishing digest',
            digestExcerpt: 'Meet at the lake at 07:00.',
            runUrlSuffix: '#/whatsapp/message-digests/md_definition_123/history/mdr_run_123',
          },
          deliveryAuthorization: {
            kind: 'message_digest_delivery_v1',
            definitionId: 'md_definition_123',
            runId: 'mdr_run_123',
          },
          retainMessageText: false,
        },
      },
    });
  });

  it('builds the exact scan-friendly Message Digest v2 presentation with deliberate line breaks', () => {
    const params = {
      userId: ' user-123 ',
      message: MESSAGE_DIGEST_EVENT_MESSAGE,
      correlationId: 'mdr_run_123',
      idempotencyKey: 'message-digest:mdr_run_123',
      timestamp: '2026-07-28T07:00:00.000Z',
      important: true,
      presentation: {
        kind: 'message_digest_v2' as const,
        digestName: 'Wędkarskie podsumowanie',
        windowLabel: '27 lip, 09:00 – 27 lip, 14:00',
        headline: 'Wyjazd wymaga potwierdzenia',
        digestBody: '🔴 WYMAGA UWAGI\nPotwierdź udział.\n\n📍 ZAWODY\nPod Krakowem.',
        runUrlSuffix: '#/whatsapp/message-digests/md_definition_123/history/mdr_run_123',
      },
      deliveryAuthorization: {
        kind: 'message_digest_delivery_v1' as const,
        definitionId: 'md_definition_123',
        runId: 'mdr_run_123',
      },
      retainMessageText: false,
    };

    expect(buildSendMessageEvent(params)).toMatchObject({
      ok: true,
      value: { event: { presentation: params.presentation } },
    });
  });

  it('enforces every Message Digest v2 parameter boundary while allowing LF in its body only', () => {
    const valid = {
      userId: 'user-123',
      message: MESSAGE_DIGEST_EVENT_MESSAGE,
      correlationId: 'mdr_run_123',
      idempotencyKey: 'message-digest:mdr_run_123',
      timestamp: '2026-07-28T07:00:00.000Z',
      presentation: {
        kind: 'message_digest_v2' as const,
        digestName: 'n'.repeat(80),
        windowLabel: 'w'.repeat(80),
        headline: 'h'.repeat(200),
        digestBody: `A\n\n${'b'.repeat(MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS - 3)}`,
        runUrlSuffix: '#/whatsapp/message-digests/md_definition_123/history/mdr_run_123',
      },
      deliveryAuthorization: {
        kind: 'message_digest_delivery_v1' as const,
        definitionId: 'md_definition_123',
        runId: 'mdr_run_123',
      },
      retainMessageText: false,
      important: true,
    };

    expect(Array.from(valid.presentation.digestBody)).toHaveLength(
      MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS
    );
    expect(buildSendMessageEvent(valid)).toMatchObject({ ok: true });
    for (const [field, value] of [
      ['digestName', 'n'.repeat(81)],
      ['windowLabel', 'w'.repeat(81)],
      ['headline', 'h'.repeat(201)],
      ['digestBody', 'b'.repeat(MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS + 1)],
      ['digestBody', 'unsafe\rbreak'],
    ] as const) {
      expect(
        buildUncheckedSendMessageEvent({
          ...valid,
          presentation: { ...valid.presentation, [field]: value },
        })
      ).toMatchObject({ ok: false });
    }
  });

  it('validates Message Digest template parameter boundaries before publication', () => {
    const valid = {
      userId: 'user-123',
      message: MESSAGE_DIGEST_EVENT_MESSAGE,
      correlationId: 'mdr_run_123',
      idempotencyKey: 'message-digest:mdr_run_123',
      timestamp: '2026-07-28T07:00:00.000Z',
      presentation: {
        kind: 'message_digest_v1' as const,
        digestName: 'n'.repeat(80),
        digestExcerpt: 'e'.repeat(876),
        runUrlSuffix: '#/whatsapp/message-digests/md_definition_123/history/mdr_run_123',
      },
      deliveryAuthorization: {
        kind: 'message_digest_delivery_v1' as const,
        definitionId: 'md_definition_123',
        runId: 'mdr_run_123',
      },
      retainMessageText: false,
      important: true,
    };

    expect(buildSendMessageEvent(valid)).toMatchObject({ ok: true });
    expect(
      buildSendMessageEvent({ ...valid, message: 'Private digest summary must not be retained' })
    ).toMatchObject({ ok: false });
    expect(
      buildSendMessageEvent({
        ...valid,
        presentation: { ...valid.presentation, digestName: 'n'.repeat(81) },
      })
    ).toMatchObject({ ok: false });
    expect(
      buildSendMessageEvent({
        ...valid,
        presentation: { ...valid.presentation, digestExcerpt: 'e'.repeat(877) },
      })
    ).toMatchObject({ ok: false });
    expect(
      buildSendMessageEvent({
        ...valid,
        retainMessageText: true,
      })
    ).toMatchObject({ ok: false });
    expect(
      buildSendMessageEvent({
        ...valid,
        ctaUrl: { displayText: 'Unsafe fallback', url: 'https://example.com' },
      })
    ).toMatchObject({ ok: false });
    expect(buildUncheckedSendMessageEvent({ ...valid, idempotencyKey: undefined })).toMatchObject({
      ok: false,
    });
    expect(buildSendMessageEvent({ ...valid, idempotencyKey: '   ' })).toMatchObject({
      ok: false,
    });
    expect(buildUncheckedSendMessageEvent({ ...valid, important: undefined })).toMatchObject({
      ok: false,
    });
    expect(buildSendMessageEvent({ ...valid, important: false })).toMatchObject({ ok: false });
    expect(
      buildUncheckedSendMessageEvent({ ...valid, deliveryAuthorization: undefined })
    ).toMatchObject({ ok: false });
    expect(
      buildSendMessageEvent({
        ...valid,
        deliveryAuthorization: {
          ...valid.deliveryAuthorization,
          definitionId: 'md_other_definition',
        },
      })
    ).toMatchObject({ ok: false });
    expect(
      buildSendMessageEvent({
        ...valid,
        deliveryAuthorization: {
          ...valid.deliveryAuthorization,
          runId: 'mdr_other_run',
        },
      })
    ).toMatchObject({ ok: false });
    expect(
      buildSendMessageEvent({ ...valid, idempotencyKey: 'message-digest:mdr_other_run' })
    ).toMatchObject({ ok: false });
    expect(
      buildUncheckedSendMessageEvent({
        ...valid,
        deliveryAuthorization: {
          ...valid.deliveryAuthorization,
          extra: 'not-allowed',
        },
      })
    ).toMatchObject({ ok: false });
    for (const unsafeCharacter of [
      '\n',
      '\r',
      '\u001f',
      '\u007f',
      '\u009f',
      '\u202a',
      '\u202e',
      '\u2066',
      '\u2069',
    ]) {
      expect(
        buildSendMessageEvent({
          ...valid,
          presentation: { ...valid.presentation, digestExcerpt: `unsafe${unsafeCharacter}` },
        })
      ).toMatchObject({ ok: false });
    }
  });

  it('fails closed for a malformed runtime presentation instead of throwing', () => {
    const malformed = {
      userId: 'user-123',
      message: 'Stable digest artifact',
      correlationId: 'mdr_run_123',
      timestamp: '2026-07-28T07:00:00.000Z',
      presentation: {
        kind: 'message_digest_v1',
        digestName: 42,
        digestExcerpt: 'Digest excerpt',
        runUrlSuffix: '#/whatsapp/message-digests/md_definition_123/history/mdr_run_123',
      },
      retainMessageText: false,
    } as unknown as Parameters<typeof buildSendMessageEvent>[0];

    expect(() => buildSendMessageEvent(malformed)).not.toThrow();
    expect(buildSendMessageEvent(malformed)).toMatchObject({ ok: false });
  });

  describe('publishSendMessage', () => {
    it('returns the opaque durable Pub/Sub acknowledgement for Matrix corpus publication', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      await expect(
        publisher.publishSendMessageWithReceipt({
          userId: 'user-123',
          message: 'Synthetic reply',
          correlationId: 'imc_reply_key_1',
          idempotencyKey: 'imc_reply_key_1',
        })
      ).resolves.toEqual({ ok: true, value: 'message-id-123' });
      expect(mockPublishMessage).toHaveBeenCalledOnce();
      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;
      expect(publishedData['idempotencyKey']).toBe('imc_reply_key_1');
    });

    it('rejects a blank Matrix receipt user before publishing', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      await expect(
        publisher.publishSendMessageWithReceipt({
          userId: '   ',
          message: 'Synthetic reply',
          idempotencyKey: 'imc_reply_key_invalid',
        })
      ).resolves.toMatchObject({ ok: false });
      expect(mockPublishMessage).not.toHaveBeenCalled();
    });

    it('publishes message with all required fields', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello from test',
        correlationId: 'corr-123',
      });

      expect(result.ok).toBe(true);
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['type']).toBe('whatsapp.message.send');
      expect(publishedData['userId']).toBe('user-123');
      expect(publishedData['message']).toBe('Hello from test');
      expect(publishedData['correlationId']).toBe('corr-123');
      expect(publishedData['timestamp']).toBeDefined();
    });

    it('reuses caller-frozen timestamp and idempotency bytes across publish retries', async () => {
      const publisher = createWhatsAppSendPublisher(config);
      const params = {
        userId: 'user-123',
        message: 'Stable digest payload',
        correlationId: 'digest-run-123',
        idempotencyKey: 'digest-run-123',
        timestamp: '2026-07-27T12:34:56.000Z',
      };

      await publisher.publishSendMessageWithReceipt(params);
      await publisher.publishSendMessageWithReceipt(params);

      const firstCall = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const secondCall = mockPublishMessage.mock.calls[1] as [{ data: Buffer }];
      expect(firstCall[0].data.equals(secondCall[0].data)).toBe(true);
      expect(JSON.parse(firstCall[0].data.toString())).toMatchObject({
        idempotencyKey: 'digest-run-123',
        timestamp: '2026-07-27T12:34:56.000Z',
      });
    });

    it('generates correlationId when not provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello',
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['correlationId']).toBeDefined();
      expect(typeof publishedData['correlationId']).toBe('string');
      expect((publishedData['correlationId'] as string).length).toBeGreaterThan(0);
    });

    it('omits idempotencyKey for ordinary messages', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello',
        correlationId: 'corr-123',
      });

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;
      expect(publishedData).not.toHaveProperty('idempotencyKey');
    });

    it('rejects blank userId before publishing', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: '   ',
        message: 'Hello',
      });

      expect(result.ok).toBe(false);
      expect(mockPublishMessage).not.toHaveBeenCalled();
      if (!result.ok) {
        expect(result.error.code).toBe('PUBLISH_FAILED');
        expect(result.error.message).toContain('userId is required');
      }
    });

    it('includes replyToMessageId when provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Reply message',
        replyToMessageId: 'wamid.original123',
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['replyToMessageId']).toBe('wamid.original123');
    });

    it('omits replyToMessageId when not provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Simple message',
      });

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(Object.prototype.hasOwnProperty.call(publishedData, 'replyToMessageId')).toBe(false);
    });

    it('includes buttons when provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const buttons = [
        { type: 'reply' as const, reply: { id: 'approve:123:abc1', title: 'Approve' } },
        { type: 'reply' as const, reply: { id: 'cancel:123', title: 'Cancel' } },
      ];

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Confirm action?',
        buttons,
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['buttons']).toEqual(buttons);
    });

    it('omits buttons when not provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Simple message',
      });

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(Object.prototype.hasOwnProperty.call(publishedData, 'buttons')).toBe(false);
    });

    it('includes ctaUrl when provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const ctaUrl = {
        displayText: 'View Pull Request',
        url: 'https://github.com/owner/repo/pull/123',
      };

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'PR ready for review',
        ctaUrl,
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['ctaUrl']).toEqual(ctaUrl);
    });

    it('omits ctaUrl when not provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Simple message',
      });

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(Object.prototype.hasOwnProperty.call(publishedData, 'ctaUrl')).toBe(false);
    });

    it('includes important=true when provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Critical alert',
        important: true,
      });

      expect(result.ok).toBe(true);

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(publishedData['important']).toBe(true);
    });

    it('omits important when not provided', async () => {
      const publisher = createWhatsAppSendPublisher(config);

      await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Simple message',
      });

      const call = mockPublishMessage.mock.calls[0] as [{ data: Buffer }];
      const publishedData = JSON.parse(call[0].data.toString()) as Record<string, unknown>;

      expect(Object.prototype.hasOwnProperty.call(publishedData, 'important')).toBe(false);
    });

    it('returns TOPIC_NOT_FOUND error when topic does not exist', async () => {
      mockPublishMessage.mockRejectedValue(new Error('NOT_FOUND: Topic does not exist'));

      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOPIC_NOT_FOUND');
        expect(result.error.message).toContain('NOT_FOUND');
      }
    });

    it('returns PERMISSION_DENIED error when access is denied', async () => {
      mockPublishMessage.mockRejectedValue(new Error('PERMISSION_DENIED: Access denied'));

      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('PERMISSION_DENIED');
      }
    });

    it('returns PUBLISH_FAILED error for other failures', async () => {
      mockPublishMessage.mockRejectedValue(new Error('Connection timeout'));

      const publisher = createWhatsAppSendPublisher(config);

      const result = await publisher.publishSendMessage({
        userId: 'user-123',
        message: 'Hello',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PUBLISH_FAILED');
        expect(result.error.message).toContain('Connection timeout');
      }
    });
  });
});
