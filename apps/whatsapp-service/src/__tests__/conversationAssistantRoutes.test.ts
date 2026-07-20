import { getServices, setServices } from '../services.js';
import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';
import type { ConversationAssistantRepository } from '../domain/conversation-assistant/ports.js';
import {
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  type ConversationAssistantDateRange,
} from '@intexuraos/llm-contract';

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

  async function storeMessage(input: {
    eventTimestamp: string;
    matrixEventId: string;
    text: string;
  }): Promise<void> {
    await ctx.privateWhatsAppRepository.storeIncomingMessage({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      userId: USER_ID,
      deliveryMode: 'backfill',
      receivedAt: input.eventTimestamp,
      chat: { matrixRoomId: '!direct', type: 'direct', displayName: 'Alice' },
      message: {
        matrixRoomId: '!direct',
        matrixEventId: input.matrixEventId,
        matrixSenderId: '@alice:matrix.example',
        senderDisplayName: 'Alice',
        senderKey: 'phone:+48111111111',
        direction: 'incoming',
        type: 'text',
        text: input.text,
        eventTimestamp: input.eventTimestamp,
        rawMatrixEvent: {},
      },
    });
  }

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
    await storeMessage({
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      matrixEventId: '$event-1',
      text: 'We agreed to meet at 17:00.',
    });
    return await createToken({ sub: USER_ID });
  }

  async function createSessionWithFirstTurn(token: string): Promise<string> {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'request-shell',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(created.statusCode).toBe(202);
    const sessionId = (JSON.parse(created.body) as { data: { session: { id: string } } }).data
      .session.id;
    await prepareSession(sessionId);

    const firstTurn = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'What was agreed?' },
    });
    expect(firstTurn.statusCode).toBe(201);
    return sessionId;
  }

  async function prepareSession(sessionId: string): Promise<void> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/internal/whatsapp/pubsub/process-webhook',
      headers: { 'x-internal-auth': 'test-internal-token' },
      payload: {
        message: {
          data: Buffer.from(
            JSON.stringify({
              type: 'whatsapp.conversation-assistant.prepare',
              sessionId,
              userId: USER_ID,
              attempt: 1,
            })
          ).toString('base64'),
          messageId: `prepare-${sessionId}`,
          publishTime: '2026-06-30T12:00:00.000Z',
        },
        subscription: 'projects/test/subscriptions/whatsapp-webhook-process',
      },
    });
    expect(response.statusCode).toBe(200);
  }

  it('creates a shell session without exposing transcriptText', async () => {
    const token = await seed();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'request-shell',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body) as {
      data: {
        session: {
          id: string;
          effectiveRange: ConversationAssistantDateRange;
          transcriptText?: string;
          assistantRoleLabel: string;
          model: string;
          modelDisplayName: string;
          status: string;
          preparationStage: string;
        };
      };
    };
    expect(body.data.session.transcriptText).toBeUndefined();
    expect(body.data.session.assistantRoleLabel).toBe('Assistant');
    expect(body.data.session.effectiveRange).toEqual({
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(body.data.session.model).toBe(DEFAULT_CONVERSATION_ASSISTANT_MODEL);
    expect(body.data.session.modelDisplayName).toBe('MiniMax M3');
    expect(body.data.session.status).toBe('preparing');
    expect(body.data.session.preparationStage).toBe('queued');
    expect(JSON.stringify(body)).not.toContain('We agreed to meet');
    expect(JSON.stringify(body)).not.toContain('transcriptText');
    expect(body.data).not.toHaveProperty('turns');
    expect(ctx.eventPublisher.getConversationAssistantPreparationEvents()).toEqual([
      {
        type: 'whatsapp.conversation-assistant.prepare',
        sessionId: body.data.session.id,
        userId: USER_ID,
        attempt: 1,
      },
    ]);

    const contextBeforeReady = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${body.data.session.id}/context`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(contextBeforeReady.statusCode).toBe(400);
    expect(JSON.parse(contextBeforeReady.body).error.message).toBe(
      'Conversation context is not ready yet'
    );
  });

  it('does not expose internal preparation bookkeeping in public session DTOs', async () => {
    const token = await seed();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'request-private-bookkeeping',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        maxMessages: 10,
      },
    });
    expect(created.statusCode).toBe(202);
    const sessionId = (JSON.parse(created.body) as { data: { session: { id: string } } }).data
      .session.id;
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    await ctx.conversationAssistantRepository.saveSession({
      ...stored,
      preparationClaimId: 'private-claim',
      preparationLeaseExpiresAt: '2026-06-30T12:05:00.000Z',
      contextSnapshotId: 'private-snapshot',
    });

    const responses = await Promise.all([
      ctx.app.inject({
        method: 'GET',
        url: `/conversation-assistant/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${token}` },
      }),
      ctx.app.inject({
        method: 'GET',
        url: '/conversation-assistant/sessions',
        headers: { authorization: `Bearer ${token}` },
      }),
      ctx.app.inject({
        method: 'GET',
        url: '/conversation-assistant/session-requests/request-private-bookkeeping',
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('transcriptText');
      expect(response.body).not.toContain('creationRequestId');
      expect(response.body).not.toContain('maxMessages');
      expect(response.body).not.toContain('preparationClaimId');
      expect(response.body).not.toContain('preparationLeaseExpiresAt');
      expect(response.body).not.toContain('contextSnapshotId');
    }
  });

  it('returns the same analysis for repeated requests and recovers it by request id', async () => {
    const token = await seed();
    const payload = {
      requestId: 'request-idempotent-route',
      chatId: CHAT_ID,
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    };

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    const repeated = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(first.statusCode).toBe(202);
    expect(repeated.statusCode).toBe(202);
    const firstSession = (JSON.parse(first.body) as { data: { session: { id: string } } }).data
      .session;
    const repeatedSession = (
      JSON.parse(repeated.body) as { data: { session: { id: string } } }
    ).data.session;
    expect(repeatedSession.id).toBe(firstSession.id);

    const recovered = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/session-requests/${payload.requestId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(recovered.statusCode).toBe(200);
    const recoveredSession = (
      JSON.parse(recovered.body) as {
        data: { session: { id: string; creationRequestId?: string } };
      }
    ).data.session;
    expect(recoveredSession.id).toBe(firstSession.id);
    expect(recoveredSession.creationRequestId).toBeUndefined();

    const missingRecovery = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/session-requests/missing-request',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missingRecovery.statusCode).toBe(404);
    expect(JSON.parse(missingRecovery.body).error.code).toBe('NOT_FOUND');

    const listed = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      (JSON.parse(listed.body) as { data: { sessions: { id: string }[] } }).data.sessions
    ).toHaveLength(1);
  });

  it('surfaces a failed preparation enqueue and lets the user retry it', async () => {
    const token = await seed();
    ctx.eventPublisher.setConversationAssistantPreparationFailure('Queue unavailable');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'request-enqueue-retry',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });

    expect(created.statusCode).toBe(202);
    const failedSession = (
      JSON.parse(created.body) as {
        data: {
          session: {
            id: string;
            status: string;
            preparationStage: string;
            preparationAttempt: number;
            preparationError: { message: string };
          };
        };
      }
    ).data.session;
    expect(failedSession).toMatchObject({
      status: 'failed',
      preparationStage: 'failed',
      preparationAttempt: 1,
      preparationError: { message: 'Queue unavailable' },
    });

    ctx.eventPublisher.setConversationAssistantPreparationFailure(null);
    const retried = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${failedSession.id}/preparation/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(retried.statusCode).toBe(202);
    expect(JSON.parse(retried.body).data.session).toMatchObject({
      id: failedSession.id,
      status: 'preparing',
      preparationStage: 'queued',
      preparationAttempt: 2,
    });
    expect(JSON.parse(retried.body).data.session).not.toHaveProperty('preparationError');
    expect(ctx.eventPublisher.getConversationAssistantPreparationEvents()).toEqual([
      {
        type: 'whatsapp.conversation-assistant.prepare',
        sessionId: failedSession.id,
        userId: USER_ID,
        attempt: 2,
      },
    ]);

    const repeatedRetry = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${failedSession.id}/preparation/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(repeatedRetry.statusCode).toBe(400);
    expect(JSON.parse(repeatedRetry.body).error).toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'Conversation context is already preparing',
    });
  });

  it('rejects a first message in the session-creation request', async () => {
    const token = await seed();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'request-reject-question',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        question: 'This belongs to the conversation view.',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('persists a selected model and returns its display name in public session DTOs', async () => {
    const token = await seed();

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'request-model',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        model: 'or:anthropic/claude-sonnet-5',
      },
    });

    expect(created.statusCode).toBe(202);
    const createdBody = JSON.parse(created.body) as {
      data: { session: { id: string; model: string; modelDisplayName: string } };
    };
    expect(createdBody.data.session.model).toBe('or:anthropic/claude-sonnet-5');
    expect(createdBody.data.session.modelDisplayName).toBe('Claude Sonnet 5');

    const fetched = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(fetched.statusCode).toBe(200);
    expect(JSON.parse(fetched.body).data.session).toMatchObject({
      model: 'or:anthropic/claude-sonnet-5',
      modelDisplayName: 'Claude Sonnet 5',
    });
  });

  it('creates an analysis, then accepts its first message in a separate request', async () => {
    const token = await seed();
    await storeMessage({
      eventTimestamp: '2026-06-30T10:05:00.000Z',
      matrixEventId: '$event-2',
      text: 'Second message that should be truncated.',
    });

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'request-first-turn',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        maxMessages: 1,
      },
    });

    expect(created.statusCode).toBe(202);
    const createdBody = JSON.parse(created.body) as {
      data: {
        session: {
          id: string;
          effectiveRange: ConversationAssistantDateRange;
          transcriptText?: string;
          assistantRoleLabel: string;
        };
      };
    };
    expect(createdBody.data).not.toHaveProperty('turns');
    expect(createdBody.data.session.assistantRoleLabel).toBe('Assistant');
    expect(createdBody.data.session.effectiveRange).toEqual({
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(createdBody.data.session.transcriptText).toBeUndefined();
    expect(JSON.stringify(createdBody)).not.toContain('transcriptText');
    await prepareSession(createdBody.data.session.id);
    const context = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/context`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(context.statusCode).toBe(200);
    expect(JSON.parse(context.body).data).toMatchObject({
      sessionId: createdBody.data.session.id,
      messageCount: 1,
      omittedMessageCount: 1,
      snapshotAvailable: true,
      messages: [
        {
          speakerLabel: 'Alice',
          content: 'We agreed to meet at 17:00.',
          contentKind: 'text',
        },
      ],
      omittedMessages: [
        {
          omissionReason: 'over_limit',
          content: 'Second message that should be truncated.',
        },
      ],
      omitted: { overLimit: 1 },
    });
    const exhaustedContext = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/context?messageCursor=1&omittedCursor=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(exhaustedContext.statusCode).toBe(200);
    expect(JSON.parse(exhaustedContext.body).data).toMatchObject({
      messages: [],
      omittedMessages: [],
    });
    const firstTurn = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        question: 'Can a lawyer explain what these messages mean for my lease dispute?',
      },
    });
    expect(firstTurn.statusCode).toBe(201);
    expect(
      JSON.parse(firstTurn.body).data.turns.map((turn: { role: string }) => turn.role)
    ).toEqual(['user', 'assistant']);
    expect(ctx.llmClient.chatCalls[0]?.options.sessionId).toBe(createdBody.data.session.id);

    const listed = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    const fetched = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const turns = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listed.statusCode).toBe(200);
    expect(fetched.statusCode).toBe(200);
    expect(turns.statusCode).toBe(200);
    expect(JSON.parse(listed.body).data.sessions[0].effectiveRange).toEqual({
      from: '2026-06-30T10:00:00.000Z',
      to: '2026-06-30T10:00:00.000Z',
    });
    expect(JSON.parse(listed.body).data.sessions[0].transcriptText).toBeUndefined();
    expect(JSON.parse(listed.body).data.sessions[0].assistantRoleLabel).toBe('Assistant');
    expect(JSON.stringify(JSON.parse(listed.body).data.sessions)).not.toContain('We agreed to meet');
    expect(JSON.parse(fetched.body).data.session.effectiveRange).toEqual({
      from: '2026-06-30T10:00:00.000Z',
      to: '2026-06-30T10:00:00.000Z',
    });
    expect(JSON.parse(fetched.body).data.session.transcriptText).toBeUndefined();
    expect(JSON.parse(fetched.body).data.session.assistantRoleLabel).toBe('Assistant');
    expect(JSON.parse(turns.body).data.turns).toHaveLength(2);
  });

  it('does not require the PDF exporter for non-export Conversation Assistant routes', async () => {
    const token = await seed();
    const { pdfConversationExporter: _pdfConversationExporter, ...servicesWithoutPdfExporter } =
      getServices();
    setServices(servicesWithoutPdfExporter);

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('exports a PDF snapshot with binary headers and a session-scoped filename', async () => {
    const token = await seed();
    const sessionId = await createSessionWithFirstTurn(token);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="alice-context-${sessionId}.pdf"`
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
    expect(ctx.pdfConversationExporter.calls[0]?.sourceRange).toEqual({
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(ctx.pdfConversationExporter.calls[0]?.effectiveRange).toEqual({
      from: '2026-06-30T10:00:00.000Z',
      to: '2026-06-30T10:00:00.000Z',
    });
  });

  it('rejects unauthenticated, missing, and foreign PDF export requests', async () => {
    const token = await seed();
    const sessionId = await createSessionWithFirstTurn(token);

    const unauthenticated = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/export.pdf`,
    });
    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions/whatsapp_conv_session_missing/export.pdf',
      headers: { authorization: `Bearer ${token}` },
    });
    const foreignToken = await createToken({ sub: 'other-user' });
    const foreign = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/export.pdf`,
      headers: { authorization: `Bearer ${foreignToken}` },
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(missing.statusCode).toBe(404);
    expect(foreign.statusCode).toBe(404);
  });

  it('maps PDF exporter failures to internal errors', async () => {
    const token = await seed();
    const sessionId = await createSessionWithFirstTurn(token);
    ctx.pdfConversationExporter.failNext('pdf render failed');

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'pdf render failed',
    });
  });

  it('requires the PDF exporter for PDF export requests', async () => {
    const token = await seed();
    const sessionId = await createSessionWithFirstTurn(token);
    const { pdfConversationExporter: _pdfConversationExporter, ...servicesWithoutPdfExporter } =
      getServices();
    setServices(servicesWithoutPdfExporter);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Conversation Assistant services are not configured',
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
        requestId: 'request-invalid-range',
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

  it('rejects unsupported Conversation Assistant models at session creation', async () => {
    const token = await seed();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'request-invalid-model',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        model: 'or:unknown/model',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'Unsupported Conversation Assistant model',
    });
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
        requestId: 'request-invalid-max',
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
        requestId: 'request-turns',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(created.statusCode).toBe(202);
    const createdBody = JSON.parse(created.body) as { data: { session: { id: string } } };
    await prepareSession(createdBody.data.session.id);

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
        requestId: 'request-empty-range',
        chatId: CHAT_ID,
        from: '2026-06-29T00:00:00.000Z',
        to: '2026-06-29T01:00:00.000Z',
      },
    });
    expect(emptyTranscript.statusCode).toBe(202);
    const emptySessionId = (JSON.parse(emptyTranscript.body) as {
      data: { session: { id: string } };
    }).data.session.id;
    await prepareSession(emptySessionId);
    const failedSession = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${emptySessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(failedSession.body).data.session).toMatchObject({
      status: 'failed',
      preparationStage: 'failed',
      preparationError: { code: 'EMPTY_TRANSCRIPT' },
    });
  });

  it('applies auth guards and dependency checks on every conversation assistant route', async () => {
    const token = await seed();
    const unauthenticatedRequests = [
      { method: 'POST' as const, url: '/conversation-assistant/sessions', payload: {} },
      { method: 'POST' as const, url: '/conversation-assistant/context/check', payload: {} },
      { method: 'GET' as const, url: '/conversation-assistant/session-requests/missing' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/context' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/export.pdf' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/turns' },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/preparation/retry',
      },
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
          requestId: 'request-misconfigured',
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
      { method: 'GET' as const, url: '/conversation-assistant/session-requests/missing' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/context' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/export.pdf' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/turns' },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/preparation/retry',
      },
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
      createSessionIfAbsent: (session) =>
        ctx.conversationAssistantRepository.createSessionIfAbsent(session),
      getSessionById: (sessionId) =>
        ctx.conversationAssistantRepository.getSessionById(sessionId),
      getSessionSnapshotById: (input) =>
        ctx.conversationAssistantRepository.getSessionSnapshotById(input),
      listSessionsByUserId: () => {
        throw new Error('list failed');
      },
      claimPreparation: (input) =>
        ctx.conversationAssistantRepository.claimPreparation(input),
      saveClaimedPreparationSession: (input) =>
        ctx.conversationAssistantRepository.saveClaimedPreparationSession(input),
      requeueFailedPreparation: (input) =>
        ctx.conversationAssistantRepository.requeueFailedPreparation(input),
      failQueuedPreparation: (input) =>
        ctx.conversationAssistantRepository.failQueuedPreparation(input),
      saveContextSnapshot: (sessionId, userId, snapshotId, snapshot) =>
        ctx.conversationAssistantRepository.saveContextSnapshot(
          sessionId,
          userId,
          snapshotId,
          snapshot
        ),
      deleteContextSnapshot: (sessionId, userId, snapshotId) =>
        ctx.conversationAssistantRepository.deleteContextSnapshot(
          sessionId,
          userId,
          snapshotId
        ),
      getContextPage: (sessionId, snapshotId, input) =>
        ctx.conversationAssistantRepository.getContextPage(sessionId, snapshotId, input),
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
