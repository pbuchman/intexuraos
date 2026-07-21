import { getServices, setServices } from '../services.js';
import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';
import type { ConversationAssistantRepository } from '../domain/conversation-assistant/ports.js';
import {
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  type ConversationAssistantDateRange,
} from '@intexuraos/llm-contract';
import type {
  ConversationAssistantContextAttachment,
  ConversationAssistantContextAttachmentPreparedSnapshot,
} from '../domain/conversation-assistant/types.js';
import { fakePreparedContextAttachmentSnapshot } from './fakes.js';
import { vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import {
  conversationAssistantContextAttachmentCreateBodyUsesPublicAllowlist,
  conversationAssistantTurnBodyUsesPublicAllowlist,
  endConversationAssistantSse,
  initializeLegacyDurableTurnState,
  writeLegacyTurnSseEvent,
  writeTurnRequestSseEvent,
} from '../routes/conversationAssistantRoutes.js';

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

const FORBIDDEN_PUBLIC_CONVERSATION_ASSISTANT_FIELDS = new Set([
  'userId',
  'chatId',
  'sourceAccountId',
  'sourceAccountGeneration',
  'sessionGenerationId',
  'generationId',
  'transcriptSha256',
  'deltaTranscriptSha256',
  'previousContextChainSha256',
  'resultingContextChainSha256',
  'contextChainSha256',
  'requestFingerprint',
  'preparationRequestFingerprint',
  'preparationClaimId',
  'claimId',
  'contextSnapshotId',
  'snapshotId',
]);

function expectPublicConversationAssistantPayload(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) expectPublicConversationAssistantPayload(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    expect(
      FORBIDDEN_PUBLIC_CONVERSATION_ASSISTANT_FIELDS.has(key),
      `Public Conversation Assistant payload exposed ${key}`
    ).toBe(false);
    expectPublicConversationAssistantPayload(child);
  }
}

function fakeSseReply(input: { destroyed?: boolean; writableEnded?: boolean } = {}): {
  reply: FastifyReply;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const write = vi.fn(() => true);
  const end = vi.fn();
  return {
    reply: {
      raw: {
        destroyed: input.destroyed ?? false,
        writableEnded: input.writableEnded ?? false,
        write,
        end,
      },
    } as unknown as FastifyReply,
    write,
    end,
  };
}

describe('Conversation Assistant route helpers', () => {
  it('accepts only valid JSON objects with public request fields', () => {
    expect(conversationAssistantTurnBodyUsesPublicAllowlist(undefined)).toBe(false);
    expect(conversationAssistantTurnBodyUsesPublicAllowlist('{"question":')).toBe(false);
    expect(
      conversationAssistantTurnBodyUsesPublicAllowlist(
        '{"requestId":"turn-1","question":"What changed?"}'
      )
    ).toBe(true);
    expect(
      conversationAssistantTurnBodyUsesPublicAllowlist(
        '{"question":"What changed?","userId":"private"}'
      )
    ).toBe(false);
    expect(
      conversationAssistantContextAttachmentCreateBodyUsesPublicAllowlist(
        '{"requestId":"attachment-1","replacesAttachmentId":"attachment-0"}'
      )
    ).toBe(true);
    expect(
      conversationAssistantContextAttachmentCreateBodyUsesPublicAllowlist(
        '{"requestId":"attachment-1","sourceAccountId":"private"}'
      )
    ).toBe(false);
  });

  it('writes and ends live streams while rejecting both disconnected states', () => {
    const live = fakeSseReply();
    writeTurnRequestSseEvent(live.reply, {
      type: 'done',
      requestId: 'request-live',
      streamSequence: 1,
    });
    expect(live.write).toHaveBeenCalledWith(expect.stringContaining('event: done'));
    endConversationAssistantSse(live.reply);
    expect(live.end).toHaveBeenCalledOnce();

    const destroyed = fakeSseReply({ destroyed: true });
    expect(() =>
      writeTurnRequestSseEvent(destroyed.reply, {
        type: 'done',
        requestId: 'request-destroyed',
        streamSequence: 1,
      })
    ).toThrow('Conversation Assistant event stream disconnected');
    endConversationAssistantSse(destroyed.reply);
    expect(destroyed.end).not.toHaveBeenCalled();

    const ended = fakeSseReply({ writableEnded: true });
    expect(() => writeLegacyTurnSseEvent(ended.reply, { type: 'done' })).toThrow(
      'Conversation Assistant event stream disconnected'
    );
    endConversationAssistantSse(ended.reply);
    expect(ended.end).not.toHaveBeenCalled();
  });
});

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
      payload: { requestId: 'turn-shell', question: 'What was agreed?' },
    });
    expect(firstTurn.statusCode).toBe(201);
    return sessionId;
  }

  async function createPreparedSession(token: string, requestId: string): Promise<string> {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(created.statusCode).toBe(202);
    const sessionId = (JSON.parse(created.body) as { data: { session: { id: string } } }).data
      .session.id;
    await prepareSession(sessionId);
    return sessionId;
  }

  async function prepareSession(sessionId: string): Promise<void> {
    const session = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    const generationId = session?.generationId;
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
              ...(generationId !== undefined ? { generationId } : {}),
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
          deletionToken: string;
          deletionPending: boolean;
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
    expect(body.data.session.deletionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data.session.deletionPending).toBe(false);
    expect(JSON.stringify(body)).not.toContain('We agreed to meet');
    expect(JSON.stringify(body)).not.toContain('transcriptText');
    expect(body.data).not.toHaveProperty('turns');
    expect(ctx.eventPublisher.getConversationAssistantPreparationEvents()).toEqual([
      {
        type: 'whatsapp.conversation-assistant.prepare',
        sessionId: body.data.session.id,
        userId: USER_ID,
        attempt: 1,
        generationId: expect.any(String),
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

  it('accepts a display time zone and exposes only a safe continuation summary', async () => {
    const token = await seed();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'request-continuation-summary',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        displayTimeZone: 'Europe/Warsaw',
      },
    });
    expect(created.statusCode).toBe(202);
    const sessionId = (
      JSON.parse(created.body) as { data: { session: { id: string } } }
    ).data.session.id;
    await prepareSession(sessionId);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const session = (
      JSON.parse(response.body) as { data: { session: Record<string, unknown> } }
    ).data.session;
    expect(session).toMatchObject({
      contextSummary: {
        displayTimeZone: 'Europe/Warsaw',
        availability: { state: 'available', displayTimeZone: 'Europe/Warsaw' },
        contextVersion: 0,
        snapshotCount: 1,
        totalAttachedMessageCount: 0,
        totalAttachedOmittedCount: 0,
        completedConversationRevision: 0,
        activeTurn: null,
      },
    });
    expect(session).not.toHaveProperty('contextContinuationAvailable');
    expect(session).not.toHaveProperty('contextContinuationState');
    expect(session).not.toHaveProperty('attachmentCount');
    expect(session).not.toHaveProperty('displayTimeZone');
    expect(session).not.toHaveProperty('continuation');
    expect(session).not.toHaveProperty('sourceAccountId');
    expect(session).not.toHaveProperty('contextChainSha256');
    expect(session).not.toHaveProperty('transcriptSha256');
    expect(session).not.toHaveProperty('preparationDisplayTimeZone');
    expectPublicConversationAssistantPayload(session);
  });

  it('projects the frozen initial context to session-local display references', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-public-initial-context');
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored).not.toBeNull();
    if (stored === null || stored.contextSnapshotId === undefined) return;
    await ctx.conversationAssistantRepository.saveSession({
      ...stored,
      transcriptMessageCount: 1,
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 1,
        overLimit: 0,
      },
    });
    await ctx.conversationAssistantRepository.saveContextSnapshot(
      sessionId,
      USER_ID,
      stored.contextSnapshotId,
      {
        messages: [
          {
            id: 'raw-initial-message-id',
            eventTimestamp: '2026-06-30T10:00:00.000Z',
            importedAt: '2026-06-30T10:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Safe initial context',
            reactions: [
              {
                id: 'raw-initial-reaction-id',
                emoji: '👍',
                senderKey: 'private-sender-key',
                senderPhoneNumber: '+48111111111',
                senderDisplayName: 'Alice',
                direction: 'incoming',
                eventTimestamp: '2026-06-30T10:01:00.000Z',
              },
            ],
          },
        ],
        omittedMessages: [
          {
            id: 'raw-initial-omitted-id',
            eventTimestamp: '2026-06-30T10:02:00.000Z',
            importedAt: '2026-06-30T10:02:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'reaction',
            omissionReason: 'non_text',
            reaction: {
              emoji: '❤️',
              targetMatrixEventId: 'raw-target-matrix-event-id',
              targetMessageId: 'raw-target-message-id',
            },
          },
        ],
      },
      stored.generationId
    );

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/context`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const data = (JSON.parse(response.body) as { data: Record<string, unknown> }).data;
    expectPublicConversationAssistantPayload(data);
    const serialized = JSON.stringify(data);
    for (const privateValue of [
      'raw-initial-message-id',
      'raw-initial-reaction-id',
      'private-sender-key',
      '+48111111111',
      'raw-initial-omitted-id',
      'raw-target-matrix-event-id',
      'raw-target-message-id',
      stored.transcriptSha256,
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(data).toMatchObject({
      sessionId,
      messages: [
        {
          id: expect.stringMatching(/^context-item-/),
          reactions: [{ id: expect.stringMatching(/^context-reaction-/) }],
        },
      ],
      omittedMessages: [
        {
          id: expect.stringMatching(/^context-item-/),
          reaction: {
            emoji: '❤️',
            targetReference: expect.stringMatching(/^context-item-/),
          },
        },
      ],
    });
  });

  it('deletes an owned analysis and treats missing or foreign deletion as an idempotent success', async () => {
    const token = await seed();
    const sessionId = await createSessionWithFirstTurn(token);
    const foreignToken = await createToken({ sub: 'other-user' });
    const sessionResponse = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const deletionToken = (
      JSON.parse(sessionResponse.body) as { data: { session: { deletionToken: string } } }
    ).data.session.deletionToken;

    const missingTokenDelete = await ctx.app.inject({
      method: 'DELETE',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missingTokenDelete.statusCode).toBe(400);
    await expect(
      ctx.conversationAssistantRepository.getSessionById(sessionId)
    ).resolves.not.toBeNull();

    const foreignDelete = await ctx.app.inject({
      method: 'DELETE',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: {
        authorization: `Bearer ${foreignToken}`,
        'x-conversation-assistant-deletion-token': deletionToken,
      },
    });
    expect(foreignDelete.statusCode).toBe(200);
    expect(JSON.parse(foreignDelete.body).data).toEqual({ deleted: true });
    await expect(ctx.conversationAssistantRepository.getSessionById(sessionId)).resolves.not.toBeNull();
    ctx.conversationAssistantOperationalTelemetry.records.length = 0;

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-conversation-assistant-deletion-token': deletionToken,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toEqual({ deleted: true });
    await expect(ctx.conversationAssistantRepository.getSessionById(sessionId)).resolves.toBeNull();
    await expect(ctx.conversationAssistantRepository.listTurnsBySessionId(sessionId)).resolves.toEqual([]);
    expect(ctx.conversationAssistantOperationalTelemetry.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'session_cleanup',
          outcome: 'completed',
          durationMs: expect.any(Number),
        }),
      ])
    );

    const repeated = await ctx.app.inject({
      method: 'DELETE',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-conversation-assistant-deletion-token': deletionToken,
      },
    });
    expect(repeated.statusCode).toBe(200);
    expect(JSON.parse(repeated.body).data).toEqual({ deleted: true });
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
      expect(response.body).not.toContain('generationId');
      expect(response.body).not.toContain('deletionStartedAt');
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
        generationId: expect.any(String),
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
        requestId: 'turn-legal-context',
        question: 'Can a lawyer explain what these messages mean for my lease dispute?',
      },
    });
    expect(firstTurn.statusCode).toBe(201);
    expect(
      JSON.parse(firstTurn.body).data.turns.map((turn: { role: string }) => turn.role)
    ).toEqual(['user', 'assistant']);
    expect(ctx.llmClient.streamChatCalls[0]?.options).not.toHaveProperty('sessionId');
    expect(ctx.llmClient.streamChatCalls[0]?.options).not.toHaveProperty('correlation');
    expect(JSON.stringify(ctx.llmClient.streamChatCalls[0]?.options)).not.toContain(
      createdBody.data.session.id
    );

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
    expect(ctx.conversationAssistantOperationalTelemetry.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'pdf_revision',
          outcome: 'completed',
          durationMs: expect.any(Number),
        }),
      ])
    );
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
    const privateMarker = 'PRIVATE_WHATSAPP_PDF_MARKER_5e263bdf';
    ctx.pdfConversationExporter.failNext(`pdf render failed: ${privateMarker}`);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Conversation Assistant request failed',
    });
    expect(response.body).not.toContain(privateMarker);
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

    const {
      conversationAssistantRepository: _repository,
      conversationAssistantTurnRequestRepository: _turnRequestRepository,
      conversationAssistantTurnRequestRunner: _turnRequestRunner,
      conversationAssistantOperationalTelemetry: _telemetry,
      ...misconfiguredServices
    } = getServices();
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
      payload: { requestId: 'turn-empty', question: '   ' },
    });
    expect(emptyTurn.statusCode).toBe(400);
    expect(JSON.parse(emptyTurn.body).error.code).toBe('INVALID_REQUEST');

    const sent = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'turn-sent', question: 'What was agreed?' },
    });
    expect(sent.statusCode).toBe(201);
    const sentData = (JSON.parse(sent.body) as { data: { turns: unknown[] } }).data;
    expect(sentData.turns.map((turn) => (turn as { role: string }).role)).toEqual([
      'user',
      'assistant',
    ]);
    expectPublicConversationAssistantPayload(sentData);

    ctx.llmClient.setNextStreamEvents([
      { type: 'delta', text: 'streamed ' },
      { type: 'delta', text: 'answer' },
    ]);
    const streamed = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'turn-streamed', question: 'Stream this.' },
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers['content-type']).toContain('text/event-stream');
    const events = parseSseEvents(streamed.body);
    expect(events.map((event) => event.event)).toEqual([
      'request_state',
      'user_turn',
      'assistant_delta',
      'assistant_delta',
      'usage',
      'request_state',
      'assistant_turn',
      'done',
    ]);
    expect(events.every((event) => {
      const data = event.data as { requestId?: string; streamSequence?: number };
      return data.requestId === 'turn-streamed' && typeof data.streamSequence === 'number';
    })).toBe(true);
    for (const event of events) expectPublicConversationAssistantPayload(event.data);
    expect(ctx.llmClient.streamChatCalls[0]?.options).not.toHaveProperty('sessionId');
    expect(ctx.llmClient.streamChatCalls[0]?.options).not.toHaveProperty('correlation');
    expect(JSON.stringify(ctx.llmClient.streamChatCalls[0]?.options)).not.toContain(
      createdBody.data.session.id
    );

    const streamCallCount = ctx.llmClient.streamChatCalls.length;
    const replayedStream = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${createdBody.data.session.id}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'turn-streamed', question: 'Stream this.' },
    });
    expect(replayedStream.statusCode).toBe(200);
    expect(parseSseEvents(replayedStream.body).map((event) => event.event)).toEqual([
      'request_state',
      'user_turn',
      'assistant_turn',
      'done',
    ]);
    expect(ctx.llmClient.streamChatCalls).toHaveLength(streamCallCount);

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
      payload: { requestId: 'turn-missing', question: 'Hello?' },
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

  it('keeps plain questions working for legacy sessions without enabling context attachments', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-legacy-turn-session');
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    const { continuation: _continuation, ...legacySession } = stored;
    await ctx.conversationAssistantRepository.saveSession(legacySession);
    const {
      conversationAssistantTurnRequestRepository: _turnRequestRepository,
      conversationAssistantTurnRequestRunner: _turnRequestRunner,
      conversationAssistantOperationalTelemetry: _telemetry,
      ...legacyServices
    } = getServices();
    setServices(legacyServices);

    const sent = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'What was agreed?' },
    });

    expect(sent.statusCode).toBe(201);
    expect(JSON.parse(sent.body).data.turns.map((turn: { role: string }) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
    expectPublicConversationAssistantPayload(JSON.parse(sent.body).data);

    ctx.llmClient.setNextStreamEvents([
      { type: 'delta', text: 'legacy ' },
      { type: 'delta', text: 'stream' },
    ]);
    const streamed = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Stream this.' },
    });

    expect(streamed.statusCode).toBe(200);
    const legacyEvents = parseSseEvents(streamed.body);
    expect(legacyEvents.map((event) => event.event)).toEqual([
      'user_turn',
      'assistant_delta',
      'assistant_delta',
      'assistant_turn',
      'done',
    ]);
    for (const event of legacyEvents) expectPublicConversationAssistantPayload(event.data);

    const attachmentAttempt = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'legacy-attachment-turn',
        question: 'Use this update.',
        contextAttachmentId: 'forbidden-legacy-attachment',
      },
    });
    const streamedAttachmentAttempt = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'legacy-stream-attachment-turn',
        question: 'Use this update in a stream.',
        contextAttachmentId: 'forbidden-legacy-stream-attachment',
      },
    });
    expect(attachmentAttempt.statusCode).toBe(409);
    expect(JSON.parse(attachmentAttempt.body).error.code).toBe('CONTEXT_STALE');
    expect(streamedAttachmentAttempt.statusCode).toBe(409);
    expect(JSON.parse(streamedAttachmentAttempt.body).error.code).toBe('CONTEXT_STALE');
  });

  it('uses durable request replay for legacy sessions when a request id is supplied', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-legacy-durable-session');
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    const { continuation: _continuation, ...legacySession } = stored;
    await ctx.conversationAssistantRepository.saveSession(legacySession);

    const payload = { requestId: 'legacy-durable-turn', question: 'What was agreed?' };
    const first = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    const replay = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(JSON.parse(replay.body).data).toEqual(JSON.parse(first.body).data);
    const recovered = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/${payload.requestId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(recovered.statusCode).toBe(200);
    expect(JSON.parse(recovered.body).data.request.id).toBe(payload.requestId);
  });

  it('fails closed while initializing legacy durable turn state', async () => {
    const configured = getServices();
    const { conversationAssistantRepository: _repository, ...withoutRepository } = configured;
    setServices(withoutRepository);
    expect(await initializeLegacyDurableTurnState(USER_ID, 'missing')).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    setServices(configured);

    expect(await initializeLegacyDurableTurnState(USER_ID, 'missing')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });

    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-legacy-init-guards');
    expect(await initializeLegacyDurableTurnState(USER_ID, sessionId)).toEqual({
      ok: true,
      value: undefined,
    });
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    const {
      continuation: _continuation,
      sourceAccountId: _sourceAccountId,
      ...missingSource
    } = stored;
    await ctx.conversationAssistantRepository.saveSession(missingSource);
    expect(await initializeLegacyDurableTurnState(USER_ID, sessionId)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    const failedJson = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'legacy-init-json-failure', question: 'Hello' },
    });
    const failedStream = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'legacy-init-stream-failure', question: 'Hello' },
    });
    expect(failedJson.statusCode).toBe(500);
    expect(failedStream.statusCode).toBe(500);

    vi.spyOn(ctx.conversationAssistantRepository, 'getSessionById').mockRejectedValueOnce(
      new Error('private initialization failure')
    );
    expect(await initializeLegacyDurableTurnState(USER_ID, sessionId)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });

  it('preserves existing durable fields while initializing legacy turn history', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-legacy-history-init');
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    const { continuation: _continuation, ...legacySession } = stored;
    await ctx.conversationAssistantRepository.saveSession(legacySession);
    await ctx.conversationAssistantRepository.saveTurn({
      id: 'legacy-existing-turn',
      sessionId,
      userId: USER_ID,
      role: 'user',
      text: 'Existing question',
      createdAt: '2026-07-20T00:00:00.000Z',
      sequence: 10,
      conversationRevision: 5,
      requestId: 'existing-request',
      kind: 'message',
    });

    expect(await initializeLegacyDurableTurnState(USER_ID, sessionId)).toEqual({
      ok: true,
      value: undefined,
    });
    const turns = await ctx.conversationAssistantRepository.listTurnsBySessionId(sessionId);
    expect(turns[0]).toMatchObject({ requestId: 'existing-request', kind: 'message' });
  });

  it('sanitizes new legacy LLM failures across JSON, SSE, persistence, logs, and telemetry', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-legacy-private-llm-errors');
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    const { continuation: _continuation, ...legacySession } = stored;
    await ctx.conversationAssistantRepository.saveSession(legacySession);
    ctx.conversationAssistantOperationalTelemetry.records.length = 0;
    const logSpies = [
      vi.spyOn(ctx.app.log, 'info'),
      vi.spyOn(ctx.app.log, 'warn'),
      vi.spyOn(ctx.app.log, 'error'),
    ];
    const syncMarker = 'PRIVATE_ROUTE_LEGACY_SYNC_LLM_MARKER_84472127';
    const streamMarker = 'PRIVATE_ROUTE_LEGACY_STREAM_LLM_MARKER_97c755cd';

    ctx.llmClient.failNextChat(syncMarker);
    const syncResponse = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Fail safely.' },
    });
    expect(syncResponse.statusCode).toBe(201);
    expect(JSON.parse(syncResponse.body).data.turns.at(-1).error).toEqual({
      code: 'LLM_ERROR',
      message: 'Conversation Assistant request failed',
    });
    expect(syncResponse.body).not.toContain(syncMarker);

    ctx.llmClient.failNextStream(streamMarker, [{ type: 'delta', text: 'partial' }]);
    const streamResponse = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Stream safely.' },
    });
    expect(streamResponse.statusCode).toBe(200);
    const streamEvents = parseSseEvents(streamResponse.body);
    expect(streamEvents.find((event) => event.event === 'error')?.data).toMatchObject({
      error: { code: 'LLM_ERROR', message: 'Conversation Assistant request failed' },
    });
    expect(streamEvents.find((event) => event.event === 'assistant_turn')?.data).toMatchObject({
      turn: {
        error: { code: 'LLM_ERROR', message: 'Conversation Assistant request failed' },
      },
    });
    expect(streamResponse.body).not.toContain(streamMarker);

    const persistedNewTurns = await ctx.conversationAssistantRepository.listTurnsBySessionId(
      sessionId
    );
    expect(persistedNewTurns.filter((turn) => turn.error !== undefined).map((turn) => turn.error)).toEqual([
      { code: 'LLM_ERROR', message: 'Conversation Assistant request failed' },
      { code: 'LLM_ERROR', message: 'Conversation Assistant request failed' },
    ]);
    expect(JSON.stringify(persistedNewTurns)).not.toMatch(new RegExp(`${syncMarker}|${streamMarker}`));

    const serializedLogs = JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls));
    const serializedTelemetry = JSON.stringify(ctx.conversationAssistantOperationalTelemetry.records);
    for (const marker of [syncMarker, streamMarker]) {
      expect(serializedLogs).not.toContain(marker);
      expect(serializedTelemetry).not.toContain(marker);
    }
  });

  it('sanitizes a historical legacy LLM error at the public DTO boundary', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-historical-private-llm-error');
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    const { continuation: _continuation, ...legacySession } = stored;
    await ctx.conversationAssistantRepository.saveSession(legacySession);
    ctx.conversationAssistantOperationalTelemetry.records.length = 0;
    const logSpies = [
      vi.spyOn(ctx.app.log, 'info'),
      vi.spyOn(ctx.app.log, 'warn'),
      vi.spyOn(ctx.app.log, 'error'),
    ];
    const historicalMarker = 'PRIVATE_ROUTE_HISTORICAL_LLM_MARKER_be267ce8';

    await ctx.conversationAssistantRepository.saveTurn({
      id: 'legacy-historical-private-error-turn',
      sessionId,
      userId: USER_ID,
      role: 'assistant',
      text: 'Historical failed answer',
      createdAt: '2026-07-21T12:00:00.000Z',
      error: { code: 'LLM_ERROR', message: historicalMarker },
    });
    const historicalResponse = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(historicalResponse.statusCode).toBe(200);
    const historicalTurn = JSON.parse(historicalResponse.body).data.turns.find(
      (turn: { id: string }) => turn.id === 'legacy-historical-private-error-turn'
    );
    expect(historicalTurn.error).toEqual({
      code: 'LLM_ERROR',
      message: 'Conversation Assistant request failed',
    });
    expect(historicalResponse.body).not.toContain(historicalMarker);

    expect(JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls))).not.toContain(
      historicalMarker
    );
    expect(JSON.stringify(ctx.conversationAssistantOperationalTelemetry.records)).not.toContain(
      historicalMarker
    );
  });

  it('persists, replays, conflicts, and recovers one durable turn request', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-durable-turn-session');
    const body = {
      requestId: 'durable-turn-1',
      question: 'How did the attitude change?',
    };

    const first = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    const replay = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    const conflict = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...body, question: 'A different immutable body' },
    });
    const recovery = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/${body.requestId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const resumed = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/${body.requestId}/resume`,
      headers: { authorization: `Bearer ${token}` },
    });
    const foreignToken = await createToken({ sub: 'foreign-user' });
    const foreignRecovery = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/${body.requestId}`,
      headers: { authorization: `Bearer ${foreignToken}` },
    });
    const missingResume = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/missing-request/resume`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(resumed.statusCode).toBe(200);
    expect(JSON.parse(resumed.body).data).toMatchObject({
      request: { id: body.requestId, status: 'completed' },
      turns: [{ role: 'user' }, { role: 'assistant' }],
    });
    expect(conflict.statusCode).toBe(409);
    expect(JSON.parse(conflict.body).error.code).toBe('REQUEST_BODY_CONFLICT');
    expect(recovery.statusCode).toBe(200);
    expect(foreignRecovery.statusCode).toBe(404);
    expect(missingResume.statusCode).toBe(404);
    expect(JSON.parse(missingResume.body).error.code).toBe('NOT_FOUND');
    const firstData = JSON.parse(first.body).data;
    expect(firstData).toMatchObject({
      request: { id: body.requestId, status: 'completed', attempt: 1, stateVersion: 2 },
      turns: [{ role: 'user' }, { role: 'assistant' }],
      canRetryAnswer: false,
    });
    expect(JSON.parse(replay.body).data).toEqual(firstData);
    expect(JSON.parse(recovery.body).data).toEqual(firstData);
    expectPublicConversationAssistantPayload(firstData);
    expectPublicConversationAssistantPayload(JSON.parse(resumed.body).data);
    expect(JSON.stringify(firstData)).not.toContain('requestFingerprint');
    expect(JSON.stringify(firstData)).not.toContain('claimId');
    expect(ctx.llmClient.streamChatCalls).toHaveLength(1);

    const legacyCompatibleBody = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Missing id' },
    });
    const injectedPrivateBoundary = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'durable-turn-injected',
        question: 'Reject private boundary',
        sessionGenerationId: 'private-generation',
      },
    });
    const missingIdWithAttachment = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        question: 'An attachment send must remain client-idempotent.',
        contextAttachmentId: 'attachment-without-request-id',
      },
    });
    const missingIdWithConfirmation = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        question: 'A confirmed send must remain client-idempotent.',
        confirmationToken: 'confirmation-without-request-id',
      },
    });
    expect(legacyCompatibleBody.statusCode).toBe(201);
    expect(JSON.parse(legacyCompatibleBody.body).data.request.id).toMatch(/^compat-/);
    expect(injectedPrivateBoundary.statusCode).toBe(400);
    expect(missingIdWithAttachment.statusCode).toBe(400);
    expect(missingIdWithConfirmation.statusCode).toBe(400);

    ctx.conversationAssistantTurnRequestRepository.throwOnNextStart();
    const persistenceFailure = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'durable-turn-persistence-failure', question: 'Safe failure' },
    });
    expect(persistenceFailure.statusCode).toBe(500);
    expect(JSON.parse(persistenceFailure.body).error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Conversation Assistant answer request failed',
    });
    expect(ctx.conversationAssistantOperationalTelemetry.records).toContainEqual({
      operation: 'turn_request',
      outcome: 'failed',
    });
  });

  it('accepts the exact pre-release question-only turn payload during backend-first rollout', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-rolling-compatibility');

    const posted = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Question from an already-open old client.' },
    });

    expect(posted.statusCode).toBe(201);
    const postedData = JSON.parse(posted.body).data;
    expect(postedData).toMatchObject({
      request: { id: expect.any(String), status: 'completed' },
      turns: [{ role: 'user' }, { role: 'assistant' }],
    });

    const streamed = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Second question from the same old client.' },
    });

    expect(streamed.statusCode).toBe(200);
    const eventTypes = parseSseEvents(streamed.body).map((event) => event.event);
    expect(eventTypes).toContain('user_turn');
    expect(eventTypes).toContain('assistant_turn');
    expect(eventTypes.at(-1)).toBe('done');
  });

  it('projects the active durable request only through contextSummary', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-active-turn-summary');
    const started = await ctx.conversationAssistantTurnRequestRepository.startTurnRequest({
      userId: USER_ID,
      sessionId,
      requestId: 'active-turn-request',
      requestFingerprint: 'active-turn-fingerprint',
      question: 'Keep this request in progress.',
      claimId: 'active-turn-claim',
      now: '2026-07-21T10:00:00.000Z',
      leaseExpiresAt: '2026-07-21T10:05:00.000Z',
    });
    expect(started.status).toBe('claimed');

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const publicSession = JSON.parse(response.body).data.session;
    expect(publicSession.contextSummary.activeTurn).toEqual({
      requestId: 'active-turn-request',
      stateVersion: 1,
    });
    expect(publicSession).not.toHaveProperty('activeTurn');
    expectPublicConversationAssistantPayload(publicSession);
  });

  it('keeps active-turn lookup failures free of session, request, and error details', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-active-turn-safe-log');
    const requestId = 'active-turn-private-request';
    const started = await ctx.conversationAssistantTurnRequestRepository.startTurnRequest({
      userId: USER_ID,
      sessionId,
      requestId,
      requestFingerprint: 'active-turn-safe-log-fingerprint',
      question: 'Keep this request in progress.',
      claimId: 'active-turn-safe-log-claim',
      now: '2026-07-21T10:00:00.000Z',
      leaseExpiresAt: '2026-07-21T10:05:00.000Z',
    });
    expect(started.status).toBe('claimed');
    vi.spyOn(
      ctx.conversationAssistantTurnRequestRepository,
      'getTurnRequest'
    ).mockRejectedValueOnce(new Error('private repository failure detail'));
    const warnSpy = vi.spyOn(ctx.app.log, 'warn');

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data.session.contextSummary.activeTurn).toBeNull();
    const matchingWarnCalls = warnSpy.mock.calls.filter(
      ([, message]) =>
        message === 'Failed to resolve Conversation Assistant active turn summary'
    );
    expect(matchingWarnCalls).toEqual([
      [
        {
          operation: 'conversation_assistant_active_turn_summary',
          outcome: 'unavailable',
          errorCode: 'TURN_REQUEST_LOOKUP_FAILED',
        },
        'Failed to resolve Conversation Assistant active turn summary',
      ],
    ]);
    const serializedLog = JSON.stringify(matchingWarnCalls);
    expect(serializedLog).not.toContain(sessionId);
    expect(serializedLog).not.toContain(requestId);
    expect(serializedLog).not.toContain('private repository failure detail');
  });

  it('rejects non-object JSON bodies at the raw public allowlist boundary', async () => {
    const token = await seed();
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };
    const paths = [
      '/conversation-assistant/sessions/missing/turns',
      '/conversation-assistant/sessions/missing/context-attachments',
    ];

    for (const url of paths) {
      for (const payload of ['[]', 'null', '"primitive"']) {
        const response = await ctx.app.inject({ method: 'POST', url, headers, payload });
        expect(response.statusCode).toBe(400);
      }
    }
  });

  it('recovers a failed answer and retries only the deterministic assistant turn', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-answer-retry-session');
    ctx.llmClient.failNextStream('private provider detail');

    const failed = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'durable-retry-1', question: 'Please answer this.' },
    });
    expect(failed.statusCode).toBe(201);
    expect(JSON.parse(failed.body).data).toMatchObject({
      request: { id: 'durable-retry-1', status: 'failed', error: { code: 'LLM_ERROR' } },
      turns: [{ role: 'user' }, { role: 'assistant', error: { code: 'LLM_ERROR' } }],
      canRetryAnswer: true,
    });
    expect(JSON.stringify(JSON.parse(failed.body).data)).not.toContain('private provider detail');

    const foreignToken = await createToken({ sub: 'foreign-user' });
    const foreignRetry = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/durable-retry-1/answer/retry`,
      headers: { authorization: `Bearer ${foreignToken}` },
    });
    expect(foreignRetry.statusCode).toBe(404);

    ctx.llmClient.succeedNextStream('Recovered answer', [
      { type: 'delta', text: 'Recovered answer' },
    ]);
    const retried = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/durable-retry-1/answer/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    const replayedRetry = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/durable-retry-1/answer/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(retried.statusCode).toBe(200);
    expect(JSON.parse(retried.body).data).toMatchObject({
      request: { status: 'completed', attempt: 2 },
      turns: [{ role: 'user' }, { role: 'assistant', text: 'Recovered answer' }],
      canRetryAnswer: false,
    });
    expect(JSON.parse(replayedRetry.body).data).toEqual(JSON.parse(retried.body).data);
    expect(JSON.parse(retried.body).data.turns).toHaveLength(2);

    ctx.conversationAssistantTurnRequestRepository.failNextRetryWith('invalid_state');
    const unavailable = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/durable-retry-1/answer/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unavailable.statusCode).toBe(409);
    expect(JSON.parse(unavailable.body).error.code).toBe('ANSWER_RETRY_UNAVAILABLE');

    expect(ctx.conversationAssistantOperationalTelemetry.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'turn_request', outcome: 'failed' }),
        expect.objectContaining({ operation: 'answer_retry', outcome: 'completed' }),
        expect.objectContaining({ operation: 'answer_retry', outcome: 'replay' }),
      ])
    );
  });

  it('offers retry only for the latest failed answer revision in status and history', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-latest-answer-retry-session');
    ctx.llmClient.failNextStream('private first failure');

    const failedA = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'durable-retry-a', question: 'Question A' },
    });
    expect(failedA.statusCode).toBe(201);

    ctx.llmClient.succeedNextStream('Answer B', [{ type: 'delta', text: 'Answer B' }]);
    const completedB = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'durable-retry-b', question: 'Question B' },
    });
    expect(completedB.statusCode).toBe(201);

    const staleStatus = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/durable-retry-a`,
      headers: { authorization: `Bearer ${token}` },
    });
    const staleRetry = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/durable-retry-a/answer/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    const historyAfterB = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(staleStatus.statusCode).toBe(200);
    const staleStatusData = JSON.parse(staleStatus.body).data;
    expect(staleStatusData.canRetryAnswer).toBe(false);
    expect(
      staleStatusData.turns.find((turn: { role?: string }) => turn.role === 'assistant')
    ).toMatchObject({ canRetryAnswer: false });
    expect(staleRetry.statusCode).toBe(409);
    expect(JSON.parse(staleRetry.body).error.code).toBe('ANSWER_RETRY_UNAVAILABLE');
    const staleAssistantTurn = JSON.parse(historyAfterB.body).data.turns.find(
      (turn: { requestId?: string; role?: string }) =>
        turn.requestId === 'durable-retry-a' && turn.role === 'assistant'
    );
    expect(staleAssistantTurn).toMatchObject({
      error: { code: 'LLM_ERROR' },
      canRetryAnswer: false,
    });

    ctx.llmClient.failNextStream('private latest failure');
    const failedC = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'durable-retry-c', question: 'Question C' },
    });
    const latestStatus = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/durable-retry-c`,
      headers: { authorization: `Bearer ${token}` },
    });
    const historyAfterC = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(failedC.statusCode).toBe(201);
    expect(JSON.parse(failedC.body).data.canRetryAnswer).toBe(true);
    expect(latestStatus.statusCode).toBe(200);
    const latestStatusData = JSON.parse(latestStatus.body).data;
    expect(latestStatusData.canRetryAnswer).toBe(true);
    expect(
      latestStatusData.turns.find((turn: { role?: string }) => turn.role === 'assistant')
    ).toMatchObject({ canRetryAnswer: true });
    const latestAssistantTurn = JSON.parse(historyAfterC.body).data.turns.find(
      (turn: { requestId?: string; role?: string }) =>
        turn.requestId === 'durable-retry-c' && turn.role === 'assistant'
    );
    expect(latestAssistantTurn).toMatchObject({
      error: { code: 'LLM_ERROR' },
      canRetryAnswer: true,
    });
  });

  it('hides answer retry while a newer request owns the active lease', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-active-answer-retry-session');
    ctx.llmClient.failNextStream('private first failure');
    const failedA = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'active-retry-a', question: 'Question A' },
    });
    expect(failedA.statusCode).toBe(201);

    const activeB = await ctx.conversationAssistantTurnRequestRepository.startTurnRequest({
      userId: USER_ID,
      sessionId,
      requestId: 'active-retry-b',
      requestFingerprint: 'active-retry-b-fingerprint',
      question: 'Question B',
      claimId: 'active-retry-b-claim',
      now: '2026-07-21T10:00:00.000Z',
      leaseExpiresAt: '2099-07-21T10:05:00.000Z',
    });
    expect(activeB.status).toBe('claimed');

    const statusA = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/active-retry-a`,
      headers: { authorization: `Bearer ${token}` },
    });
    const history = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
    });
    const retryA = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turn-requests/active-retry-a/answer/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(JSON.parse(statusA.body).data.canRetryAnswer).toBe(false);
    expect(
      JSON.parse(history.body).data.turns.find(
        (turn: { requestId?: string; role?: string }) =>
          turn.requestId === 'active-retry-a' && turn.role === 'assistant'
      )
    ).toMatchObject({ canRetryAnswer: false });
    expect(retryA.statusCode).toBe(409);
    expect(JSON.parse(retryA.body).error.code).toBe('TURN_IN_PROGRESS');
  });

  it('applies auth guards and dependency checks on every conversation assistant route', async () => {
    const token = await seed();
    const unauthenticatedRequests = [
      { method: 'POST' as const, url: '/conversation-assistant/sessions', payload: {} },
      { method: 'POST' as const, url: '/conversation-assistant/context/check', payload: {} },
      { method: 'GET' as const, url: '/conversation-assistant/session-requests/missing' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing' },
      { method: 'DELETE' as const, url: '/conversation-assistant/sessions/missing' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/context' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/export.pdf' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/turns' },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments',
        payload: { requestId: 'attachment-auth' },
      },
      {
        method: 'GET' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments/missing',
      },
      {
        method: 'GET' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments/missing/messages',
      },
      {
        method: 'DELETE' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments/missing',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments/missing/preparation/retry',
      },
      {
        method: 'GET' as const,
        url: '/conversation-assistant/sessions/missing/context/history',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/preparation/retry',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turns',
        payload: { requestId: 'turn-auth', question: 'hello' },
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turns/stream',
        payload: { requestId: 'turn-stream-auth', question: 'hello' },
      },
      {
        method: 'GET' as const,
        url: '/conversation-assistant/sessions/missing/turn-requests/missing',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turn-requests/missing/resume',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turn-requests/missing/answer/retry',
      },
    ];

    for (const request of unauthenticatedRequests) {
      const response = await ctx.app.inject(request);
      expect(response.statusCode).toBe(401);
    }

    const {
      conversationAssistantRepository: _repository,
      conversationAssistantTurnRequestRepository: _turnRequestRepository,
      conversationAssistantTurnRequestRunner: _turnRequestRunner,
      conversationAssistantOperationalTelemetry: _telemetry,
      conversationAssistantContextAttachmentRepository: _attachmentRepository,
      ...misconfiguredServices
    } = getServices();
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
      { method: 'DELETE' as const, url: '/conversation-assistant/sessions/missing' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/context' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/export.pdf' },
      { method: 'GET' as const, url: '/conversation-assistant/sessions/missing/turns' },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments',
        payload: { requestId: 'attachment-misconfigured' },
      },
      {
        method: 'GET' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments/missing',
      },
      {
        method: 'GET' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments/missing/messages',
      },
      {
        method: 'DELETE' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments/missing',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/context-attachments/missing/preparation/retry',
      },
      {
        method: 'GET' as const,
        url: '/conversation-assistant/sessions/missing/context/history',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/preparation/retry',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turns',
        payload: { requestId: 'turn-misconfigured', question: 'hello' },
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turns/stream',
        payload: { requestId: 'turn-stream-misconfigured', question: 'hello' },
      },
      {
        method: 'GET' as const,
        url: '/conversation-assistant/sessions/missing/turn-requests/missing',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turn-requests/missing/resume',
      },
      {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/missing/turn-requests/missing/answer/retry',
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
    const listPrivateMarker = 'PRIVATE_WHATSAPP_LIST_MARKER_b10148ca';
    const deletePrivateMarker = 'PRIVATE_WHATSAPP_DELETE_MARKER_04d92c16';
    const legacyPrivateMarker = 'PRIVATE_WHATSAPP_LEGACY_MARKER_53d87db1';
    const throwingRepository: ConversationAssistantRepository = {
      saveSession: (session) => ctx.conversationAssistantRepository.saveSession(session),
      createSessionIfAbsent: (session) =>
        ctx.conversationAssistantRepository.createSessionIfAbsent(session),
      getSessionById: () => {
        throw new Error(`legacy lookup failed: ${legacyPrivateMarker}`);
      },
      getSessionSnapshotById: (input) =>
        ctx.conversationAssistantRepository.getSessionSnapshotById(input),
      listSessionsByUserId: () => {
        throw new Error(`list failed: ${listPrivateMarker}`);
      },
      deleteSession: () => {
        throw new Error(`delete failed: ${deletePrivateMarker}`);
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
      saveTurnIfSessionExists: (turn, expectedGenerationId) =>
        ctx.conversationAssistantRepository.saveTurnIfSessionExists(
          turn,
          expectedGenerationId
        ),
      saveAssistantTurnAndTouchSession: (input) =>
        ctx.conversationAssistantRepository.saveAssistantTurnAndTouchSession(input),
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
    expect(JSON.parse(response.body).error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Conversation Assistant request failed',
    });
    expect(response.body).not.toContain(listPrivateMarker);

    const deleteResponse = await ctx.app.inject({
      method: 'DELETE',
      url: '/conversation-assistant/sessions/missing',
      headers: {
        authorization: `Bearer ${token}`,
        'x-conversation-assistant-deletion-token': 'stale-token',
      },
    });
    expect(deleteResponse.statusCode).toBe(500);
    expect(JSON.parse(deleteResponse.body).error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Conversation Assistant request failed',
    });
    expect(deleteResponse.body).not.toContain(deletePrivateMarker);

    const legacyResponse = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions/missing/turns',
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Does not matter for a failed lookup.' },
    });
    expect(legacyResponse.statusCode).toBe(500);
    expect(JSON.parse(legacyResponse.body).error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Conversation Assistant request failed',
    });
    expect(legacyResponse.body).not.toContain(legacyPrivateMarker);

    const turnRequestPrivateMarker = 'PRIVATE_TURN_REQUEST_THROW_MARKER_28211156';
    vi.spyOn(
      ctx.conversationAssistantTurnRequestRepository,
      'getTurnRequest'
    ).mockRejectedValueOnce(new Error(turnRequestPrivateMarker));
    const turnRequestResponse = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions/missing/turn-requests/throwing-request',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(turnRequestResponse.statusCode).toBe(500);
    expect(JSON.parse(turnRequestResponse.body).error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Conversation Assistant answer request failed',
    });
    expect(turnRequestResponse.body).not.toContain(turnRequestPrivateMarker);
  });

  it('maps legacy turn dependency, lookup, and stream failures without exposing details', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-legacy-route-failures');
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    const { continuation: _continuation, ...legacySession } = stored;
    await ctx.conversationAssistantRepository.saveSession(legacySession);
    const configured = getServices();
    const { llmClientFactory: _llmClientFactory, ...withoutLlmFactory } = configured;
    setServices(withoutLlmFactory);

    const syncDependencyFailure = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Hello' },
    });
    const streamDependencyFailure = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Hello' },
    });
    setServices(configured);

    const getSessionSpy = vi.spyOn(ctx.conversationAssistantRepository, 'getSessionById');
    getSessionSpy.mockResolvedValueOnce(legacySession).mockResolvedValueOnce(null);
    const syncLookupFailure = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Hello' },
    });
    getSessionSpy.mockResolvedValueOnce(legacySession).mockResolvedValueOnce(null);
    const streamLookupFailure = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Hello' },
    });
    getSessionSpy.mockRejectedValueOnce(new Error('private legacy lookup failure'));
    const streamModeFailure = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns/stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { question: 'Hello' },
    });

    expect(syncDependencyFailure.statusCode).toBe(500);
    expect(streamDependencyFailure.statusCode).toBe(500);
    expect(syncLookupFailure.statusCode).toBe(404);
    expect(streamLookupFailure.statusCode).toBe(200);
    expect(parseSseEvents(streamLookupFailure.body).map((event) => event.event)).toEqual([
      'error',
      'done',
    ]);
    expect(streamModeFailure.statusCode).toBe(500);
    expect(streamModeFailure.body).not.toContain('private legacy lookup failure');
  });

  it('preserves attachment fields in durable JSON and stream requests', async () => {
    const token = await seed();
    const headers = { authorization: `Bearer ${token}` };
    const payload = {
      requestId: 'missing-attachment-turn',
      question: 'Use the new context',
      contextAttachmentId: 'attachment-requested',
      confirmationToken: 'confirmation-requested',
    };

    const json = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions/missing/turns',
      headers,
      payload,
    });
    const stream = await ctx.app.inject({
      method: 'POST',
      url: '/conversation-assistant/sessions/missing/turns/stream',
      headers,
      payload: { ...payload, requestId: 'missing-attachment-stream' },
    });

    expect(json.statusCode).toBe(404);
    expect(stream.statusCode).toBe(200);
    expect(parseSseEvents(stream.body)[0]?.data).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });

  it('routes maximum-length durable request ids and rejects longer ids through schema validation', async () => {
    const token = await seed();
    const headers = { authorization: `Bearer ${token}` };
    const maximumRequestId = 'r'.repeat(128);
    const longRequestId = 'r'.repeat(129);
    const base = `/conversation-assistant/sessions/missing/turn-requests/${longRequestId}`;

    const maximumLengthResponse = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/missing/turn-requests/${maximumRequestId}`,
      headers,
    });
    expect(maximumLengthResponse.statusCode).toBe(404);
    expect(JSON.parse(maximumLengthResponse.body)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });

    for (const request of [
      { method: 'GET' as const, url: base },
      { method: 'POST' as const, url: `${base}/resume` },
      { method: 'POST' as const, url: `${base}/answer/retry` },
    ]) {
      const response = await ctx.app.inject({ ...request, headers });
      expect(response.statusCode, request.url).toBe(400);
    }
  });

  it('uses legacy time-zone fallbacks and hides a completed request from active summary', async () => {
    const token = await seed();
    const sessionId = await createPreparedSession(token, 'request-public-summary-fallback');
    const completed = await ctx.app.inject({
      method: 'POST',
      url: `/conversation-assistant/sessions/${sessionId}/turns`,
      headers: { authorization: `Bearer ${token}` },
      payload: { requestId: 'completed-summary-request', question: 'Summarize this.' },
    });
    expect(completed.statusCode).toBe(201);
    const stored = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(stored?.continuation).toBeDefined();
    if (stored?.continuation === undefined) return;
    const { displayTimeZone: _displayTimeZone, ...continuationWithoutTimeZone } =
      stored.continuation;
    const { preparationDisplayTimeZone: _preparationTimeZone, ...sessionWithoutTimeZone } =
      stored;
    await ctx.conversationAssistantRepository.saveSession({
      ...sessionWithoutTimeZone,
      continuation: {
        ...continuationWithoutTimeZone,
        activeTurnRequestId: 'completed-summary-request',
      } as typeof stored.continuation,
    });

    const completedSummary = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const afterCompleted = await ctx.conversationAssistantRepository.getSessionById(sessionId);
    expect(afterCompleted?.continuation).toBeDefined();
    if (afterCompleted?.continuation === undefined) return;
    await ctx.conversationAssistantRepository.saveSession({
      ...afterCompleted,
      continuation: {
        ...afterCompleted.continuation,
        activeTurnRequestId: 'missing-summary-request',
      },
    });
    const missingSummary = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(completedSummary.statusCode).toBe(200);
    expect(JSON.parse(completedSummary.body).data.session.contextSummary).toMatchObject({
      displayTimeZone: 'UTC',
      availability: { state: 'available', displayTimeZone: 'UTC' },
      activeTurn: null,
    });
    expect(missingSummary.statusCode).toBe(200);
    expect(JSON.parse(missingSummary.body).data.session.contextSummary.activeTurn).toBeNull();
  });

  describe('context attachment endpoints', () => {
    function attachment(
      overrides: Partial<ConversationAssistantContextAttachment> = {}
    ): ConversationAssistantContextAttachment {
      return {
        id: 'attachment-route-1',
        sessionId: 'session-route-1',
        userId: USER_ID,
        sessionGenerationId: 'generation-route-1',
        sourceAccountId: SOURCE_ACCOUNT_ID,
        sourceAccountGeneration: SOURCE_ACCOUNT_ID,
        chatId: CHAT_ID,
        preparationRequestId: 'request-route-1',
        preparationRequestFingerprint: 'fingerprint-private',
        status: 'ready',
        initialContextFrom: '2026-06-30T00:00:00.000Z',
        baseContextVersion: 0,
        baseEventThrough: '2026-07-01T00:00:00.000Z',
        capturedAt: '2026-07-02T12:00:00.000Z',
        baseChangeSeq: 1,
        cutoffChangeSeq: 1,
        captureRange: {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-02T12:00:00.000Z',
        },
        eventRange: {
          from: '2026-07-02T08:00:00.000Z',
          to: '2026-07-02T09:00:00.000Z',
        },
        counts: {
          included: 1,
          omitted: 0,
          newlyAvailable: 1,
          edited: 0,
          redacted: 0,
          deleted: 0,
          reactionsChanged: 0,
          lateIngested: 0,
          completedTranscriptions: 0,
        },
        omitted: {
          mediaOnly: 0,
          failedTranscriptions: 0,
          pendingTranscriptions: 0,
          nonText: 0,
          overLimit: 0,
        },
        snapshotId: 'snapshot-private',
        chunkManifest: { chunkIds: ['chunk-private'], chunkCount: 1 },
        deltaTranscriptSha256: 'delta-hash-private',
        previousContextChainSha256: 'previous-hash-private',
        resultingContextChainSha256: 'result-hash-private',
        estimatedInputTokens: 42,
        requiresConfirmation: false,
        preparationAttempt: 1,
        expiresAt: '2099-07-02T12:30:00.000Z',
        ...overrides,
      };
    }

    function previewSnapshot(): ConversationAssistantContextAttachmentPreparedSnapshot {
      return {
        ...fakePreparedContextAttachmentSnapshot(),
        transcriptText: 'private transcript bytes',
        messages: [
          {
            id: 'message-preview-1',
            eventTimestamp: '2026-07-02T08:00:00.000Z',
            importedAt: '2026-07-02T08:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Safe preview body',
            reactions: [
              {
                id: 'reaction-private-id',
                emoji: '👍',
                senderKey: 'phone:+48111111111',
                senderPhoneNumber: '+48111111111',
                senderDisplayName: 'Alice',
                direction: 'incoming',
                eventTimestamp: '2026-07-02T08:01:00.000Z',
              },
            ],
          },
        ],
        corrections: [
          {
            userId: USER_ID,
            sourceAccountId: 'source-account-private',
            chatId: 'chat-private',
            sequence: 1,
            messageId: 'source-message-id-private',
            messageRevision: 2,
            changeType: 'edited',
            changedAt: '2026-07-02T08:02:00.000Z',
            eventTimestamp: '2026-07-01T08:00:00.000Z',
            before: {
              state: 'included',
              eventTimestamp: '2026-07-01T08:00:00.000Z',
              importedAt: '2026-07-01T08:00:01.000Z',
              direction: 'incoming',
              speakerLabel: 'Alice',
              messageType: 'text',
              contentKind: 'text',
              content: 'Earlier wording',
              reactions: [],
            },
            after: {
              state: 'included',
              eventTimestamp: '2026-07-01T08:00:00.000Z',
              importedAt: '2026-07-01T08:00:01.000Z',
              direction: 'incoming',
              speakerLabel: 'Alice',
              messageType: 'text',
              contentKind: 'text',
              content: 'Updated wording',
              reactions: [],
            },
            schemaVersion: 1,
          },
        ],
        counts: {
          ...fakePreparedContextAttachmentSnapshot().counts,
          included: 1,
          newlyAvailable: 1,
        },
      };
    }

    async function seedAttachmentSession(): Promise<string> {
      const token = await seed();
      ctx.conversationAssistantContextAttachmentRepository.setSession({
        userId: USER_ID,
        sessionId: 'session-route-1',
        generationId: 'generation-route-1',
        contextVersion: 0,
      });
      return token;
    }

    it('creates with 202, replays the same request, rejects substitution, and exposes only public fields', async () => {
      const token = await seedAttachmentSession();
      const request = {
        method: 'POST' as const,
        url: '/conversation-assistant/sessions/session-route-1/context-attachments',
        headers: { authorization: `Bearer ${token}` },
        payload: { requestId: 'route-request-1' },
      };

      const created = await ctx.app.inject(request);
      const replay = await ctx.app.inject(request);
      const conflict = await ctx.app.inject({
        ...request,
        payload: {
          requestId: 'route-request-1',
          replacesAttachmentId: 'another-draft',
        },
      });
      const injectedBoundary = await ctx.app.inject({
        ...request,
        payload: { requestId: 'route-request-2', cutoffChangeSeq: 999 },
      });

      expect(created.statusCode).toBe(202);
      expect(replay.statusCode).toBe(202);
      expect(conflict.statusCode).toBe(409);
      expect(injectedBoundary.statusCode).toBe(400);
      expect(
        ctx.conversationAssistantOperationalTelemetry.records
          .filter((record) => record.operation === 'attachment_preparation')
          .map((record) => record.outcome)
      ).toEqual(expect.arrayContaining(['created', 'replay', 'conflict']));
      const body = JSON.parse(created.body) as { data: { attachment: Record<string, unknown> } };
      expect(body.data.attachment).toMatchObject({
        status: 'preparing',
        compatibility: 'current',
        newerAvailableCount: 0,
        newerAvailableCorrectionCount: 0,
      });
      expect(body.data.attachment).not.toHaveProperty('sessionId');
      expect(body.data.attachment).not.toHaveProperty('estimatedInputTokens');
      expect(body.data.attachment['counts']).not.toHaveProperty('newlyAvailable');
      for (const privateField of [
        'userId',
        'sessionGenerationId',
        'sourceAccountId',
        'chatId',
        'preparationRequestId',
        'preparationRequestFingerprint',
        'baseContextVersion',
        'baseEventThrough',
        'baseChangeSeq',
        'cutoffChangeSeq',
        'snapshotId',
        'chunkManifest',
        'deltaTranscriptSha256',
        'previousContextChainSha256',
        'resultingContextChainSha256',
        'preparationClaimId',
        'preparationLeaseExpiresAt',
      ]) {
        expect(body.data.attachment).not.toHaveProperty(privateField);
      }
      expect(
        ctx.eventPublisher.getConversationAssistantContextAttachmentPreparationEvents()
      ).toHaveLength(2);
    });

    it('requires authentication and treats a foreign attachment as not found', async () => {
      const token = await seedAttachmentSession();
      ctx.conversationAssistantContextAttachmentRepository.seedAttachment(attachment());
      const foreignToken = await createToken({ sub: 'foreign-user' });
      const url =
        '/conversation-assistant/sessions/session-route-1/context-attachments/attachment-route-1';

      const unauthenticated = await ctx.app.inject({ method: 'GET', url });
      const foreign = await ctx.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${foreignToken}` },
      });
      const owned = await ctx.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(unauthenticated.statusCode).toBe(401);
      expect(foreign.statusCode).toBe(404);
      expect(owned.statusCode).toBe(200);
    });

    it('returns opaque-cursor preview items without hashes, transcript bytes, or reaction identity', async () => {
      const token = await seedAttachmentSession();
      ctx.conversationAssistantContextAttachmentRepository.seedAttachment(
        attachment(),
        previewSnapshot()
      );
      const url =
        '/conversation-assistant/sessions/session-route-1/context-attachments/attachment-route-1/messages';

      const response = await ctx.app.inject({
        method: 'GET',
        url: `${url}?limit=100`,
        headers: { authorization: `Bearer ${token}` },
      });
      const invalidCursor = await ctx.app.inject({
        method: 'GET',
        url: `${url}?cursor=not+a+cursor&limit=1`,
        headers: { authorization: `Bearer ${token}` },
      });
      const invalidLimit = await ctx.app.inject({
        method: 'GET',
        url: `${url}?limit=0`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const serialized = JSON.stringify(JSON.parse(response.body));
      expect(serialized).toContain('Safe preview body');
      expect(serialized).not.toContain('+48111111111');
      expect(serialized).not.toContain('reaction-private-id');
      expect(serialized).not.toContain('private transcript bytes');
      expect(serialized).not.toContain('delta-hash-private');
      expect(serialized).not.toContain('message-preview-1');
      expect(serialized).not.toContain('source-message-id-private');
      expect(serialized).not.toContain('"sequence"');
      expect(invalidCursor.statusCode).toBe(400);
      expect(invalidLimit.statusCode).toBe(400);
    });

    it('idempotently removes only uncommitted drafts and conflicts on committed history', async () => {
      const token = await seedAttachmentSession();
      ctx.conversationAssistantContextAttachmentRepository.seedAttachment(
        attachment(),
        previewSnapshot()
      );
      ctx.conversationAssistantContextAttachmentRepository.seedAttachment(
        attachment({ id: 'attachment-committed', status: 'committed' })
      );
      const draftUrl =
        '/conversation-assistant/sessions/session-route-1/context-attachments/attachment-route-1';

      const removed = await ctx.app.inject({
        method: 'DELETE',
        url: draftUrl,
        headers: { authorization: `Bearer ${token}` },
      });
      const replay = await ctx.app.inject({
        method: 'DELETE',
        url: draftUrl,
        headers: { authorization: `Bearer ${token}` },
      });
      const committed = await ctx.app.inject({
        method: 'DELETE',
        url: `${draftUrl.replace('attachment-route-1', 'attachment-committed')}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(removed.statusCode).toBe(200);
      expect(replay.statusCode).toBe(200);
      expect(committed.statusCode).toBe(409);
      expect(ctx.conversationAssistantContextAttachmentRepository.getSnapshot('attachment-route-1'))
        .toBeUndefined();
    });

    it('requeues a failed attachment, republishes attempt 2, and rejects retry of a ready snapshot', async () => {
      const token = await seedAttachmentSession();
      ctx.conversationAssistantContextAttachmentRepository.seedAttachment(
        attachment({
          status: 'failed',
          preparationError: { code: 'ATTACHMENT_PREPARATION_FAILED', message: 'private' },
        })
      );
      ctx.conversationAssistantContextAttachmentRepository.seedAttachment(
        attachment({ id: 'attachment-ready', status: 'ready' })
      );
      const base = '/conversation-assistant/sessions/session-route-1/context-attachments';

      const failedStatus = await ctx.app.inject({
        method: 'GET',
        url: `${base}/attachment-route-1`,
        headers: { authorization: `Bearer ${token}` },
      });

      const retry = await ctx.app.inject({
        method: 'POST',
        url: `${base}/attachment-route-1/preparation/retry`,
        headers: { authorization: `Bearer ${token}` },
      });
      const invalidState = await ctx.app.inject({
        method: 'POST',
        url: `${base}/attachment-ready/preparation/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(failedStatus.statusCode).toBe(200);
      expect(JSON.parse(failedStatus.body).data.attachment).toMatchObject({
        error: {
          code: 'PREPARATION_FAILED',
          message: 'The context attachment could not be prepared',
        },
      });
      expect(JSON.parse(failedStatus.body).data.attachment).not.toHaveProperty(
        'preparationError'
      );
      expect(retry.statusCode).toBe(202);
      expect(invalidState.statusCode).toBe(409);
      expect(
        ctx.eventPublisher.getConversationAssistantContextAttachmentPreparationEvents()
      ).toContainEqual(
        expect.objectContaining({ attachmentId: 'attachment-route-1', attempt: 2 })
      );
    });

    it('lists initial and committed context summaries from the Web client history path', async () => {
      const token = await seedAttachmentSession();
      ctx.conversationAssistantContextAttachmentRepository.seedAttachment(
        attachment({
          id: 'attachment-committed',
          status: 'committed',
          committedTurnId: 'turn-2',
          committedAt: '2026-07-02T13:00:00.000Z',
          counts: {
            included: 0,
            omitted: 2,
            newlyAvailable: 0,
            edited: 2,
            redacted: 0,
            deleted: 0,
            reactionsChanged: 0,
            lateIngested: 0,
            completedTranscriptions: 1,
          },
          omitted: {
            mediaOnly: 1,
            failedTranscriptions: 0,
            pendingTranscriptions: 1,
            nonText: 0,
            overLimit: 0,
          },
        })
      );

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/conversation-assistant/sessions/session-route-1/context/history',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data.snapshots).toEqual([
        expect.objectContaining({ kind: 'initial', contextVersion: 0 }),
        expect.objectContaining({
          kind: 'update',
          contextVersion: 1,
          messageCount: 0,
          excludedCount: 2,
          correctionCount: 3,
          omitted: {
            mediaOnly: 1,
            failedTranscriptions: 0,
            pendingTranscriptions: 1,
            nonText: 0,
            overLimit: 0,
          },
          attachmentId: 'attachment-committed',
          linkedTurnId: 'turn-2',
          captureRange: {
            from: '2026-07-01T00:00:00.000Z',
            to: '2026-07-02T12:00:00.000Z',
          },
        }),
      ]);
    });

    it('routes maximum-length attachment ids and maps invalid parameters to invalid requests', async () => {
      const token = await seedAttachmentSession();
      const headers = { authorization: `Bearer ${token}` };
      const maximumId = 'a'.repeat(256);
      const longId = 'a'.repeat(257);

      for (const url of [
        `/conversation-assistant/sessions/session-route-1/context-attachments/${maximumId}`,
        `/conversation-assistant/sessions/${maximumId}/context/history`,
      ]) {
        const maximumLengthResponse = await ctx.app.inject({ method: 'GET', url, headers });
        expect(maximumLengthResponse.statusCode, url).toBe(404);
        expect(JSON.parse(maximumLengthResponse.body), url).toMatchObject({
          success: false,
          error: { code: 'NOT_FOUND' },
        });
      }

      const requests = [
        {
          method: 'POST' as const,
          url: '/conversation-assistant/sessions/%20/context-attachments',
          payload: { requestId: 'trimmed-create' },
        },
        {
          method: 'GET' as const,
          url: '/conversation-assistant/sessions/session-route-1/context-attachments/%20',
        },
        {
          method: 'DELETE' as const,
          url: '/conversation-assistant/sessions/session-route-1/context-attachments/%20',
        },
        {
          method: 'POST' as const,
          url: '/conversation-assistant/sessions/session-route-1/context-attachments/%20/preparation/retry',
        },
        {
          method: 'GET' as const,
          url: '/conversation-assistant/sessions/%20/context/history',
        },
        {
          method: 'GET' as const,
          url: `/conversation-assistant/sessions/session-route-1/context-attachments/${longId}`,
        },
        {
          method: 'DELETE' as const,
          url: `/conversation-assistant/sessions/session-route-1/context-attachments/${longId}`,
        },
        {
          method: 'POST' as const,
          url: `/conversation-assistant/sessions/session-route-1/context-attachments/${longId}/preparation/retry`,
        },
        {
          method: 'GET' as const,
          url: `/conversation-assistant/sessions/${longId}/context/history`,
        },
      ];

      for (const request of requests) {
        const response = await ctx.app.inject({ ...request, headers });
        expect(response.statusCode, request.url).toBe(400);
      }
    });

    it('maps every context attachment creation rejection and publication failure', async () => {
      const token = await seedAttachmentSession();
      const headers = { authorization: `Bearer ${token}` };
      const url = '/conversation-assistant/sessions/session-route-1/context-attachments';
      const resolveSpy = vi.spyOn(
        ctx.conversationAssistantContextAttachmentRepository,
        'resolveContextAttachmentSession'
      );

      resolveSpy.mockResolvedValueOnce({ status: 'not_found' });
      const notFound = await ctx.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { requestId: 'creation-not-found' },
      });
      resolveSpy.mockResolvedValueOnce({
        status: 'unsupported',
        reason: 'legacy_session',
      } as never);
      const legacy = await ctx.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { requestId: 'creation-legacy' },
      });
      resolveSpy.mockResolvedValueOnce({
        status: 'unsupported',
        reason: 'source_unavailable',
      } as never);
      const unavailable = await ctx.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { requestId: 'creation-unavailable' },
      });
      const stale = await ctx.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { requestId: 'creation-stale', replacesAttachmentId: 'missing-draft' },
      });

      vi.spyOn(
        ctx.eventPublisher,
        'publishConversationAssistantContextAttachmentPreparation'
      ).mockResolvedValueOnce({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'private publication failure' },
      });
      const publicationFailure = await ctx.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { requestId: 'creation-publication-failure' },
      });

      const configured = getServices();
      const {
        conversationAssistantOperationalTelemetry: _operationalTelemetry,
        ...withoutOperationalTelemetry
      } = configured;
      setServices(withoutOperationalTelemetry);
      const withoutTelemetry = await ctx.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { requestId: 'creation-no-telemetry' },
      });

      expect(notFound.statusCode).toBe(404);
      expect(legacy.statusCode).toBe(409);
      expect(JSON.parse(legacy.body).error.message).toBe(
        'This analysis cannot include later messages'
      );
      expect(unavailable.statusCode).toBe(409);
      expect(JSON.parse(unavailable.body).error.message).toBe(
        'The source conversation is unavailable'
      );
      expect(stale.statusCode).toBe(409);
      expect(publicationFailure.statusCode).toBe(202);
      expect(JSON.parse(publicationFailure.body).data.attachment.status).toBe('failed');
      expect(publicationFailure.body).not.toContain('private publication failure');
      expect(withoutTelemetry.statusCode).toBe(202);
    });

    it('maps source, readiness, missing-resource, and repository exception outcomes', async () => {
      const token = await seedAttachmentSession();
      const headers = { authorization: `Bearer ${token}` };
      const base = '/conversation-assistant/sessions/session-route-1/context-attachments';
      ctx.conversationAssistantContextAttachmentRepository.seedAttachment(attachment());

      ctx.privateWhatsAppRepository.failNext({
        code: 'PERSISTENCE_ERROR',
        message: 'private source lookup failure',
      });
      const sourceUnavailable = await ctx.app.inject({
        method: 'GET',
        url: `${base}/attachment-route-1`,
        headers,
      });
      const notReady = await ctx.app.inject({
        method: 'GET',
        url: `${base}/attachment-route-1/messages`,
        headers,
      });
      const missingDelete = await ctx.app.inject({
        method: 'DELETE',
        url: `${base}/missing-delete`,
        headers,
      });
      const missingRetry = await ctx.app.inject({
        method: 'POST',
        url: `${base}/missing-retry/preparation/retry`,
        headers,
      });

      const repository = ctx.conversationAssistantContextAttachmentRepository;
      vi.spyOn(repository, 'resolveContextAttachmentSession').mockRejectedValueOnce(
        new Error('private create failure')
      );
      const createFailure = await ctx.app.inject({
        method: 'POST',
        url: base,
        headers,
        payload: { requestId: 'throw-create' },
      });
      const getOwnedSpy = vi.spyOn(repository, 'getOwnedContextAttachment');
      getOwnedSpy.mockRejectedValueOnce(new Error('private status failure'));
      const statusFailure = await ctx.app.inject({
        method: 'GET',
        url: `${base}/attachment-route-1`,
        headers,
      });
      vi.spyOn(repository, 'loadOwnedContextAttachmentPreparedSnapshot').mockRejectedValueOnce(
        new Error('private preview failure')
      );
      const previewFailure = await ctx.app.inject({
        method: 'GET',
        url: `${base}/attachment-route-1/messages`,
        headers,
      });
      vi.spyOn(repository, 'deleteOwnedContextAttachmentDraft').mockRejectedValueOnce(
        new Error('private delete failure')
      );
      const deleteFailure = await ctx.app.inject({
        method: 'DELETE',
        url: `${base}/attachment-route-1`,
        headers,
      });
      getOwnedSpy.mockRejectedValueOnce(new Error('private retry failure'));
      const retryFailure = await ctx.app.inject({
        method: 'POST',
        url: `${base}/attachment-route-1/preparation/retry`,
        headers,
      });
      vi.spyOn(repository, 'listOwnedContextHistory').mockRejectedValueOnce(
        new Error('private history failure')
      );
      const historyFailure = await ctx.app.inject({
        method: 'GET',
        url: '/conversation-assistant/sessions/session-route-1/context/history',
        headers,
      });

      expect(sourceUnavailable.statusCode).toBe(409);
      expect(notReady.statusCode).toBe(409);
      expect(missingDelete.statusCode).toBe(404);
      expect(missingRetry.statusCode).toBe(404);
      for (const response of [
        createFailure,
        statusFailure,
        previewFailure,
        deleteFailure,
        retryFailure,
        historyFailure,
      ]) {
        expect(response.statusCode).toBe(500);
        expect(response.body).not.toContain('private');
      }
    });
  });

  it('reports source_unavailable after the private account disconnects while keeping history readable', async () => {
    const token = await seed();
    const sessionId = await createSessionWithFirstTurn(token);
    ctx.conversationAssistantContextAttachmentRepository.setSession({
      userId: USER_ID,
      sessionId,
      generationId: 'history-generation',
      contextVersion: 0,
    });

    const before = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(before.body).data.session.contextSummary.availability).toEqual({
      state: 'available',
      displayTimeZone: 'UTC',
    });
    expect(JSON.parse(before.body).data.session.contextSummary.displayTimeZone).toBe('UTC');

    await ctx.privateWhatsAppRepository.disableAccount({
      userId: USER_ID,
      now: '2026-07-03T00:00:00.000Z',
    });
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/conversation-assistant/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    const history = await ctx.app.inject({
      method: 'GET',
      url: `/conversation-assistant/sessions/${sessionId}/context/history`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).data.session).toMatchObject({
      contextSummary: {
        displayTimeZone: 'UTC',
        availability: { state: 'source_unavailable' },
      },
    });
    expect(JSON.parse(list.body).data.sessions[0]).toMatchObject({
      contextSummary: {
        displayTimeZone: 'UTC',
        availability: { state: 'source_unavailable' },
      },
    });
    expect(history.statusCode).toBe(200);
  });

  it('maps an erasure-fenced Conversation Assistant read surface to hidden resources', async () => {
    const token = await seed();
    const headers = { authorization: `Bearer ${token}` };
    const sessionId = 'session-hidden-by-erasure-fence';
    vi.spyOn(ctx.conversationAssistantRepository, 'getSessionById').mockResolvedValue(null);
    vi.spyOn(ctx.conversationAssistantRepository, 'getSessionSnapshotById').mockResolvedValue(null);
    vi.spyOn(ctx.conversationAssistantRepository, 'listSessionsByUserId').mockResolvedValue([]);
    vi.spyOn(
      ctx.conversationAssistantContextAttachmentRepository,
      'getOwnedContextAttachment'
    ).mockResolvedValue({ status: 'not_found' });
    vi.spyOn(
      ctx.conversationAssistantContextAttachmentRepository,
      'loadOwnedContextAttachmentPreparedSnapshot'
    ).mockResolvedValue({ status: 'not_found' });
    vi.spyOn(
      ctx.conversationAssistantContextAttachmentRepository,
      'listOwnedContextHistory'
    ).mockResolvedValue({ status: 'not_found' });
    vi.spyOn(ctx.conversationAssistantTurnRequestRepository, 'getTurnRequest').mockResolvedValue({
      status: 'not_found',
    });

    const [list, detail, context, turns, pdf, attachment, preview, history, turnRequest] =
      await Promise.all([
        ctx.app.inject({ method: 'GET', url: '/conversation-assistant/sessions', headers }),
        ctx.app.inject({
          method: 'GET',
          url: `/conversation-assistant/sessions/${sessionId}`,
          headers,
        }),
        ctx.app.inject({
          method: 'GET',
          url: `/conversation-assistant/sessions/${sessionId}/context`,
          headers,
        }),
        ctx.app.inject({
          method: 'GET',
          url: `/conversation-assistant/sessions/${sessionId}/turns`,
          headers,
        }),
        ctx.app.inject({
          method: 'GET',
          url: `/conversation-assistant/sessions/${sessionId}/export.pdf`,
          headers,
        }),
        ctx.app.inject({
          method: 'GET',
          url: `/conversation-assistant/sessions/${sessionId}/context-attachments/attachment-hidden`,
          headers,
        }),
        ctx.app.inject({
          method: 'GET',
          url: `/conversation-assistant/sessions/${sessionId}/context-attachments/attachment-hidden/messages`,
          headers,
        }),
        ctx.app.inject({
          method: 'GET',
          url: `/conversation-assistant/sessions/${sessionId}/context/history`,
          headers,
        }),
        ctx.app.inject({
          method: 'GET',
          url: `/conversation-assistant/sessions/${sessionId}/turn-requests/request-hidden`,
          headers,
        }),
      ]);

    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).data.sessions).toEqual([]);
    for (const response of [
      detail,
      context,
      turns,
      pdf,
      attachment,
      preview,
      history,
      turnRequest,
    ]) {
      expect(response.statusCode).toBe(404);
    }
  });
});
