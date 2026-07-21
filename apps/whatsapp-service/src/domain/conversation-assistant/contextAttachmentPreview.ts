import { createHash } from 'node:crypto';
import type {
  PrivateConversationContextMessage,
  PrivateConversationContextOmittedMessage,
  PrivateWhatsAppContextChange,
  PrivateWhatsAppContextProjection,
  PrivateWhatsAppReactionSummary,
} from '../whatsapp/index.js';
import type { ConversationAssistantContextAttachmentPreparedSnapshot } from './types.js';

const MAX_PREVIEW_PAGE_SIZE = 100;

export interface PublicConversationAssistantPreviewReaction {
  emoji: string;
  direction: 'incoming' | 'outgoing';
  eventTimestamp: string;
  senderDisplayName?: string;
}

export interface PublicConversationAssistantIncludedPreviewMessage {
  id: string;
  eventTimestamp: string;
  importedAt: string;
  direction: 'incoming' | 'outgoing';
  speakerLabel: string;
  messageType: PrivateConversationContextMessage['messageType'];
  contentKind: 'text' | 'transcription';
  content: string;
  reactions?: PublicConversationAssistantPreviewReaction[];
}

export interface PublicConversationAssistantExcludedPreviewMessage {
  id: string;
  eventTimestamp: string;
  importedAt: string;
  direction: 'incoming' | 'outgoing';
  speakerLabel: string;
  messageType: PrivateConversationContextOmittedMessage['messageType'];
  omissionReason: PrivateConversationContextOmittedMessage['omissionReason'];
  contentKind?: 'text' | 'transcription';
  content?: string;
  reactions?: PublicConversationAssistantPreviewReaction[];
}

export type PublicConversationAssistantCorrectionProjection =
  | { state: 'missing' | 'unavailable' }
  | {
      state: 'included';
      eventTimestamp: string;
      importedAt: string;
      direction: 'incoming' | 'outgoing';
      speakerLabel: string;
      messageType: PrivateConversationContextMessage['messageType'];
      contentKind: 'text' | 'transcription';
      content: string;
      reactions: PublicConversationAssistantPreviewReaction[];
    }
  | {
      state: 'omitted';
      eventTimestamp: string;
      importedAt: string;
      direction: 'incoming' | 'outgoing';
      speakerLabel: string;
      messageType: PrivateConversationContextMessage['messageType'];
      omissionReason: PrivateConversationContextOmittedMessage['omissionReason'];
      reactions: PublicConversationAssistantPreviewReaction[];
    }
  | {
      state: 'redacted';
      eventTimestamp: string;
      importedAt: string;
      direction: 'incoming' | 'outgoing';
      speakerLabel: string;
      messageType: PrivateConversationContextMessage['messageType'];
    };

export type PublicConversationAssistantContextAttachmentPreviewItem =
  | { kind: 'included'; message: PublicConversationAssistantIncludedPreviewMessage }
  | { kind: 'excluded'; message: PublicConversationAssistantExcludedPreviewMessage }
  | {
      kind: 'correction';
      changeKind: Exclude<PrivateWhatsAppContextChange['changeType'], 'deleted'>;
      targetReference: string;
      before: PublicConversationAssistantCorrectionProjection;
      after: PublicConversationAssistantCorrectionProjection;
    };

export interface ConversationAssistantContextAttachmentPreviewPage {
  items: PublicConversationAssistantContextAttachmentPreviewItem[];
  nextCursor?: string;
}

export type ConversationAssistantContextAttachmentPreviewResult =
  | { ok: true; value: ConversationAssistantContextAttachmentPreviewPage }
  | { ok: false; error: { code: 'INVALID_CURSOR'; message: string } };

export function buildConversationAssistantContextAttachmentPreviewPage(input: {
  attachmentId: string;
  snapshot: ConversationAssistantContextAttachmentPreparedSnapshot;
  cursor?: string;
  limit: number;
}): ConversationAssistantContextAttachmentPreviewResult {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_PREVIEW_PAGE_SIZE) {
    return invalidCursor();
  }
  const offset = input.cursor === undefined ? 0 : decodeCursor(input.cursor);
  if (offset === null) return invalidCursor();

  const messageItems: PublicConversationAssistantContextAttachmentPreviewItem[] = [
    ...input.snapshot.messages.map((message) => ({
      kind: 'included' as const,
      message: sanitizeIncludedMessage(message, input.attachmentId),
    })),
    ...input.snapshot.omittedMessages.map((message) => ({
      kind: 'excluded' as const,
      message: sanitizeExcludedMessage(message, input.attachmentId),
    })),
  ].sort(comparePreviewMessages);
  const correctionItems = [...input.snapshot.corrections]
    .sort((left, right) => left.sequence - right.sequence)
    .map((change) => toPublicCorrection(change, input.attachmentId));
  const items = [...messageItems, ...correctionItems];
  if (offset > items.length) return invalidCursor();
  const page = items.slice(offset, offset + input.limit);
  const nextOffset = offset + page.length;
  return {
    ok: true,
    value: {
      items: page,
      ...(nextOffset < items.length ? { nextCursor: encodeCursor(nextOffset) } : {}),
    },
  };
}

function sanitizeIncludedMessage(
  message: PrivateConversationContextMessage,
  attachmentId: string
): PublicConversationAssistantIncludedPreviewMessage {
  const reactions = sanitizeReactions(message.reactions);
  const result: PublicConversationAssistantIncludedPreviewMessage = {
    id: createAttachmentLocalPreviewReference(attachmentId, message.id),
    eventTimestamp: message.eventTimestamp,
    importedAt: message.importedAt,
    direction: message.direction,
    speakerLabel: message.speakerLabel,
    messageType: message.messageType,
    contentKind: message.contentKind,
    content: message.content,
  };
  if (reactions.length > 0) result.reactions = reactions;
  return result;
}

function sanitizeExcludedMessage(
  message: PrivateConversationContextOmittedMessage,
  attachmentId: string
): PublicConversationAssistantExcludedPreviewMessage {
  const reactions = sanitizeReactions(message.reactions);
  const result: PublicConversationAssistantExcludedPreviewMessage = {
    id: createAttachmentLocalPreviewReference(attachmentId, message.id),
    eventTimestamp: message.eventTimestamp,
    importedAt: message.importedAt,
    direction: message.direction,
    speakerLabel: message.speakerLabel,
    messageType: message.messageType,
    omissionReason: message.omissionReason,
  };
  if (message.contentKind !== undefined) result.contentKind = message.contentKind;
  if (message.content !== undefined) result.content = message.content;
  if (reactions.length > 0) result.reactions = reactions;
  return result;
}

function toPublicCorrection(
  change: PrivateWhatsAppContextChange,
  attachmentId: string
): Extract<PublicConversationAssistantContextAttachmentPreviewItem, { kind: 'correction' }> {
  const removesContent = change.changeType === 'redacted' || change.changeType === 'deleted';
  return {
    kind: 'correction',
    changeKind: change.changeType === 'deleted' ? 'redacted' : change.changeType,
    targetReference: createAttachmentLocalPreviewReference(attachmentId, change.messageId),
    before: removesContent ? { state: 'unavailable' } : sanitizeProjection(change.before),
    after: sanitizeProjection(change.after),
  };
}

function createAttachmentLocalPreviewReference(
  attachmentId: string,
  sourceMessageId: string
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ version: 1, attachmentId, sourceMessageId }))
    .digest('base64url');
  return `context-item-${digest.slice(0, 24)}`;
}

function sanitizeProjection(
  projection: PrivateWhatsAppContextProjection
): PublicConversationAssistantCorrectionProjection {
  if (projection.state === 'missing') return projection;
  if (projection.state === 'included') {
    return {
      state: projection.state,
      eventTimestamp: projection.eventTimestamp,
      importedAt: projection.importedAt,
      direction: projection.direction,
      speakerLabel: projection.speakerLabel,
      messageType: projection.messageType,
      contentKind: projection.contentKind,
      content: projection.content,
      reactions: sanitizeReactions(projection.reactions),
    };
  }
  if (projection.state === 'omitted') {
    return {
      state: projection.state,
      eventTimestamp: projection.eventTimestamp,
      importedAt: projection.importedAt,
      direction: projection.direction,
      speakerLabel: projection.speakerLabel,
      messageType: projection.messageType,
      omissionReason: projection.omissionReason,
      reactions: sanitizeReactions(projection.reactions),
    };
  }
  return {
    state: 'redacted',
    eventTimestamp: projection.eventTimestamp,
    importedAt: projection.importedAt,
    direction: projection.direction,
    speakerLabel: projection.speakerLabel,
    messageType: projection.messageType,
  };
}

function sanitizeReactions(
  reactions: readonly PrivateWhatsAppReactionSummary[] | undefined
): PublicConversationAssistantPreviewReaction[] {
  return (reactions ?? [])
    .map((reaction) => ({
      emoji: reaction.emoji,
      direction: reaction.direction,
      eventTimestamp: reaction.eventTimestamp,
      ...(reaction.senderDisplayName === undefined
        ? {}
        : { senderDisplayName: reaction.senderDisplayName }),
    }))
    .sort((left, right) => {
      const timestamp = left.eventTimestamp.localeCompare(right.eventTimestamp);
      return timestamp === 0 ? left.emoji.localeCompare(right.emoji) : timestamp;
    });
}

function comparePreviewMessages(
  left: Extract<
    PublicConversationAssistantContextAttachmentPreviewItem,
    { kind: 'included' | 'excluded' }
  >,
  right: Extract<
    PublicConversationAssistantContextAttachmentPreviewItem,
    { kind: 'included' | 'excluded' }
  >
): number {
  const timestamp = left.message.eventTimestamp.localeCompare(right.message.eventTimestamp);
  return timestamp === 0 ? left.message.id.localeCompare(right.message.id) : timestamp;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ version: 1, offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('offset' in value) ||
      typeof value.offset !== 'number' ||
      !Number.isInteger(value.offset) ||
      value.offset < 0
    ) {
      return null;
    }
    return value.offset;
  } catch {
    return null;
  }
}

function invalidCursor(): Extract<
  ConversationAssistantContextAttachmentPreviewResult,
  { ok: false }
> {
  return {
    ok: false,
    error: { code: 'INVALID_CURSOR', message: 'Invalid attachment preview cursor' },
  };
}
