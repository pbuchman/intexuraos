import { createHash } from 'node:crypto';
import type {
  PrivateWhatsAppChat,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageDirection,
  PrivateWhatsAppReactionSummary,
  PrivateWhatsAppMessageType,
} from '../whatsapp/index.js';

export interface PrivateConversationContextMessage {
  id: string;
  eventTimestamp: string;
  importedAt: string;
  direction: PrivateWhatsAppMessageDirection;
  speakerLabel: string;
  messageType: PrivateWhatsAppMessageType;
  contentKind: 'text' | 'transcription';
  content: string;
  reactions?: PrivateWhatsAppReactionSummary[];
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
  maxMessages?: number;
  totalMessageCount?: number;
}

interface PrivateWhatsAppTranscriptReaction {
  emoji: string;
  targetMatrixEventId?: string;
  targetMessageId: string;
}

type PrivateWhatsAppMessageWithReaction = PrivateWhatsAppMessage & {
  reaction?: PrivateWhatsAppTranscriptReaction;
};

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
  const targetsById = new Map(input.messages.map((message) => [message.id, message]));
  const targetsByMatrixEventId = new Map(
    input.messages
      .filter((message) => message.matrixEventId.length > 0)
      .map((message) => [message.matrixEventId, message])
  );
  const reactionsByTarget = new Map<string, PrivateWhatsAppReactionSummary[]>();
  const attachedReactionIds = new Set<string>();

  for (const message of input.messages) {
    if (message.messageType !== 'reaction') {
      continue;
    }
    const reaction = normalizeTranscriptReaction(message, targetsByMatrixEventId);
    if (reaction === undefined) {
      continue;
    }
    const target = targetsById.get(reaction.targetMessageId);
    if (target === undefined) {
      continue;
    }
    attachedReactionIds.add(message.id);
    const summaries = reactionsByTarget.get(target.id) ?? [];
    summaries.push({
      id: message.id,
      emoji: reaction.emoji,
      direction: message.direction,
      eventTimestamp: message.eventTimestamp,
      ...(message.senderKey !== undefined ? { senderKey: message.senderKey } : {}),
      ...(message.senderDisplayName !== undefined
        ? { senderDisplayName: message.senderDisplayName }
        : {}),
      ...(message.senderPhoneNumber !== undefined
        ? { senderPhoneNumber: message.senderPhoneNumber }
        : {}),
    });
    reactionsByTarget.set(target.id, summaries);
  }

  for (const message of input.messages) {
    if (attachedReactionIds.has(message.id)) {
      continue;
    }
    const text = message.text?.trim();
    if (text !== undefined && text.length > 0) {
      if (hasReachedMaxMessages(contextMessages.length, input.maxMessages)) {
        omitted.overLimit += 1;
        continue;
      }
      contextMessages.push(toContextMessage(message, 'text', text, reactionsByTarget.get(message.id)));
      continue;
    }

    const transcription = message.transcription;
    if (transcription?.status === 'completed') {
      const transcriptionText = transcription.text?.trim();
      if (transcriptionText !== undefined && transcriptionText.length > 0) {
        if (hasReachedMaxMessages(contextMessages.length, input.maxMessages)) {
          omitted.overLimit += 1;
          continue;
        }
        contextMessages.push(
          toContextMessage(message, 'transcription', transcriptionText, reactionsByTarget.get(message.id))
        );
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

  const transcriptText = buildPrivateConversationTranscriptText(contextMessages);
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
  content: string,
  reactions: PrivateWhatsAppReactionSummary[] | undefined
): PrivateConversationContextMessage {
  const contextMessage: PrivateConversationContextMessage = {
    id: message.id,
    eventTimestamp: message.eventTimestamp,
    importedAt: message.ingestedAt,
    direction: message.direction,
    speakerLabel: speakerLabelFor(message),
    messageType: message.messageType,
    contentKind,
    content,
  };
  if (reactions !== undefined && reactions.length > 0) {
    Object.defineProperty(contextMessage, 'reactions', {
      value: reactions,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return contextMessage;
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

export function buildPrivateConversationTranscriptText(
  messages: PrivateConversationContextMessage[]
): string {
  return messages
    .map((message) => {
      const reactionLine =
        message.reactions === undefined || message.reactions.length === 0
          ? ''
          : `\n  Reactions: ${message.reactions.map(formatReactionSummary).join(', ')}`;
      return `[Sent ${formatTranscriptDateLabel(message.eventTimestamp)}; imported ${formatTranscriptDateLabel(message.importedAt)}] ${message.speakerLabel}: ${message.content}${reactionLine}`;
    })
    .join('\n');
}

function formatReactionSummary(reaction: PrivateWhatsAppReactionSummary): string {
  const sender =
    reaction.direction === 'outgoing' ? 'You' : firstNonEmpty(reaction.senderDisplayName) ?? 'Unknown';
  return `${reaction.emoji} ${sender}`;
}

function normalizeTranscriptReaction(
  message: PrivateWhatsAppMessage,
  targetsByMatrixEventId: ReadonlyMap<string, PrivateWhatsAppMessage>
): PrivateWhatsAppTranscriptReaction | undefined {
  const normalizedReaction = (message as PrivateWhatsAppMessageWithReaction).reaction;
  const normalizedEmoji = firstNonEmpty(normalizedReaction?.emoji);
  if (normalizedEmoji !== undefined) {
    const targetMessageId = firstNonEmpty(normalizedReaction?.targetMessageId);
    if (targetMessageId !== undefined) {
      return {
        emoji: normalizedEmoji,
        targetMessageId,
        ...(normalizedReaction?.targetMatrixEventId !== undefined
          ? { targetMatrixEventId: normalizedReaction.targetMatrixEventId }
          : {}),
      };
    }
    const targetMatrixEventId = firstNonEmpty(normalizedReaction?.targetMatrixEventId);
    if (targetMatrixEventId === undefined) {
      return undefined;
    }
    const target = targetsByMatrixEventId.get(targetMatrixEventId);
    if (target === undefined) {
      return undefined;
    }
    return {
      emoji: normalizedEmoji,
      targetMatrixEventId,
      targetMessageId: target.id,
    };
  }

  const legacyReaction = extractLegacyTranscriptReaction(message.rawMatrixEvent);
  if (legacyReaction === undefined) {
    return undefined;
  }
  const target = targetsByMatrixEventId.get(legacyReaction.targetMatrixEventId);
  if (target === undefined) {
    return undefined;
  }
  return {
    emoji: legacyReaction.emoji,
    targetMatrixEventId: legacyReaction.targetMatrixEventId,
    targetMessageId: target.id,
  };
}

function extractLegacyTranscriptReaction(
  rawMatrixEvent: unknown
): { emoji: string; targetMatrixEventId: string } | undefined {
  if (!isRecord(rawMatrixEvent)) {
    return undefined;
  }
  const content = rawMatrixEvent['content'];
  if (!isRecord(content)) {
    return undefined;
  }
  const relatesTo = content['m.relates_to'];
  if (!isRecord(relatesTo)) {
    return undefined;
  }
  if (relatesTo['rel_type'] !== 'm.annotation') {
    return undefined;
  }
  const targetMatrixEventId = firstNonEmpty(asOptionalString(relatesTo['event_id']));
  const emoji = firstNonEmpty(asOptionalString(relatesTo['key']));
  if (targetMatrixEventId === undefined || emoji === undefined) {
    return undefined;
  }
  return { emoji, targetMatrixEventId };
}

function hasReachedMaxMessages(currentLength: number, maxMessages: number | undefined): boolean {
  return maxMessages !== undefined && currentLength >= maxMessages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const ENGLISH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function formatTranscriptDateLabel(value: string): string {
  const date = new Date(value);
  const month = ENGLISH_MONTHS[date.getUTCMonth()];
  if (month === undefined) {
    return 'Unknown date';
  }
  return `${String(date.getUTCDate())} ${month} ${String(date.getUTCFullYear())}`;
}
