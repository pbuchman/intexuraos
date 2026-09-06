import type { WhatsAppError } from './error.js';

export type PrivateDigestChatType = 'group' | 'direct';

export interface PrivateDigestSourceError extends Omit<WhatsAppError, 'code'> {
  code: WhatsAppError['code'] | 'SOURCE_CHANGED';
}

export interface PrivateDigestSourcePosition {
  eventTimestamp: string;
  messageId: string;
}

export interface ValidatePrivateDigestSourceInput {
  userId: string;
  chatId: string;
  expectedGenerationId?: string | undefined;
}

export interface ValidatedPrivateDigestSource {
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: PrivateDigestChatType;
  displayName: string;
  messageCount: number;
  participantCount?: number | undefined;
  lastActivityAt?: string | undefined;
  sourceRevision: string;
}

export interface ResolvePrivateDigestMigrationBindingInput {
  userId: string;
  expectedDisplayName: string;
}

export interface ResolvedPrivateDigestMigrationBinding {
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  displayName: string;
}

export interface PrivateDigestMessage {
  messageRef: string;
  eventTimestamp: string;
  direction: 'inbound' | 'outbound' | 'system';
  authorLabel: string;
  text: string;
  contentKind: 'text' | 'media_caption' | 'transcription' | 'reaction' | 'system';
}

export interface QueryPrivateDigestMessagesInput {
  userId: string;
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: PrivateDigestChatType;
  windowStart: string;
  windowEnd: string;
  limit: number;
  cursor?: string | undefined;
}

export interface QueryPrivateDigestMessagesResult {
  messages: PrivateDigestMessage[];
  sourceRevision: string;
  highWatermark: string | null;
  nextCursor: string | null;
}

export interface PrivateDigestSourceRevisionClaims {
  userId: string;
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: PrivateDigestChatType;
  contextChangeSequence: number;
  windowStart?: string | undefined;
  windowEnd?: string | undefined;
  highWatermark?: PrivateDigestSourcePosition | null | undefined;
}

export interface PrivateDigestMessageReferenceInput {
  messageId: string;
  projectionKey: string;
}

export type PrivateDigestMessageReferenceFactory = (
  input: PrivateDigestMessageReferenceInput
) => string;
