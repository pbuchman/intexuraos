import { vi } from 'vitest';

const commonHttpState = vi.hoisted(() => ({
  logIncomingRequest: vi.fn(),
}));

vi.mock('@intexuraos/common-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intexuraos/common-http')>();

  return {
    ...actual,
    logIncomingRequest: commonHttpState.logIncomingRequest,
  };
});

import { beforeEach, describe, expect, it, setupTestContext } from './testUtils.js';

describe('Private WhatsApp Sync Routes', () => {
  const ctx = setupTestContext();

  beforeEach(() => {
    commonHttpState.logIncomingRequest.mockClear();
  });

  function createPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      sourceAccountId: 'pbuchman-private-whatsapp',
      userId: 'user-123',
      deliveryMode: 'live',
      events: [
        {
          matrixRoomId: '!room:matrix.example',
          matrixEventId: '$event-1',
          matrixSenderId: '@alice:matrix.example',
          eventTimestamp: '2026-06-22T10:00:00.000Z',
          chat: {
            type: 'direct',
            displayName: 'Alice',
          },
          sender: {
            displayName: 'Alice',
            phoneNumber: '+48123456789',
          },
          message: {
            direction: 'incoming',
            type: 'text',
            text: 'hello from private whatsapp',
          },
          rawMatrixEvent: {
            type: 'm.room.message',
            event_id: '$event-1',
          },
        },
      ],
      ...overrides,
    };
  }

  it('requires internal auth on the production internal path', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      payload: createPayload(),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects bearer-only auth because nginx must inject internal auth', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { authorization: 'Bearer arbitrary-unverified-token' },
      payload: createPayload(),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('validates the batch envelope before ingestion', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        sourceAccountId: 'pbuchman-private-whatsapp',
        userId: 'user-123',
        deliveryMode: 'live',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('ingests live incoming private WhatsApp events', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        accepted: number;
        duplicates: number;
        rejected: number;
        messages: { matrixEventId: string; outcome: string }[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      messages: [{ matrixEventId: '$event-1', outcome: 'created' }],
    });
  });

  it('logs private sync requests without raw body previews', async () => {
    const payload = createPayload();
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload,
    });

    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        message: 'Received request to /internal/whatsapp/private/events',
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'internal_whatsapp_private_events',
          deliveryMode: 'live',
          eventCount: 1,
          hasSourceAccountId: true,
          hasUserId: true,
        },
      })
    );
    const logOptions = commonHttpState.logIncomingRequest.mock.calls[0]?.[1];
    expect(JSON.stringify(logOptions)).not.toContain('hello from private whatsapp');
    expect(JSON.stringify(logOptions)).not.toContain('+48123456789');
    expect(JSON.stringify(logOptions)).not.toContain('Alice');
    expect(JSON.stringify(logOptions)).not.toContain('$event-1');
  });

  it('logs non-object private sync bodies without inspecting payload contents', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(400);
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'internal_whatsapp_private_events',
          bodyType: 'undefined',
        },
      })
    );
  });

  it('logs invalid private sync envelopes with coarse metadata only', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        sourceAccountId: 123,
        deliveryMode: 42,
        events: 'not-an-event-array',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'internal_whatsapp_private_events',
          deliveryMode: 'unknown',
          eventCount: 0,
          hasSourceAccountId: false,
          hasUserId: false,
        },
      })
    );
  });

  it('returns a standard error envelope when private message persistence fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private WhatsApp persistence failure',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('rejects malformed event objects without failing the whole batch', async () => {
    const validEvent = (createPayload()['events'] as Record<string, unknown>[])[0];
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            ...validEvent,
            matrixEventId: '$event-valid',
          },
          {
            matrixEventId: '$event-missing-message',
            matrixRoomId: '!room:matrix.example',
            matrixSenderId: '@alice:matrix.example',
            eventTimestamp: '2026-06-22T10:01:00.000Z',
            chat: {
              type: 'direct',
              displayName: 'Alice',
            },
          },
        ],
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        accepted: number;
        rejected: number;
        messages: { matrixEventId: string; outcome: string; reason?: string }[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      accepted: 1,
      rejected: 1,
      messages: [
        { matrixEventId: '$event-valid', outcome: 'created' },
        {
          matrixEventId: '$event-missing-message',
          outcome: 'rejected',
          reason: 'missing_message',
        },
      ],
    });
  });

  it('rejects non-object event entries without failing the whole batch', async () => {
    const validEvent = (createPayload()['events'] as Record<string, unknown>[])[0];
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            ...validEvent,
            matrixEventId: '$event-valid',
          },
          'not-an-event-object',
        ],
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        accepted: number;
        rejected: number;
        messages: { matrixEventId: string; outcome: string; reason?: string }[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      accepted: 1,
      rejected: 1,
      messages: [
        { matrixEventId: '$event-valid', outcome: 'created' },
        {
          matrixEventId: '<unknown>',
          outcome: 'rejected',
          reason: 'invalid_event',
        },
      ],
    });
  });

  it('supports backfill batches through the same ingest contract', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({ deliveryMode: 'backfill' }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { accepted: number; messages: { outcome: string }[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.accepted).toBe(1);
    expect(body.data.messages[0]?.outcome).toBe('created');
  });

  it('requires internal auth for private WhatsApp message range queries', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/messages?sourceAccountId=pbuchman-private-whatsapp',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns private WhatsApp messages for an internal sender range query without logging message bodies', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    commonHttpState.logIncomingRequest.mockClear();

    const response = await ctx.app.inject({
      method: 'GET',
      url:
        '/internal/whatsapp/private/messages?sourceAccountId=pbuchman-private-whatsapp&senderKey=phone:%2B48123456789&from=2026-06-22T00:00:00.000Z&to=2026-06-23T00:00:00.000Z&eventDayKey=2026-06-22&limit=20&cursor=test-cursor',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        messages: { matrixEventId: string; senderKey: string; text?: string }[];
        nextCursor?: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.messages).toMatchObject([
      {
        matrixEventId: '$event-1',
        senderKey: 'phone:+48123456789',
        text: 'hello from private whatsapp',
      },
    ]);
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyPreviewLength: 0,
        additionalFields: expect.objectContaining({
          route: 'internal_whatsapp_private_messages_query',
          hasSourceAccountId: true,
          hasSenderKey: true,
          hasEventDayKey: true,
          hasCursor: true,
          limit: 20,
        }),
      })
    );
    expect(JSON.stringify(commonHttpState.logIncomingRequest.mock.calls)).not.toContain(
      'hello from private whatsapp'
    );
  });

  it('rejects invalid private WhatsApp message range query parameters after coarse logging', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/messages?sourceAccountId=pbuchman-private-whatsapp&limit=abc',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        additionalFields: expect.objectContaining({
          route: 'internal_whatsapp_private_messages_query',
          limit: 50,
        }),
      })
    );
  });

  it('returns a standard error envelope when private message range query fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private WhatsApp message query failure',
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/messages?sourceAccountId=pbuchman-private-whatsapp',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('requires internal auth for private WhatsApp sender-day queries', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/sender-days?sourceAccountId=pbuchman-private-whatsapp',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns private WhatsApp sender-day aggregates for internal summary preparation', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url:
        '/internal/whatsapp/private/sender-days?sourceAccountId=pbuchman-private-whatsapp&senderKey=phone:%2B48123456789&fromDay=2026-06-22&toDay=2026-06-22&limit=10&cursor=test-cursor',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        senderDays: {
          senderKey: string;
          eventDayKey: string;
          messageCount: number;
          summaryStatus: string;
        }[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.senderDays).toMatchObject([
      {
        senderKey: 'phone:+48123456789',
        eventDayKey: '2026-06-22',
        messageCount: 1,
        summaryStatus: 'not_started',
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('hello from private whatsapp');
  });

  it('rejects invalid private WhatsApp sender-day query parameters after coarse logging', async () => {
    commonHttpState.logIncomingRequest.mockClear();

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/sender-days?limit=abc',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        additionalFields: expect.objectContaining({
          route: 'internal_whatsapp_private_sender_days_query',
          hasSourceAccountId: false,
          limit: 50,
        }),
      })
    );
  });

  it('returns a standard error envelope when private sender-day query fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private WhatsApp sender-day query failure',
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/internal/whatsapp/private/sender-days?sourceAccountId=pbuchman-private-whatsapp',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('requires internal auth for private WhatsApp aggregate rebuilds', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/aggregates/rebuild',
      payload: {
        sourceAccountId: 'pbuchman-private-whatsapp',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('runs a private WhatsApp aggregate rebuild through an internal endpoint', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    commonHttpState.logIncomingRequest.mockClear();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/aggregates/rebuild',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        sourceAccountId: 'pbuchman-private-whatsapp',
        from: '2026-06-22T00:00:00.000Z',
        to: '2026-06-23T00:00:00.000Z',
        limit: 100,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        scannedMessages: number;
        senderDayCount: number;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      scannedMessages: 1,
      senderDayCount: 1,
    });
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyPreviewLength: 0,
        additionalFields: expect.objectContaining({
          route: 'internal_whatsapp_private_aggregates_rebuild',
          hasSourceAccountId: true,
          hasFrom: true,
          hasTo: true,
          limit: 100,
        }),
      })
    );
    expect(JSON.stringify(commonHttpState.logIncomingRequest.mock.calls)).not.toContain(
      'hello from private whatsapp'
    );
  });

  it('rejects invalid private WhatsApp aggregate rebuild bodies after coarse logging', async () => {
    commonHttpState.logIncomingRequest.mockClear();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/aggregates/rebuild',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        limit: 'abc',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        additionalFields: expect.objectContaining({
          route: 'internal_whatsapp_private_aggregates_rebuild',
          hasSourceAccountId: false,
          limit: 50,
        }),
      })
    );
  });

  it('logs non-object private WhatsApp aggregate rebuild bodies without inspecting contents', async () => {
    commonHttpState.logIncomingRequest.mockClear();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/aggregates/rebuild',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(400);
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'internal_whatsapp_private_aggregates_rebuild',
          bodyType: 'undefined',
        },
      })
    );
  });

  it('returns a standard error envelope when private aggregate rebuild fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private WhatsApp aggregate rebuild failure',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/aggregates/rebuild',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        sourceAccountId: 'pbuchman-private-whatsapp',
      },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
