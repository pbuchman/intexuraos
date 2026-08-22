import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkConversationAssistantContext,
  createConversationAssistantSession,
  deleteConversationAssistantSession,
  exportConversationAssistantSessionPdf,
  getConversationAssistantContext,
  getConversationAssistantContextHistory,
  getConversationAssistantSession,
  getConversationAssistantSessionByRequest,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
  retryConversationAssistantPreparation,
  resumeConversationAssistantTurnRequest,
  sendConversationAssistantTurn,
  streamConversationAssistantTurn,
} from '../conversationAssistantApi.js';
import { ApiError } from '../apiClient.js';

vi.mock('../apiClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apiClient.js')>();
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

vi.mock('../../config', () => ({
  config: {
    whatsappServiceUrl: 'https://wa.test',
  },
}));

const TOKEN = 'access-token';

const publicSession = {
  id: 'session-1',
  chatDisplayName: 'Alice',
  status: 'ready' as const,
  preparationStage: 'ready' as const,
  preparationAttempt: 1,
  range: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
  effectiveRange: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
  model: 'or:minimax/minimax-m2.5',
  modelDisplayName: 'MiniMax M2.5',
  transcriptMessageCount: 1,
  assistantRoleLabel: 'Assistant',
  omitted: {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  },
  title: 'Conversation with Alice',
  createdAt: '2026-06-02T00:00:01.000Z',
  updatedAt: '2026-06-02T00:00:02.000Z',
  deletionToken: 'deletion-token',
  deletionPending: false,
  contextSummary: {
    displayTimeZone: 'Europe/Warsaw',
    availability: { state: 'available' as const, displayTimeZone: 'Europe/Warsaw' },
    contextVersion: 0,
    snapshotCount: 1,
    totalAttachedMessageCount: 0,
    totalAttachedOmittedCount: 0,
    completedConversationRevision: 0,
    activeTurn: null,
  },
};

const privateSessionResponse = {
  ...publicSession,
  userId: 'must-not-reach-web-state',
  chatId: 'must-not-reach-web-state',
  sourceAccountId: 'must-not-reach-web-state',
  sourceAccountGeneration: 'must-not-reach-web-state',
  transcriptSha256: 'must-not-reach-web-state',
  generationId: 'must-not-reach-web-state',
  contextContinuationAvailable: true,
  contextContinuationState: 'available',
  contextVersion: 999,
  displayTimeZone: 'Private/Legacy',
  attachmentCount: 999,
  completedConversationRevision: 999,
  activeTurn: { requestId: 'legacy-parallel-representation', stateVersion: 999 },
};

describe('conversationAssistantApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists conversation assistant sessions from the WhatsApp service base URL', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ sessions: [privateSessionResponse] });

    const result = await listConversationAssistantSessions(TOKEN);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions',
      TOKEN
    );
    expect(result).toEqual({ sessions: [publicSession] });
  });

  it('keeps actionable context-window preparation details in web state', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const preparationError = {
      code: 'CONTEXT_WINDOW_EXCEEDED',
      message: 'Selected context is too large',
      estimatedPromptTokens: 1_000_001,
      promptTokenBudget: 934_464,
      recommendedRange: {
        from: '2026-06-01T12:00:00.000Z',
        to: '2026-06-02T00:00:00.000Z',
      },
    };
    vi.mocked(apiRequest).mockResolvedValue({
      sessions: [{ ...privateSessionResponse, status: 'failed', preparationError }],
    });

    const result = await listConversationAssistantSessions(TOKEN);

    expect(result.sessions[0]?.preparationError).toEqual(preparationError);
  });

  it('degrades old or malformed server payloads to a safe legacy context summary during rollout', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const { contextSummary: _contextSummary, ...oldServerSession } = privateSessionResponse;
    const safeLegacySummary = {
      displayTimeZone: 'UTC',
      availability: { state: 'legacy_session' },
      contextVersion: 0,
      snapshotCount: 0,
      totalAttachedMessageCount: 0,
      totalAttachedOmittedCount: 0,
      completedConversationRevision: 0,
      activeTurn: null,
    };

    for (const contextSummary of [undefined, null, { availability: { state: 'available' } }]) {
      vi.mocked(apiRequest).mockResolvedValueOnce({
        sessions: [
          contextSummary === undefined
            ? oldServerSession
            : { ...oldServerSession, contextSummary },
        ],
      });

      const result = await listConversationAssistantSessions(TOKEN);

      expect(result.sessions[0]?.contextSummary).toEqual(safeLegacySummary);
    }
  });

  it('preserves the display timezone when continuation becomes unavailable', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      sessions: [
        {
          ...privateSessionResponse,
          contextSummary: {
            ...publicSession.contextSummary,
            displayTimeZone: 'Europe/Warsaw',
            availability: { state: 'source_unavailable' },
          },
        },
      ],
    });

    const result = await listConversationAssistantSessions(TOKEN);

    expect(result.sessions[0]?.contextSummary).toMatchObject({
      displayTimeZone: 'Europe/Warsaw',
      availability: { state: 'source_unavailable' },
    });
  });

  it('creates a conversation assistant session with a POST body', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ session: privateSessionResponse });

    const request = {
      requestId: 'request-1',
      chatId: 'chat-1',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-02T00:00:00.000Z',
      model: 'or:anthropic/claude-sonnet-5' as const,
    };

    const result = await createConversationAssistantSession(TOKEN, request);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions',
      TOKEN,
      {
        method: 'POST',
        body: request,
      }
    );
    expect(result).toEqual(publicSession);
  });

  it('recovers a session by the client creation request id', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const recovered = { ...privateSessionResponse, id: 'session-recovered' };
    vi.mocked(apiRequest).mockResolvedValue({ session: recovered });

    const result = await getConversationAssistantSessionByRequest(TOKEN, 'request/with spaces');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/session-requests/request%2Fwith%20spaces',
      TOKEN
    );
    expect(result).toEqual({ ...publicSession, id: 'session-recovered' });
  });

  it('resumes a durable turn request without resending its question body', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const response = {
      request: {
        id: 'request/with spaces',
        sessionId: 'session/with spaces',
        status: 'in_progress' as const,
        attempt: 2,
        stateVersion: 2,
        conversationRevision: 1,
      },
      turns: [],
      canRetryAnswer: false,
    };
    vi.mocked(apiRequest).mockResolvedValue(response);

    await expect(
      resumeConversationAssistantTurnRequest(TOKEN, 'session/with spaces', 'request/with spaces')
    ).resolves.toEqual(response);
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces/turn-requests/request%2Fwith%20spaces/resume',
      TOKEN,
      { method: 'POST' }
    );
  });

  it('retries preparation for an existing session', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const retried = {
      ...privateSessionResponse,
      id: 'session/retry',
      status: 'preparing' as const,
      preparationStage: 'queued' as const,
    };
    vi.mocked(apiRequest).mockResolvedValue({ session: retried });

    const result = await retryConversationAssistantPreparation(TOKEN, 'session/retry');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fretry/preparation/retry',
      TOKEN,
      { method: 'POST' }
    );
    expect(result).toEqual({
      ...publicSession,
      id: 'session/retry',
      status: 'preparing',
      preparationStage: 'queued',
    });
  });

  it('checks conversation context size with a POST body', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      messageCount: 5001,
      warningThreshold: 5000,
      requiresConfirmation: true,
    });

    const request = {
      chatId: 'chat-1',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-02T00:00:00.000Z',
    };

    const result = await checkConversationAssistantContext(TOKEN, request);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/context/check',
      TOKEN,
      {
        method: 'POST',
        body: request,
      }
    );
    expect(result.requiresConfirmation).toBe(true);
  });

  it('loads a single conversation assistant session with URL-encoded session ids', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const loaded = { ...privateSessionResponse, id: 'session/with spaces?' };
    vi.mocked(apiRequest).mockResolvedValue({ session: loaded });

    const result = await getConversationAssistantSession(TOKEN, 'session/with spaces?');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F',
      TOKEN
    );
    expect(result).toEqual({ ...publicSession, id: 'session/with spaces?' });
  });

  it('deletes a conversation assistant session with a URL-encoded id', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ deleted: true });

    await deleteConversationAssistantSession(TOKEN, 'session/with spaces?', 'delete-token');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F',
      TOKEN,
      {
        method: 'DELETE',
        headers: { 'X-Conversation-Assistant-Deletion-Token': 'delete-token' },
      }
    );
  });

  it('loads the frozen context with a URL-encoded session id', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const privateContext = {
      sessionId: 'session/with spaces?',
      messages: [
        {
          id: 'context-item-safe',
          eventTimestamp: '2026-06-01T10:00:00.000Z',
          importedAt: '2026-06-01T10:00:01.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
          contentKind: 'text',
          content: 'Hello',
          sourceMessageId: 'must-not-reach-web-state',
          reactions: [
            {
              id: 'context-reaction-safe',
              emoji: '👍',
              direction: 'incoming',
              eventTimestamp: '2026-06-01T10:00:02.000Z',
              senderDisplayName: 'Alice',
              senderPhoneNumber: 'must-not-reach-web-state',
            },
          ],
        },
      ],
      omittedMessages: [
        {
          id: 'context-item-omitted',
          eventTimestamp: '2026-06-01T10:01:00.000Z',
          importedAt: '2026-06-01T10:01:01.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'reaction',
          omissionReason: 'non_text',
          reaction: {
            emoji: '❤️',
            targetReference: 'context-item-safe',
            targetMessageId: 'must-not-reach-web-state',
          },
        },
      ],
      messageCount: 1,
      omittedMessageCount: 1,
      snapshotAvailable: true,
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
      transcriptSha256: 'hash',
    };
    vi.mocked(apiRequest).mockResolvedValue(privateContext);

    const result = await getConversationAssistantContext(TOKEN, 'session/with spaces?');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F/context',
      TOKEN
    );
    expect(result).toEqual({
      sessionId: privateContext.sessionId,
      messages: [
        {
          id: 'context-item-safe',
          eventTimestamp: '2026-06-01T10:00:00.000Z',
          importedAt: '2026-06-01T10:00:01.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
          contentKind: 'text',
          content: 'Hello',
          reactions: [
            {
              id: 'context-reaction-safe',
              emoji: '👍',
              direction: 'incoming',
              eventTimestamp: '2026-06-01T10:00:02.000Z',
              senderDisplayName: 'Alice',
            },
          ],
        },
      ],
      omittedMessages: [
        {
          id: 'context-item-omitted',
          eventTimestamp: '2026-06-01T10:01:00.000Z',
          importedAt: '2026-06-01T10:01:01.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'reaction',
          omissionReason: 'non_text',
          reaction: { emoji: '❤️', targetReference: 'context-item-safe' },
        },
      ],
      messageCount: 1,
      omittedMessageCount: 1,
      snapshotAvailable: true,
      omitted: privateContext.omitted,
    });
    expect(result).not.toHaveProperty('transcriptSha256');
  });

  it('projects auditable correction and omission metadata in context history', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      snapshots: [
        {
          kind: 'update',
          contextVersion: 1,
          capturedAt: '2026-07-21T10:00:00.000Z',
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
          attachmentId: 'attachment-history',
          linkedTurnId: 'turn-history',
          captureRange: {
            from: '2026-07-20T10:00:00.000Z',
            to: '2026-07-21T10:00:00.000Z',
          },
          privateHash: 'must-not-reach-web-state',
        },
      ],
    });

    const result = await getConversationAssistantContextHistory(
      TOKEN,
      'session/with spaces'
    );

    expect(result.snapshots).toEqual([
      {
        kind: 'update',
        contextVersion: 1,
        capturedAt: '2026-07-21T10:00:00.000Z',
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
        attachmentId: 'attachment-history',
        linkedTurnId: 'turn-history',
        captureRange: {
          from: '2026-07-20T10:00:00.000Z',
          to: '2026-07-21T10:00:00.000Z',
        },
      },
    ]);
  });

  it('loads the next frozen-context page with independent cursors', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      sessionId: 'session-1',
      messages: [],
      omittedMessages: [],
      messageCount: 0,
      omittedMessageCount: 0,
      snapshotAvailable: true,
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
    });

    await getConversationAssistantContext(TOKEN, 'session-1', {
      messageCursor: 100,
      omittedCursor: 25,
    });

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session-1/context?messageCursor=100&omittedCursor=25',
      TOKEN
    );
  });

  it('lists conversation assistant turns with URL-encoded session ids', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      turns: [
        {
          id: 'turn-1',
          sessionId: 'session/with spaces?',
          userId: 'must-not-reach-web-state',
          role: 'user',
          text: 'Hello',
          canRetryAnswer: false,
          createdAt: '2026-06-01T10:00:00.000Z',
        },
      ],
    });

    const result = await listConversationAssistantTurns(TOKEN, 'session/with spaces?');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F/turns',
      TOKEN
    );
    expect(result).toEqual({
      turns: [
        {
          id: 'turn-1',
          sessionId: 'session/with spaces?',
          role: 'user',
          text: 'Hello',
          canRetryAnswer: false,
          createdAt: '2026-06-01T10:00:00.000Z',
        },
      ],
    });
  });

  it('sends a conversation assistant turn with a POST body and URL-encoded session id', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ turns: [{ id: 'turn-1' }] });

    const request = {
      question: 'Summarize the disagreement.',
    };

    await sendConversationAssistantTurn(TOKEN, 'session/with spaces?', request);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F/turns',
      TOKEN,
      {
        method: 'POST',
        body: request,
      }
    );
  });

  it('streams a conversation assistant turn and parses split SSE frames', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode('event: user_turn\ndata: {"type":"user_turn","turn":{"id":"turn-1"')
        );
        controller.enqueue(
          encoder.encode(
            ',"sessionId":"session/with spaces?","userId":"user-1","role":"user","text":"Hi","createdAt":"2026-06-01T00:00:00.000Z"}}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode('event: assistant_delta\ndata: {"type":"assistant_delta","text":"Hello"}\n\n')
        );
        controller.enqueue(
          encoder.encode(
            'event: assistant_turn\ndata: {"type":"assistant_turn","turn":{"id":"turn-2","sessionId":"session/with spaces?","userId":"user-1","role":"assistant","text":"Hello","createdAt":"2026-06-01T00:00:01.000Z"}}\n\n'
          )
        );
        controller.enqueue(encoder.encode('event: done\ndata: {"type":"done"}\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    );
    const events: unknown[] = [];

    await streamConversationAssistantTurn(
      TOKEN,
      'session/with spaces?',
      { question: 'Hi' },
      (event) => events.push(event)
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://wa.test/conversation-assistant/sessions/session%2Fwith%20spaces%3F/turns/stream',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ question: 'Hi' }),
        cache: 'no-store',
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        }),
      })
    );
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      'user_turn',
      'assistant_delta',
      'assistant_turn',
      'done',
    ]);
    expect(JSON.stringify(events)).not.toContain('userId');
  });

  it('rejects an acknowledged error stream even when it ends with done', async () => {
    const encoder = new TextEncoder();
    const frames = [
      'event: user_turn\ndata: {"type":"user_turn","turn":{"id":"turn-1","sessionId":"session-1","userId":"user-1","role":"user","text":"Hi","createdAt":"2026-06-01T00:00:00.000Z"}}\n\n',
      'event: assistant_delta\ndata: {"type":"assistant_delta","text":"Partial"}\n\n',
      'event: error\ndata: {"type":"error","error":{"code":"LLM_ERROR","message":"Disconnected"}}\n\n',
      'event: done\ndata: {"type":"done"}\n\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(encoder.encode(frames.join('')));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    );

    await expect(
      streamConversationAssistantTurn(TOKEN, 'session-1', { question: 'Hi' }, vi.fn())
    ).rejects.toThrow('Assistant response stream ended before completion');
  });

  it('accepts a persisted model error when the assistant turn and stream both complete', async () => {
    const encoder = new TextEncoder();
    const frames = [
      'event: user_turn\ndata: {"type":"user_turn","turn":{"id":"turn-1","sessionId":"session-1","userId":"user-1","role":"user","text":"Hi","createdAt":"2026-06-01T00:00:00.000Z"}}\n\n',
      'event: assistant_delta\ndata: {"type":"assistant_delta","text":"Partial"}\n\n',
      'event: error\ndata: {"type":"error","error":{"code":"LLM_ERROR","message":"Disconnected"}}\n\n',
      'event: assistant_turn\ndata: {"type":"assistant_turn","turn":{"id":"turn-2","sessionId":"session-1","userId":"user-1","role":"assistant","text":"Partial","createdAt":"2026-06-01T00:00:01.000Z","error":{"code":"LLM_ERROR","message":"Disconnected"}}}\n\n',
      'event: done\ndata: {"type":"done"}\n\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(encoder.encode(frames.join('')));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    );
    const events: unknown[] = [];

    await expect(
      streamConversationAssistantTurn(TOKEN, 'session-1', { question: 'Hi' }, (event) =>
        events.push(event)
      )
    ).resolves.toBeUndefined();
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      'user_turn',
      'assistant_delta',
      'error',
      'assistant_turn',
      'done',
    ]);
  });

  it.each([
    { name: 'empty', frames: '' },
    {
      name: 'user acknowledgement only',
      frames:
        'event: user_turn\ndata: {"type":"user_turn","turn":{"id":"turn-1","sessionId":"session-1","userId":"user-1","role":"user","text":"Hi","createdAt":"2026-06-01T00:00:00.000Z"}}\n\n',
    },
    {
      name: 'partial assistant answer',
      frames:
        'event: user_turn\ndata: {"type":"user_turn","turn":{"id":"turn-1","sessionId":"session-1","userId":"user-1","role":"user","text":"Hi","createdAt":"2026-06-01T00:00:00.000Z"}}\n\nevent: assistant_delta\ndata: {"type":"assistant_delta","text":"Partial"}\n\n',
    },
  ])('rejects a $name stream that closes without a done event', async ({ frames }) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        if (frames !== '') controller.enqueue(encoder.encode(frames));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    );

    await expect(
      streamConversationAssistantTurn(TOKEN, 'session-1', { question: 'Hi' }, vi.fn())
    ).rejects.toMatchObject<ApiError>({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Assistant response stream ended before completion',
    });
  });

  it('exports conversation assistant PDF with filename from content disposition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('pdf-bytes', {
          status: 200,
          headers: {
            'Content-Disposition': 'attachment; filename="alice-context.pdf"',
            'Content-Type': 'application/pdf',
          },
        })
      )
    );

    const result = await exportConversationAssistantSessionPdf(TOKEN, 'session/with spaces?');

    expect(fetch).toHaveBeenCalledWith(
      'https://wa.test/conversation-assistant/sessions/session%2Fwith%20spaces%3F/export.pdf',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
        }),
      })
    );
    expect(result.filename).toBe('alice-context.pdf');
    expect(result.blob.type).toBe('application/pdf');
    expect(result.blob.size).toBe(9);
  });

  it('exports conversation assistant PDF and throws ApiError for API envelopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'FORBIDDEN',
              message: 'No export access',
              details: { reason: 'policy' },
            },
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
    );

    await expect(
      exportConversationAssistantSessionPdf(TOKEN, 'session-1')
    ).rejects.toMatchObject<ApiError>({
      code: 'FORBIDDEN',
      message: 'No export access',
      status: 403,
      details: { reason: 'policy' },
    });
  });

  it('exports conversation assistant PDF with UTF-8 filename and fallback when missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(
          new Response(new Blob(['pdf-bytes'], { type: 'application/pdf' }), {
            status: 200,
            headers: {
              'Content-Disposition':
                "attachment; filename*=UTF-8''alice%20context%20%E2%82%AC.pdf",
            },
          })
        )
        .mockResolvedValueOnce(
          new Response(new Blob(['pdf-bytes'], { type: 'application/pdf' }), {
            status: 200,
            headers: { 'Content-Type': 'application/pdf' },
          })
        )
    );

    const utf8Result = await exportConversationAssistantSessionPdf(TOKEN, 'session-utf8');
    const fallbackResult = await exportConversationAssistantSessionPdf(TOKEN, 'session-1');

    expect(utf8Result.filename).toBe('alice context €.pdf');
    expect(fallbackResult.filename).toBe('conversation-assistant-session-1.pdf');
  });
});
