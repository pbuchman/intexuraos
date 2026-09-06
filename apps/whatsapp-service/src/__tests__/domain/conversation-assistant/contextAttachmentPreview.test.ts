import { describe, expect, it } from 'vitest';
import type { ConversationAssistantContextAttachmentPreparedSnapshot } from '../../../domain/conversation-assistant/types.js';
import {
  buildConversationAssistantContextAttachmentPreviewPage,
  type PublicConversationAssistantContextAttachmentPreviewItem,
} from '../../../domain/conversation-assistant/contextAttachmentPreview.js';

function snapshot(): ConversationAssistantContextAttachmentPreparedSnapshot {
  return {
    transcriptText: 'private transcript',
    messages: [
      {
        id: 'message-2',
        eventTimestamp: '2026-07-20T11:00:00.000Z',
        importedAt: '2026-07-20T11:00:01.000Z',
        direction: 'outgoing',
        speakerLabel: 'You',
        messageType: 'text',
        contentKind: 'text',
        content: 'Second',
      },
      {
        id: 'message-1',
        eventTimestamp: '2026-07-20T10:00:00.000Z',
        importedAt: '2026-07-20T10:00:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
        contentKind: 'text',
        content: 'First',
        reactions: [
          {
            id: 'reaction-1',
            emoji: '👍',
            direction: 'incoming',
            eventTimestamp: '2026-07-20T10:05:00.000Z',
            senderKey: 'phone:+48111111111',
            senderDisplayName: 'Alice',
            senderPhoneNumber: '+48111111111',
          },
        ],
      },
    ],
    omittedMessages: [
      {
        id: 'omitted-1',
        eventTimestamp: '2026-07-20T10:30:00.000Z',
        importedAt: '2026-07-20T10:30:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'audio',
        omissionReason: 'pending_transcription',
      },
    ],
    corrections: [
      {
        userId: 'user-private',
        sourceAccountId: 'source-private',
        chatId: 'chat-private',
        sequence: 12,
        messageId: 'target-redacted',
        messageRevision: 2,
        changeType: 'redacted',
        changedAt: '2026-07-20T12:00:00.000Z',
        eventTimestamp: '2026-07-16T10:00:00.000Z',
        before: {
          state: 'included',
          eventTimestamp: '2026-07-16T10:00:00.000Z',
          importedAt: '2026-07-16T10:00:01.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
          contentKind: 'text',
          content: 'must never be returned',
          reactions: [],
        },
        after: {
          state: 'redacted',
          eventTimestamp: '2026-07-16T10:00:00.000Z',
          importedAt: '2026-07-16T10:00:01.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
        },
        schemaVersion: 1,
      },
      {
        userId: 'user-private',
        sourceAccountId: 'source-private',
        chatId: 'chat-private',
        sequence: 11,
        messageId: 'target-edited',
        messageRevision: 2,
        changeType: 'edited',
        changedAt: '2026-07-20T11:30:00.000Z',
        eventTimestamp: '2026-07-16T09:00:00.000Z',
        before: {
          state: 'included',
          eventTimestamp: '2026-07-16T09:00:00.000Z',
          importedAt: '2026-07-16T09:00:01.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
          contentKind: 'text',
          content: 'Old wording',
          reactions: [],
        },
        after: {
          state: 'included',
          eventTimestamp: '2026-07-16T09:00:00.000Z',
          importedAt: '2026-07-16T09:00:01.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
          contentKind: 'text',
          content: 'Correct wording',
          reactions: [],
        },
        schemaVersion: 1,
      },
    ],
    eventRange: {
      from: '2026-07-20T10:00:00.000Z',
      to: '2026-07-20T11:00:00.000Z',
    },
    counts: {
      included: 2,
      omitted: 1,
      newlyAvailable: 2,
      edited: 1,
      redacted: 1,
      deleted: 0,
      reactionsChanged: 0,
      lateIngested: 0,
      completedTranscriptions: 0,
    },
    omitted: {
      mediaOnly: 0,
      failedTranscriptions: 0,
      pendingTranscriptions: 1,
      nonText: 0,
      overLimit: 0,
    },
    deltaTranscriptSha256: 'a'.repeat(64),
    previousContextChainSha256: 'b'.repeat(64),
    resultingContextChainSha256: 'c'.repeat(64),
    estimatedInputTokens: 20,
    requiresConfirmation: false,
  };
}

describe('buildConversationAssistantContextAttachmentPreviewPage', () => {
  it('uses deterministic attachment-local references and never serializes source message ids', () => {
    const input = {
      attachmentId: 'attachment-preview-a',
      snapshot: snapshot(),
      limit: 10,
    };
    const first = buildConversationAssistantContextAttachmentPreviewPage(input);
    const replay = buildConversationAssistantContextAttachmentPreviewPage(input);
    const anotherAttachment = buildConversationAssistantContextAttachmentPreviewPage({
      ...input,
      attachmentId: 'attachment-preview-b',
    });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(anotherAttachment.ok).toBe(true);
    if (!first.ok || !replay.ok || !anotherAttachment.ok) {
      throw new Error('Expected valid attachment preview pages');
    }
    const serialized = JSON.stringify(first.value);
    for (const sourceMessageId of [
      'message-1',
      'message-2',
      'omitted-1',
      'target-edited',
      'target-redacted',
    ]) {
      expect(serialized).not.toContain(sourceMessageId);
    }
    expect(replay.value.items).toEqual(first.value.items);
    expect(anotherAttachment.value.items).not.toEqual(first.value.items);
  });

  it('returns one chronological included/excluded stream followed by ordered corrections', () => {
    const result = buildConversationAssistantContextAttachmentPreviewPage({
      attachmentId: 'attachment-preview-a',
      snapshot: snapshot(),
      limit: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.items.map((item) => item.kind)).toEqual([
      'included',
      'excluded',
      'included',
      'correction',
      'correction',
    ]);
    expect(
      (result.value.items[0] as Extract<
        PublicConversationAssistantContextAttachmentPreviewItem,
        { kind: 'included' }
      >).message.reactions?.[0]
    ).toEqual({
      emoji: '👍',
      direction: 'incoming',
      eventTimestamp: '2026-07-20T10:05:00.000Z',
      senderDisplayName: 'Alice',
    });
    expect(JSON.stringify(result.value)).not.toContain('phone:+');
    expect(JSON.stringify(result.value)).not.toContain('+48111111111');
    expect(JSON.stringify(result.value)).not.toContain('user-private');
    expect(JSON.stringify(result.value)).not.toContain('source-private');
    expect(JSON.stringify(result.value)).not.toContain('"sequence"');
  });

  it('keeps available content metadata on an excluded message', () => {
    const prepared = snapshot();
    const omittedMessage = prepared.omittedMessages[0];
    if (omittedMessage === undefined) throw new Error('Expected an omitted preview fixture');
    omittedMessage.contentKind = 'transcription';
    omittedMessage.content = 'Partial transcription';

    const result = buildConversationAssistantContextAttachmentPreviewPage({
      attachmentId: 'attachment-preview-a',
      snapshot: prepared,
      limit: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'excluded',
          message: expect.objectContaining({
            contentKind: 'transcription',
            content: 'Partial transcription',
          }),
        }),
      ])
    );
  });

  it('never exposes removed content in a redaction or deletion correction', () => {
    const prepared = snapshot();
    prepared.corrections.push({
      userId: 'user-private',
      sourceAccountId: 'source-private',
      chatId: 'chat-private',
      sequence: 13,
      messageId: 'target-legacy-deleted',
      messageRevision: 2,
      changeType: 'deleted',
      changedAt: '2026-07-20T12:05:00.000Z',
      eventTimestamp: '2026-07-16T10:05:00.000Z',
      before: {
        state: 'included',
        eventTimestamp: '2026-07-16T10:05:00.000Z',
        importedAt: '2026-07-16T10:05:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
        contentKind: 'text',
        content: 'legacy deleted content must never be returned',
        reactions: [],
      },
      after: {
        state: 'deleted',
        eventTimestamp: '2026-07-16T10:05:00.000Z',
        importedAt: '2026-07-16T10:05:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
      },
      schemaVersion: 1,
    });
    const result = buildConversationAssistantContextAttachmentPreviewPage({
      attachmentId: 'attachment-preview-a',
      snapshot: prepared,
      limit: 10,
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('must never be returned');
    expect(JSON.stringify(result)).not.toContain('deleted');
    if (!result.ok) throw new Error(result.error.message);
    const redactions = result.value.items.filter(
      (item): item is Extract<
        PublicConversationAssistantContextAttachmentPreviewItem,
        { kind: 'correction' }
      > => item.kind === 'correction' && item.before.state === 'unavailable'
    );
    expect(redactions).toHaveLength(2);
    expect(redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeKind: 'redacted',
          targetReference: expect.stringMatching(/^context-item-[A-Za-z0-9_-]{24}$/),
          before: { state: 'unavailable' },
          after: expect.objectContaining({ state: 'redacted' }),
        }),
      ])
    );
  });

  it('paginates with an opaque cursor and rejects invalid cursors and limits', () => {
    const first = buildConversationAssistantContextAttachmentPreviewPage({
      attachmentId: 'attachment-preview-a',
      snapshot: snapshot(),
      limit: 2,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.items).toHaveLength(2);
    expect(first.value.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const nextCursor = first.value.nextCursor;
    if (nextCursor === undefined) throw new Error('Expected a next preview cursor');

    const second = buildConversationAssistantContextAttachmentPreviewPage({
      attachmentId: 'attachment-preview-a',
      snapshot: snapshot(),
      limit: 2,
      cursor: nextCursor,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);
    expect(second.value.items).toHaveLength(2);
    expect(second.value.items[0]).not.toEqual(first.value.items[0]);

    expect(
      buildConversationAssistantContextAttachmentPreviewPage({
        attachmentId: 'attachment-preview-a',
        snapshot: snapshot(),
        limit: 0,
      })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_CURSOR' } });
    expect(
      buildConversationAssistantContextAttachmentPreviewPage({
        attachmentId: 'attachment-preview-a',
        snapshot: snapshot(),
        limit: 10,
        cursor: 'not-a-valid-cursor',
      })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_CURSOR' } });
  });

  it('sanitizes omitted corrections and rejects every malformed cursor shape', () => {
    const prepared = snapshot();
    const firstMessage = prepared.messages[0];
    const secondMessage = prepared.messages[1];
    const omittedMessage = prepared.omittedMessages[0];
    const edited = prepared.corrections.find((change) => change.changeType === 'edited');
    if (
      firstMessage === undefined ||
      secondMessage === undefined ||
      omittedMessage === undefined ||
      edited === undefined
    ) {
      throw new Error('Expected complete preview fixture');
    }
    firstMessage.eventTimestamp = secondMessage.eventTimestamp;
    firstMessage.reactions = [
      {
        id: 'reaction-private-a',
        emoji: '😊',
        direction: 'incoming',
        eventTimestamp: '2026-07-20T10:04:00.000Z',
        senderKey: 'sender-private-a',
      },
      {
        id: 'reaction-private-b',
        emoji: '👍',
        direction: 'incoming',
        eventTimestamp: '2026-07-20T10:04:00.000Z',
        senderKey: 'sender-private-b',
      },
      {
        id: 'reaction-private-c',
        emoji: '👍',
        direction: 'incoming',
        eventTimestamp: '2026-07-20T10:03:00.000Z',
        senderKey: 'sender-private-c',
      },
    ];
    edited.before = {
      state: 'omitted',
      eventTimestamp: edited.eventTimestamp,
      importedAt: edited.changedAt,
      direction: 'incoming',
      speakerLabel: 'Alice',
      messageType: 'audio',
      omissionReason: 'pending_transcription',
      reactions: firstMessage.reactions,
    };
    edited.after = { state: 'missing' };
    omittedMessage.reactions = firstMessage.reactions;

    const result = buildConversationAssistantContextAttachmentPreviewPage({
      attachmentId: 'attachment-preview-a',
      snapshot: prepared,
      limit: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(JSON.stringify(result.value)).not.toContain('reaction-private-');
    expect(result.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'correction',
          before: expect.objectContaining({
            state: 'omitted',
            omissionReason: 'pending_transcription',
          }),
        }),
      ])
    );

    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    for (const cursor of [
      'bad+cursor',
      encode(null),
      encode({}),
      encode({ version: 2, offset: 0 }),
      encode({ version: 1 }),
      encode({ version: 1, offset: '0' }),
      encode({ version: 1, offset: 1.5 }),
      encode({ version: 1, offset: -1 }),
      encode({ version: 1, offset: 999 }),
    ]) {
      expect(
        buildConversationAssistantContextAttachmentPreviewPage({
          attachmentId: 'attachment-preview-a',
          snapshot: prepared,
          cursor,
          limit: 10,
        })
      ).toMatchObject({ ok: false, error: { code: 'INVALID_CURSOR' } });
    }
    for (const limit of [1.5, 101]) {
      expect(
        buildConversationAssistantContextAttachmentPreviewPage({
          attachmentId: 'attachment-preview-a',
          snapshot: prepared,
          limit,
        })
      ).toMatchObject({ ok: false, error: { code: 'INVALID_CURSOR' } });
    }
  });
});
