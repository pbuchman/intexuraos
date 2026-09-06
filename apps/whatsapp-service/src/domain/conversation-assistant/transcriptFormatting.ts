import { createHash } from 'node:crypto';
import type { ConversationAssistantDateRange } from '@intexuraos/llm-contract';
import type {
  PrivateWhatsAppChat,
  PrivateConversationContextMessage,
  PrivateConversationContextOmittedMessage,
  PrivateConversationContextResponse,
  PrivateWhatsAppMessage,
  PrivateWhatsAppReactionSummary,
  PrivateWhatsAppMessageType,
} from '../whatsapp/index.js';

export interface ProjectPrivateConversationContextInput {
  chat: PrivateWhatsAppChat;
  range: ConversationAssistantDateRange;
  messages: PrivateWhatsAppMessage[];
  maxMessages?: number;
  totalMessageCount?: number;
  captureOmittedMessages?: boolean;
  referenceScope?: ConversationAssistantMessageReferenceScope;
}

export interface ConversationAssistantMessageReferenceScope {
  sessionId: string;
  sessionGenerationId: string;
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
  const omittedMessages: PrivateConversationContextOmittedMessage[] = [];
  const targetsById = new Map(input.messages.map((message) => [message.id, message]));
  const targetsByMatrixEventId = new Map(
    input.messages
      .filter((message) => message.matrixEventId.length > 0)
      .map((message) => [message.matrixEventId, message])
  );
  const reactionsByTarget = new Map<string, PrivateWhatsAppReactionSummary[]>();
  const attachedReactionIds = new Set<string>();

  for (const message of input.messages) {
    if (
      message.messageType !== 'reaction' ||
      message.contextState === 'redacted' ||
      message.contextState === 'deleted'
    ) {
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
    if (
      attachedReactionIds.has(message.id) ||
      message.relation !== undefined ||
      message.messageType === 'redaction' ||
      message.contextState === 'redacted' ||
      message.contextState === 'deleted'
    ) {
      continue;
    }
    const text = message.text?.trim();
    if (text !== undefined && text.length > 0) {
      if (hasReachedMaxMessages(contextMessages.length, input.maxMessages)) {
        omitted.overLimit += 1;
        captureOmittedMessage(
          omittedMessages,
          input.captureOmittedMessages,
          toOmittedMessage(message, 'over_limit', 'text', text, reactionsByTarget.get(message.id))
        );
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
          captureOmittedMessage(
            omittedMessages,
            input.captureOmittedMessages,
            toOmittedMessage(
              message,
              'over_limit',
              'transcription',
              transcriptionText,
              reactionsByTarget.get(message.id)
            )
          );
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
      captureOmittedMessage(
        omittedMessages,
        input.captureOmittedMessages,
        toOmittedMessage(
          message,
          'pending_transcription',
          undefined,
          undefined,
          reactionsByTarget.get(message.id)
        )
      );
      continue;
    }
    if (transcription?.status === 'failed') {
      omitted.failedTranscriptions += 1;
      captureOmittedMessage(
        omittedMessages,
        input.captureOmittedMessages,
        toOmittedMessage(
          message,
          'failed_transcription',
          undefined,
          undefined,
          reactionsByTarget.get(message.id)
        )
      );
      continue;
    }
    if (MEDIA_MESSAGE_TYPES.has(message.messageType)) {
      omitted.mediaOnly += 1;
      captureOmittedMessage(
        omittedMessages,
        input.captureOmittedMessages,
        toOmittedMessage(
          message,
          'media_only',
          undefined,
          undefined,
          reactionsByTarget.get(message.id)
        )
      );
      continue;
    }
    omitted.nonText += 1;
    captureOmittedMessage(
      omittedMessages,
      input.captureOmittedMessages,
      toOmittedMessage(
        message,
        'non_text',
        undefined,
        undefined,
        reactionsByTarget.get(message.id),
        reactionReferenceForAudit(message)
      )
    );
  }

  const transcriptText = buildPrivateConversationTranscriptText(
    contextMessages,
    input.referenceScope
  );
  return {
    chat: toContextChat(input.chat),
    range: input.range,
    messages: contextMessages,
    omittedMessages,
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
    contextMessage.reactions = reactions;
  }
  return contextMessage;
}

function toOmittedMessage(
  message: PrivateWhatsAppMessage,
  omissionReason: PrivateConversationContextOmittedMessage['omissionReason'],
  contentKind?: PrivateConversationContextOmittedMessage['contentKind'],
  content?: string,
  reactions?: PrivateWhatsAppReactionSummary[],
  reaction?: PrivateConversationContextOmittedMessage['reaction']
): PrivateConversationContextOmittedMessage {
  return {
    id: message.id,
    eventTimestamp: message.eventTimestamp,
    importedAt: message.ingestedAt,
    direction: message.direction,
    speakerLabel: speakerLabelFor(message),
    messageType: message.messageType,
    omissionReason,
    ...(contentKind !== undefined ? { contentKind } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(reactions !== undefined && reactions.length > 0 ? { reactions } : {}),
    ...(reaction !== undefined ? { reaction } : {}),
  };
}

function reactionReferenceForAudit(
  message: PrivateWhatsAppMessage
): PrivateConversationContextOmittedMessage['reaction'] {
  if (message.messageType !== 'reaction') return undefined;
  const normalized = (message as PrivateWhatsAppMessageWithReaction).reaction;
  const emoji = firstNonEmpty(normalized?.emoji);
  const targetMessageId = firstNonEmpty(normalized?.targetMessageId);
  const targetMatrixEventId = firstNonEmpty(normalized?.targetMatrixEventId);
  if (emoji !== undefined && (targetMessageId !== undefined || targetMatrixEventId !== undefined)) {
    return {
      emoji,
      ...(targetMessageId !== undefined ? { targetMessageId } : {}),
      ...(targetMatrixEventId !== undefined ? { targetMatrixEventId } : {}),
    };
  }
  const legacy = extractLegacyTranscriptReaction(message.rawMatrixEvent);
  return legacy === undefined
    ? undefined
    : { emoji: legacy.emoji, targetMatrixEventId: legacy.targetMatrixEventId };
}

function captureOmittedMessage(
  omittedMessages: PrivateConversationContextOmittedMessage[],
  enabled: boolean | undefined,
  message: PrivateConversationContextOmittedMessage
): void {
  if (enabled === true) omittedMessages.push(message);
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
  messages: PrivateConversationContextMessage[],
  referenceScope?: ConversationAssistantMessageReferenceScope
): string {
  if (referenceScope !== undefined) {
    return messages
      .map((message) =>
        buildPrivateConversationModelFacingMessageProjection(message, referenceScope)
      )
      .join('\n');
  }
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

export function buildPrivateConversationModelFacingMessageProjection(
  message: PrivateConversationContextMessage,
  referenceScope: ConversationAssistantMessageReferenceScope
): string {
  return JSON.stringify({
    reference: createConversationAssistantMessageReference(referenceScope, message.id),
    sentDate: formatTranscriptDateLabel(message.eventTimestamp),
    importedDate: formatTranscriptDateLabel(message.importedAt),
    direction: message.direction,
    speakerLabel: message.speakerLabel,
    messageType: message.messageType,
    contentKind: message.contentKind,
    content: message.content,
    reactions: [...(message.reactions ?? [])].sort(compareTranscriptReactions).map((reaction) => ({
      emoji: reaction.emoji,
      direction: reaction.direction,
      speakerLabel:
        reaction.direction === 'outgoing'
          ? 'You'
          : firstNonEmpty(reaction.senderDisplayName) ?? 'Unknown',
      eventDate: formatTranscriptDateLabel(reaction.eventTimestamp),
    })),
  });
}

export function createConversationAssistantMessageReference(
  scope: ConversationAssistantMessageReferenceScope,
  rawMessageId: string
): string {
  const digest = createHash('sha256')
    .update('intexuraos:whatsapp-conversation-assistant:message-reference:v1')
    .update('\0')
    .update(scope.sessionId)
    .update('\0')
    .update(scope.sessionGenerationId)
    .update('\0')
    .update(rawMessageId)
    .digest('hex');
  return `wa_msg_${digest}`;
}

function compareTranscriptReactions(
  left: PrivateWhatsAppReactionSummary,
  right: PrivateWhatsAppReactionSummary
): number {
  const timestamp = left.eventTimestamp.localeCompare(right.eventTimestamp);
  return timestamp === 0 ? left.id.localeCompare(right.id) : timestamp;
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
