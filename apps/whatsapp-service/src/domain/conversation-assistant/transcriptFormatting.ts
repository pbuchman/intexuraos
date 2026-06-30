import { createHash } from 'node:crypto';
import type {
  PrivateWhatsAppChat,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageType,
} from '../whatsapp/index.js';
import type {
  PrivateConversationContextMessage,
  PrivateConversationContextOmittedCounts,
  PrivateConversationContextResponse,
} from '../whatsapp/models/PrivateWhatsApp.js';

export interface ProjectPrivateConversationContextInput {
  chat: PrivateWhatsAppChat;
  range: {
    from: string;
    to: string;
  };
  messages: PrivateWhatsAppMessage[];
  maxMessages: number;
  totalMatchingMessages: number;
}

const MEDIA_MESSAGE_TYPES = new Set<PrivateWhatsAppMessageType>([
  'image',
  'audio',
  'video',
  'file',
  'sticker',
]);

const NON_TEXT_MESSAGE_TYPES = new Set<PrivateWhatsAppMessageType>([
  'reaction',
  'redaction',
  'unknown',
]);

export function projectPrivateConversationContext(
  input: ProjectPrivateConversationContextInput
): PrivateConversationContextResponse {
  const consideredMessages = input.messages.slice(0, input.maxMessages);
  const omitted: PrivateConversationContextOmittedCounts = {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: Math.max(0, input.totalMatchingMessages - input.maxMessages),
  };
  const messages: PrivateConversationContextMessage[] = [];

  for (const message of consideredMessages) {
    const projected = projectMessage(message, omitted);
    if (projected !== null) {
      messages.push(projected);
    }
  }

  const chat: PrivateConversationContextResponse['chat'] = {
    id: input.chat.id,
    chatType: 'direct',
    firstSeenAt: input.chat.firstSeenAt,
    lastEventAt: input.chat.lastEventAt,
    messageCount: input.chat.messageCount ?? 0,
  };
  if (input.chat.displayName !== undefined) {
    chat.displayName = input.chat.displayName;
  }

  const transcriptText = buildPrivateConversationTranscriptText(messages);
  return {
    chat,
    range: input.range,
    messages,
    omitted,
    messageCount: messages.length,
    transcriptSha256: createHash('sha256').update(transcriptText).digest('hex'),
  };
}

export function buildPrivateConversationTranscriptText(
  messages: PrivateConversationContextMessage[]
): string {
  return messages
    .map((message) => `[${message.eventTimestamp}] ${message.speakerLabel}: ${message.content}`)
    .join('\n');
}

function projectMessage(
  message: PrivateWhatsAppMessage,
  omitted: PrivateConversationContextOmittedCounts
): PrivateConversationContextMessage | null {
  const text = message.text?.trim();
  if (text !== undefined && text.length > 0) {
    return buildContextMessage(message, 'text', text);
  }

  const transcriptionText = message.transcription?.text?.trim();
  if (message.transcription?.status === 'completed' && transcriptionText !== undefined && transcriptionText.length > 0) {
    return buildContextMessage(message, 'transcription', transcriptionText);
  }

  countOmission(message, omitted);
  return null;
}

function buildContextMessage(
  message: PrivateWhatsAppMessage,
  contentKind: PrivateConversationContextMessage['contentKind'],
  content: string
): PrivateConversationContextMessage {
  return {
    id: message.id,
    eventTimestamp: message.eventTimestamp,
    direction: message.direction,
    speakerLabel: getSpeakerLabel(message),
    messageType: message.messageType,
    contentKind,
    content,
  };
}

function getSpeakerLabel(message: PrivateWhatsAppMessage): string {
  if (message.direction === 'outgoing') {
    return 'You';
  }
  const displayName = message.senderDisplayName?.trim();
  if (displayName !== undefined && displayName.length > 0) return displayName;
  return 'Contact';
}

function countOmission(
  message: PrivateWhatsAppMessage,
  omitted: PrivateConversationContextOmittedCounts
): void {
  if (message.transcription?.status === 'failed') {
    omitted.failedTranscriptions += 1;
    return;
  }
  if (message.transcription?.status === 'pending' || message.transcription?.status === 'processing') {
    omitted.pendingTranscriptions += 1;
    return;
  }
  if (NON_TEXT_MESSAGE_TYPES.has(message.messageType)) {
    omitted.nonText += 1;
    return;
  }
  if (MEDIA_MESSAGE_TYPES.has(message.messageType)) {
    omitted.mediaOnly += 1;
    return;
  }
  omitted.nonText += 1;
}
