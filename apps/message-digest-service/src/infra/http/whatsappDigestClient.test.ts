import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppServiceClient } from '@intexuraos/internal-clients';
import { createWhatsAppDigestClient } from './whatsappDigestClient.js';

describe('WhatsAppDigestClient', () => {
  it('maps a validated private source to the domain-safe snapshot only', async () => {
    const validatePrivateDigestSource = vi.fn(async () => ({
      ok: true as const,
      value: {
        sourceAccountId: 'synthetic-account-001',
        generationId: 'synthetic-generation-001',
        chatId: 'synthetic-chat-001',
        chatType: 'group' as const,
        displayName: 'Fishing friends',
        messageCount: 123,
        participantCount: 8,
        lastActivityAt: '2026-07-27T11:00:00.000Z',
        sourceRevision: 'synthetic-source-revision-001',
      },
    }));
    const client = createWhatsAppDigestClient(internalClient({ validatePrivateDigestSource }));

    await expect(
      client.validateSource({ userId: 'synthetic-user-001', chatId: 'synthetic-chat-001' })
    ).resolves.toEqual({
      ok: true,
      value: {
        sourceAccountId: 'synthetic-account-001',
        generationId: 'synthetic-generation-001',
        chatId: 'synthetic-chat-001',
        chatType: 'group',
        displayName: 'Fishing friends',
        messageCount: 123,
        participantCount: 8,
        lastActivityAt: '2026-07-27T11:00:00.000Z',
        sourceRevision: 'synthetic-source-revision-001',
      },
    });
  });

  it('omits optional safe source metadata when an existing source does not have it', async () => {
    const client = createWhatsAppDigestClient(
      internalClient({
        validatePrivateDigestSource: vi.fn(async () => ({
          ok: true as const,
          value: {
            sourceAccountId: 'synthetic-account-legacy',
            generationId: 'synthetic-generation-legacy',
            chatId: 'synthetic-chat-legacy',
            chatType: 'direct' as const,
            displayName: 'Legacy conversation',
            messageCount: 0,
            sourceRevision: 'synthetic-source-revision-legacy',
          },
        })),
      })
    );

    const result = await client.validateSource({
      userId: 'synthetic-user-001',
      chatId: 'synthetic-chat-legacy',
    });

    expect(result).toMatchObject({ ok: true, value: { messageCount: 0 } });
    expect(result.ok ? result.value : {}).not.toHaveProperty('participantCount');
    expect(result.ok ? result.value : {}).not.toHaveProperty('lastActivityAt');
  });

  it('forwards an expected account generation fence when supplied', async () => {
    const validatePrivateDigestSource = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'source_changed' as const },
    }));
    const client = createWhatsAppDigestClient(internalClient({ validatePrivateDigestSource }));

    await client.validateSource({
      userId: 'synthetic-user-001',
      chatId: 'synthetic-chat-001',
      expectedGenerationId: 'synthetic-generation-001',
    });

    expect(validatePrivateDigestSource).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      chatId: 'synthetic-chat-001',
      expectedGenerationId: 'synthetic-generation-001',
    });
  });

  it.each([
    ['not_found', 'not_found'],
    ['source_changed', 'source_changed'],
    ['invalid_request', 'invalid_request'],
    ['invalid_response', 'invalid_response'],
    ['timeout', 'unavailable'],
    ['rejected', 'unavailable'],
    ['unavailable', 'unavailable'],
  ] as const)('maps internal source failure %s to %s', async (internalCode, domainCode) => {
    const client = createWhatsAppDigestClient(
      internalClient({
        validatePrivateDigestSource: vi.fn(async () => ({
          ok: false as const,
          error: { code: internalCode },
        })),
      })
    );

    await expect(
      client.validateSource({ userId: 'synthetic-user-001', chatId: 'synthetic-chat-001' })
    ).resolves.toEqual({ ok: false, code: domainCode });
  });

  it('forwards only masked readiness metadata', async () => {
    const getWhatsAppDeliveryReadiness = vi.fn(async () => ({
      ok: true as const,
      value: {
        status: 'ready' as const,
        maskedPrimaryNumber: '+48•••123',
        observationVersion: 'readiness-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    }));
    const client = createWhatsAppDigestClient(internalClient({ getWhatsAppDeliveryReadiness }));

    await expect(client.getDeliveryReadiness('synthetic-user-001')).resolves.toEqual({
      ok: true,
      value: {
        status: 'ready',
        maskedPrimaryNumber: '+48•••123',
        observationVersion: 'readiness-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    });
  });

  it('omits absent readiness display metadata and maps readiness failures', async () => {
    const withoutMask = createWhatsAppDigestClient(
      internalClient({
        getWhatsAppDeliveryReadiness: vi.fn(async () => ({
          ok: true as const,
          value: {
            status: 'mapping_missing' as const,
            observationVersion: 'readiness-v2',
            observedAt: '2026-07-27T12:00:00.000Z',
          },
        })),
      })
    );
    await expect(withoutMask.getDeliveryReadiness('synthetic-user-001')).resolves.toEqual({
      ok: true,
      value: {
        status: 'mapping_missing',
        observationVersion: 'readiness-v2',
        observedAt: '2026-07-27T12:00:00.000Z',
      },
    });

    const failed = createWhatsAppDigestClient(
      internalClient({
        getWhatsAppDeliveryReadiness: vi.fn(async () => ({
          ok: false as const,
          error: { code: 'timeout' as const },
        })),
      })
    );
    await expect(failed.getDeliveryReadiness('synthetic-user-001')).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('queries one frozen safe source page without exposing internal response fields', async () => {
    const queryPrivateDigestMessages = vi.fn(async () => ({
      ok: true as const,
      value: {
        messages: [
          {
            messageRef: 'a'.repeat(64),
            eventTimestamp: '2026-07-27T10:00:00.000Z',
            direction: 'inbound' as const,
            authorLabel: 'Synthetic participant',
            text: 'A bounded source message.',
            contentKind: 'text' as const,
          },
        ],
        sourceRevision: 'opaque-source-revision',
        highWatermark: 'opaque-high-watermark',
        nextCursor: 'opaque-next-cursor',
      },
    }));
    const client = createWhatsAppDigestClient(internalClient({ queryPrivateDigestMessages }));
    const request = {
      userId: 'synthetic-user-001',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group' as const,
      windowStart: '2026-07-26T07:00:00.000Z',
      windowEnd: '2026-07-27T07:00:00.000Z',
      limit: 200,
      cursor: 'opaque-current-cursor',
    };

    await expect(client.queryMessages(request)).resolves.toEqual({
      ok: true,
      value: {
        messages: [
          {
            messageRef: 'a'.repeat(64),
            eventTimestamp: '2026-07-27T10:00:00.000Z',
            direction: 'inbound',
            authorLabel: 'Synthetic participant',
            text: 'A bounded source message.',
            contentKind: 'text',
          },
        ],
        sourceRevision: 'opaque-source-revision',
        highWatermark: 'opaque-high-watermark',
        nextCursor: 'opaque-next-cursor',
      },
    });
    expect(queryPrivateDigestMessages).toHaveBeenCalledWith(request);
  });

  it.each([
    ['source_changed', 'source_changed'],
    ['invalid_response', 'invalid_response'],
    ['timeout', 'unavailable'],
  ] as const)('maps internal message query failure %s to %s', async (internalCode, domainCode) => {
    const client = createWhatsAppDigestClient(
      internalClient({
        queryPrivateDigestMessages: vi.fn(async () => ({
          ok: false as const,
          error: { code: internalCode },
        })),
      })
    );

    await expect(
      client.queryMessages({
        userId: 'synthetic-user-001',
        sourceAccountId: 'synthetic-account-001',
        generationId: 'synthetic-generation-001',
        chatId: 'synthetic-chat-001',
        chatType: 'direct',
        windowStart: '2026-07-26T07:00:00.000Z',
        windowEnd: '2026-07-27T07:00:00.000Z',
        limit: 200,
      })
    ).resolves.toEqual({ ok: false, code: domainCode });
  });

  it.each([
    [{ status: 'pending' as const }, { status: 'pending' as const }],
    [
      { status: 'sent' as const, acceptedAt: '2026-07-27T12:03:00.000Z' },
      { status: 'sent' as const, acceptedAt: '2026-07-27T12:03:00.000Z' },
    ],
    [
      { status: 'ambiguous' as const },
      { status: 'ambiguous' as const },
    ],
    [
      {
        status: 'failed' as const,
        failedAt: '2026-07-27T12:03:00.000Z',
        failureCode: 'DELIVERY_DISABLED',
      },
      {
        status: 'failed' as const,
        failedAt: '2026-07-27T12:03:00.000Z',
        failureCode: 'DELIVERY_DISABLED',
      },
    ],
    [{ status: 'missing' as const }, { status: 'missing' as const }],
  ])('maps the truthful outbound delivery receipt %#', async (internalState, expected) => {
    const getOutboundDeliveryState = vi.fn(async () => ({
      ok: true as const,
      value: internalState,
    }));
    const client = createWhatsAppDigestClient(internalClient({ getOutboundDeliveryState }));

    await expect(
      client.getOutboundDeliveryState({
        userId: 'synthetic-user-001',
        idempotencyKey: 'message-digest:mdr_run_001',
      })
    ).resolves.toEqual({ ok: true, value: expected });
  });

  it('preserves optional ambiguous acceptance and rejects incomplete terminal receipts', async () => {
    const ambiguous = createWhatsAppDigestClient(
      internalClient({
        getOutboundDeliveryState: vi.fn(async () => ({
          ok: true as const,
          value: {
            status: 'ambiguous' as const,
            acceptedAt: '2026-07-27T12:03:00.000Z',
          },
        })),
      })
    );
    await expect(
      ambiguous.getOutboundDeliveryState({
        userId: 'synthetic-user-001',
        idempotencyKey: 'message-digest:mdr_run_001',
      })
    ).resolves.toEqual({
      ok: true,
      value: { status: 'ambiguous', acceptedAt: '2026-07-27T12:03:00.000Z' },
    });

    for (const value of [
      { status: 'sent' as const },
      { status: 'failed' as const, failureCode: 'DELIVERY_DISABLED' },
      { status: 'failed' as const, failedAt: '2026-07-27T12:03:00.000Z' },
    ]) {
      const client = createWhatsAppDigestClient(
        internalClient({
          getOutboundDeliveryState: vi.fn(async () => ({ ok: true as const, value })),
        })
      );
      await expect(
        client.getOutboundDeliveryState({
          userId: 'synthetic-user-001',
          idempotencyKey: 'message-digest:mdr_run_001',
        })
      ).resolves.toEqual({ ok: false, code: 'invalid_response' });
    }

    const unavailable = createWhatsAppDigestClient(
      internalClient({
        getOutboundDeliveryState: vi.fn(async () => ({
          ok: false as const,
          error: { code: 'timeout' as const },
        })),
      })
    );
    await expect(
      unavailable.getOutboundDeliveryState({
        userId: 'synthetic-user-001',
        idempotencyKey: 'message-digest:mdr_run_001',
      })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
  });

  it('authorizes one outbound delivery retry without exposing transport metadata', async () => {
    const authorizeOutboundDeliveryRetry = vi.fn(async () => ({
      ok: true as const,
      value: { authorized: true as const },
    }));
    const client = createWhatsAppDigestClient(internalClient({ authorizeOutboundDeliveryRetry }));
    const input = {
      userId: 'synthetic-user-001',
      idempotencyKey: 'message-digest:mdr_run_001',
      payloadDigest: 'a'.repeat(64),
    };

    await expect(client.authorizeOutboundDeliveryRetry(input)).resolves.toEqual({ ok: true });
    expect(authorizeOutboundDeliveryRetry).toHaveBeenCalledWith(input);
  });

  it.each([
    ['invalid_request', 'invalid_request'],
    ['not_found', 'not_found'],
    ['invalid_response', 'invalid_response'],
    ['timeout', 'unavailable'],
    ['unavailable', 'unavailable'],
    ['rejected', 'unavailable'],
    ['source_changed', 'unavailable'],
  ] as const)('maps retry authorization failure %s to %s', async (internalCode, domainCode) => {
    const client = createWhatsAppDigestClient(
      internalClient({
        authorizeOutboundDeliveryRetry: vi.fn(async () => ({
          ok: false as const,
          error: { code: internalCode },
        })),
      })
    );

    await expect(
      client.authorizeOutboundDeliveryRetry({
        userId: 'synthetic-user-001',
        idempotencyKey: 'message-digest:mdr_run_001',
        payloadDigest: 'a'.repeat(64),
      })
    ).resolves.toEqual({ ok: false, code: domainCode });
  });

  it('omits an absent source cursor on the internal query', async () => {
    const queryPrivateDigestMessages = vi.fn(async () => ({
      ok: true as const,
      value: {
        messages: [],
        sourceRevision: 'opaque-source-revision',
        highWatermark: null,
        nextCursor: null,
      },
    }));
    const client = createWhatsAppDigestClient(internalClient({ queryPrivateDigestMessages }));
    await client.queryMessages({
      userId: 'synthetic-user-001',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'direct',
      windowStart: '2026-07-26T07:00:00.000Z',
      windowEnd: '2026-07-27T07:00:00.000Z',
      limit: 200,
    });

    expect(queryPrivateDigestMessages).toHaveBeenCalledWith(
      expect.not.objectContaining({ cursor: expect.anything() })
    );
  });
});

function internalClient(overrides: Partial<WhatsAppServiceClient>): WhatsAppServiceClient {
  return overrides as WhatsAppServiceClient;
}
