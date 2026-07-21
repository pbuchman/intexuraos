import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationAssistantContextAttachment,
  getConversationAssistantContextAttachment,
  getConversationAssistantContextAttachmentPreview,
  getConversationAssistantContextHistory,
  getConversationAssistantTurnRequest,
  removeConversationAssistantContextAttachment,
  retryConversationAssistantContextAttachment,
  retryConversationAssistantTurnAnswer,
  streamConversationAssistantTurn,
} from '../conversationAssistantApi.js';

vi.mock('../apiClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apiClient.js')>();
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock('../../config', () => ({
  config: { whatsappServiceUrl: 'https://wa.test' },
}));

const TOKEN = 'access-token';
const sessionId = 'session/with spaces';
const attachmentId = 'attachment/with spaces';
const requestId = 'request/with spaces';

const attachmentResponse = {
  attachment: {
    id: attachmentId,
    sessionId,
    status: 'ready',
    compatibility: 'current',
    capturedAt: '2026-07-21T10:00:00.000Z',
    captureRange: {
      from: '2026-07-20T10:00:00.000Z',
      to: '2026-07-21T10:00:00.000Z',
    },
    counts: {
      included: 2,
      excluded: 1,
      newlyAvailable: 2,
      edited: 0,
      redacted: 0,
      deleted: 0,
      reactionsChanged: 0,
      lateIngested: 0,
      completedTranscriptions: 0,
    },
    omitted: {
      mediaOnly: 1,
      failedTranscriptions: 0,
      pendingTranscriptions: 0,
      nonText: 0,
      overLimit: 0,
    },
    requiresConfirmation: false,
    newerAvailableCount: 0,
    newerAvailableCorrectionCount: 0,
    sourceAccountId: 'must-not-reach-web-state',
    cutoffChangeSeq: 42,
    transcriptSha256: 'must-not-reach-web-state',
    preparationClaimId: 'must-not-reach-web-state',
  },
};

describe('Conversation Assistant attachment API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates an attachment with only request intent and strips private response fields', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue(attachmentResponse);
    const signal = new AbortController().signal;

    const result = await createConversationAssistantContextAttachment(
      TOKEN,
      sessionId,
      { requestId, replacesAttachmentId: 'old/attachment' },
      signal
    );

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces/context-attachments',
      TOKEN,
      {
        method: 'POST',
        body: { requestId, replacesAttachmentId: 'old/attachment' },
        signal,
      }
    );
    expect(result).toEqual({
      id: attachmentId,
      status: 'ready',
      compatibility: 'current',
      capturedAt: '2026-07-21T10:00:00.000Z',
      captureRange: {
        from: '2026-07-20T10:00:00.000Z',
        to: '2026-07-21T10:00:00.000Z',
      },
      counts: {
        included: 2,
        excluded: 1,
        completedTranscriptions: 0,
        edited: 0,
        redacted: 0,
        reactionsChanged: 0,
        lateIngested: 0,
      },
      omitted: attachmentResponse.attachment.omitted,
      requiresConfirmation: false,
      newerAvailableCount: 0,
      newerAvailableCorrectionCount: 0,
    });
    expect(result).not.toHaveProperty('sessionId');
    expect(result.counts).not.toHaveProperty('newlyAvailable');
  });

  it('loads encoded status and forwards the abort signal', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue(attachmentResponse);
    const signal = new AbortController().signal;

    await getConversationAssistantContextAttachment(TOKEN, sessionId, attachmentId, signal);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces/context-attachments/attachment%2Fwith%20spaces',
      TOKEN,
      { signal }
    );
  });

  it('loads an opaque-cursor preview and strips unknown response fields', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      items: [
        {
          kind: 'included',
          message: {
            id: 'message-1',
            eventTimestamp: '2026-07-21T09:00:00.000Z',
            importedAt: '2026-07-21T09:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'text',
            contentKind: 'text',
            content: 'Visible preview',
            reactions: [
              {
                emoji: '❤️',
                direction: 'incoming',
                eventTimestamp: '2026-07-21T09:00:02.000Z',
                senderDisplayName: 'Contact',
                senderPhoneNumber: 'must-not-reach-web-state',
              },
            ],
            rawMatrixEvent: { private: true },
          },
        },
        {
          kind: 'correction',
          sequence: 7,
          changeKind: 'redacted',
          targetReference: 'message-1',
          before: { state: 'unavailable', content: 'must not be returned for a redaction' },
          after: {
            state: 'redacted',
            eventTimestamp: '2026-07-21T09:00:00.000Z',
            importedAt: '2026-07-21T09:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'text',
            content: 'must-not-reach-web-state',
          },
          sourceAccountId: 'must-not-reach-web-state',
        },
      ],
      nextCursor: 'opaque/cursor',
      sourceAccountId: 'private',
    });

    const result = await getConversationAssistantContextAttachmentPreview(
      TOKEN,
      sessionId,
      attachmentId,
      { cursor: 'opaque/cursor', limit: 25 }
    );

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces/context-attachments/attachment%2Fwith%20spaces/messages?cursor=opaque%2Fcursor&limit=25',
      TOKEN,
      {}
    );
    expect(result).toEqual({
      items: [
        {
          kind: 'included',
          message: {
            id: 'message-1',
            eventTimestamp: '2026-07-21T09:00:00.000Z',
            importedAt: '2026-07-21T09:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'text',
            contentKind: 'text',
            content: 'Visible preview',
            reactions: [
              {
                emoji: '❤️',
                direction: 'incoming',
                eventTimestamp: '2026-07-21T09:00:02.000Z',
                senderDisplayName: 'Contact',
              },
            ],
          },
        },
        {
          kind: 'correction',
          changeKind: 'redacted',
          targetReference: 'message-1',
          before: { state: 'unavailable' },
          after: {
            state: 'redacted',
            eventTimestamp: '2026-07-21T09:00:00.000Z',
            importedAt: '2026-07-21T09:00:01.000Z',
            direction: 'incoming',
            speakerLabel: 'Contact',
            messageType: 'text',
          },
        },
      ],
      nextCursor: 'opaque/cursor',
    });
  });

  it('removes and retries only the encoded attachment id', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ deleted: true })
      .mockResolvedValueOnce(attachmentResponse);

    await removeConversationAssistantContextAttachment(TOKEN, sessionId, attachmentId);
    await retryConversationAssistantContextAttachment(TOKEN, sessionId, attachmentId);

    const base =
      '/conversation-assistant/sessions/session%2Fwith%20spaces/context-attachments/attachment%2Fwith%20spaces';
    expect(vi.mocked(apiRequest)).toHaveBeenNthCalledWith(1, 'https://wa.test', base, TOKEN, {
      method: 'DELETE',
    });
    expect(vi.mocked(apiRequest)).toHaveBeenNthCalledWith(
      2,
      'https://wa.test',
      `${base}/preparation/retry`,
      TOKEN,
      { method: 'POST' }
    );
  });

  it('loads immutable context history with encoded session id', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      snapshots: [
        {
          kind: 'initial',
          contextVersion: 0,
          capturedAt: '2026-07-20T10:00:00.000Z',
          messageCount: 5,
          excludedCount: 1,
          correctionCount: 0,
          omitted: {
            mediaOnly: 1,
            failedTranscriptions: 0,
            pendingTranscriptions: 0,
            nonText: 0,
            overLimit: 0,
          },
        },
      ],
    });

    const result = await getConversationAssistantContextHistory(TOKEN, sessionId);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces/context/history',
      TOKEN,
      {}
    );
    expect(result.snapshots[0]).toMatchObject({ kind: 'initial', contextVersion: 0 });
  });
});

describe('Conversation Assistant durable turn API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads durable request status and strips request internals', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      request: {
        id: requestId,
        sessionId,
        status: 'failed',
        attempt: 1,
        stateVersion: 3,
        conversationRevision: 2,
        contextAttachmentId: attachmentId,
        error: { code: 'MODEL_FAILED', message: 'The answer could not be generated' },
        requestFingerprint: 'private',
        claimId: 'private',
      },
      turns: [
        {
          id: 'turn-1',
          sessionId,
          userId: 'user-1',
          role: 'user',
          text: 'What changed?',
          createdAt: '2026-07-21T10:02:00.000Z',
          contextAttachment: {
            id: attachmentId,
            capturedAt: '2026-07-21T10:00:00.000Z',
            captureRange: attachmentResponse.attachment.captureRange,
            counts: attachmentResponse.attachment.counts,
            omitted: attachmentResponse.attachment.omitted,
            confirmationToken: 'must-not-reach-web-state',
            preparationClaimId: 'must-not-reach-web-state',
          },
        },
      ],
      canRetryAnswer: true,
    });

    const result = await getConversationAssistantTurnRequest(TOKEN, sessionId, requestId);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces/turn-requests/request%2Fwith%20spaces',
      TOKEN,
      {}
    );
    expect(result).toEqual({
      request: {
        id: requestId,
        sessionId,
        status: 'failed',
        attempt: 1,
        stateVersion: 3,
        conversationRevision: 2,
        contextAttachmentId: attachmentId,
        error: { code: 'MODEL_FAILED', message: 'The answer could not be generated' },
      },
      turns: [
        {
          id: 'turn-1',
          sessionId,
          role: 'user',
          text: 'What changed?',
          createdAt: '2026-07-21T10:02:00.000Z',
          contextAttachment: {
            id: attachmentId,
            capturedAt: '2026-07-21T10:00:00.000Z',
            captureRange: attachmentResponse.attachment.captureRange,
            counts: {
              included: 2,
              excluded: 1,
              completedTranscriptions: 0,
              edited: 0,
              redacted: 0,
              reactionsChanged: 0,
              lateIngested: 0,
            },
            omitted: attachmentResponse.attachment.omitted,
          },
        },
      ],
      canRetryAnswer: true,
    });
  });

  it('starts an attachment turn with the same request id and abort signal', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode(
            `event: request_state\ndata: {"type":"request_state","requestId":"${requestId}","streamSequence":1,"request":{"id":"${requestId}","sessionId":"${sessionId}","status":"in_progress","attempt":1,"stateVersion":1,"conversationRevision":2}}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(
            `event: user_turn\ndata: {"type":"user_turn","requestId":"${requestId}","streamSequence":2,"turn":{"id":"turn-1","sessionId":"${sessionId}","userId":"user-1","role":"user","text":"Question","createdAt":"2026-07-21T10:00:00.000Z"}}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(
            `event: assistant_turn\ndata: {"type":"assistant_turn","requestId":"${requestId}","streamSequence":3,"turn":{"id":"turn-2","sessionId":"${sessionId}","userId":"user-1","role":"assistant","text":"Answer","createdAt":"2026-07-21T10:00:01.000Z"}}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: {"type":"done","requestId":"${requestId}","streamSequence":4}\n\n`
          )
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      )
    );
    const signal = new AbortController().signal;

    await streamConversationAssistantTurn(
      TOKEN,
      sessionId,
      {
        requestId,
        question: 'Question',
        contextAttachmentId: attachmentId,
        confirmationToken: 'server-token',
      },
      vi.fn(),
      signal
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://wa.test/conversation-assistant/sessions/session%2Fwith%20spaces/turns/stream',
      expect.objectContaining({
        signal,
        body: JSON.stringify({
          requestId,
          question: 'Question',
          contextAttachmentId: attachmentId,
          confirmationToken: 'server-token',
        }),
      })
    );
  });

  it('retries only the answer through the durable request route', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      request: {
        id: requestId,
        sessionId,
        status: 'in_progress',
        attempt: 2,
        stateVersion: 4,
        conversationRevision: 2,
      },
      turns: [],
      canRetryAnswer: false,
    });

    await retryConversationAssistantTurnAnswer(TOKEN, sessionId, requestId);

    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      'https://wa.test',
      '/conversation-assistant/sessions/session%2Fwith%20spaces/turn-requests/request%2Fwith%20spaces/answer/retry',
      TOKEN,
      { method: 'POST' }
    );
  });
});
