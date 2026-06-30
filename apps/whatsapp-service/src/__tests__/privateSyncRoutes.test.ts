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

import { beforeEach, createToken, describe, expect, it, setupTestContext } from './testUtils.js';

interface PublicPrivateWhatsAppMediaDto {
  mxcUri: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
  storageStatus?: 'stored';
  hasMedia?: boolean;
  hasThumbnail?: boolean;
  storedMimeType?: string;
  storedSizeBytes?: number;
  storedAt?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

describe('Private WhatsApp Sync Routes', () => {
  const ctx = setupTestContext();

  beforeEach(async () => {
    commonHttpState.logIncomingRequest.mockClear();
    await ctx.userMappingRepository.saveMapping('user-123', ['+48123456789']);
    ctx.privateWhatsAppRepository.setAccount({
      id: 'user-123',
      userId: 'user-123',
      sourceAccountId: 'pbuchman-private-whatsapp',
      phoneNumberNormalized: '48123456789',
      displayName: '+48123456789',
      status: 'active',
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
      schemaVersion: 1,
    });
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

  function createSparseImagePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return createPayload({
      events: [
        {
          matrixRoomId: '!sparse-room:matrix.example',
          matrixEventId: '$event-sparse-image',
          matrixSenderId: '@sparse:matrix.example',
          eventTimestamp: '2026-06-22T11:00:00.000Z',
          chat: {
            type: 'unknown',
          },
          message: {
            direction: 'incoming',
            type: 'image',
            media: {
              mxcUri: 'mxc://matrix.example/sparse-image',
              mimeType: 'image/jpeg',
            },
          },
          rawMatrixEvent: {
            type: 'm.room.message',
            event_id: '$event-sparse-image',
          },
        },
      ],
      ...overrides,
    });
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

  it('uses the canonical account owner when adapter payload includes a stale user id', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({ userId: 'adapter-supplied-user' }),
    });

    expect(response.statusCode).toBe(200);
    expect(ctx.privateWhatsAppRepository.getAll()[0]?.userId).toBe('user-123');
  });

  it('rejects internal ingest for unknown private source accounts', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({ sourceAccountId: 'unknown-private-source' }),
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns a standard error envelope when private source account resolution fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private source account lookup failure',
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
          deliveryMode: '42',
          eventCount: 0,
          hasSourceAccountId: true,
          hasUserId: false,
        },
      })
    );
  });

  it('logs missing private sync delivery mode as unknown', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        sourceAccountId: 'pbuchman-private-whatsapp',
        events: [],
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
          hasSourceAccountId: true,
          hasUserId: false,
        },
      })
    );
  });

  it('requires bearer auth for public private WhatsApp account reads and writes', async () => {
    const getResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/account',
    });
    const putResponse = await ctx.app.inject({
      method: 'PUT',
      url: '/private/account',
      payload: { phoneNumber: '+48123456789' },
    });
    const deleteResponse = await ctx.app.inject({
      method: 'DELETE',
      url: '/private/account',
    });

    expect(getResponse.statusCode).toBe(401);
    expect(putResponse.statusCode).toBe(401);
    expect(deleteResponse.statusCode).toBe(401);
  });

  it('requires bearer auth for public private WhatsApp sender reads', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/senders',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires bearer auth for public private WhatsApp message reads', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages?senderKey=phone:%2B48123456789',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires bearer auth for public private WhatsApp chat reads', async () => {
    const chatsResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats',
    });
    const messagesResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats/chat-a/messages',
    });

    expect(chatsResponse.statusCode).toBe(401);
    expect(messagesResponse.statusCode).toBe(401);
  });

  it('requires bearer auth for public private WhatsApp sender-day reads', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/sender-days?senderKey=phone:%2B48123456789',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns not found for authenticated users without a private WhatsApp mirror', async () => {
    const token = await createToken({ sub: 'user-other' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/senders',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns not found for private WhatsApp chat reads without a mirror', async () => {
    const token = await createToken({ sub: 'user-other' });

    const chatsResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats',
      headers: { authorization: `Bearer ${token}` },
    });
    const messagesResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats/chat-a/messages',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(chatsResponse.statusCode).toBe(404);
    expect(messagesResponse.statusCode).toBe(404);
  });

  it('returns the authenticated user private WhatsApp mirror account', async () => {
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        userId?: string;
        sourceAccountId: string;
        phoneNumberNormalized: string;
        status: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      sourceAccountId: 'pbuchman-private-whatsapp',
      phoneNumberNormalized: '48123456789',
      status: 'active',
    });
    expect(body.data.userId).toBeUndefined();
  });

  it('returns null when the authenticated user has no private WhatsApp mirror account', async () => {
    const token = await createToken({ sub: 'user-without-private-mirror' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  it('returns a standard error envelope when loading the private WhatsApp account fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private account lookup failure',
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('rejects invalid private WhatsApp mirror account payloads after auth', async () => {
    const token = await createToken({ sub: 'user-123' });

    const missingPhone = await ctx.app.inject({
      method: 'PUT',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const invalidPhone = await ctx.app.inject({
      method: 'PUT',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
      payload: { phoneNumber: 'not-a-phone-number' },
    });

    expect(missingPhone.statusCode).toBe(400);
    expect(invalidPhone.statusCode).toBe(400);
  });

  it('returns a standard error envelope when connected phone lookup fails', async () => {
    ctx.userMappingRepository.setFailGetMapping(true);
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
      payload: { phoneNumber: '+48123456789' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns a standard error envelope when saving the private WhatsApp account fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private account write failure',
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
      payload: { phoneNumber: '+48123456789' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('creates a private WhatsApp mirror account from a connected phone number', async () => {
    await ctx.userMappingRepository.saveMapping('user-new', ['+48987654321']);
    const token = await createToken({ sub: 'user-new' });

    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
      payload: { phoneNumber: '+48987654321' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { sourceAccountId: string; phoneNumberNormalized: string; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      phoneNumberNormalized: '48987654321',
      status: 'active',
    });
    expect(body.data.sourceAccountId).toEqual(expect.any(String));
    expect(body.data.sourceAccountId).not.toBe('');
  });

  it('rejects private WhatsApp mirror enablement for phones not connected to the user', async () => {
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
      payload: { phoneNumber: '+48987654321' },
    });

    expect(response.statusCode).toBe(412);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PRECONDITION_FAILED');
  });

  it('disables the authenticated user private WhatsApp mirror account', async () => {
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('disabled');
  });

  it('returns not found when disabling a missing private WhatsApp mirror account', async () => {
    const token = await createToken({ sub: 'user-without-private-mirror' });

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns a standard error envelope when disabling the private WhatsApp account fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private account disable failure',
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: '/private/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns sanitized public private WhatsApp sender profiles for the configured source account', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    commonHttpState.logIncomingRequest.mockClear();
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/senders?limit=10',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        senders: {
          senderKey: string;
          senderDisplayName?: string;
          senderPhoneNumber?: string;
          messageCount: number;
        }[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.senders).toMatchObject([
      {
        senderKey: 'phone:+48123456789',
        senderDisplayName: 'Alice',
        senderPhoneNumber: '+48123456789',
        messageCount: 1,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('sourceAccountId');
    expect(JSON.stringify(body)).not.toContain('userId');
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyPreviewLength: 0,
        additionalFields: expect.objectContaining({
          route: 'whatsapp_private_senders_query',
          limit: 10,
        }),
      })
    );
    const logged = JSON.stringify(
      commonHttpState.logIncomingRequest.mock.calls.map(([, options]) => options)
    );
    expect(logged).not.toContain('Alice');
    expect(logged).not.toContain('+48123456789');
    expect(logged).not.toContain('phone:+48123456789');
  });

  it('paginates public private WhatsApp sender profiles and rejects invalid public sender filters', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            ...(createPayload()['events'] as Record<string, unknown>[])[0],
            matrixEventId: '$event-public-sender-2',
            matrixSenderId: '@bob:matrix.example',
            sender: {
              displayName: 'Bob',
              phoneNumber: '+48987654321',
            },
          },
        ],
      }),
    });
    const token = await createToken({ sub: 'user-123' });

    const firstPage = await ctx.app.inject({
      method: 'GET',
      url: '/private/senders?limit=1',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(firstPage.statusCode).toBe(200);
    const firstBody = JSON.parse(firstPage.body) as {
      data: { senders: { senderKey: string }[]; nextCursor?: string };
    };
    expect(firstBody.data.senders).toHaveLength(1);
    expect(firstBody.data.nextCursor).toEqual(expect.any(String));

    const secondPage = await ctx.app.inject({
      method: 'GET',
      url: `/private/senders?limit=1&cursor=${encodeURIComponent(firstBody.data.nextCursor ?? '')}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = JSON.parse(secondPage.body) as {
      data: { senders: { senderKey: string }[]; nextCursor?: string };
    };
    expect(secondBody.data.senders).toHaveLength(1);
    expect(secondBody.data.senders[0]?.senderKey).not.toBe(firstBody.data.senders[0]?.senderKey);

    const invalid = await ctx.app.inject({
      method: 'GET',
      url: '/private/senders?limit=abc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(invalid.statusCode).toBe(400);

    const rejectedSourceAccount = await ctx.app.inject({
      method: 'GET',
      url: '/private/senders?sourceAccountId=wrong-source',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rejectedSourceAccount.statusCode).toBe(400);
  });

  it('returns private WhatsApp chats and reads a whole group conversation by chat id', async () => {
    const groupEvents = [
      {
        ...(createPayload()['events'] as Record<string, unknown>[])[0],
        matrixRoomId: '!group-room:matrix.example',
        matrixEventId: '$group-piotrek',
        matrixSenderId: '@whatsapp_48536911713:home-dev',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
        chat: {
          type: 'group',
          displayName: 'Fishing Crew (WA)',
        },
        sender: {
          displayName: 'Piotrek (WA)',
          phoneNumber: '+48536911713',
        },
        message: {
          direction: 'incoming',
          type: 'text',
          text: 'Kto jedzie?',
        },
      },
      {
        ...(createPayload()['events'] as Record<string, unknown>[])[0],
        matrixRoomId: '!group-room:matrix.example',
        matrixEventId: '$group-monika',
        matrixSenderId: '@whatsapp_48517277952:home-dev',
        eventTimestamp: '2026-06-22T10:02:00.000Z',
        chat: {
          type: 'group',
          displayName: 'Fishing Crew (WA)',
        },
        sender: {
          displayName: 'Monika (WA)',
          phoneNumber: '+48517277952',
        },
        message: {
          direction: 'incoming',
          type: 'text',
          text: 'Ja moge.',
        },
      },
    ];
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({ events: groupEvents }),
    });
    const token = await createToken({ sub: 'user-123' });

    const chatsResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats?limit=10',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(chatsResponse.statusCode).toBe(200);
    const chatsBody = JSON.parse(chatsResponse.body) as {
      success: boolean;
      data: {
        chats: {
          id: string;
          chatType: string;
          displayName?: string;
          messageCount: number;
          participantCount: number;
        }[];
      };
    };
    expect(chatsBody.success).toBe(true);
    expect(chatsBody.data.chats).toMatchObject([
      {
        chatType: 'group',
        displayName: 'Fishing Crew (WA)',
        messageCount: 2,
        participantCount: 2,
      },
    ]);
    const chatId = chatsBody.data.chats[0]?.id;
    expect(chatId).toEqual(expect.any(String));

    const messagesResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/chats/${encodeURIComponent(chatId ?? '')}/messages?limit=10`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(messagesResponse.statusCode).toBe(200);
    const messagesBody = JSON.parse(messagesResponse.body) as {
      success: boolean;
      data: {
        messages: {
          text?: string;
          senderDisplayName?: string;
          senderPhoneNumber?: string;
          direction: string;
          chatDisplayName?: string;
          chatType?: string;
        }[];
      };
    };
    expect(messagesBody.success).toBe(true);
    expect(messagesBody.data.messages).toMatchObject([
      {
        text: 'Ja moge.',
        senderDisplayName: 'Monika (WA)',
        senderPhoneNumber: '+48517277952',
        direction: 'incoming',
        chatDisplayName: 'Fishing Crew (WA)',
        chatType: 'group',
      },
      {
        text: 'Kto jedzie?',
        senderDisplayName: 'Piotrek (WA)',
        senderPhoneNumber: '+48536911713',
        direction: 'incoming',
        chatDisplayName: 'Fishing Crew (WA)',
        chatType: 'group',
      },
    ]);
    expect(JSON.stringify(messagesBody)).not.toContain('sourceAccountId');
    expect(JSON.stringify(messagesBody)).not.toContain('rawMatrixEvent');
  });

  it('paginates private WhatsApp chats and rejects server-side public chat filters', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            ...(createPayload()['events'] as Record<string, unknown>[])[0],
            matrixRoomId: '!second-room:matrix.example',
            matrixEventId: '$event-second-chat',
            eventTimestamp: '2026-06-22T12:00:00.000Z',
            chat: {
              type: 'direct',
              displayName: 'Second Chat',
            },
          },
        ],
      }),
    });
    const token = await createToken({ sub: 'user-123' });

    const firstPage = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats?limit=1',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(firstPage.statusCode).toBe(200);
    const firstBody = JSON.parse(firstPage.body) as {
      data: { chats: { id: string }[]; nextCursor?: string };
    };
    expect(firstBody.data.chats).toHaveLength(1);
    expect(firstBody.data.nextCursor).toEqual(expect.any(String));

    const cursor = firstBody.data.nextCursor;
    const secondPage = await ctx.app.inject({
      method: 'GET',
      url: `/private/chats?limit=10&cursor=${encodeURIComponent(cursor ?? '')}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const sourceFilter = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats?sourceAccountId=wrong-source',
      headers: { authorization: `Bearer ${token}` },
    });
    const invalidLimit = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats?limit=0',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(secondPage.statusCode).toBe(200);
    expect(sourceFilter.statusCode).toBe(400);
    expect(invalidLimit.statusCode).toBe(400);
  });

  it('updates private WhatsApp chat transcription settings for the authenticated account', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    const token = await createToken({ sub: 'user-123' });
    const chatsResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats?limit=1',
      headers: { authorization: `Bearer ${token}` },
    });
    const chatsBody = JSON.parse(chatsResponse.body) as {
      data: { chats: { id: string; transcriptionEnabled?: boolean }[] };
    };
    const chatId = chatsBody.data.chats[0]?.id ?? '';
    expect(chatsBody.data.chats[0]?.transcriptionEnabled).toBeUndefined();

    const updateResponse = await ctx.app.inject({
      method: 'PATCH',
      url: `/private/chats/${encodeURIComponent(chatId)}/transcription`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });

    expect(updateResponse.statusCode).toBe(200);
    const updateBody = JSON.parse(updateResponse.body) as {
      success: boolean;
      data: {
        id: string;
        transcriptionEnabled?: boolean;
        transcriptionEnabledAt?: string;
        transcriptionUpdatedAt?: string;
      };
    };
    expect(updateBody.success).toBe(true);
    expect(updateBody.data).toMatchObject({
      id: chatId,
      transcriptionEnabled: true,
    });
    expect(updateBody.data.transcriptionEnabledAt).toEqual(expect.any(String));
    expect(updateBody.data.transcriptionUpdatedAt).toEqual(expect.any(String));

    const updatedChatsResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats?limit=1',
      headers: { authorization: `Bearer ${token}` },
    });
    const updatedChatsBody = JSON.parse(updatedChatsResponse.body) as {
      data: {
        chats: {
          id: string;
          transcriptionEnabled?: boolean;
          transcriptionEnabledAt?: string;
          transcriptionUpdatedAt?: string;
        }[];
      };
    };
    expect(updatedChatsBody.data.chats[0]).toMatchObject({
      id: chatId,
      transcriptionEnabled: true,
      transcriptionEnabledAt: updateBody.data.transcriptionEnabledAt,
      transcriptionUpdatedAt: updateBody.data.transcriptionUpdatedAt,
    });
  });

  it('requires auth before updating private WhatsApp chat transcription settings', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/private/chats/missing-chat/transcription',
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(401);
  });

  it('validates private WhatsApp chat transcription update bodies', async () => {
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/private/chats/missing-chat/transcription',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: 'yes' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns not found when updating transcription for a user without a private WhatsApp account', async () => {
    const token = await createToken({ sub: 'user-without-private-whatsapp' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/private/chats/missing-chat/transcription',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns not found when updating transcription for a missing private WhatsApp chat', async () => {
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/private/chats/missing-chat/transcription',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns internal error when updating private WhatsApp chat transcription settings fails', async () => {
    ctx.privateWhatsAppRepository.failNextChatTranscriptionUpdate({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated transcription setting update failure',
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/private/chats/missing-chat/transcription',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('publishes one private audio transcription job after chat transcription is enabled', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    const token = await createToken({ sub: 'user-123' });
    const chatsResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats?limit=1',
      headers: { authorization: `Bearer ${token}` },
    });
    const chatsBody = JSON.parse(chatsResponse.body) as { data: { chats: { id: string }[] } };
    const chatId = chatsBody.data.chats[0]?.id ?? '';
    const updateResponse = await ctx.app.inject({
      method: 'PATCH',
      url: `/private/chats/${encodeURIComponent(chatId)}/transcription`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });
    expect(updateResponse.statusCode).toBe(200);

    const audioPayload = createPayload({
      events: [
        {
          ...(createPayload()['events'] as Record<string, unknown>[])[0],
          matrixEventId: '$event-private-audio',
          message: {
            direction: 'incoming',
            type: 'audio',
            media: {
              mxcUri: 'mxc://home-dev/private-audio',
              mimeType: 'audio/ogg',
              storageStatus: 'stored',
              gcsPath: 'whatsapp/private/user-123/private-audio/audio.ogg',
              storedMimeType: 'audio/ogg',
              storedSizeBytes: 2048,
            },
          },
        },
      ],
    });

    const firstIngest = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: audioPayload,
    });
    const duplicateIngest = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: audioPayload,
    });

    expect(firstIngest.statusCode).toBe(200);
    expect(duplicateIngest.statusCode).toBe(200);
    expect(ctx.eventPublisher.getAudioStoredEvents()).toEqual([
      {
        type: 'whatsapp.audio.stored',
        messageSource: 'private_whatsapp',
        userId: 'user-123',
        messageId: 'message:pbuchman-private-whatsapp:$event-private-audio',
        mediaId: 'mxc://home-dev/private-audio',
        gcsPath: 'whatsapp/private/user-123/private-audio/audio.ogg',
        mimeType: 'audio/ogg',
        timestamp: expect.any(String),
      },
    ]);
  });

  it('publishes one private video transcription job after chat transcription is enabled', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    const token = await createToken({ sub: 'user-123' });
    const chatsResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats?limit=1',
      headers: { authorization: `Bearer ${token}` },
    });
    const chatsBody = JSON.parse(chatsResponse.body) as { data: { chats: { id: string }[] } };
    const chatId = chatsBody.data.chats[0]?.id ?? '';
    const updateResponse = await ctx.app.inject({
      method: 'PATCH',
      url: `/private/chats/${encodeURIComponent(chatId)}/transcription`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });
    expect(updateResponse.statusCode).toBe(200);

    const videoPayload = createPayload({
      events: [
        {
          ...(createPayload()['events'] as Record<string, unknown>[])[0],
          matrixEventId: '$event-private-video',
          message: {
            direction: 'incoming',
            type: 'video',
            media: {
              mxcUri: 'mxc://home-dev/private-video',
              mimeType: 'video/mp4',
              storageStatus: 'stored',
              gcsPath: 'whatsapp/private/user-123/private-video/video.mp4',
              storedMimeType: 'video/mp4',
              storedSizeBytes: 4096,
            },
          },
        },
      ],
    });

    const firstIngest = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: videoPayload,
    });
    const duplicateIngest = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: videoPayload,
    });

    expect(firstIngest.statusCode).toBe(200);
    expect(duplicateIngest.statusCode).toBe(200);
    expect(ctx.eventPublisher.getMediaTranscriptionRequestedEvents()).toEqual([
      {
        type: 'whatsapp.media.transcription.requested',
        messageSource: 'private_whatsapp',
        mediaKind: 'video',
        userId: 'user-123',
        messageId: 'message:pbuchman-private-whatsapp:$event-private-video',
        mediaId: 'mxc://home-dev/private-video',
        gcsPath: 'whatsapp/private/user-123/private-video/video.mp4',
        mimeType: 'video/mp4',
        timestamp: expect.any(String),
      },
    ]);
  });

  it('returns stored private WhatsApp message transcription state in chat messages', async () => {
    const ingestResponse = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            ...(createPayload()['events'] as Record<string, unknown>[])[0],
            matrixEventId: '$event-transcribed-audio',
            message: {
              direction: 'incoming',
              type: 'audio',
              media: {
                mxcUri: 'mxc://home-dev/transcribed-audio',
                mimeType: 'audio/ogg',
                storageStatus: 'stored',
                gcsPath: 'whatsapp/private/user-123/transcribed-audio/audio.ogg',
              },
            },
          },
        ],
      }),
    });
    const ingestBody = JSON.parse(ingestResponse.body) as {
      data: { messages: { chatId?: string; messageId?: string }[] };
    };
    const chatId = ingestBody.data.messages[0]?.chatId ?? '';
    const messageId = ingestBody.data.messages[0]?.messageId ?? '';
    const updateResult = await ctx.privateWhatsAppRepository.updateMessageTranscription({
      userId: 'user-123',
      messageId,
      transcription: {
        status: 'completed',
        jobId: 'job-private-api',
        text: 'Timeline transcript.',
        detectedLanguage: 'en',
        completedAt: '2026-06-28T10:10:00.000Z',
      },
    });
    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) throw new Error(updateResult.error.message);
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/private/chats/${encodeURIComponent(chatId)}/messages?limit=10`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: {
        messages: {
          id: string;
          transcription?: {
            status: string;
            jobId?: string;
            text?: string;
            detectedLanguage?: string;
            completedAt?: string;
          };
        }[];
      };
    };
    expect(body.data.messages[0]).toMatchObject({
      id: messageId,
      transcription: {
        status: 'completed',
        jobId: 'job-private-api',
        text: 'Timeline transcript.',
        detectedLanguage: 'en',
        completedAt: '2026-06-28T10:10:00.000Z',
      },
    });
    expect(JSON.stringify(body)).not.toContain('sourceAccountId');
    expect(JSON.stringify(body)).not.toContain('rawMatrixEvent');
  });

  it('returns standard errors when private WhatsApp chat data queries fail', async () => {
    const token = await createToken({ sub: 'user-123' });
    ctx.privateWhatsAppRepository.failNextDataQuery({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private chat query failure',
    });
    const chatsResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats',
      headers: { authorization: `Bearer ${token}` },
    });
    ctx.privateWhatsAppRepository.failNextDataQuery({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private chat message query failure',
    });
    const messagesResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats/chat-a/messages',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(chatsResponse.statusCode).toBe(500);
    expect(messagesResponse.statusCode).toBe(500);
  });

  it('filters private WhatsApp chat messages by day and rejects server-side public message filters', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            ...(createPayload()['events'] as Record<string, unknown>[])[0],
            matrixEventId: '$event-day-one',
            eventTimestamp: '2026-06-22T10:00:00.000Z',
          },
          {
            ...(createPayload()['events'] as Record<string, unknown>[])[0],
            matrixEventId: '$event-day-two',
            eventTimestamp: '2026-06-23T10:00:00.000Z',
            message: {
              direction: 'incoming',
              type: 'text',
              text: 'next day',
            },
          },
        ],
      }),
    });
    const token = await createToken({ sub: 'user-123' });
    const chatsResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats?limit=1',
      headers: { authorization: `Bearer ${token}` },
    });
    const chatsBody = JSON.parse(chatsResponse.body) as {
      data: { chats: { id: string }[] };
    };
    const chatId = chatsBody.data.chats[0]?.id ?? '';

    const dayResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/chats/${encodeURIComponent(chatId)}/messages?eventDayKey=2026-06-23&limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    const firstMessagePage = await ctx.app.inject({
      method: 'GET',
      url: `/private/chats/${encodeURIComponent(chatId)}/messages?limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    const firstMessagePageBody = JSON.parse(firstMessagePage.body) as {
      data: { nextCursor?: string };
    };
    const secondMessagePage = await ctx.app.inject({
      method: 'GET',
      url: `/private/chats/${encodeURIComponent(chatId)}/messages?limit=10&cursor=${encodeURIComponent(
        firstMessagePageBody.data.nextCursor ?? ''
      )}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const sourceFilter = await ctx.app.inject({
      method: 'GET',
      url: `/private/chats/${encodeURIComponent(chatId)}/messages?sourceAccountId=wrong-source`,
      headers: { authorization: `Bearer ${token}` },
    });
    const invalidLimit = await ctx.app.inject({
      method: 'GET',
      url: `/private/chats/${encodeURIComponent(chatId)}/messages?limit=0`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(dayResponse.statusCode).toBe(200);
    expect(firstMessagePage.statusCode).toBe(200);
    expect(firstMessagePageBody.data.nextCursor).toEqual(expect.any(String));
    expect(secondMessagePage.statusCode).toBe(200);
    const dayBody = JSON.parse(dayResponse.body) as {
      data: { messages: { text?: string }[]; nextCursor?: string };
    };
    expect(dayBody.data.messages).toMatchObject([{ text: 'next day' }]);
    expect(dayBody.data.nextCursor).toBeUndefined();
    expect(sourceFilter.statusCode).toBe(400);
    expect(invalidLimit.statusCode).toBe(400);
  });

  it('returns a standard error envelope when public private sender query fails', async () => {
    ctx.privateWhatsAppRepository.failNextDataQuery({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated private sender query failure',
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/senders',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns sanitized public private WhatsApp messages without source internals', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    commonHttpState.logIncomingRequest.mockClear();
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages?senderKey=phone:%2B48123456789&eventDayKey=2026-06-22&limit=20',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { messages: { text?: string; rawMatrixEvent?: unknown }[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.messages).toMatchObject([
      {
        text: 'hello from private whatsapp',
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('rawMatrixEvent');
    expect(JSON.stringify(body)).not.toContain('sourceAccountId');
    expect(JSON.stringify(body)).not.toContain('userId');
    const logged = JSON.stringify(
      commonHttpState.logIncomingRequest.mock.calls.map(([, options]) => options)
    );
    expect(logged).not.toContain('hello from private whatsapp');
    expect(logged).not.toContain('+48123456789');
    expect(logged).not.toContain('phone:+48123456789');
  });

  it('paginates public private WhatsApp messages and returns media metadata without text', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            ...(createPayload()['events'] as Record<string, unknown>[])[0],
            matrixEventId: '$event-public-message-2',
            eventTimestamp: '2026-06-22T11:00:00.000Z',
            message: {
              direction: 'incoming',
              type: 'text',
              text: 'newer private whatsapp text',
            },
          },
        ],
      }),
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createSparseImagePayload(),
    });
    const token = await createToken({ sub: 'user-123' });

    const firstPage = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages?senderKey=phone:%2B48123456789&limit=1',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(firstPage.statusCode).toBe(200);
    const firstBody = JSON.parse(firstPage.body) as {
      data: { messages: { text?: string }[]; nextCursor?: string };
    };
    expect(firstBody.data.messages).toHaveLength(1);
    expect(firstBody.data.nextCursor).toEqual(expect.any(String));

    const secondPage = await ctx.app.inject({
      method: 'GET',
      url:
        '/private/messages?senderKey=phone:%2B48123456789&limit=1&cursor=' +
        encodeURIComponent(firstBody.data.nextCursor ?? ''),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = JSON.parse(secondPage.body) as {
      data: { messages: { text?: string }[]; nextCursor?: string };
    };
    expect(secondBody.data.messages).toHaveLength(1);

    const mediaResponse = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages?senderKey=matrix:%40sparse:matrix.example&limit=10',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mediaResponse.statusCode).toBe(200);
    const mediaBody = JSON.parse(mediaResponse.body) as {
      data: { messages: { media?: { mimeType?: string }; text?: string; senderDisplayName?: string }[] };
    };
    expect(mediaBody.data.messages).toMatchObject([
      {
        media: {
          mimeType: 'image/jpeg',
        },
      },
    ]);
    expect(mediaBody.data.messages[0]).not.toHaveProperty('text');
    expect(mediaBody.data.messages[0]).not.toHaveProperty('senderDisplayName');
  });

  it('rejects sourceAccountId on public private WhatsApp message queries', async () => {
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages?senderKey=phone:%2B48123456789&sourceAccountId=wrong-source',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('projects stored private image media without leaking GCS paths to the browser', async () => {
    const token = await createToken({ sub: 'user-123' });
    await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: 'pbuchman-private-whatsapp',
      userId: 'user-123',
      deliveryMode: 'live',
      receivedAt: '2026-06-26T10:00:01.000Z',
      chat: {
        matrixRoomId: '!sparse-room:matrix.example',
        type: 'unknown',
      },
      message: {
        matrixRoomId: '!sparse-room:matrix.example',
        matrixEventId: '$event-stored-image',
        matrixSenderId: '@sparse:matrix.example',
        senderKey: 'matrix:@sparse:matrix.example',
        direction: 'incoming',
        type: 'image',
        media: {
          mxcUri: 'mxc://matrix.example/stored-image',
          mimeType: 'image/jpeg',
          storageStatus: 'stored',
          gcsPath: 'whatsapp/private/user/message/image.jpg',
          thumbnailGcsPath: 'whatsapp/private/user/message/image_thumb.jpg',
          storedMimeType: 'image/jpeg',
          storedSizeBytes: 11,
          storedAt: '2026-06-26T10:00:00.000Z',
          width: 1280,
          height: 720,
          durationMs: 3456,
        },
        eventTimestamp: '2026-06-22T11:00:00.000Z',
        rawMatrixEvent: {},
      },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/chats',
      headers: { authorization: `Bearer ${token}` },
    });
    const chatsBody = JSON.parse(response.body) as { data: { chats: { id: string }[] } };
    const chatId = chatsBody.data.chats[0]?.id;
    expect(chatId).toBeDefined();

    const messagesResponse = await ctx.app.inject({
      method: 'GET',
      url: `/private/chats/${String(chatId)}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(messagesResponse.statusCode).toBe(200);
    const body = JSON.parse(messagesResponse.body) as {
      data: { messages: { media?: PublicPrivateWhatsAppMediaDto }[] };
    };
    expect(body.data.messages[0]?.media).toMatchObject({
      mxcUri: 'mxc://matrix.example/stored-image',
      mimeType: 'image/jpeg',
      width: 1280,
      height: 720,
      durationMs: 3456,
      storageStatus: 'stored',
      hasMedia: true,
      hasThumbnail: true,
      storedMimeType: 'image/jpeg',
      storedSizeBytes: 11,
    });
    expect(JSON.stringify(body.data.messages[0]?.media)).not.toContain('gcsPath');
    expect(JSON.stringify(body.data.messages[0]?.media)).not.toContain('whatsapp/private');
  });

  it('rejects invalid public private WhatsApp message filters after owner auth', async () => {
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages?senderKey=phone:%2B48123456789&limit=abc',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns a standard error envelope when public private message account lookup fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated public private message account lookup failure',
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages?senderKey=phone:%2B48123456789',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns a standard error envelope when public private message query fails', async () => {
    ctx.privateWhatsAppRepository.failNextDataQuery({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated public private message query failure',
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/messages?senderKey=phone:%2B48123456789',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns public sender-day aggregates without raw message text', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/sender-days?senderKey=phone:%2B48123456789&limit=10',
      headers: { authorization: `Bearer ${token}` },
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
    expect(JSON.stringify(body)).not.toContain('sourceAccountId');
    expect(JSON.stringify(body)).not.toContain('userId');
  });

  it('paginates public sender-day aggregates and rejects invalid public sender-day filters', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            ...(createPayload()['events'] as Record<string, unknown>[])[0],
            matrixEventId: '$event-next-day-public',
            eventTimestamp: '2026-06-23T11:00:00.000Z',
          },
        ],
      }),
    });
    const token = await createToken({ sub: 'user-123' });

    const firstPage = await ctx.app.inject({
      method: 'GET',
      url: '/private/sender-days?senderKey=phone:%2B48123456789&fromDay=2026-06-22&toDay=2026-06-23&limit=1',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(firstPage.statusCode).toBe(200);
    const firstBody = JSON.parse(firstPage.body) as {
      data: { senderDays: { eventDayKey: string }[]; nextCursor?: string };
    };
    expect(firstBody.data.senderDays).toHaveLength(1);
    expect(firstBody.data.nextCursor).toEqual(expect.any(String));

    const secondPage = await ctx.app.inject({
      method: 'GET',
      url:
        '/private/sender-days?senderKey=phone:%2B48123456789&limit=1&cursor=' +
        encodeURIComponent(firstBody.data.nextCursor ?? ''),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = JSON.parse(secondPage.body) as {
      data: { senderDays: { eventDayKey: string }[]; nextCursor?: string };
    };
    expect(secondBody.data.senderDays).toHaveLength(1);
    expect(secondBody.data.senderDays[0]?.eventDayKey).not.toBe(
      firstBody.data.senderDays[0]?.eventDayKey
    );

    const invalid = await ctx.app.inject({
      method: 'GET',
      url: '/private/sender-days?senderKey=phone:%2B48123456789&limit=abc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(invalid.statusCode).toBe(400);

    const rejectedSourceAccount = await ctx.app.inject({
      method: 'GET',
      url: '/private/sender-days?senderKey=phone:%2B48123456789&sourceAccountId=wrong-source',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rejectedSourceAccount.statusCode).toBe(400);
  });

  it('returns not found when public sender-day reads have no private WhatsApp mirror', async () => {
    const token = await createToken({ sub: 'user-without-private-mirror' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/sender-days?senderKey=phone:%2B48123456789',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns a standard error envelope when public sender-day query fails', async () => {
    ctx.privateWhatsAppRepository.failNextDataQuery({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated public private sender-day query failure',
    });
    const token = await createToken({ sub: 'user-123' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/private/sender-days?senderKey=phone:%2B48123456789',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns a standard error envelope when private message persistence fails', async () => {
    ctx.privateWhatsAppRepository.failNextStore({
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

  it('exports sanitized direct-chat conversation context for the active private account', async () => {
    const textResponse = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    expect(textResponse.statusCode).toBe(200);
    const audioResponse = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            matrixRoomId: '!room:matrix.example',
            matrixEventId: '$event-audio',
            matrixSenderId: '@user:matrix.example',
            eventTimestamp: '2026-06-22T10:05:00.000Z',
            chat: { type: 'direct', displayName: 'Alice' },
            sender: { displayName: 'Me' },
            message: {
              direction: 'outgoing',
              type: 'audio',
              media: {
                mxcUri: 'mxc://matrix.example/private-audio',
                mimeType: 'audio/ogg',
              },
            },
            rawMatrixEvent: {
              type: 'm.room.message',
              content: { url: 'mxc://matrix.example/private-audio' },
            },
          },
        ],
      }),
    });
    expect(audioResponse.statusCode).toBe(200);
    const audioMessagesResult = await ctx.privateWhatsAppRepository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 10,
    });
    expect(audioMessagesResult.ok).toBe(true);
    if (!audioMessagesResult.ok) throw new Error(audioMessagesResult.error.message);
    const audioMessage = audioMessagesResult.value.messages.find(
      (message) => message.matrixEventId === '$event-audio'
    );
    if (audioMessage === undefined) throw new Error('Expected audio message');
    await ctx.privateWhatsAppRepository.updateMessageTranscription({
      userId: 'user-123',
      messageId: audioMessage.id,
      transcription: {
        status: 'completed',
        text: 'Transcribed private voice note',
        completedAt: '2026-06-22T10:06:00.000Z',
      },
    });

    commonHttpState.logIncomingRequest.mockClear();
    const chatId = audioMessage.chatId;
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        chatId,
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
        maxMessages: 20,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: {
        chat: { id: string; displayName?: string; chatType: string; messageCount: number };
        messages: {
          id: string;
          speakerLabel: string;
          contentKind: string;
          content: string;
          matrixEventId?: string;
          media?: unknown;
          rawMatrixEvent?: unknown;
          sourceAccountId?: string;
        }[];
        omitted: Record<string, number>;
        messageCount: number;
        transcriptSha256: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.chat).toMatchObject({
      id: chatId,
      displayName: 'Alice',
      chatType: 'direct',
      messageCount: 2,
    });
    expect(body.data.messages).toEqual([
      expect.objectContaining({
        speakerLabel: 'Alice',
        contentKind: 'text',
        content: 'hello from private whatsapp',
      }),
      expect.objectContaining({
        speakerLabel: 'You',
        contentKind: 'transcription',
        content: 'Transcribed private voice note',
      }),
    ]);
    expect(body.data.omitted).toEqual({
      mediaOnly: 0,
      failedTranscriptions: 0,
      pendingTranscriptions: 0,
      nonText: 0,
      overLimit: 0,
    });
    expect(body.data.messageCount).toBe(2);
    expect(body.data.transcriptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body.data)).not.toContain('mxc://matrix.example/private-audio');
    expect(JSON.stringify(body.data)).not.toContain('sourceAccountId');
    expect(JSON.stringify(body.data)).not.toContain('rawMatrixEvent');
    expect(JSON.stringify(body.data)).not.toContain('matrixEventId');
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyPreviewLength: 0,
        additionalFields: expect.objectContaining({
          route: 'internal_whatsapp_private_conversation_context',
          hasUserId: true,
          hasChatId: true,
        }),
      })
    );
    expect(JSON.stringify(commonHttpState.logIncomingRequest.mock.calls)).not.toContain(
      'hello from private whatsapp'
    );
  });

  it('reports the full conversation context over-limit count', async () => {
    for (let index = 0; index < 7; index += 1) {
      const timestamp = `2026-06-22T10:0${String(index)}:00.000Z`;
      const isLeadingMedia = index < 2;
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/whatsapp/private/events',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: createPayload({
          events: [
            {
              matrixRoomId: '!room:matrix.example',
              matrixEventId: `$event-over-limit-${String(index)}`,
              matrixSenderId: '@alice:matrix.example',
              eventTimestamp: timestamp,
              chat: { type: 'direct', displayName: 'Alice' },
              sender: { displayName: 'Alice' },
              message: isLeadingMedia
                ? {
                    direction: 'incoming',
                    type: 'image',
                    media: { mxcUri: `mxc://matrix.example/leading-${String(index)}` },
                  }
                : {
                    direction: 'incoming',
                    type: 'text',
                    text: `message ${String(index)}`,
                  },
              rawMatrixEvent: { type: 'm.room.message' },
            },
          ],
        }),
      });
      expect(response.statusCode).toBe(200);
    }
    const messagesResult = await ctx.privateWhatsAppRepository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 10,
    });
    expect(messagesResult.ok).toBe(true);
    if (!messagesResult.ok) throw new Error(messagesResult.error.message);
    const chatId = messagesResult.value.messages[0]?.chatId;
    if (chatId === undefined) throw new Error('Expected chat id');

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        chatId,
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
        maxMessages: 2,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      success: boolean;
      data: { messages: unknown[]; omitted: { overLimit: number } };
    };
    expect(body.success).toBe(true);
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.omitted.overLimit).toBe(3);
  });

  it('rejects conversation context requests without internal auth', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      payload: {
        userId: 'user-123',
        chatId: 'chat-123',
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T10:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('validates conversation context time ranges and limits', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        chatId: 'chat-123',
        from: '2026-06-22T10:00:00.000Z',
        to: '2026-06-22T10:00:00.000Z',
        maxMessages: 0,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects conversation context ranges where from is not before to', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        chatId: 'chat-123',
        from: '2026-06-22T10:00:00.000Z',
        to: '2026-06-22T10:00:00.000Z',
        maxMessages: 1,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects group chats for conversation context export', async () => {
    const ingest = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload({
        events: [
          {
            matrixRoomId: '!group:matrix.example',
            matrixEventId: '$group-event',
            matrixSenderId: '@alice:matrix.example',
            eventTimestamp: '2026-06-22T10:00:00.000Z',
            chat: { type: 'group', displayName: 'Group Chat' },
            sender: { displayName: 'Alice' },
            message: { direction: 'incoming', type: 'text', text: 'group secret' },
            rawMatrixEvent: { type: 'm.room.message' },
          },
        ],
      }),
    });
    expect(ingest.statusCode).toBe(200);
    const messagesResult = await ctx.privateWhatsAppRepository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 10,
    });
    expect(messagesResult.ok).toBe(true);
    if (!messagesResult.ok) throw new Error(messagesResult.error.message);
    const storedMessage = messagesResult.value.messages.find(
      (message) => message.matrixEventId === '$group-event'
    );
    if (storedMessage === undefined) throw new Error('Expected group message');

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        chatId: storedMessage.chatId,
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('logs non-object conversation context bodies without inspecting contents', async () => {
    commonHttpState.logIncomingRequest.mockClear();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(400);
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'internal_whatsapp_private_conversation_context',
          bodyType: 'undefined',
        },
      })
    );
  });

  it('returns not found when exporting conversation context without an active account', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'missing-user',
        chatId: 'chat-123',
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns standard errors when conversation context account lookup fails', async () => {
    ctx.privateWhatsAppRepository.failNext({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated conversation context account lookup failure',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        chatId: 'chat-123',
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns not found when exporting conversation context for an unknown chat', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        chatId: 'missing-chat',
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns standard errors when conversation context chat lookup fails', async () => {
    ctx.privateWhatsAppRepository.failNextDataQuery({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated conversation context chat lookup failure',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        chatId: 'chat-123',
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns standard errors when conversation context message lookup fails', async () => {
    const ingest = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/events',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: createPayload(),
    });
    expect(ingest.statusCode).toBe(200);
    const messagesResult = await ctx.privateWhatsAppRepository.findMessages({
      sourceAccountId: 'pbuchman-private-whatsapp',
      limit: 10,
    });
    expect(messagesResult.ok).toBe(true);
    if (!messagesResult.ok) throw new Error(messagesResult.error.message);
    const chatId = messagesResult.value.messages[0]?.chatId;
    if (chatId === undefined) throw new Error('Expected chat id');
    ctx.privateWhatsAppRepository.failNextConversationContextQuery({
      code: 'PERSISTENCE_ERROR',
      message: 'Simulated conversation context message lookup failure',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/conversation-context',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        userId: 'user-123',
        chatId,
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
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
