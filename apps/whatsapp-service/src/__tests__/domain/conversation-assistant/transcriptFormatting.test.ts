import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PrivateWhatsAppChat, PrivateWhatsAppMessage } from '../../../domain/whatsapp/index.js';
import { projectPrivateConversationContext } from '../../../domain/conversation-assistant/transcriptFormatting.js';

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
  Omit<PrivateWhatsAppMessage, 'text' | 'senderDisplayName' | 'senderPhoneNumber' | 'senderKey'>
> & {
  text?: string | undefined;
  senderDisplayName?: string | undefined;
  senderPhoneNumber?: string | undefined;
  senderKey?: string | undefined;
};

function message(overrides: MessageOverrides): PrivateWhatsAppMessage {
  const { text, senderDisplayName, senderPhoneNumber, senderKey, ...rest } = overrides;
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
      maxMessages: 10,
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
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
        contentKind: 'text',
        content: 'hello from private chat',
      },
      {
        id: 'message-2',
        eventTimestamp: '2026-06-22T10:05:00.000Z',
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
    expect(result.messageCount).toBe(2);
    const expectedTranscript = [
      '[2026-06-22T10:00:00.000Z] Alice: hello from private chat',
      '[2026-06-22T10:05:00.000Z] You: voice transcript',
    ].join('\n');
    expect(result.transcriptSha256).toBe(
      createHash('sha256').update(expectedTranscript).digest('hex')
    );
    expect(JSON.stringify(result)).not.toContain('rawMatrixEvent');
    expect(JSON.stringify(result)).not.toContain('sourceAccountId');
    expect(JSON.stringify(result)).not.toContain('mxc://matrix.example');
  });

  it('counts over-limit messages after projecting the first maxMessages plus one repository result', () => {
    const result = projectPrivateConversationContext({
      chat,
      range: {
        from: '2026-06-22T09:00:00.000Z',
        to: '2026-06-22T11:00:00.000Z',
      },
      maxMessages: 1,
      messages: [
        message({ id: 'message-1', text: 'first' }),
        message({ id: 'message-2', matrixEventId: '$event-2', text: 'second' }),
        message({
          id: 'message-media',
          matrixEventId: '$event-media',
          text: undefined,
          messageType: 'image',
          media: { mxcUri: 'mxc://matrix.example/after-limit-media' },
        }),
        message({ id: 'message-3', matrixEventId: '$event-3', text: 'third' }),
        message({
          id: 'message-4',
          matrixEventId: '$event-4',
          text: undefined,
          messageType: 'audio',
          transcription: { status: 'completed', text: 'fourth transcript' },
        }),
      ],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe('first');
    expect(result.omitted.mediaOnly).toBe(1);
    expect(result.omitted.overLimit).toBe(3);
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
      maxMessages: 10,
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
