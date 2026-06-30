import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  PrivateWhatsAppChat,
  PrivateWhatsAppMessage,
} from '../../../domain/whatsapp/models/PrivateWhatsApp.js';
import {
  buildPrivateConversationTranscriptText,
  projectPrivateConversationContext,
} from '../../../domain/conversation-assistant/transcriptFormatting.js';

function chat(
  overrides: Omit<Partial<PrivateWhatsAppChat>, 'displayName' | 'messageCount'> & {
    displayName?: string | undefined;
    messageCount?: number | undefined;
  } = {}
): PrivateWhatsAppChat {
  const value = {
    id: 'chat-1',
    userId: 'user-123',
    sourceAccountId: 'source-1',
    matrixRoomId: '!room:matrix.example',
    chatType: 'direct',
    displayName: 'Alice',
    firstSeenAt: '2026-06-22T09:00:00.000Z',
    lastEventAt: '2026-06-22T10:15:00.000Z',
    updatedAt: '2026-06-22T10:15:00.000Z',
    messageCount: 9,
    schemaVersion: 2,
    ...overrides,
  } as PrivateWhatsAppChat;
  if (Object.hasOwn(overrides, 'displayName') && overrides.displayName === undefined) {
    delete (value as { displayName?: string }).displayName;
  }
  if (Object.hasOwn(overrides, 'messageCount') && overrides.messageCount === undefined) {
    delete (value as { messageCount?: number }).messageCount;
  }
  return value;
}

function message(
  overrides: Omit<
    Partial<PrivateWhatsAppMessage>,
    'senderDisplayName' | 'senderPhoneNumber' | 'senderKey' | 'text'
  > & {
    senderDisplayName?: string | undefined;
    senderPhoneNumber?: string | undefined;
    senderKey?: string | undefined;
    text?: string | undefined;
  } = {}
): PrivateWhatsAppMessage {
  const value = {
    id: 'message-1',
    chatId: 'chat-1',
    userId: 'user-123',
    sourceAccountId: 'source-1',
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
    receivedAt: '2026-06-22T10:00:01.000Z',
    ingestedAt: '2026-06-22T10:00:02.000Z',
    deliveryMode: 'live',
    rawMatrixEvent: { event_id: '$event-1', content: { body: 'raw' } },
    schemaVersion: 2,
    ...overrides,
  } as PrivateWhatsAppMessage;
  if (Object.hasOwn(overrides, 'text') && overrides.text === undefined) {
    delete (value as { text?: string }).text;
  }
  if (Object.hasOwn(overrides, 'senderDisplayName') && overrides.senderDisplayName === undefined) {
    delete (value as { senderDisplayName?: string }).senderDisplayName;
  }
  if (Object.hasOwn(overrides, 'senderPhoneNumber') && overrides.senderPhoneNumber === undefined) {
    delete (value as { senderPhoneNumber?: string }).senderPhoneNumber;
  }
  if (Object.hasOwn(overrides, 'senderKey') && overrides.senderKey === undefined) {
    delete (value as { senderKey?: string }).senderKey;
  }
  return value;
}

describe('projectPrivateConversationContext', () => {
  it('projects text and completed transcriptions into a sanitized stable transcript', () => {
    const messages = [
      message({ id: 'm1', eventTimestamp: '2026-06-22T10:00:00.000Z', text: '  hi Alice  ' }),
      message({
        id: 'm2',
        direction: 'outgoing',
        eventTimestamp: '2026-06-22T10:01:00.000Z',
        text: ' I will call you. ',
      }),
      message({
        id: 'm3',
        eventTimestamp: '2026-06-22T10:02:00.000Z',
        messageType: 'audio',
        text: undefined,
        transcription: { status: 'completed', text: '  voice note text  ' },
        media: { mxcUri: 'mxc://matrix.example/audio', gcsPath: 'private/audio.ogg' },
      }),
    ];

    const result = projectPrivateConversationContext({
      chat: chat(),
      range: {
        from: '2026-06-22T10:00:00.000Z',
        to: '2026-06-22T10:10:00.000Z',
      },
      messages,
      maxMessages: 2000,
      totalMatchingMessages: messages.length,
    });

    expect(result.chat).toEqual({
      id: 'chat-1',
      displayName: 'Alice',
      chatType: 'direct',
      firstSeenAt: '2026-06-22T09:00:00.000Z',
      lastEventAt: '2026-06-22T10:15:00.000Z',
      messageCount: 9,
    });
    expect(result.messages).toEqual([
      {
        id: 'm1',
        eventTimestamp: '2026-06-22T10:00:00.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
        contentKind: 'text',
        content: 'hi Alice',
      },
      {
        id: 'm2',
        eventTimestamp: '2026-06-22T10:01:00.000Z',
        direction: 'outgoing',
        speakerLabel: 'You',
        messageType: 'text',
        contentKind: 'text',
        content: 'I will call you.',
      },
      {
        id: 'm3',
        eventTimestamp: '2026-06-22T10:02:00.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'audio',
        contentKind: 'transcription',
        content: 'voice note text',
      },
    ]);
    expect(result.omitted).toEqual({
      mediaOnly: 0,
      failedTranscriptions: 0,
      pendingTranscriptions: 0,
      nonText: 0,
      overLimit: 0,
    });
    expect(result.messageCount).toBe(3);
    const transcriptText = buildPrivateConversationTranscriptText(result.messages);
    expect(transcriptText).toBe(
      [
        '[2026-06-22T10:00:00.000Z] Alice: hi Alice',
        '[2026-06-22T10:01:00.000Z] You: I will call you.',
        '[2026-06-22T10:02:00.000Z] Alice: voice note text',
      ].join('\n')
    );
    expect(result.transcriptSha256).toBe(
      createHash('sha256').update(transcriptText).digest('hex')
    );
    expect(JSON.stringify(result.messages)).not.toContain('matrix');
    expect(JSON.stringify(result.messages)).not.toContain('mxc://');
    expect(JSON.stringify(result.messages)).not.toContain('gcsPath');
  });

  it('counts omitted pending failed media-only non-text and over-limit messages', () => {
    const result = projectPrivateConversationContext({
      chat: chat({ displayName: undefined }),
      range: {
        from: '2026-06-22T10:00:00.000Z',
        to: '2026-06-22T10:10:00.000Z',
      },
      maxMessages: 5,
      totalMatchingMessages: 8,
      messages: [
        message({
          id: 'pending-audio',
          messageType: 'audio',
          text: undefined,
          transcription: { status: 'pending' },
        }),
        message({
          id: 'processing-video',
          messageType: 'video',
          text: undefined,
          transcription: { status: 'processing' },
        }),
        message({
          id: 'failed-audio',
          messageType: 'audio',
          text: undefined,
          transcription: { status: 'failed', error: { code: 'BAD_AUDIO', message: 'bad' } },
        }),
        message({ id: 'image-only', messageType: 'image', text: '   ' }),
        message({ id: 'reaction', messageType: 'reaction', text: undefined }),
        message({ id: 'over-limit', text: 'not counted because repository returned limit + 1' }),
      ],
    });

    expect(result.chat).toEqual({
      id: 'chat-1',
      chatType: 'direct',
      firstSeenAt: '2026-06-22T09:00:00.000Z',
      lastEventAt: '2026-06-22T10:15:00.000Z',
      messageCount: 9,
    });
    expect(result.messages).toEqual([]);
    expect(result.omitted).toEqual({
      mediaOnly: 1,
      failedTranscriptions: 1,
      pendingTranscriptions: 2,
      nonText: 1,
      overLimit: 3,
    });
    expect(result.messageCount).toBe(0);
    expect(result.transcriptSha256).toBe(createHash('sha256').update('').digest('hex'));
  });

  it('falls back through incoming speaker labels and chat message count defaults', () => {
    const result = projectPrivateConversationContext({
      chat: chat({ messageCount: undefined }),
      range: {
        from: '2026-06-22T10:00:00.000Z',
        to: '2026-06-22T10:10:00.000Z',
      },
      maxMessages: 10,
      totalMatchingMessages: 4,
      messages: [
        message({
          id: 'phone-label',
          senderDisplayName: '   ',
          senderPhoneNumber: ' +48111111111 ',
          senderKey: 'phone:+48111111111',
          text: 'phone label',
        }),
        message({
          id: 'sender-key-label',
          senderDisplayName: undefined,
          senderPhoneNumber: undefined,
          senderKey: ' phone:+48222222222 ',
          text: 'key label',
        }),
        message({
          id: 'unknown-label',
          senderDisplayName: undefined,
          senderPhoneNumber: undefined,
          senderKey: undefined,
          messageType: 'unknown',
          text: undefined,
        }),
        message({
          id: 'empty-text',
          messageType: 'text',
          text: undefined,
        }),
      ],
    });

    expect(result.chat.messageCount).toBe(0);
    expect(result.messages.map((projected) => projected.speakerLabel)).toEqual([
      'Contact',
      'Contact',
    ]);
    expect(result.omitted.nonText).toBe(2);
  });
});
