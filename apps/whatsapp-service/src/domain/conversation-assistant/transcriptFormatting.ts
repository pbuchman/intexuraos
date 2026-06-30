import { createHash } from 'node:crypto';
import type {
  PrivateWhatsAppChat,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageDirection,
  PrivateWhatsAppMessageType,
} from '../whatsapp/index.js';

export interface PrivateConversationContextMessage {
  id: string;
  eventTimestamp: string;
  direction: PrivateWhatsAppMessageDirection;
  speakerLabel: string;
  messageType: PrivateWhatsAppMessageType;
  contentKind: 'text' | 'transcription';
  content: string;
}

export interface PrivateConversationContextResponse {
  chat: {
    id: string;
    displayName?: string;
    chatType: 'direct';
    firstSeenAt: string;
    lastEventAt: string;
    messageCount: number;
  };
  range: { from: string; to: string };
  messages: PrivateConversationContextMessage[];
  omitted: {
    mediaOnly: number;
    failedTranscriptions: number;
    pendingTranscriptions: number;
    nonText: number;
    overLimit: number;
  };
  messageCount: number;
  transcriptSha256: string;
}

export interface ProjectPrivateConversationContextInput {
  chat: PrivateWhatsAppChat;
  range: { from: string; to: string };
  messages: PrivateWhatsAppMessage[];
  maxMessages: number;
  totalMessageCount?: number;
}

const MEDIA_MESSAGE_TYPES = new Set<PrivateWhatsAppMessageType>(['image', 'audio', 'video', 'file', 'sticker']);

export function projectPrivateConversationContext(
  input: ProjectPrivateConversationContextInput
): PrivateConversationContextResponse {
  const omitted = {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  };
  const contextMessages: PrivateConversationContextMessage[] = [];

  for (const message of input.messages) {
    const text = message.text?.trim();
    if (text !== undefined && text.length > 0) {
      if (contextMessages.length >= input.maxMessages) {
        omitted.overLimit += 1;
        continue;
      }
      contextMessages.push(toContextMessage(message, 'text', text));
      continue;
    }

    const transcription = message.transcription;
    if (transcription?.status === 'completed') {
      const transcriptionText = transcription.text?.trim();
      if (transcriptionText !== undefined && transcriptionText.length > 0) {
        if (contextMessages.length >= input.maxMessages) {
          omitted.overLimit += 1;
          continue;
        }
        contextMessages.push(toContextMessage(message, 'transcription', transcriptionText));
        continue;
      }
    }

    if (transcription?.status === 'pending' || transcription?.status === 'processing') {
      omitted.pendingTranscriptions += 1;
      continue;
    }
    if (transcription?.status === 'failed') {
      omitted.failedTranscriptions += 1;
      continue;
    }
    if (MEDIA_MESSAGE_TYPES.has(message.messageType)) {
      omitted.mediaOnly += 1;
      continue;
    }
    omitted.nonText += 1;
  }

  const transcriptText = formatTranscriptText(contextMessages);
  return {
    chat: toContextChat(input.chat),
    range: input.range,
    messages: contextMessages,
    omitted,
    messageCount: contextMessages.length,
    transcriptSha256: createHash('sha256').update(transcriptText).digest('hex'),
  };
}

function toContextChat(chat: PrivateWhatsAppChat): PrivateConversationContextResponse['chat'] {
  const contextChat: PrivateConversationContextResponse['chat'] = {
    id: chat.id,
    chatType: 'direct',
    firstSeenAt: chat.firstSeenAt,
    lastEventAt: chat.lastEventAt,
    messageCount: chat.messageCount ?? 0,
  };
  if (chat.displayName !== undefined) {
    contextChat.displayName = chat.displayName;
  }
  return contextChat;
}

function toContextMessage(
  message: PrivateWhatsAppMessage,
  contentKind: PrivateConversationContextMessage['contentKind'],
  content: string
): PrivateConversationContextMessage {
  return {
    id: message.id,
    eventTimestamp: message.eventTimestamp,
    direction: message.direction,
    speakerLabel: speakerLabelFor(message),
    messageType: message.messageType,
    contentKind,
    content,
  };
}

function speakerLabelFor(message: PrivateWhatsAppMessage): string {
  if (message.direction === 'outgoing') {
    return 'You';
  }
  return firstNonEmpty(message.senderDisplayName) ?? 'Unknown';
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.map((value) => value?.trim()).find((value) => value !== undefined && value.length > 0);
}

function formatTranscriptText(messages: PrivateConversationContextMessage[]): string {
  return messages
    .map((message) => `[${message.eventTimestamp}] ${message.speakerLabel}: ${message.content}`)
    .join('\n');
}
