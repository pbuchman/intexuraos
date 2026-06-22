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
});
