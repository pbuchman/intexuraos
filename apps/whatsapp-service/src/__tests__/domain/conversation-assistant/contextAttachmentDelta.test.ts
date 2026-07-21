import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildConversationAssistantContextAttachmentDelta,
  type BuildConversationAssistantContextAttachmentDeltaInput,
  type BuildConversationAssistantContextAttachmentDeltaResult,
} from '../../../domain/conversation-assistant/contextAttachmentDelta.js';
import { calculateConversationAssistantPreparedSnapshotIntegrity } from '../../../domain/conversation-assistant/preparedSnapshotIntegrity.js';
import type {
  ConversationAssistantContextAttachment,
} from '../../../domain/conversation-assistant/types.js';
import type {
  PrivateWhatsAppChat,
  PrivateWhatsAppContextChange,
  PrivateWhatsAppContextProjection,
  PrivateWhatsAppMessage,
} from '../../../domain/whatsapp/index.js';

const BASE_FROM = '2026-07-14T00:00:00.000Z';
const BASE_THROUGH = '2026-07-17T18:00:00.000Z';
const CAPTURED_AT = '2026-07-19T10:15:00.000Z';

type TestOverrides<T> = { [Key in keyof T]?: T[Key] | undefined };

function attachment(
  overrides: TestOverrides<ConversationAssistantContextAttachment> = {}
): ConversationAssistantContextAttachment {
  return {
    id: 'attachment-1',
    sessionId: 'session-1',
    userId: 'user-1',
    sessionGenerationId: 'generation-1',
    sourceAccountId: 'source-1',
    sourceAccountGeneration: 'source-generation-1',
    chatId: 'chat-1',
    preparationRequestId: 'request-1',
    preparationRequestFingerprint: 'request-fingerprint-1',
    status: 'preparing',
    initialContextFrom: BASE_FROM,
    baseContextVersion: 2,
    baseEventThrough: BASE_THROUGH,
    capturedAt: CAPTURED_AT,
    baseChangeSeq: 10,
    cutoffChangeSeq: 10,
    captureRange: { from: BASE_THROUGH, to: CAPTURED_AT },
    counts: emptyCounts(),
    omitted: emptyOmitted(),
    previousContextChainSha256: 'previous-chain',
    requiresConfirmation: false,
    preparationAttempt: 1,
    ...overrides,
  } as ConversationAssistantContextAttachment;
}

function chat(overrides: Partial<PrivateWhatsAppChat> = {}): PrivateWhatsAppChat {
  return {
    id: 'chat-1',
    userId: 'user-1',
    sourceAccountId: 'source-1',
    matrixRoomId: '!room:example',
    chatType: 'direct',
    displayName: 'Test chat',
    firstSeenAt: BASE_FROM,
    lastEventAt: CAPTURED_AT,
    updatedAt: CAPTURED_AT,
    ...overrides,
  };
}

function message(overrides: TestOverrides<PrivateWhatsAppMessage> = {}): PrivateWhatsAppMessage {
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
    text: 'Hello',
    eventTimestamp: '2026-07-18T10:00:00.000Z',
    receivedAt: '2026-07-18T10:00:01.000Z',
    ingestedAt: '2026-07-18T10:00:01.000Z',
    deliveryMode: 'live',
    contextRevision: 1,
    contextChangeSequence: 9,
    contextState: 'visible',
    rawMatrixEvent: {},
    ...overrides,
  } as PrivateWhatsAppMessage;
}

function includedProjection(
  overrides: Partial<Extract<PrivateWhatsAppContextProjection, { state: 'included' }>> = {}
): Extract<PrivateWhatsAppContextProjection, { state: 'included' }> {
  return {
    state: 'included',
    eventTimestamp: '2026-07-16T10:00:00.000Z',
    importedAt: '2026-07-18T12:00:00.000Z',
    direction: 'incoming',
    speakerLabel: 'Alice',
    messageType: 'text',
    contentKind: 'text',
    content: 'Late hello',
    reactions: [],
    ...overrides,
  };
}

function omittedProjection(
  overrides: Partial<Extract<PrivateWhatsAppContextProjection, { state: 'omitted' }>> = {}
): Extract<PrivateWhatsAppContextProjection, { state: 'omitted' }> {
  return {
    state: 'omitted',
    eventTimestamp: '2026-07-16T10:00:00.000Z',
    importedAt: '2026-07-18T12:00:00.000Z',
    direction: 'incoming',
    speakerLabel: 'Alice',
    messageType: 'audio',
    omissionReason: 'pending_transcription',
    reactions: [],
    ...overrides,
  };
}

function change(
  sequence: number,
  overrides: Partial<PrivateWhatsAppContextChange> = {}
): PrivateWhatsAppContextChange {
  return {
    userId: 'user-1',
    sourceAccountId: 'source-1',
    chatId: 'chat-1',
    sequence,
    messageId: 'historical-1',
    messageRevision: sequence,
    changeType: 'edited',
    changedAt: `2026-07-18T12:00:${String(sequence).padStart(2, '0')}.000Z`,
    eventTimestamp: '2026-07-16T10:00:00.000Z',
    before: includedProjection({ content: 'Before' }),
    after: includedProjection({ content: 'After' }),
    schemaVersion: 1,
    ...overrides,
  };
}

function input(
  overrides: Partial<BuildConversationAssistantContextAttachmentDeltaInput> = {}
): BuildConversationAssistantContextAttachmentDeltaInput {
  return {
    attachment: attachment(),
    chat: chat(),
    scannedMessages: [],
    journalChanges: [],
    observedChangeSeq: 10,
    confirmationSecret: 'confirmation-secret',
    warningMessageThreshold: 5_000,
    warningTokenThreshold: 100_000,
    ...overrides,
  };
}

describe('buildConversationAssistantContextAttachmentDelta', () => {
  it('builds a chronological extension with stable ordering, ranges, hashes and token estimate', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        scannedMessages: [
          message({ id: 'message-b', matrixEventId: '$b', text: 'Second' }),
          message({ id: 'message-a', matrixEventId: '$a', text: 'First' }),
          message({
            id: 'message-c',
            matrixEventId: '$c',
            text: 'Last',
            eventTimestamp: '2026-07-19T09:00:00.000Z',
          }),
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.messages.map(({ id }) => id)).toEqual([
      'message-a',
      'message-b',
      'message-c',
    ]);
    expect(result.value.eventRange).toEqual({
      from: '2026-07-18T10:00:00.000Z',
      to: '2026-07-19T09:00:00.000Z',
    });
    expect(result.value.counts).toEqual({
      included: 3,
      omitted: 0,
      newlyAvailable: 3,
      edited: 0,
      redacted: 0,
      deleted: 0,
      reactionsChanged: 0,
      lateIngested: 0,
      completedTranscriptions: 0,
    });
    expect(result.value.deltaTranscriptSha256).toBe(
      createHash('sha256').update(result.value.transcriptText).digest('hex')
    );
    expect(result.value.resultingContextChainSha256).not.toBe('previous-chain');
    expect(result.value.estimatedInputTokens).toBe(
      calculateConversationAssistantPreparedSnapshotIntegrity(result.value)
        .canonicalSnapshotUtf8ByteLength
    );
    expect(result.value.requiresConfirmation).toBe(false);
    expect(result.value.confirmationToken).toBeUndefined();
  });

  it('includes in-range late ingest, excludes pre-range backfill, and deduplicates scan overlap', () => {
    const late = change(11, {
      messageId: 'late-1',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: includedProjection({ content: 'Late' }),
    });
    const tooOld = change(12, {
      messageId: 'too-old',
      messageRevision: 1,
      changeType: 'created',
      eventTimestamp: '2026-07-13T23:59:59.999Z',
      before: { state: 'missing' },
      after: includedProjection({
        eventTimestamp: '2026-07-13T23:59:59.999Z',
        content: 'Too old',
      }),
    });
    const overlap = change(13, {
      messageId: 'message-1',
      messageRevision: 1,
      changeType: 'created',
      eventTimestamp: '2026-07-18T10:00:00.000Z',
      before: { state: 'missing' },
      after: includedProjection({
        eventTimestamp: '2026-07-18T10:00:00.000Z',
        importedAt: '2026-07-18T10:00:01.000Z',
        content: 'Hello',
      }),
    });

    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        attachment: attachment({ cutoffChangeSeq: 13 }),
        scannedMessages: [message()],
        journalChanges: [overlap, tooOld, late],
        observedChangeSeq: 13,
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.messages.map(({ id }) => id)).toEqual(['late-1', 'message-1']);
    expect(result.value.counts.included).toBe(2);
    expect(result.value.counts.lateIngested).toBe(1);
    expect(result.value.corrections).toEqual([]);
  });

  it('supplies a completed historical transcription and records its typed correction', () => {
    const completed = change(11, {
      messageId: 'audio-1',
      changeType: 'transcription_changed',
      before: omittedProjection(),
      after: includedProjection({
        messageType: 'audio',
        contentKind: 'transcription',
        content: 'Finished transcript',
      }),
    });

    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        attachment: attachment({ cutoffChangeSeq: 11 }),
        journalChanges: [completed],
        observedChangeSeq: 11,
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.messages).toHaveLength(1);
    expect(result.value.messages[0]).toMatchObject({
      id: 'audio-1',
      contentKind: 'transcription',
      content: 'Finished transcript',
    });
    expect(result.value.corrections).toEqual([completed]);
    expect(result.value.counts).toMatchObject({
      included: 1,
      newlyAvailable: 1,
      completedTranscriptions: 1,
    });
  });

  it('includes a historical omitted message when an edit makes it analyzable', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        observedChangeSeq: 11,
        attachment: attachment({ cutoffChangeSeq: 11 }),
        journalChanges: [
          change(11, {
            messageId: 'edited-into-context',
            changeType: 'edited',
            before: omittedProjection({ omissionReason: 'media_only' }),
            after: includedProjection({ content: 'Caption added later' }),
          }),
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.messages).toHaveLength(1);
    expect(result.value.messages[0]).toMatchObject({
      id: 'edited-into-context',
      content: 'Caption added later',
    });
    expect(result.value.transcriptText).toContain('Caption added later');
    expect(result.value.counts).toMatchObject({ included: 1, edited: 1 });
  });

  it('retains earlier-context corrections in source sequence with typed counts', () => {
    const edited = change(11, { changeType: 'edited', messageId: 'edited-1' });
    const redacted = change(12, {
      changeType: 'redacted',
      messageId: 'redacted-1',
      after: {
        state: 'redacted',
        eventTimestamp: '2026-07-16T11:00:00.000Z',
        importedAt: '2026-07-16T11:00:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
      },
    });
    const deleted = change(13, {
      changeType: 'deleted',
      messageId: 'deleted-1',
      after: {
        state: 'deleted',
        eventTimestamp: '2026-07-16T12:00:00.000Z',
        importedAt: '2026-07-16T12:00:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
      },
    });
    const reaction = change(14, {
      changeType: 'reaction_changed',
      messageId: 'reaction-target',
      after: includedProjection({
        reactions: [
          {
            id: 'reaction-1',
            emoji: '👍',
            senderPhoneNumber: '+48000000000',
            direction: 'outgoing',
            eventTimestamp: '2026-07-18T12:00:00.000Z',
          },
        ],
      }),
    });

    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        attachment: attachment({ cutoffChangeSeq: 14 }),
        journalChanges: [reaction, redacted, edited, deleted],
        observedChangeSeq: 14,
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.messages).toEqual([]);
    expect(result.value.corrections).toEqual([
      edited,
      redacted,
      deleted,
      {
        ...reaction,
        after: {
          ...reaction.after,
          reactions: [
            {
              id: 'reaction-1',
              emoji: '👍',
              direction: 'outgoing',
              eventTimestamp: '2026-07-18T12:00:00.000Z',
            },
          ],
        },
      },
    ]);
    expect(result.value.counts).toMatchObject({
      edited: 1,
      redacted: 1,
      deleted: 1,
      reactionsChanged: 1,
    });
  });

  it('returns a valid zero delta', () => {
    const result = buildConversationAssistantContextAttachmentDelta(input());

    expect(result).toMatchObject({
      ok: true,
      value: {
        transcriptText: '',
        messages: [],
        omittedMessages: [],
        corrections: [],
        counts: emptyCounts(),
        omitted: emptyOmitted(),
        requiresConfirmation: false,
      },
    });
  });

  it('retains omitted-only context without inventing an event range', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        scannedMessages: [
          message({
            id: 'audio-pending',
            matrixEventId: '$audio',
            text: undefined,
            messageType: 'audio',
            transcription: { status: 'pending' },
          }),
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.messages).toEqual([]);
    expect(result.value.omittedMessages).toHaveLength(1);
    expect(result.value.eventRange).toBeUndefined();
    expect(result.value.counts).toMatchObject({ included: 0, omitted: 1, newlyAvailable: 0 });
    expect(result.value.omitted.pendingTranscriptions).toBe(1);
  });

  it('reconstructs a scanned post-cutoff mutation from the earliest post-cutoff before projection', () => {
    const afterCutoff = change(11, {
      messageId: 'message-1',
      changeType: 'edited',
      before: includedProjection({
        eventTimestamp: '2026-07-18T10:00:00.000Z',
        importedAt: '2026-07-18T10:00:01.000Z',
        content: 'At cutoff',
      }),
      after: includedProjection({
        eventTimestamp: '2026-07-18T10:00:00.000Z',
        importedAt: '2026-07-18T10:00:01.000Z',
        content: 'After cutoff',
      }),
    });
    const laterAgain = change(12, {
      messageId: 'message-1',
      changeType: 'edited',
      before: afterCutoff.after,
      after: includedProjection({
        eventTimestamp: '2026-07-18T10:00:00.000Z',
        importedAt: '2026-07-18T10:00:01.000Z',
        content: 'Later again',
      }),
    });

    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        scannedMessages: [message({ text: 'Later again', contextChangeSequence: 12 })],
        journalChanges: [laterAgain, afterCutoff],
        observedChangeSeq: 12,
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.messages[0]?.content).toBe('At cutoff');
    expect(result.value.corrections).toEqual([]);
  });

  it('excludes a post-cutoff insert that appeared during the scan', () => {
    const inserted = change(11, {
      messageId: 'inserted-after-cutoff',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: includedProjection({
        eventTimestamp: '2026-07-18T10:00:00.000Z',
        content: 'Not captured',
      }),
    });

    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        scannedMessages: [
          message({ id: 'inserted-after-cutoff', text: 'Not captured', contextChangeSequence: 11 }),
        ],
        journalChanges: [inserted],
        observedChangeSeq: 11,
      })
    );

    expect(result).toMatchObject({ ok: true, value: { messages: [], corrections: [] } });
  });

  it('restores a message deleted after cutoff', () => {
    const deleted = change(11, {
      messageId: 'message-1',
      changeType: 'deleted',
      before: includedProjection({
        eventTimestamp: '2026-07-18T10:00:00.000Z',
        importedAt: '2026-07-18T10:00:01.000Z',
        content: 'Still present at cutoff',
      }),
      after: {
        state: 'deleted',
        eventTimestamp: '2026-07-18T10:00:00.000Z',
        importedAt: '2026-07-18T10:00:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
      },
    });

    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        scannedMessages: [
          message({ text: undefined, contextState: 'deleted', contextChangeSequence: 11 }),
        ],
        journalChanges: [deleted],
        observedChangeSeq: 11,
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.messages[0]?.content).toBe('Still present at cutoff');
  });

  it('fails closed for a journal gap, duplicate sequence, or invalid observed boundary', () => {
    const gap = buildConversationAssistantContextAttachmentDelta(
      input({
        attachment: attachment({ cutoffChangeSeq: 12 }),
        journalChanges: [change(12)],
        observedChangeSeq: 12,
      })
    );
    const duplicate = buildConversationAssistantContextAttachmentDelta(
      input({
        attachment: attachment({ cutoffChangeSeq: 11 }),
        journalChanges: [change(11), change(11, { messageId: 'duplicate' })],
        observedChangeSeq: 11,
      })
    );
    const invalidBoundary = buildConversationAssistantContextAttachmentDelta(
      input({ observedChangeSeq: 9 })
    );

    expect(gap).toEqual({
      ok: false,
      error: {
        code: 'CONTEXT_JOURNAL_GAP',
        message: 'The context change journal is incomplete at sequence 11',
      },
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: 'CONTEXT_JOURNAL_GAP' },
    });
    expect(invalidBoundary).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTEXT_BOUNDARY' },
    });
  });

  it('fails closed when the journal extends beyond the observed head', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({ journalChanges: [change(11)], observedChangeSeq: 10 })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTEXT_BOUNDARY' },
    });
  });

  it('requires a previous context-chain hash for every prepared delta', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({ attachment: attachment({ previousContextChainSha256: undefined }) })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTEXT_BOUNDARY' },
    });
  });

  it('fails closed when source ownership does not match the frozen attachment', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({ scannedMessages: [message({ userId: 'other-user' })] })
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'CONTEXT_SOURCE_MISMATCH',
        message: 'The context source does not match the frozen attachment',
      },
    });
  });

  it('fails closed when the chat or a journal entry belongs to another source', () => {
    const chatMismatch = buildConversationAssistantContextAttachmentDelta(
      input({ chat: chat({ id: 'other-chat' }) })
    );
    const journalMismatch = buildConversationAssistantContextAttachmentDelta(
      input({
        attachment: attachment({ cutoffChangeSeq: 11 }),
        journalChanges: [change(11, { sourceAccountId: 'other-source' })],
        observedChangeSeq: 11,
      })
    );

    expect(chatMismatch).toMatchObject({
      ok: false,
      error: { code: 'CONTEXT_SOURCE_MISMATCH' },
    });
    expect(journalMismatch).toMatchObject({
      ok: false,
      error: { code: 'CONTEXT_SOURCE_MISMATCH' },
    });
  });

  it('ignores operational and out-of-extension scan rows', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        scannedMessages: [
          message({
            id: 'relation',
            relation: {
              kind: 'replacement',
              targetMatrixEventId: '$target',
              applicationStatus: 'applied',
            },
          }),
          message({ id: 'reaction', messageType: 'reaction' }),
          message({ id: 'redaction', messageType: 'redaction' }),
          message({ id: 'before-frontier', eventTimestamp: BASE_THROUGH.replace('18:00', '17:59') }),
          message({ id: 'at-cutoff', eventTimestamp: CAPTURED_AT }),
        ],
      })
    );

    expect(result).toMatchObject({ ok: true, value: { messages: [], omittedMessages: [] } });
  });

  it('uses the last captured state for a newly created message without emitting a correction', () => {
    const created = change(11, {
      messageId: 'new-edited',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: includedProjection({ content: 'First version' }),
    });
    const edited = change(12, {
      messageId: 'new-edited',
      messageRevision: 2,
      changeType: 'edited',
      before: created.after,
      after: includedProjection({ content: 'Final version' }),
    });

    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        attachment: attachment({ cutoffChangeSeq: 12 }),
        journalChanges: [created, edited],
        observedChangeSeq: 12,
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.messages[0]?.content).toBe('Final version');
    expect(result.value.corrections).toEqual([]);
    expect(result.value.counts.edited).toBe(0);
  });

  it('handles projection and omission variants while stripping reaction phone numbers', () => {
    const outgoing = change(11, {
      messageId: 'outgoing',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: includedProjection({
        direction: 'outgoing',
        speakerLabel: 'Participant',
        content: 'Outgoing',
        reactions: [
          {
            id: 'reaction-full',
            emoji: '👍',
            senderKey: 'sender-key',
            senderDisplayName: 'Alice',
            senderPhoneNumber: '+48000000000',
            direction: 'incoming',
            eventTimestamp: '2026-07-18T12:00:00.000Z',
          },
          {
            id: 'reaction-minimal',
            emoji: '❤️',
            direction: 'outgoing',
            eventTimestamp: '2026-07-18T12:01:00.000Z',
          },
        ],
      }),
    });
    const pending = change(12, {
      messageId: 'pending',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: omittedProjection(),
    });
    const failed = change(13, {
      messageId: 'failed',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: omittedProjection({ omissionReason: 'failed_transcription' }),
    });
    const mediaOnly = change(14, {
      messageId: 'media-only',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: omittedProjection({ messageType: 'image', omissionReason: 'media_only' }),
    });
    const nonText = change(15, {
      messageId: 'non-text',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: omittedProjection({ messageType: 'unknown', omissionReason: 'non_text' }),
    });
    const missingBeforeTranscription = change(16, {
      messageId: 'restored-transcription',
      changeType: 'transcription_changed',
      before: { state: 'missing' },
      after: includedProjection({
        messageType: 'audio',
        contentKind: 'transcription',
        content: 'Recovered transcription',
      }),
    });
    const redactedCreated = change(17, {
      messageId: 'redacted-new',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: includedProjection({ content: 'Soon redacted' }),
    });
    const redactedNew = change(18, {
      messageId: 'redacted-new',
      changeType: 'redacted',
      before: redactedCreated.after,
      after: {
        state: 'redacted',
        eventTimestamp: '2026-07-16T10:00:00.000Z',
        importedAt: '2026-07-18T12:00:00.000Z',
        direction: 'incoming',
        speakerLabel: 'Participant',
        messageType: 'text',
      },
    });
    const deletedCreated = change(19, {
      messageId: 'deleted-new',
      messageRevision: 1,
      changeType: 'created',
      before: { state: 'missing' },
      after: includedProjection({ content: 'Soon deleted' }),
    });
    const deletedNew = change(20, {
      messageId: 'deleted-new',
      changeType: 'deleted',
      before: deletedCreated.after,
      after: {
        state: 'deleted',
        eventTimestamp: '2026-07-16T10:00:00.000Z',
        importedAt: '2026-07-18T12:00:00.000Z',
        direction: 'incoming',
        speakerLabel: 'Participant',
        messageType: 'text',
      },
    });
    const removed = change(21, {
      messageId: 'historical-removed',
      after: { state: 'missing' },
    });

    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        attachment: attachment({ cutoffChangeSeq: 21 }),
        scannedMessages: [
          message({
            id: 'processing',
            text: undefined,
            messageType: 'audio',
            transcription: { status: 'processing' },
          }),
          ...(['image', 'audio', 'video', 'file', 'sticker'] as const).map((messageType) =>
            message({
              id: `raw-${messageType}`,
              matrixEventId: `$raw-${messageType}`,
              text: undefined,
              messageType,
            })
          ),
          message({
            id: 'raw-non-text',
            text: undefined,
            messageType: 'unknown',
            senderDisplayName: '   ',
          }),
          message({ id: 'raw-redacted', contextState: 'redacted' }),
          message({ id: 'raw-deleted', contextState: 'deleted' }),
        ],
        journalChanges: [
          removed,
          deletedNew,
          outgoing,
          pending,
          failed,
          mediaOnly,
          nonText,
          missingBeforeTranscription,
          redactedCreated,
          redactedNew,
          deletedCreated,
        ],
        observedChangeSeq: 21,
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    const outgoingMessage = result.value.messages.find(({ id }) => id === 'outgoing');
    expect(outgoingMessage).toMatchObject({ speakerLabel: 'You' });
    expect(outgoingMessage?.reactions?.[0]).not.toHaveProperty('senderPhoneNumber');
    expect(outgoingMessage?.reactions?.[0]).not.toHaveProperty('senderKey');
    expect(result.value.messages.map(({ id }) => id)).toContain('restored-transcription');
    expect(result.value.omitted).toEqual({
      mediaOnly: 6,
      failedTranscriptions: 1,
      pendingTranscriptions: 2,
      nonText: 2,
      overLimit: 0,
    });
    expect(result.value.omittedMessages.find(({ id }) => id === 'raw-non-text')).toMatchObject({
      speakerLabel: 'Unknown',
    });
    expect(result.value.counts.completedTranscriptions).toBe(1);
  });

  it('reports a missing tail journal sequence after an otherwise contiguous prefix', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        attachment: attachment({ cutoffChangeSeq: 12 }),
        journalChanges: [change(11)],
        observedChangeSeq: 12,
      })
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'CONTEXT_JOURNAL_GAP',
        message: 'The context change journal is incomplete at sequence 12',
      },
    });
  });

  it('rejects every malformed frozen boundary input', () => {
    const malformed: BuildConversationAssistantContextAttachmentDeltaInput[] = [
      input({ attachment: attachment({ baseChangeSeq: 1.5 }) }),
      input({ attachment: attachment({ cutoffChangeSeq: 10.5 }) }),
      input({ observedChangeSeq: 10.5 }),
      input({ attachment: attachment({ baseChangeSeq: -1 }) }),
      input({ attachment: attachment({ baseChangeSeq: 10, cutoffChangeSeq: 9 }) }),
      input({
        attachment: attachment({ initialContextFrom: BASE_THROUGH }),
      }),
      input({
        attachment: attachment({ baseEventThrough: '2026-07-20T00:00:00.000Z' }),
      }),
      input({ attachment: attachment({ previousContextChainSha256: '' }) }),
      input({ confirmationSecret: '' }),
      input({ warningMessageThreshold: Number.POSITIVE_INFINITY }),
      input({ warningMessageThreshold: -1 }),
      input({ warningTokenThreshold: Number.POSITIVE_INFINITY }),
      input({ warningTokenThreshold: -1 }),
    ];

    expect(
      malformed.map((value) => buildConversationAssistantContextAttachmentDelta(value))
    ).toSatisfy((results: BuildConversationAssistantContextAttachmentDeltaResult[]) =>
      results.every((result) => !result.ok && result.error.code === 'INVALID_CONTEXT_BOUNDARY')
    );
  });

  it('requires confirmation when only the conservative token threshold is exceeded', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        scannedMessages: [message()],
        warningMessageThreshold: 100,
        warningTokenThreshold: 0,
      })
    );

    expect(result).toMatchObject({
      ok: true,
      value: { requiresConfirmation: true },
    });
  });

  it('canonicalizes reaction ordering so hashes do not depend on storage array order', () => {
    const reactions = [
      {
        id: 'reaction-b',
        emoji: '❤️',
        direction: 'outgoing' as const,
        eventTimestamp: '2026-07-18T12:00:00.000Z',
      },
      {
        id: 'reaction-a',
        emoji: '👍',
        direction: 'incoming' as const,
        eventTimestamp: '2026-07-18T12:00:00.000Z',
      },
    ];
    const first = buildConversationAssistantContextAttachmentDelta(
      input({ scannedMessages: [message({ reactions })] })
    );
    const second = buildConversationAssistantContextAttachmentDelta(
      input({ scannedMessages: [message({ reactions: [...reactions].reverse() })] })
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('expected ready deltas');
    expect(first.value.messages[0]?.reactions?.map(({ id }) => id)).toEqual([
      'reaction-a',
      'reaction-b',
    ]);
    expect(first.value.resultingContextChainSha256).toBe(
      second.value.resultingContextChainSha256
    );
  });

  it('creates a deterministic opaque confirmation bound to the attachment and snapshot', () => {
    const warningInput = input({
      warningMessageThreshold: 0,
      scannedMessages: [message()],
    });
    const result = buildConversationAssistantContextAttachmentDelta(warningInput);
    const anotherAttachment = buildConversationAssistantContextAttachmentDelta({
      ...warningInput,
      attachment: attachment({ id: 'attachment-2' }),
    });

    expect(result.ok).toBe(true);
    expect(anotherAttachment.ok).toBe(true);
    if (!result.ok || !anotherAttachment.ok) throw new Error('expected ready delta');
    const expected = createHmac('sha256', 'confirmation-secret')
      .update(
        JSON.stringify({
          version: 1,
          attachmentId: 'attachment-1',
          deltaTranscriptSha256: result.value.deltaTranscriptSha256,
          resultingContextChainSha256: result.value.resultingContextChainSha256,
          estimatedInputTokens: result.value.estimatedInputTokens,
        })
      )
      .digest('base64url');
    expect(result.value.requiresConfirmation).toBe(true);
    expect(result.value.confirmationToken).toBe(expected);
    expect(anotherAttachment.value.confirmationToken).not.toBe(expected);
  });

  it('does not require confirmation for a source row that contributes no attached evidence', () => {
    const result = buildConversationAssistantContextAttachmentDelta(
      input({
        warningMessageThreshold: 0,
        scannedMessages: [
          message({
            id: 'redacted-only',
            text: undefined,
            contextState: 'redacted',
          }),
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        counts: { included: 0, omitted: 0 },
        requiresConfirmation: false,
      },
    });
  });
});

function emptyCounts(): ConversationAssistantContextAttachment['counts'] {
  return {
    included: 0,
    omitted: 0,
    newlyAvailable: 0,
    edited: 0,
    redacted: 0,
    deleted: 0,
    reactionsChanged: 0,
    lateIngested: 0,
    completedTranscriptions: 0,
  };
}

function emptyOmitted(): ConversationAssistantContextAttachment['omitted'] {
  return {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  };
}
