import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PrivateWhatsAppChat, PrivateWhatsAppMessage } from '../../../domain/whatsapp/index.js';
import {
  buildPrivateConversationTranscriptText,
  projectPrivateConversationContext,
} from '../../../domain/conversation-assistant/transcriptFormatting.js';

const chat: PrivateWhatsAppChat = {
  id: 'chat-123',
  userId: 'user-123',
  sourceAccountId: 'private-source-123',
  matrixRoomId: '!room:matrix.example',
  chatType: 'direct',
  displayName: 'Alice',
  messageCount: 7,
  firstSeenAt: '2026-06-22T09:00:00.000Z',
  lastEventAt: '2026-06-22T11:00:00.000Z',
  updatedAt: '2026-06-22T11:00:00.000Z',
};

type MessageOverrides = Partial<
  Omit<
    PrivateWhatsAppMessage,
    'text' | 'senderDisplayName' | 'senderPhoneNumber' | 'senderKey' | 'reaction'
  >
> & {
  text?: string | undefined;
  senderDisplayName?: string | undefined;
  senderPhoneNumber?: string | undefined;
  senderKey?: string | undefined;
  reaction?: TranscriptReactionFixture | undefined;
};

interface TranscriptReactionFixture {
  emoji: string;
  targetMatrixEventId?: string;
  targetMessageId?: string;
}

function message(overrides: MessageOverrides): PrivateWhatsAppMessage {
  const { text, senderDisplayName, senderPhoneNumber, senderKey, reaction, ...rest } = overrides;
  const result: PrivateWhatsAppMessage = {
    id: 'message-1',
    chatId: 'chat-123',
    userId: 'user-123',
    sourceAccountId: 'private-source-123',
    matrixRoomId: '!room:matrix.example',
    matrixEventId: '$event-1',
    matrixSenderId: '@alice:matrix.example',
    senderDisplayName: 'Alice',
    senderPhoneNumber: '+48123456789',
    senderPhoneNumberNormalized: '48123456789',
    senderKey: 'phone:+48123456789',
    direction: 'incoming',
    messageType: 'text',
    text: ' hello ',
    eventTimestamp: '2026-06-22T10:00:00.000Z',
    chatDisplayName: 'Alice',
    chatType: 'direct',
    receivedAt: '2026-06-22T10:00:01.000Z',
    ingestedAt: '2026-06-22T10:00:02.000Z',
    deliveryMode: 'live',
    rawMatrixEvent: {
      event_id: '$event-1',
      content: { body: 'raw text', url: 'mxc://matrix.example/private' },
    },
    ...rest,
  };
  if (text !== undefined) {
    result.text = text;
  } else if (Object.hasOwn(overrides, 'text')) {
    delete result.text;
  }
  if (senderDisplayName !== undefined) {
    result.senderDisplayName = senderDisplayName;
  } else if (Object.hasOwn(overrides, 'senderDisplayName')) {
    delete result.senderDisplayName;
  }
  if (senderPhoneNumber !== undefined) {
    result.senderPhoneNumber = senderPhoneNumber;
  } else if (Object.hasOwn(overrides, 'senderPhoneNumber')) {
    delete result.senderPhoneNumber;
  }
  if (senderKey !== undefined) {
    result.senderKey = senderKey;
  } else if (Object.hasOwn(overrides, 'senderKey')) {
    delete result.senderKey;
  }
  if (reaction !== undefined) {
    (result as Omit<PrivateWhatsAppMessage, 'reaction'> & { reaction?: TranscriptReactionFixture }).reaction =
      reaction;
  } else if (Object.hasOwn(overrides, 'reaction')) {
    delete (result as Omit<PrivateWhatsAppMessage, 'reaction'> & { reaction?: TranscriptReactionFixture })
      .reaction;
  }
  return result;
}

describe('projectPrivateConversationContext', () => {
  it('projects only text and completed transcriptions into a stable sanitized context', () => {
    const result = projectPrivateConversationContext({
      chat,
      range: {
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
      captureOmittedMessages: true,
      messages: [
        message({ id: 'message-1', text: ' hello from private chat ' }),
        message({
          id: 'message-2',
          matrixEventId: '$event-2',
          direction: 'outgoing',
          messageType: 'audio',
          text: undefined,
          eventTimestamp: '2026-06-22T10:05:00.000Z',
          transcription: { status: 'completed', text: ' voice transcript ' },
        }),
        message({
          id: 'message-3',
          matrixEventId: '$event-3',
          messageType: 'audio',
          text: undefined,
          eventTimestamp: '2026-06-22T10:10:00.000Z',
          transcription: { status: 'pending' },
        }),
        message({
          id: 'message-4',
          matrixEventId: '$event-4',
          messageType: 'video',
          text: undefined,
          eventTimestamp: '2026-06-22T10:15:00.000Z',
          transcription: { status: 'failed', error: { code: 'FAILED', message: 'private' } },
        }),
        message({
          id: 'message-5',
          matrixEventId: '$event-5',
          messageType: 'image',
          text: undefined,
          media: { mxcUri: 'mxc://matrix.example/image' },
          eventTimestamp: '2026-06-22T10:20:00.000Z',
        }),
        message({
          id: 'message-6',
          matrixEventId: '$event-6',
          messageType: 'reaction',
          text: undefined,
          eventTimestamp: '2026-06-22T10:25:00.000Z',
        }),
      ],
    });

    expect(result.messages).toEqual([
      {
        id: 'message-1',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
        importedAt: '2026-06-22T10:00:02.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
        contentKind: 'text',
        content: 'hello from private chat',
      },
      {
        id: 'message-2',
        eventTimestamp: '2026-06-22T10:05:00.000Z',
        importedAt: '2026-06-22T10:00:02.000Z',
        direction: 'outgoing',
        speakerLabel: 'You',
        messageType: 'audio',
        contentKind: 'transcription',
        content: 'voice transcript',
      },
    ]);
    expect(result.omitted).toEqual({
      mediaOnly: 1,
      failedTranscriptions: 1,
      pendingTranscriptions: 1,
      nonText: 1,
      overLimit: 0,
    });
    expect(result.omittedMessages.map((item) => [item.id, item.omissionReason])).toEqual([
      ['message-3', 'pending_transcription'],
      ['message-4', 'failed_transcription'],
      ['message-5', 'media_only'],
      ['message-6', 'non_text'],
    ]);
    expect(result.messageCount).toBe(2);
    const expectedTranscript = [
      '[Sent 22 June 2026; imported 22 June 2026] Alice: hello from private chat',
      '[Sent 22 June 2026; imported 22 June 2026] You: voice transcript',
    ].join('\n');
    expect(expectedTranscript).not.toContain('T10:00:00');
    expect(result.transcriptSha256).toBe(
      createHash('sha256').update(expectedTranscript).digest('hex')
    );
    expect(JSON.stringify(result)).not.toContain('rawMatrixEvent');
    expect(JSON.stringify(result)).not.toContain('sourceAccountId');
    expect(JSON.stringify(result)).not.toContain('mxc://matrix.example');
  });

  it('does not truncate projected text messages when no max-message cap is provided', () => {
    const result = projectPrivateConversationContext({
      chat,
      range: {
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
      messages: [
        message({ id: 'message-1', text: 'first' }),
        message({ id: 'message-2', matrixEventId: '$event-2', text: 'second' }),
        message({ id: 'message-3', matrixEventId: '$event-3', text: 'third' }),
      ],
    });

    expect(result.messages.map((item) => item.content)).toEqual(['first', 'second', 'third']);
    expect(result.omitted.overLimit).toBe(0);
  });

  it('uses a stable fallback transcript label for invalid message timestamps', () => {
    const result = projectPrivateConversationContext({
      chat,
      range: {
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
      messages: [
        message({
          eventTimestamp: 'not-a-date',
          ingestedAt: 'still-not-a-date',
          text: 'invalid timestamp text',
        }),
      ],
    });

    const transcriptText = buildPrivateConversationTranscriptText(result.messages);
    expect(transcriptText).toBe(
      '[Sent Unknown date; imported Unknown date] Alice: invalid timestamp text'
    );
    expect(transcriptText).not.toContain('NaN');
  });

  it('folds private WhatsApp reactions into the target transcript message', () => {
    const target = message({
      id: 'target-message',
      matrixEventId: '$target',
      text: 'See you at five',
      eventTimestamp: '2026-07-03T10:00:00.000Z',
    });
    const reaction = message({
      id: 'reaction-message',
      matrixEventId: '$reaction',
      messageType: 'reaction',
      text: '👍',
      eventTimestamp: '2026-07-03T10:05:00.000Z',
      reaction: {
        emoji: '👍',
        targetMatrixEventId: '$target',
        targetMessageId: 'target-message',
      },
    });

    const context = projectPrivateConversationContext({
      chat,
      range: { from: '2026-07-03T00:00:00.000Z', to: '2026-07-04T00:00:00.000Z' },
      messages: [target, reaction],
    });

    expect(context.messages).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(context.messages[0]))).toMatchObject({
      reactions: [{ id: 'reaction-message', emoji: '👍' }],
    });
    expect(buildPrivateConversationTranscriptText(context.messages)).toContain(
      '[Sent 3 July 2026; imported 22 June 2026] Alice: See you at five\n  Reactions: 👍 Alice'
    );
  });

  it('preserves reactions attached to an omitted media message', () => {
    const mediaTarget = message({
      id: 'media-target',
      matrixEventId: '$media-target',
      messageType: 'image',
      text: undefined,
      eventTimestamp: '2026-07-03T10:00:00.000Z',
      media: { mxcUri: 'mxc://matrix.example/private-image' },
    });
    const reaction = message({
      id: 'media-reaction',
      matrixEventId: '$media-reaction',
      messageType: 'reaction',
      text: undefined,
      direction: 'outgoing',
      senderDisplayName: undefined,
      senderPhoneNumber: undefined,
      senderKey: undefined,
      eventTimestamp: '2026-07-03T10:05:00.000Z',
      reaction: {
        emoji: '❤️',
        targetMatrixEventId: '$media-target',
        targetMessageId: 'media-target',
      },
    });

    const context = projectPrivateConversationContext({
      chat,
      range: { from: '2026-07-03T00:00:00.000Z', to: '2026-07-04T00:00:00.000Z' },
      captureOmittedMessages: true,
      messages: [mediaTarget, reaction],
    });

    expect(context.messages).toEqual([]);
    expect(context.omittedMessages).toEqual([
      expect.objectContaining({
        id: 'media-target',
        omissionReason: 'media_only',
        reactions: [
          expect.objectContaining({
            id: 'media-reaction',
            emoji: '❤️',
            direction: 'outgoing',
          }),
        ],
      }),
    ]);
  });

  it('preserves an unresolved reaction event as an auditable omission', () => {
    const reaction = message({
      id: 'orphan-reaction',
      matrixEventId: '$orphan-reaction',
      messageType: 'reaction',
      text: undefined,
      eventTimestamp: '2026-07-03T10:05:00.000Z',
      reaction: {
        emoji: '👍',
        targetMatrixEventId: '$target-outside-range',
        targetMessageId: 'target-outside-range',
      },
    });

    const context = projectPrivateConversationContext({
      chat,
      range: { from: '2026-07-03T00:00:00.000Z', to: '2026-07-04T00:00:00.000Z' },
      captureOmittedMessages: true,
      messages: [reaction],
    });

    expect(context.omittedMessages).toEqual([
      expect.objectContaining({
        id: 'orphan-reaction',
        omissionReason: 'non_text',
        reaction: {
          emoji: '👍',
          targetMatrixEventId: '$target-outside-range',
          targetMessageId: 'target-outside-range',
        },
      }),
    ]);
  });

  it('does not expose private reaction sender identifiers in transcript text', () => {
    const target = message({
      id: 'target-message',
      matrixEventId: '$target',
      text: 'See you at five',
      eventTimestamp: '2026-07-03T10:00:00.000Z',
    });
    const reaction = message({
      id: 'reaction-message',
      matrixEventId: '$reaction',
      messageType: 'reaction',
      text: '👍',
      senderDisplayName: undefined,
      senderPhoneNumber: '+48123456789',
      senderKey: 'phone:+48123456789',
      eventTimestamp: '2026-07-03T10:05:00.000Z',
      reaction: {
        emoji: '👍',
        targetMatrixEventId: '$target',
        targetMessageId: 'target-message',
      },
    });

    const context = projectPrivateConversationContext({
      chat,
      range: { from: '2026-07-03T00:00:00.000Z', to: '2026-07-04T00:00:00.000Z' },
      messages: [target, reaction],
    });

    const transcriptText = buildPrivateConversationTranscriptText(context.messages);
    expect(transcriptText).toContain('Reactions: 👍 Unknown');
    expect(transcriptText).not.toContain('+48123456789');
    expect(transcriptText).not.toContain('phone:+48123456789');
  });

  it('folds legacy raw Matrix reactions into the target transcript message', () => {
    const target = message({
      id: 'target-message',
      matrixEventId: '$target',
      text: 'See you at five',
      eventTimestamp: '2026-07-03T10:00:00.000Z',
    });
    const reaction = message({
      id: 'legacy-reaction-message',
      matrixEventId: '$legacy-reaction',
      messageType: 'reaction',
      text: '👍',
      eventTimestamp: '2026-07-03T10:05:00.000Z',
      rawMatrixEvent: {
        type: 'm.reaction',
        event_id: '$legacy-reaction',
        content: {
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: '$target',
            key: '👍',
          },
        },
      },
    });

    const context = projectPrivateConversationContext({
      chat,
      range: { from: '2026-07-03T00:00:00.000Z', to: '2026-07-04T00:00:00.000Z' },
      messages: [target, reaction],
    });

    expect(context.messages).toHaveLength(1);
    expect(buildPrivateConversationTranscriptText(context.messages)).toContain(
      '[Sent 3 July 2026; imported 22 June 2026] Alice: See you at five\n  Reactions: 👍 Alice'
    );
  });

  it('folds reactions resolved by Matrix target id and labels outgoing reactions as You', () => {
    const target = message({
      id: 'target-message',
      matrixEventId: '$target',
      text: 'See you at five',
      eventTimestamp: '2026-07-03T10:00:00.000Z',
    });
    const reaction = message({
      id: 'reaction-message',
      matrixEventId: '$reaction',
      messageType: 'reaction',
      direction: 'outgoing',
      text: '👍',
      senderDisplayName: undefined,
      senderPhoneNumber: undefined,
      senderKey: undefined,
      eventTimestamp: '2026-07-03T10:05:00.000Z',
      reaction: {
        emoji: '👍',
        targetMatrixEventId: '$target',
      },
    });

    const context = projectPrivateConversationContext({
      chat,
      range: { from: '2026-07-03T00:00:00.000Z', to: '2026-07-04T00:00:00.000Z' },
      messages: [target, reaction],
    });

    expect(buildPrivateConversationTranscriptText(context.messages)).toContain(
      '[Sent 3 July 2026; imported 22 June 2026] Alice: See you at five\n  Reactions: 👍 You'
    );
  });

  it('ignores malformed or unresolved private WhatsApp reactions in transcript projection', () => {
    const target = message({
      id: 'target-message',
      matrixEventId: '$target',
      text: 'See you at five',
      eventTimestamp: '2026-07-03T10:00:00.000Z',
    });
    const malformedReactions = [
      message({
        id: 'missing-normalized-target',
        matrixEventId: '$missing-normalized-target',
        messageType: 'reaction',
        text: undefined,
        reaction: {
          emoji: '👍',
        },
      }),
      message({
        id: 'unresolved-normalized-target',
        matrixEventId: '$unresolved-normalized-target',
        messageType: 'reaction',
        text: undefined,
        reaction: {
          emoji: '👍',
          targetMatrixEventId: '$missing-target',
        },
      }),
      message({
        id: 'raw-not-record',
        matrixEventId: '$raw-not-record',
        messageType: 'reaction',
        text: undefined,
        rawMatrixEvent: 'not-an-event',
      }),
      message({
        id: 'content-not-record',
        matrixEventId: '$content-not-record',
        messageType: 'reaction',
        text: undefined,
        rawMatrixEvent: { content: 'not-content' },
      }),
      message({
        id: 'relation-not-record',
        matrixEventId: '$relation-not-record',
        messageType: 'reaction',
        text: undefined,
        rawMatrixEvent: { content: { 'm.relates_to': 'not-relation' } },
      }),
      message({
        id: 'wrong-relation-type',
        matrixEventId: '$wrong-relation-type',
        messageType: 'reaction',
        text: undefined,
        rawMatrixEvent: {
          content: {
            'm.relates_to': {
              rel_type: 'm.reference',
              event_id: '$target',
              key: '👍',
            },
          },
        },
      }),
      message({
        id: 'missing-reaction-key',
        matrixEventId: '$missing-reaction-key',
        messageType: 'reaction',
        text: undefined,
        rawMatrixEvent: {
          content: {
            'm.relates_to': {
              rel_type: 'm.annotation',
              event_id: '$target',
            },
          },
        },
      }),
      message({
        id: 'unresolved-legacy-target',
        matrixEventId: '$unresolved-legacy-target',
        messageType: 'reaction',
        text: undefined,
        rawMatrixEvent: {
          content: {
            'm.relates_to': {
              rel_type: 'm.annotation',
              event_id: '$missing-target',
              key: '👍',
            },
          },
        },
      }),
      message({
        id: 'unresolved-target-id',
        matrixEventId: '$unresolved-target-id',
        messageType: 'reaction',
        text: undefined,
        reaction: {
          emoji: '👍',
          targetMessageId: 'missing-target-message',
        },
      }),
    ];

    const context = projectPrivateConversationContext({
      chat,
      range: { from: '2026-07-03T00:00:00.000Z', to: '2026-07-04T00:00:00.000Z' },
      messages: [target, ...malformedReactions],
    });

    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]?.content).toBe('See you at five');
    expect(context.omitted.nonText).toBe(malformedReactions.length);
    expect(buildPrivateConversationTranscriptText(context.messages)).not.toContain('Reactions:');
  });

  it('preserves explicit max-message caps for legacy context callers', () => {
    const result = projectPrivateConversationContext({
      chat,
      range: {
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
      maxMessages: 1,
      captureOmittedMessages: true,
      messages: [
        message({ id: 'message-1', text: 'first' }),
        message({ id: 'message-2', matrixEventId: '$event-2', text: 'second' }),
        message({ id: 'message-3', matrixEventId: '$event-3', text: 'third' }),
      ],
    });

    expect(result.messages.map((item) => item.content)).toEqual(['first']);
    expect(result.omitted.overLimit).toBe(2);
    expect(result.omittedMessages).toEqual([
      expect.objectContaining({
        id: 'message-2',
        omissionReason: 'over_limit',
        contentKind: 'text',
        content: 'second',
      }),
      expect.objectContaining({
        id: 'message-3',
        omissionReason: 'over_limit',
        contentKind: 'text',
        content: 'third',
      }),
    ]);
  });

  it('counts completed transcriptions over an explicit max-message cap', () => {
    const result = projectPrivateConversationContext({
      chat,
      range: {
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
      maxMessages: 1,
      messages: [
        message({ id: 'message-1', text: 'first' }),
        message({
          id: 'message-2',
          matrixEventId: '$event-2',
          messageType: 'audio',
          text: undefined,
          transcription: { status: 'completed', text: 'second transcript' },
        }),
      ],
    });

    expect(result.messages.map((item) => item.content)).toEqual(['first']);
    expect(result.omitted.overLimit).toBe(1);
  });

  it('falls back safely for empty completed transcripts and sparse chat metadata', () => {
    const sparseChat: PrivateWhatsAppChat = { ...chat };
    delete sparseChat.displayName;
    delete sparseChat.messageCount;

    const result = projectPrivateConversationContext({
      chat: sparseChat,
      range: {
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
      messages: [
        message({
          id: 'message-empty-transcript',
          text: undefined,
          senderDisplayName: undefined,
          senderPhoneNumber: undefined,
          senderKey: undefined,
          transcription: { status: 'completed', text: '   ' },
        }),
        message({
          id: 'message-unknown-speaker',
          text: 'from unknown sender',
          senderDisplayName: undefined,
          senderPhoneNumber: '+48123456789',
          senderKey: 'phone:+48123456789',
        }),
      ],
    });

    expect(result.chat).toEqual({
      id: 'chat-123',
      chatType: 'direct',
      firstSeenAt: '2026-06-22T09:00:00.000Z',
      lastEventAt: '2026-06-22T11:00:00.000Z',
      messageCount: 0,
    });
    expect(result.messages).toEqual([
      expect.objectContaining({
        id: 'message-unknown-speaker',
        speakerLabel: 'Unknown',
        content: 'from unknown sender',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('+48123456789');
    expect(JSON.stringify(result)).not.toContain('phone:+48123456789');
    expect(result.omitted.nonText).toBe(1);
  });
});
