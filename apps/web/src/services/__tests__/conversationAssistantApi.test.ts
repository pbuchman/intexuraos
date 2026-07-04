import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkConversationAssistantContext,
  createConversationAssistantSession,
  exportConversationAssistantSessionPdf,
  getConversationAssistantSession,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
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

describe('conversationAssistantApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists conversation assistant sessions from the WhatsApp service base URL', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ sessions: [] });

    await listConversationAssistantSessions(TOKEN);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions',
      TOKEN
    );
  });

  it('creates a conversation assistant session with a POST body', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const session = { id: 'session-1' };
    vi.mocked(apiRequest).mockResolvedValue({ session, turns: [] });

    const request = {
      chatId: 'chat-1',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-02T00:00:00.000Z',
      model: 'or:anthropic/claude-sonnet-5' as const,
      question: 'What happened?',
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
    expect(result).toEqual(session);
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
    const session = { id: 'session/with spaces?' };
    vi.mocked(apiRequest).mockResolvedValue({ session });

    const result = await getConversationAssistantSession(TOKEN, 'session/with spaces?');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F',
      TOKEN
    );
    expect(result).toEqual(session);
  });

  it('lists conversation assistant turns with URL-encoded session ids', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ turns: [] });

    await listConversationAssistantTurns(TOKEN, 'session/with spaces?');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces%3F/turns',
      TOKEN
    );
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
      'done',
    ]);
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
    await expect(result.blob.text()).resolves.toBe('pdf-bytes');
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
