import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  PrivateDigestMessage,
  PrivateDigestMessageReferenceFactory,
  PrivateDigestSourceError,
  PrivateDigestSourceRevisionClaims,
  ResolvePrivateDigestMigrationBindingInput,
  ResolvedPrivateDigestMigrationBinding,
  ValidatePrivateDigestSourceInput,
  ValidatedPrivateDigestSource,
} from '../models/PrivateWhatsAppDigestSource.js';
import type {
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageDirection,
  PrivateWhatsAppMessageType,
  PrivateWhatsAppReactionSummary,
} from '../models/PrivateWhatsApp.js';
import type { PrivateWhatsAppRepository } from '../ports/privateWhatsAppRepository.js';

const MAX_DISPLAY_LABEL_LENGTH = 80;
const MAX_REACTION_LENGTH = 16;
const MIGRATION_CHAT_PAGE_SIZE = 100;
const MAX_MIGRATION_CHATS = 1_000;
type PrivateWhatsAppMediaType = Extract<
  PrivateWhatsAppMessageType,
  'image' | 'audio' | 'video' | 'file' | 'sticker'
>;
const MEDIA_TYPES = new Set<PrivateWhatsAppMediaType>([
  'image',
  'audio',
  'video',
  'file',
  'sticker',
]);

export interface PrivateWhatsAppDigestSourceDeps {
  repository: Pick<
    PrivateWhatsAppRepository,
    'getAccountByUserId' | 'getChatById' | 'getConversationContextJournalHead'
  >;
  issueSourceRevision(
    claims: PrivateDigestSourceRevisionClaims
  ): Result<string, PrivateDigestSourceError>;
}

export interface PrivateWhatsAppDigestMigrationBindingDeps {
  repository: Pick<PrivateWhatsAppRepository, 'getAccountByUserId' | 'findChats'>;
}

export async function resolvePrivateDigestMigrationBinding(
  input: ResolvePrivateDigestMigrationBindingInput,
  deps: PrivateWhatsAppDigestMigrationBindingDeps
): Promise<Result<ResolvedPrivateDigestMigrationBinding, PrivateDigestSourceError>> {
  const accountResult = await deps.repository.getAccountByUserId(input.userId);
  if (!accountResult.ok) return accountResult;
  const account = accountResult.value;
  const generationId =
    nonEmptyText(account?.generationId) ?? nonEmptyText(account?.sourceAccountId);
  if (
    account?.userId !== input.userId ||
    account.status !== 'active' ||
    account.erasureStatus === 'erasing' ||
    generationId === undefined
  ) {
    return privateSourceNotFound();
  }

  const expectedDisplayName = normalizeMigrationDisplayName(input.expectedDisplayName);
  if (expectedDisplayName === '') {
    return err({ code: 'VALIDATION_ERROR', message: 'Invalid migration display name' });
  }

  const matches: ResolvedPrivateDigestMigrationBinding[] = [];
  const cursors = new Set<string>();
  let scanned = 0;
  let cursor: string | undefined;
  for (;;) {
    const pageResult = await deps.repository.findChats({
      sourceAccountId: account.sourceAccountId,
      limit: MIGRATION_CHAT_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!pageResult.ok) return pageResult;
    scanned += pageResult.value.chats.length;
    if (scanned > MAX_MIGRATION_CHATS) {
      return err({ code: 'VALIDATION_ERROR', message: 'Migration chat scan is too large' });
    }
    for (const chat of pageResult.value.chats) {
      const displayName = chat.displayName?.trim() ?? '';
      if (
        chat.userId !== input.userId ||
        chat.sourceAccountId !== account.sourceAccountId ||
        chat.chatType !== 'group' ||
        normalizeMigrationDisplayName(displayName) !== expectedDisplayName
      ) {
        continue;
      }
      matches.push({
        sourceAccountId: account.sourceAccountId,
        generationId,
        chatId: chat.id,
        displayName,
      });
      if (matches.length > 1) return sourceChanged();
    }
    const nextCursor = nonEmptyText(pageResult.value.nextCursor);
    if (nextCursor === undefined) break;
    if (scanned >= MAX_MIGRATION_CHATS || cursors.has(nextCursor)) {
      return err({ code: 'VALIDATION_ERROR', message: 'Migration chat scan is not bounded' });
    }
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  return matches[0] === undefined ? sourceChanged() : ok(matches[0]);
}

export async function validatePrivateDigestSource(
  input: ValidatePrivateDigestSourceInput,
  deps: PrivateWhatsAppDigestSourceDeps
): Promise<Result<ValidatedPrivateDigestSource, PrivateDigestSourceError>> {
  const accountResult = await deps.repository.getAccountByUserId(input.userId);
  if (!accountResult.ok) return accountResult;
  const account = accountResult.value;
  if (account?.status !== 'active' || account.erasureStatus === 'erasing') {
    return privateSourceNotFound();
  }
  const generationId =
    nonEmptyText(account.generationId) ?? nonEmptyText(account.sourceAccountId);
  if (
    generationId === undefined ||
    (input.expectedGenerationId !== undefined && input.expectedGenerationId !== generationId)
  ) {
    return sourceChanged();
  }

  const chatResult = await deps.repository.getChatById({
    sourceAccountId: account.sourceAccountId,
    chatId: input.chatId,
  });
  if (!chatResult.ok) return chatResult;
  const chat = chatResult.value;
  if (chat?.userId !== input.userId || chat.sourceAccountId !== account.sourceAccountId) {
    return privateChatNotFound();
  }
  if (chat.chatType !== 'group' && chat.chatType !== 'direct') {
    return err({ code: 'VALIDATION_ERROR', message: 'Unsupported WhatsApp chat type' });
  }

  const journalHead = await deps.repository.getConversationContextJournalHead({
    userId: input.userId,
    sourceAccountId: account.sourceAccountId,
    chatId: input.chatId,
  });
  if (!journalHead.ok) return journalHead;

  const revisionResult = deps.issueSourceRevision({
    userId: input.userId,
    sourceAccountId: account.sourceAccountId,
    generationId,
    chatId: input.chatId,
    chatType: chat.chatType,
    contextChangeSequence: journalHead.value,
  });
  if (!revisionResult.ok) return revisionResult;

  const source: ValidatedPrivateDigestSource = {
    sourceAccountId: account.sourceAccountId,
    generationId,
    chatId: input.chatId,
    chatType: chat.chatType,
    displayName: safeDisplayLabel(
      chat.displayName,
      chat.chatType === 'group' ? 'WhatsApp group' : 'WhatsApp contact'
    ),
    messageCount: nonNegativeInteger(chat.messageCount),
    lastActivityAt: chat.lastEventAt,
    sourceRevision: revisionResult.value,
  };
  if (chat.chatType === 'group' && chat.participantCount !== undefined) {
    source.participantCount = nonNegativeInteger(chat.participantCount);
  }
  return ok(source);
}

export function projectPrivateDigestMessages(
  messages: PrivateWhatsAppMessage[],
  createMessageRef: PrivateDigestMessageReferenceFactory
): PrivateDigestMessage[] {
  const orderedMessages = [...messages].sort(compareStoredMessages);
  return orderedMessages.flatMap((message) => projectMessage(message, createMessageRef));
}

function projectMessage(
  message: PrivateWhatsAppMessage,
  createMessageRef: PrivateDigestMessageReferenceFactory
): PrivateDigestMessage[] {
  if (
    message.contextState === 'redacted' ||
    message.contextState === 'deleted' ||
    message.messageType === 'reaction' ||
    message.messageType === 'redaction' ||
    message.relation !== undefined
  ) {
    return [];
  }

  const content = projectContent(message, createMessageRef);
  const reactions = projectReactions(message, createMessageRef);
  return [content, ...reactions];
}

function projectContent(
  message: PrivateWhatsAppMessage,
  createMessageRef: PrivateDigestMessageReferenceFactory
): PrivateDigestMessage {
  const eventTimestamp = message.eventTimestamp;
  const messageRef = createMessageRef({ messageId: message.id, projectionKey: 'content' });
  const direction = toDigestDirection(message.direction);
  const authorLabel = safeAuthorLabel(message.direction, message.senderDisplayName);
  const text = nonEmptyText(message.text);
  const transcription =
    message.transcription?.status === 'completed'
      ? nonEmptyText(message.transcription.text)
      : undefined;

  if (isMediaType(message.messageType)) {
    if (text !== undefined) {
      return {
        messageRef,
        eventTimestamp,
        direction,
        authorLabel,
        text: `[${mediaLabel(message.messageType)}] ${text}`,
        contentKind: 'media_caption',
      };
    }
    if (transcription !== undefined) {
      return {
        messageRef,
        eventTimestamp,
        direction,
        authorLabel,
        text: transcription,
        contentKind: 'transcription',
      };
    }
    return {
      messageRef,
      eventTimestamp,
      direction,
      authorLabel,
      text: `[${mediaLabel(message.messageType)}]`,
      contentKind: 'media_caption',
    };
  }

  if (text !== undefined) {
    return {
      messageRef,
      eventTimestamp,
      direction,
      authorLabel,
      text,
      contentKind: 'text',
    };
  }
  if (transcription !== undefined) {
    return {
      messageRef,
      eventTimestamp,
      direction,
      authorLabel,
      text: transcription,
      contentKind: 'transcription',
    };
  }
  return {
    messageRef,
    eventTimestamp,
    direction: 'system',
    authorLabel: 'System',
    text: '[Unsupported WhatsApp message]',
    contentKind: 'system',
  };
}

function projectReactions(
  message: PrivateWhatsAppMessage,
  createMessageRef: PrivateDigestMessageReferenceFactory
): PrivateDigestMessage[] {
  const seenIds = new Set<string>();
  return [...(message.reactions ?? [])].sort(compareReactions).flatMap((reaction) => {
    if (seenIds.has(reaction.id)) return [];
    seenIds.add(reaction.id);
    const emoji = boundedText(reaction.emoji, MAX_REACTION_LENGTH);
    if (emoji === undefined) return [];
    return [
      {
        messageRef: createMessageRef({
          messageId: message.id,
          projectionKey: `reaction:${reaction.id}`,
        }),
        eventTimestamp: reaction.eventTimestamp,
        direction: toDigestDirection(reaction.direction),
        authorLabel: safeAuthorLabel(reaction.direction, reaction.senderDisplayName),
        text: `Reacted ${emoji}`,
        contentKind: 'reaction' as const,
      },
    ];
  });
}

function compareStoredMessages(
  left: PrivateWhatsAppMessage,
  right: PrivateWhatsAppMessage
): number {
  const timestamp = left.eventTimestamp.localeCompare(right.eventTimestamp);
  return timestamp === 0 ? left.id.localeCompare(right.id) : timestamp;
}

function compareReactions(
  left: PrivateWhatsAppReactionSummary,
  right: PrivateWhatsAppReactionSummary
): number {
  const timestamp = left.eventTimestamp.localeCompare(right.eventTimestamp);
  return timestamp === 0 ? left.id.localeCompare(right.id) : timestamp;
}

function toDigestDirection(
  direction: PrivateWhatsAppMessageDirection
): PrivateDigestMessage['direction'] {
  return direction === 'incoming' ? 'inbound' : 'outbound';
}

function safeAuthorLabel(
  direction: PrivateWhatsAppMessageDirection,
  displayName: string | undefined
): string {
  if (direction === 'outgoing') return 'You';
  return safeDisplayLabel(displayName, 'Participant');
}

function safeDisplayLabel(value: string | undefined, fallback: string): string {
  const candidate = boundedText(value, MAX_DISPLAY_LABEL_LENGTH);
  if (
    candidate === undefined ||
    looksLikeMatrixIdentifier(candidate) ||
    looksLikePhoneNumber(candidate)
  ) {
    return fallback;
  }
  return candidate;
}

function boundedText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = nonEmptyText(value);
  if (normalized === undefined) return undefined;
  return Array.from(normalized).slice(0, maxLength).join('');
}

function nonEmptyText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.length === 0 ? undefined : normalized;
}

function normalizeMigrationDisplayName(value: string | undefined): string {
  return (
    value
      ?.normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase('pl-PL')
      .replace(/[^\p{L}\p{N}]+/gu, '') ?? ''
  );
}

function looksLikeMatrixIdentifier(value: string): boolean {
  return /^@[\S]+:[\S]+$/u.test(value);
}

function looksLikePhoneNumber(value: string): boolean {
  if (/[A-Za-z\p{L}]/u.test(value)) return false;
  const digits = value.replace(/\D/gu, '');
  return digits.length >= 7 && digits.length <= 15;
}

function nonNegativeInteger(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value < 0 ? 0 : Math.floor(value);
}

function isMediaType(
  messageType: PrivateWhatsAppMessageType
): messageType is PrivateWhatsAppMediaType {
  return MEDIA_TYPES.has(messageType as PrivateWhatsAppMediaType);
}

function mediaLabel(messageType: PrivateWhatsAppMediaType): string {
  switch (messageType) {
    case 'image':
      return 'Image';
    case 'audio':
      return 'Audio';
    case 'video':
      return 'Video';
    case 'file':
      return 'File';
    case 'sticker':
      return 'Sticker';
  }
}

function privateSourceNotFound(): Result<never, PrivateDigestSourceError> {
  return err({ code: 'NOT_FOUND', message: 'Private WhatsApp source not found' });
}

function privateChatNotFound(): Result<never, PrivateDigestSourceError> {
  return err({ code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' });
}

function sourceChanged(): Result<never, PrivateDigestSourceError> {
  return err({ code: 'SOURCE_CHANGED', message: 'Private WhatsApp source changed' });
}
