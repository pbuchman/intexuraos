import { vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';

const commonHttpState = vi.hoisted(() => ({
  logIncomingRequest: vi.fn(),
}));

vi.mock('@intexuraos/common-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intexuraos/common-http')>();
  return { ...actual, logIncomingRequest: commonHttpState.logIncomingRequest };
});

import { beforeEach, describe, expect, it, setupTestContext } from './testUtils.js';
import { getServices, setServices, type ServiceContainer } from '../services.js';
import type { PrivateDigestSourceTokenCodec } from '../domain/whatsapp/ports/privateWhatsAppDigestSourceRepository.js';
import type { PrivateWhatsAppDigestSourceRepository } from '../domain/whatsapp/ports/privateWhatsAppDigestSourceRepository.js';
import type {
  PrivateWhatsAppAccount,
  PrivateWhatsAppChat,
  PrivateWhatsAppMessage,
} from '../domain/whatsapp/models/PrivateWhatsApp.js';
import { privateDigestSourceBodyUsesAllowlist } from '../routes/privateDigestSourceRoutes.js';

const INTERNAL_HEADERS = { 'x-internal-auth': 'test-internal-token' } as const;
const CUTOVER_HEADERS = {
  ...INTERNAL_HEADERS,
  'x-internal-caller-role': 'message_digest_cutover_verifier',
} as const;

const account: PrivateWhatsAppAccount = {
  id: 'account-1',
  userId: 'user-1',
  sourceAccountId: 'source-1',
  generationId: 'generation-1',
  phoneNumberNormalized: '+48000000000',
  displayName: 'Primary',
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
  schemaVersion: 1,
};

const chat: PrivateWhatsAppChat = {
  id: 'chat-1',
  userId: 'user-1',
  sourceAccountId: 'source-1',
  matrixRoomId: '!private-room:example.invalid',
  chatType: 'group',
  displayName: 'Fishing group',
  messageCount: 12,
  participantCount: 4,
  firstSeenAt: '2026-07-01T00:00:00.000Z',
  lastEventAt: '2026-07-27T11:00:00.000Z',
  updatedAt: '2026-07-27T11:00:00.000Z',
};

const storedMessage: PrivateWhatsAppMessage = {
  id: 'private-message-id',
  chatId: 'chat-1',
  userId: 'user-1',
  sourceAccountId: 'source-1',
  matrixRoomId: '!private-room:example.invalid',
  matrixEventId: '$private-event',
  matrixSenderId: '@private-sender:example.invalid',
  senderDisplayName: 'Alice',
  senderPhoneNumber: '+48111111111',
  senderKey: 'private-sender-key',
  direction: 'incoming',
  messageType: 'text',
  text: 'Visible summary input',
  eventTimestamp: '2026-07-27T10:00:00.000Z',
  receivedAt: '2026-07-27T10:00:01.000Z',
  ingestedAt: '2026-07-27T10:00:02.000Z',
  deliveryMode: 'live',
  contextState: 'visible',
  rawMatrixEvent: { privatePayload: 'must-not-leak' },
};

const queryPayload = {
  userId: 'user-1',
  sourceAccountId: 'source-1',
  generationId: 'generation-1',
  chatId: 'chat-1',
  chatType: 'group' as const,
  windowStart: '2026-07-27T00:00:00.000Z',
  windowEnd: '2026-07-28T00:00:00.000Z',
  limit: 50,
};

describe('private WhatsApp digest source routes', () => {
  const ctx = setupTestContext();
  const queryMessages = vi.fn<PrivateWhatsAppDigestSourceRepository['queryMessages']>();
  const tokens: PrivateDigestSourceTokenCodec = {
    issueSourceRevision: vi.fn().mockReturnValue(ok('opaque-source-revision')),
    issueHighWatermark: vi.fn().mockReturnValue(ok('opaque-high-watermark')),
    issueCursor: vi.fn().mockReturnValue(ok('opaque-cursor')),
    readCursor: vi
      .fn()
      .mockReturnValue(err({ code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' })),
    createMessageRef: vi.fn().mockReturnValue('opaque-message-reference'),
  };

  beforeEach(() => {
    commonHttpState.logIncomingRequest.mockClear();
    queryMessages.mockReset().mockResolvedValue(
      ok({
        messages: [storedMessage],
        sourceRevision: 'opaque-source-revision',
        highWatermark: 'opaque-high-watermark',
        nextCursor: null,
      })
    );
    vi.spyOn(ctx.privateWhatsAppRepository, 'getAccountByUserId').mockResolvedValue(ok(account));
    vi.spyOn(ctx.privateWhatsAppRepository, 'getChatById').mockResolvedValue(ok(chat));
    vi.spyOn(ctx.privateWhatsAppRepository, 'findChats').mockResolvedValue(ok({ chats: [chat] }));
    vi.spyOn(ctx.privateWhatsAppRepository, 'getConversationContextJournalHead').mockResolvedValue(
      ok(7)
    );
    setServices({
      ...getServices(),
      privateWhatsAppDigestSourceRepository: { queryMessages },
      privateDigestSourceTokens: tokens,
    } as ServiceContainer & {
      privateWhatsAppDigestSourceRepository: PrivateWhatsAppDigestSourceRepository;
      privateDigestSourceTokens: PrivateDigestSourceTokenCodec;
    });
  });

  it('requires internal auth without invoking any private source dependency', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/validate',
      payload: { userId: 'user-1', chatId: 'chat-1' },
    });

    expect(response.statusCode).toBe(401);
    expect(ctx.privateWhatsAppRepository.getAccountByUserId).not.toHaveBeenCalled();
    expect(queryMessages).not.toHaveBeenCalled();
  });

  it('validates an owned group and returns only the safe source projection', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/validate',
      headers: INTERNAL_HEADERS,
      payload: {
        userId: 'user-1',
        chatId: 'chat-1',
        expectedGenerationId: 'generation-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toEqual({
      sourceAccountId: 'source-1',
      generationId: 'generation-1',
      chatId: 'chat-1',
      chatType: 'group',
      displayName: 'Fishing group',
      messageCount: 12,
      participantCount: 4,
      lastActivityAt: '2026-07-27T11:00:00.000Z',
      sourceRevision: 'opaque-source-revision',
    });
    expect(response.body).not.toContain('!private-room');
    expect(response.body).not.toContain('+48000000000');
    expect(commonHttpState.logIncomingRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bodyPreviewLength: 0 })
    );
  });

  it('resolves one exact migration group only for the cutover caller role', async () => {
    const forbidden = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/migration-binding/resolve',
      headers: INTERNAL_HEADERS,
      payload: { userId: 'user-1', expectedDisplayName: 'Fishing group' },
    });

    expect(forbidden.statusCode).toBe(401);
    expect(ctx.privateWhatsAppRepository.findChats).not.toHaveBeenCalled();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/migration-binding/resolve',
      headers: CUTOVER_HEADERS,
      payload: { userId: 'user-1', expectedDisplayName: '  Fishing gro\u0075p  ' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toEqual({
      sourceAccountId: 'source-1',
      generationId: 'generation-1',
      chatId: 'chat-1',
      displayName: 'Fishing group',
    });
    expect(response.body).not.toContain('+48000000000');
    expect(response.body).not.toContain('!private-room');
    expect(commonHttpState.logIncomingRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ bodyPreviewLength: 0 })
    );
  });

  it.each([
    {
      name: 'missing chat',
      setup: (): void => {
        vi.mocked(ctx.privateWhatsAppRepository.getChatById).mockResolvedValueOnce(ok(null));
      },
      status: 404,
      code: 'NOT_FOUND',
    },
    {
      name: 'foreign chat',
      setup: (): void => {
        vi.mocked(ctx.privateWhatsAppRepository.getChatById).mockResolvedValueOnce(
          ok({ ...chat, userId: 'foreign-user' })
        );
      },
      status: 404,
      code: 'NOT_FOUND',
    },
    {
      name: 'stale generation',
      setup: (): void => undefined,
      status: 409,
      code: 'SOURCE_CHANGED',
      generation: 'stale-generation',
    },
  ])('maps $name to a stable safe response', async (scenario) => {
    scenario.setup();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/validate',
      headers: INTERNAL_HEADERS,
      payload: {
        userId: 'user-1',
        chatId: 'chat-1',
        expectedGenerationId: scenario.generation ?? 'generation-1',
      },
    });

    expect(response.statusCode).toBe(scenario.status);
    expect(JSON.parse(response.body).error.code).toBe(scenario.code);
    expect(ctx.privateWhatsAppRepository.getAccountByUserId).toHaveBeenCalledWith('user-1');
    if (scenario.name !== 'stale generation') {
      expect(ctx.privateWhatsAppRepository.getChatById).toHaveBeenCalled();
    }
    expect(response.body).not.toContain('foreign-user');
    expect(response.body).not.toContain('stale-generation');
  });

  it('returns a paged safe message projection and forwards every snapshot fence', async () => {
    const payload = {
      userId: 'user-1',
      sourceAccountId: 'source-1',
      generationId: 'generation-1',
      chatId: 'chat-1',
      chatType: 'group',
      windowStart: '2026-07-27T00:00:00.000Z',
      windowEnd: '2026-07-28T00:00:00.000Z',
      limit: 50,
      cursor: 'incoming-opaque-cursor',
    };
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/messages/query',
      headers: INTERNAL_HEADERS,
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(queryMessages).toHaveBeenCalledWith(payload);
    expect(JSON.parse(response.body).data).toEqual({
      messages: [
        {
          messageRef: 'opaque-message-reference',
          eventTimestamp: '2026-07-27T10:00:00.000Z',
          direction: 'inbound',
          authorLabel: 'Alice',
          text: 'Visible summary input',
          contentKind: 'text',
        },
      ],
      sourceRevision: 'opaque-source-revision',
      highWatermark: 'opaque-high-watermark',
      nextCursor: null,
    });
    const serialized = response.body;
    expect(serialized).not.toContain('private-message-id');
    expect(serialized).not.toContain('$private-event');
    expect(serialized).not.toContain('@private-sender');
    expect(serialized).not.toContain('+48111111111');
    expect(serialized).not.toContain('must-not-leak');
  });

  it('returns SOURCE_CHANGED with no page data when a paging fence conflicts', async () => {
    queryMessages.mockResolvedValueOnce(
      err({ code: 'SOURCE_CHANGED', message: 'private mutation detail' })
    );
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/messages/query',
      headers: INTERNAL_HEADERS,
      payload: {
        userId: 'user-1',
        sourceAccountId: 'source-1',
        generationId: 'generation-1',
        chatId: 'chat-1',
        chatType: 'group',
        windowStart: '2026-07-27T00:00:00.000Z',
        windowEnd: '2026-07-28T00:00:00.000Z',
        limit: 50,
        cursor: 'stale-cursor',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe('SOURCE_CHANGED');
    expect(response.body).not.toContain('private mutation detail');
    expect(response.body).not.toContain('messages');
  });

  it('maps migration discovery failures without exposing dependency details', async () => {
    vi.mocked(ctx.privateWhatsAppRepository.findChats).mockResolvedValueOnce(
      err({ code: 'PERSISTENCE_ERROR', message: 'private migration storage detail' })
    );
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/migration-binding/resolve',
      headers: CUTOVER_HEADERS,
      payload: { userId: 'user-1', expectedDisplayName: 'Fishing group' },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error.code).toBe('INTERNAL_ERROR');
    expect(response.body).not.toContain('private migration storage detail');
  });

  it('requires query auth and fails safely when private source tokens are not configured', async () => {
    const unauthorized = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/messages/query',
      payload: queryPayload,
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(queryMessages).not.toHaveBeenCalled();

    const unconfigured = { ...getServices() } as Partial<ServiceContainer>;
    delete unconfigured.privateDigestSourceTokens;
    setServices(unconfigured as ServiceContainer);

    const validateResponse = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/validate',
      headers: INTERNAL_HEADERS,
      payload: { userId: 'user-1', chatId: 'chat-1' },
    });
    expect(validateResponse.statusCode).toBe(500);
    expect(JSON.parse(validateResponse.body).error.code).toBe('INTERNAL_ERROR');

    const queryResponse = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/messages/query',
      headers: INTERNAL_HEADERS,
      payload: queryPayload,
    });
    expect(queryResponse.statusCode).toBe(500);
    expect(JSON.parse(queryResponse.body).error.code).toBe('INTERNAL_ERROR');
    expect(queryMessages).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'VALIDATION_ERROR' as const, status: 400, responseCode: 'INVALID_REQUEST' },
    { code: 'INTERNAL_ERROR' as const, status: 500, responseCode: 'INTERNAL_ERROR' },
    { code: 'ALREADY_VERIFIED' as const, status: 500, responseCode: 'INTERNAL_ERROR' },
    { code: 'COOLDOWN_ACTIVE' as const, status: 500, responseCode: 'INTERNAL_ERROR' },
    { code: 'RATE_LIMIT_EXCEEDED' as const, status: 500, responseCode: 'INTERNAL_ERROR' },
  ])('maps $code to a stable content-free query response', async (scenario) => {
    queryMessages.mockResolvedValueOnce(
      err({ code: scenario.code, message: `private ${scenario.code} detail` })
    );
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/private/digest-source/messages/query',
      headers: INTERNAL_HEADERS,
      payload: queryPayload,
    });

    expect(response.statusCode).toBe(scenario.status);
    expect(JSON.parse(response.body).error.code).toBe(scenario.responseCode);
    expect(response.body).not.toContain(`private ${scenario.code} detail`);
  });

  it('rejects missing, malformed, array, and additional-field raw bodies', () => {
    const allowedKeys = new Set(['userId']);
    expect(privateDigestSourceBodyUsesAllowlist(undefined, allowedKeys)).toBe(false);
    expect(privateDigestSourceBodyUsesAllowlist('{', allowedKeys)).toBe(false);
    expect(privateDigestSourceBodyUsesAllowlist('[]', allowedKeys)).toBe(false);
    expect(
      privateDigestSourceBodyUsesAllowlist(
        JSON.stringify({ userId: 'user-1', privateExtra: true }),
        allowedKeys
      )
    ).toBe(false);
    expect(
      privateDigestSourceBodyUsesAllowlist(JSON.stringify({ userId: 'user-1' }), allowedKeys)
    ).toBe(true);
  });

  it.each([
    {
      url: '/internal/whatsapp/private/digest-source/validate',
      payload: { userId: 'user-1', chatId: 'chat-1', unexpected: true },
    },
    {
      url: '/internal/whatsapp/private/digest-source/migration-binding/resolve',
      payload: {
        userId: 'user-1',
        expectedDisplayName: 'Fishing group',
        unexpected: true,
      },
      headers: CUTOVER_HEADERS,
    },
    {
      url: '/internal/whatsapp/private/digest-source/messages/query',
      payload: {
        userId: 'user-1',
        sourceAccountId: 'source-1',
        generationId: 'generation-1',
        chatId: 'chat-1',
        chatType: 'group',
        windowStart: '2026-07-27T00:00:00.000Z',
        windowEnd: '2026-07-28T00:00:00.000Z',
        limit: 50,
        unexpected: true,
      },
    },
  ])('rejects additional private body fields for $url', async ({ url, payload, headers }) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url,
      headers: headers ?? INTERNAL_HEADERS,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('INVALID_REQUEST');
  });
});
