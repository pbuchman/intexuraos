import { getServices, setServices } from '../services.js';
import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';
import type { ConversationAssistantRepository } from '../domain/conversation-assistant/ports.js';

const USER_ID = 'user-123';
const SOURCE_ACCOUNT_ID = 'source-123';
const CHAT_ID = `chat:${SOURCE_ACCOUNT_ID}:!direct`;

function parseSseEvents(body: string): { event: string; data: unknown }[] {
  return body
    .trim()
    .split('\n\n')
    .map((frame) => {
      const event = frame
        .split('\n')
        .find((line) => line.startsWith('event: '))
        ?.slice('event: '.length);
      const data = frame
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);
      if (event === undefined || data === undefined) {
        throw new Error(`Invalid SSE frame: ${frame}`);
      }
      return { event, data: JSON.parse(data) as unknown };
    });
}

describe('Conversation Assistant routes', () => {
  const ctx = setupTestContext();

  async function seed(): Promise<string> {
    ctx.privateWhatsAppRepository.setAccount({
      id: USER_ID,
      userId: USER_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      phoneNumberNormalized: '48123456789',
      displayName: '+48123456789',
      status: 'active',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      schemaVersion: 1,
    });
    await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      userId: USER_ID,
      deliveryMode: 'backfill',
      receivedAt: '2026-06-30T10:00:00.000Z',
      chat: { matrixRoomId: '!direct', type: 'direct', displayName: 'Alice' },
      message: {
        matrixRoomId: '!direct',
        matrixEventId: '$event-1',
        matrixSenderId: '@alice:matrix.example',
        senderDisplayName: 'Alice',
        senderKey: 'phone:+48111111111',
        direction: 'incoming',
        type: 'text',
        text: 'We agreed to meet at 17:00.',
        eventTimestamp: '2026-06-30T10:00:00.000Z',
        rawMatrixEvent: {},
      },
    });
    return await createToken({ sub: USER_ID });
  }

  it('creates a shell session without exposing transcriptText', async () => {
    const token = await seed();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as {
      data: { session: { id: string; transcriptText?: string }; turns: unknown[] };
    };
    expect(body.data.session.transcriptText).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('We agreed to meet');
    expect(body.data.turns).toEqual([]);
  });

  it('creates first turns, lists sessions, and lists turns', async () => {
    const token = await seed();

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        maxMessages: 10,
        question: 'What was agreed?',
      },
    });

    expect(created.statusCode).toBe(201);
    const createdBody = JSON.parse(created.body) as {
      data: { session: { id: string }; turns: { role: string }[] };
    };
    expect(createdBody.data.turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(ctx.llmClient.chatCalls[0]?.options.sessionId).toBe(createdBody.data.session.id);

    const listed = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    const turns = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listed.statusCode).toBe(200);
    expect(turns.statusCode).toBe(200);
    expect(JSON.parse(listed.body).data.sessions[0].transcriptText).toBeUndefined();
    expect(JSON.stringify(JSON.parse(listed.body).data.sessions)).not.toContain('We agreed to meet');
    expect(JSON.parse(turns.body).data.turns).toHaveLength(2);
  });

  it('exports a PDF snapshot with binary headers and a session-scoped filename', async () => {
    const token = await seed();

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        question: 'What was agreed?',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = JSON.parse(created.body) as { data: { session: { id: string } } };

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="alice-context-${createdBody.data.session.id}.pdf"`
    );
    expect(response.body).toBe('%PDF-test');
    expect(ctx.pdfConversationExporter.calls).toHaveLength(1);
    expect(ctx.pdfConversationExporter.calls[0]?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(ctx.pdfConversationExporter.calls[0]?.messageCounts).toEqual({
      included: 1,
      excluded: 0,
    });
  });

  it('rejects unauthenticated, missing, and foreign PDF export requests', async () => {
    const token = await seed();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = JSON.parse(created.body) as { data: { session: { id: string } } };

    const unauthenticated = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/export.pdf`,
    });
    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions/whatsapp_conv_session_missing/export.pdf',
      headers: { authorization: `Bearer ${token}` },
    });
    const foreignToken = await createToken({ sub: 'other-user' });
    const foreign = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/export.pdf`,
      headers: { authorization: `Bearer ${foreignToken}` },
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(missing.statusCode).toBe(404);
    expect(foreign.statusCode).toBe(404);
  });

  it('maps PDF exporter failures to internal errors', async () => {
    const token = await seed();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = JSON.parse(created.body) as { data: { session: { id: string } } };
    ctx.pdfConversationExporter.failNext('pdf render failed');

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'pdf render failed',
    });
  });

  it('checks selected context size before creating a session', async () => {
    const token = await seed();

    const checked = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/context/check',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });

    expect(checked.statusCode).toBe(200);
    expect(JSON.parse(checked.body).data).toEqual({
      messageCount: 1,
      warningThreshold: 5000,
      requiresConfirmation: false,
    });

    const invalidBody = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/context/check',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(invalidBody.statusCode).toBe(400);

    const invalidRange = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/context/check',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-06-30T00:00:00.000Z',
      },
    });
    expect(invalidRange.statusCode).toBe(400);
    expect(JSON.parse(invalidRange.body).error.code).toBe('INVALID_REQUEST');
  });

  it('rejects invalid ranges and foreign session access', async () => {
    const token = await seed();
    const invalid = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-06-30T00:00:00.000Z',
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(JSON.parse(invalid.body).error.code).toBe('INVALID_REQUEST');

    const foreignToken = await createToken({ sub: 'other-user' });
    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions/whatsapp_conv_session_missing',
      headers: { authorization: `Bearer ${foreignToken}` },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects unauthenticated, invalid, and misconfigured session requests', async () => {
    const unauthenticated = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const token = await seed();
    const invalid = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        maxMessages: 0,
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(JSON.parse(invalid.body).error.code).toBe('INVALID_REQUEST');

    const { conversationAssistantRepository: _repository, ...misconfiguredServices } = getServices();
    setServices(misconfiguredServices);
    const misconfigured = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(misconfigured.statusCode).toBe(500);
  });

  it('gets sessions, sends follow-up turns, and maps domain errors', async () => {
    const token = await seed();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = JSON.parse(created.body) as { data: { session: { id: string } } };

    const fetched = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(fetched.statusCode).toBe(200);
    expect(JSON.parse(fetched.body).data.session.transcriptText).toBeUndefined();
    expect(JSON.stringify(JSON.parse(fetched.body).data.session)).not.toContain('We agreed to meet');

    const foreignToken = await createToken({ sub: 'other-user' });
    const foreignTurns = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns`,
      headers: { authorization: `Bearer ${foreignToken}` },
    });
    expect(foreignTurns.statusCode).toBe(404);

    const invalidTurn = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(invalidTurn.statusCode).toBe(400);

    const emptyTurn = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: '   ' },
    });
    expect(emptyTurn.statusCode).toBe(400);
    expect(JSON.parse(emptyTurn.body).error.code).toBe('INVALID_REQUEST');

    const sent = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'What was agreed?' },
    });
    expect(sent.statusCode).toBe(201);
    expect(JSON.parse(sent.body).data.turns.map((turn: { role: string }) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);

    ctx.llmClient.setNextStreamEvents([
      { type: 'delta', text: 'streamed ' },
      { type: 'delta', text: 'answer' },
    ]);
    const streamed = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Stream this.' },
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers['content-type']).toContain('text/event-stream');
    const events = parseSseEvents(streamed.body);
    expect(events.map((event) => event.event)).toEqual([
      'user_turn',
      'assistant_delta',
      'assistant_delta',
      'assistant_turn',
      'done',
    ]);
    expect(ctx.llmClient.streamChatCalls[0]?.options.sessionId).toBe(
      createdBody.data.session.id
    );

    const invalidStreamBody = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(invalidStreamBody.statusCode).toBe(400);

    const missingStreamSession = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions/whatsapp_conv_session_missing/turns/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Hello?' },
    });
    expect(missingStreamSession.statusCode).toBe(200);
    const missingStreamEvents = parseSseEvents(missingStreamSession.body);
    expect(missingStreamEvents.map((event) => event.event)).toEqual(['error', 'done']);
    expect(missingStreamEvents[0]?.data).toMatchObject({
      type: 'error',
      error: { code: 'NOT_FOUND' },
    });

    const emptyTranscript = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId: CHAT_ID,
        from: '2026-06-29T00:00:00.000Z',
        to: '2026-06-29T01:00:00.000Z',
      },
    });
    expect(emptyTranscript.statusCode).toBe(400);
    expect(JSON.parse(emptyTranscript.body).error.code).toBe('EMPTY_TRANSCRIPT');
  });

  it('applies auth guards and dependency checks on every conversation assistant route', async () => {
    const token = await seed();
    const unauthenticatedRequests = [
      { method: 'POST' as const, url: '/conversation-assistant/sessions', payload: {} },
      { method: 'POST' as const, url: '/conversation-assistant/context/check', payload: {} },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/export.pdf' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/turns' },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turns',
        payload: { question: 'hello' },
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turns/stream',
        payload: { question: 'hello' },
      },
    ];

    for (const request of unauthenticatedRequests) {
      const response = await ctx.app.inject(request);
      expect(response.statusCode).toBe(401);
    }

    const { conversationAssistantRepository: _repository, ...misconfiguredServices } = getServices();
    setServices(misconfiguredServices);
    const misconfiguredRequests = [
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions',
        payload: {
          chatId: CHAT_ID,
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/context/check',
        payload: {
          chatId: CHAT_ID,
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
      },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/export.pdf' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/turns' },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turns',
        payload: { question: 'hello' },
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turns/stream',
        payload: { question: 'hello' },
      },
    ];

    for (const request of misconfiguredRequests) {
      const response = await ctx.app.inject({
        ...request,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(500);
    }
  });

  it('maps repository exceptions from route safe calls to internal errors', async () => {
    const token = await seed();
    const throwingRepository: ConversationAssistantRepository = {
      saveSession: (session) => ctx.conversationAssistantRepository.saveSession(session),
      getSessionById: (sessionId) =>
        ctx.conversationAssistantRepository.getSessionById(sessionId),
      getSessionSnapshotById: (sessionId) =>
        ctx.conversationAssistantRepository.getSessionSnapshotById(sessionId),
      listSessionsByUserId: () => {
        throw new Error('list failed');
      },
      saveTurn: (turn) => ctx.conversationAssistantRepository.saveTurn(turn),
      listTurnsBySessionId: (sessionId) =>
        ctx.conversationAssistantRepository.listTurnsBySessionId(sessionId),
    };
    setServices({
      ...getServices(),
      conversationAssistantRepository: throwingRepository,
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error.code).toBe('INTERNAL_ERROR');
  });
});
