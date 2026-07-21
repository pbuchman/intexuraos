import { describe, expect, it } from 'vitest';
import type {
  PrivateWhatsAppContextChange,
  PrivateWhatsAppMessage,
} from '../../../domain/whatsapp/index.js';
import { reconcileConversationContextAtCutoff } from '../../../domain/conversation-assistant/contextReconciliation.js';

function createMessage(overrides: Partial<PrivateWhatsAppMessage> = {}): PrivateWhatsAppMessage {
  return {
    id: 'message-1',
    chatId: 'chat-1',
    userId: 'user-1',
    sourceAccountId: 'source-1',
    matrixRoomId: '!room:example',
    matrixEventId: '$event-1',
    matrixSenderId: '@alice:example',
    senderDisplayName: 'Alice',
    direction: 'incoming',
    messageType: 'text',
    text: 'Original',
    eventTimestamp: '2026-07-20T10:00:00.000Z',
    receivedAt: '2026-07-20T10:00:01.000Z',
    ingestedAt: '2026-07-20T10:00:01.000Z',
    deliveryMode: 'live',
    rawMatrixEvent: {},
    contextRevision: 1,
    contextChangeSequence: 1,
    contextState: 'visible',
    ...overrides,
  };
}

function createChange(
  overrides: Partial<PrivateWhatsAppContextChange> = {}
): PrivateWhatsAppContextChange {
  return {
    userId: 'user-1',
    sourceAccountId: 'source-1',
    chatId: 'chat-1',
    sequence: 2,
    messageId: 'message-1',
    messageRevision: 2,
    changeType: 'edited',
    changedAt: '2026-07-20T11:00:00.000Z',
    eventTimestamp: '2026-07-20T10:00:00.000Z',
    before: {
      state: 'included',
      eventTimestamp: '2026-07-20T10:00:00.000Z',
      importedAt: '2026-07-20T10:00:01.000Z',
      direction: 'incoming',
      speakerLabel: 'Alice',
      messageType: 'text',
      contentKind: 'text',
      content: 'Original',
      reactions: [],
    },
    after: {
      state: 'included',
      eventTimestamp: '2026-07-20T10:00:00.000Z',
      importedAt: '2026-07-20T10:00:01.000Z',
      direction: 'incoming',
      speakerLabel: 'Alice',
      messageType: 'text',
      contentKind: 'text',
      content: 'Corrected',
      reactions: [],
    },
    schemaVersion: 1,
    ...overrides,
  };
}

describe('reconcileConversationContextAtCutoff', () => {
  it('applies a contiguous journal to logical messages and excludes operation rows', () => {
    const operation = createMessage({
      id: 'edit-operation',
      matrixEventId: '$edit-operation',
      text: 'Corrected',
      relation: {
        kind: 'replacement',
        targetMatrixEventId: '$event-1',
        targetMessageId: 'message-1',
        applicationStatus: 'applied',
      },
    });

    const result = reconcileConversationContextAtCutoff({
      userId: 'user-1',
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      range: {
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-07-21T00:00:00.000Z',
      },
      startSequence: 1,
      cutoffSequence: 2,
      scannedMessages: [createMessage(), operation],
      changes: [createChange()],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.reason);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 'message-1',
      text: 'Corrected',
      contextRevision: 2,
      contextChangeSequence: 2,
    });
  });

  it('adds late in-range messages, excludes pre-range backfill, and sorts timestamp ties by id', () => {
    const first = createChange({
      sequence: 1,
      messageId: 'message-b',
      messageRevision: 1,
      changeType: 'created',
      eventTimestamp: '2026-07-20T09:00:00.000Z',
      before: { state: 'missing' },
      after: {
        state: 'included',
        eventTimestamp: '2026-07-20T09:00:00.000Z',
        importedAt: '2026-07-20T12:00:00.000Z',
        direction: 'incoming',
        speakerLabel: 'Bob',
        messageType: 'text',
        contentKind: 'text',
        content: 'B',
        reactions: [],
      },
    });
    const firstAfter = first.after;
    if (firstAfter.state !== 'included') {
      throw new Error('Expected an included projection');
    }
    const tied = createChange({
      sequence: 2,
      messageId: 'message-a',
      messageRevision: 1,
      changeType: 'created',
      eventTimestamp: '2026-07-20T09:00:00.000Z',
      before: { state: 'missing' },
      after: {
        ...firstAfter,
        state: 'included',
        content: 'A',
      },
    });
    const tooOld = createChange({
      sequence: 3,
      messageId: 'message-old',
      messageRevision: 1,
      changeType: 'created',
      eventTimestamp: '2026-07-18T09:00:00.000Z',
      before: { state: 'missing' },
      after: {
        ...firstAfter,
        state: 'included',
        eventTimestamp: '2026-07-18T09:00:00.000Z',
        content: 'Too old',
      },
    });

    const result = reconcileConversationContextAtCutoff({
      userId: 'user-1',
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      range: {
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-07-21T00:00:00.000Z',
      },
      startSequence: 0,
      cutoffSequence: 3,
      scannedMessages: [],
      changes: [tooOld, tied, first],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.messages.map((message) => message.id)).toEqual(['message-a', 'message-b']);
  });

  it('fails closed when the requested journal range contains a gap', () => {
    const result = reconcileConversationContextAtCutoff({
      userId: 'user-1',
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      range: {
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-07-21T00:00:00.000Z',
      },
      startSequence: 1,
      cutoffSequence: 3,
      scannedMessages: [createMessage()],
      changes: [createChange({ sequence: 3 })],
    });

    expect(result).toEqual({
      ok: false,
      reason: 'journal_gap',
      expectedSequence: 2,
      actualSequence: 3,
    });
  });

  it('fails closed when the journal ends before the cutoff', () => {
    const result = reconcileConversationContextAtCutoff({
      userId: 'user-1',
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      range: {
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-07-21T00:00:00.000Z',
      },
      startSequence: 1,
      cutoffSequence: 2,
      scannedMessages: [createMessage()],
      changes: [],
    });

    expect(result).toEqual({
      ok: false,
      reason: 'journal_gap',
      expectedSequence: 2,
    });
  });

  it('reconstructs projection variants without leaking participant labels or removed content', () => {
    const baseIncluded = createChange().after;
    if (baseIncluded.state !== 'included') throw new Error('Expected included projection fixture');
    const changes: PrivateWhatsAppContextChange[] = [
      createChange({
        sequence: 1,
        messageId: 'outgoing-audio',
        before: { state: 'missing' },
        after: {
          ...baseIncluded,
          direction: 'outgoing',
          speakerLabel: 'You',
          messageType: 'audio',
          contentKind: 'transcription',
          content: 'Completed transcription',
        },
      }),
      createChange({
        sequence: 2,
        messageId: 'anonymous-participant',
        before: { state: 'missing' },
        after: { ...baseIncluded, speakerLabel: 'Participant' },
      }),
      createChange({
        sequence: 3,
        messageId: 'redacted-message',
        before: baseIncluded,
        after: {
          state: 'redacted',
          eventTimestamp: baseIncluded.eventTimestamp,
          importedAt: baseIncluded.importedAt,
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
        },
      }),
      createChange({
        sequence: 4,
        messageId: 'deleted-message',
        before: baseIncluded,
        after: {
          state: 'deleted',
          eventTimestamp: baseIncluded.eventTimestamp,
          importedAt: baseIncluded.importedAt,
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
        },
      }),
      createChange({
        sequence: 5,
        messageId: 'pending-audio',
        before: { state: 'missing' },
        after: {
          state: 'omitted',
          eventTimestamp: baseIncluded.eventTimestamp,
          importedAt: baseIncluded.importedAt,
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'audio',
          omissionReason: 'pending_transcription',
          reactions: [],
        },
      }),
      createChange({
        sequence: 6,
        messageId: 'failed-audio',
        before: { state: 'missing' },
        after: {
          state: 'omitted',
          eventTimestamp: baseIncluded.eventTimestamp,
          importedAt: baseIncluded.importedAt,
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'audio',
          omissionReason: 'failed_transcription',
          reactions: [],
        },
      }),
      createChange({
        sequence: 7,
        messageId: 'media-only',
        before: { state: 'missing' },
        after: {
          state: 'omitted',
          eventTimestamp: baseIncluded.eventTimestamp,
          importedAt: baseIncluded.importedAt,
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'image',
          omissionReason: 'media_only',
          reactions: [],
        },
      }),
    ];

    const result = reconcileConversationContextAtCutoff({
      userId: 'user-1',
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      range: {
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-07-21T00:00:00.000Z',
      },
      startSequence: 0,
      cutoffSequence: changes.length,
      scannedMessages: [],
      changes,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'outgoing-audio',
          transcription: { status: 'completed', text: 'Completed transcription' },
        }),
        expect.objectContaining({
          id: 'anonymous-participant',
          text: 'Corrected',
        }),
        expect.objectContaining({ id: 'redacted-message', contextState: 'redacted' }),
        expect.objectContaining({ id: 'deleted-message', contextState: 'deleted' }),
        expect.objectContaining({
          id: 'pending-audio',
          transcription: { status: 'pending' },
        }),
        expect.objectContaining({
          id: 'failed-audio',
          transcription: {
            status: 'failed',
            error: { code: 'TRANSCRIPTION_FAILED', message: 'Transcription failed' },
          },
        }),
        expect.objectContaining({ id: 'media-only' }),
      ])
    );
    expect(result.messages.find((message) => message.id === 'outgoing-audio')).not.toHaveProperty(
      'senderDisplayName'
    );
    expect(
      result.messages.find((message) => message.id === 'anonymous-participant')
    ).not.toHaveProperty('senderDisplayName');
    expect(result.messages.find((message) => message.id === 'media-only')).not.toHaveProperty(
      'transcription'
    );
  });
});
