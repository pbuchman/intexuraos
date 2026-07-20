/**
 * Domain model for private WhatsApp messages synchronized through Matrix.
 */

export type PrivateWhatsAppDeliveryMode = 'live' | 'backfill';
export type PrivateWhatsAppChatType = 'direct' | 'group' | 'unknown';
export type PrivateWhatsAppMessageDirection = 'incoming' | 'outgoing';
export type PrivateWhatsAppSummaryStatus = 'not_started' | 'completed' | 'failed';
export type PrivateWhatsAppAccountStatus = 'active' | 'disabled';
export type PrivateWhatsAppMediaStorageStatus = 'stored';
export type PrivateWhatsAppTranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type PrivateWhatsAppMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'sticker'
  | 'reaction'
  | 'redaction'
  | 'unknown';

export interface PrivateWhatsAppMediaInfo {
  mxcUri: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  sha256?: string;
  storageStatus?: PrivateWhatsAppMediaStorageStatus;
  gcsPath?: string;
  thumbnailGcsPath?: string;
  storedMimeType?: string;
  storedSizeBytes?: number;
  storedAt?: string;
}

export interface PrivateWhatsAppReactionInfo {
  emoji: string;
  targetMatrixEventId: string;
  targetMessageId: string;
}

export interface PrivateWhatsAppReactionInput {
  emoji: string;
  targetMatrixEventId: string;
}

export interface PrivateWhatsAppReactionSummary {
  id: string;
  emoji: string;
  senderKey?: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  direction: PrivateWhatsAppMessageDirection;
  eventTimestamp: string;
}

export interface PrivateWhatsAppTranscriptionError {
  code: string;
  message: string;
}

export interface PrivateWhatsAppTranscriptionState {
  status: PrivateWhatsAppTranscriptionStatus;
  jobId?: string;
  text?: string;
  summary?: string;
  detectedLanguage?: string;
  error?: PrivateWhatsAppTranscriptionError;
  startedAt?: string;
  completedAt?: string;
}

export interface PrivateWhatsAppChatInput {
  matrixRoomId: string;
  type: PrivateWhatsAppChatType;
  displayName?: string;
  avatarMxcUri?: string;
}

export interface PrivateWhatsAppMessageInput {
  matrixRoomId: string;
  matrixEventId: string;
  matrixSenderId: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  senderPhoneNumberNormalized?: string;
  senderKey?: string;
  direction: PrivateWhatsAppMessageDirection;
  type: PrivateWhatsAppMessageType;
  text?: string;
  media?: PrivateWhatsAppMediaInfo;
  reaction?: PrivateWhatsAppReactionInput;
  eventTimestamp: string;
  eventDayKey?: string;
  eventTimeZone?: string;
  rawMatrixEvent: unknown;
}

export interface StorePrivateWhatsAppMessageInput {
  sourceAccountId: string;
  userId: string;
  deliveryMode: PrivateWhatsAppDeliveryMode;
  receivedAt: string;
  chat: PrivateWhatsAppChatInput;
  message: PrivateWhatsAppMessageInput;
}

export interface PrivateWhatsAppAccount {
  id: string;
  userId: string;
  sourceAccountId: string;
  phoneNumberNormalized: string;
  displayName: string;
  status: PrivateWhatsAppAccountStatus;
  createdAt: string;
  updatedAt: string;
  lastIngestAt?: string;
  lastEventAt?: string;
  messageCount?: number;
  senderCount?: number;
  schemaVersion: 1;
}

export interface UpsertPrivateWhatsAppAccountInput {
  userId: string;
  phoneNumberNormalized: string;
  displayName?: string;
  now: string;
}

export interface DisablePrivateWhatsAppAccountInput {
  userId: string;
  now: string;
}

export interface PrivateWhatsAppChat {
  id: string;
  userId: string;
  sourceAccountId: string;
  matrixRoomId: string;
  matrixRoomIds?: string[];
  chatType: PrivateWhatsAppChatType;
  displayName?: string;
  avatarMxcUri?: string;
  messageCount?: number;
  participantCount?: number;
  participantKeys?: string[];
  transcriptionEnabled?: boolean;
  transcriptionEnabledAt?: string;
  transcriptionUpdatedAt?: string;
  firstSeenAt: string;
  lastEventAt: string;
  updatedAt: string;
  schemaVersion?: number;
}

export interface PrivateWhatsAppMessage {
  id: string;
  chatId: string;
  userId: string;
  sourceAccountId: string;
  matrixRoomId: string;
  matrixEventId: string;
  matrixSenderId: string;
  senderKey?: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  senderPhoneNumberNormalized?: string;
  direction: PrivateWhatsAppMessageDirection;
  messageType: PrivateWhatsAppMessageType;
  text?: string;
  media?: PrivateWhatsAppMediaInfo;
  reaction?: PrivateWhatsAppReactionInfo;
  reactions?: PrivateWhatsAppReactionSummary[];
  eventTimestamp: string;
  eventDayKey?: string;
  eventTimeZone?: string;
  chatDisplayName?: string;
  chatType?: PrivateWhatsAppChatType;
  receivedAt: string;
  ingestedAt: string;
  deliveryMode: PrivateWhatsAppDeliveryMode;
  transcription?: PrivateWhatsAppTranscriptionState;
  rawMatrixEvent: unknown;
  schemaVersion?: number;
}

export interface PrivateWhatsAppSender {
  id: string;
  userId: string;
  sourceAccountId: string;
  senderKey: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  senderPhoneNumberNormalized?: string;
  firstEventAt: string;
  lastEventAt: string;
  messageCount: number;
  chatIds: string[];
  updatedAt: string;
  schemaVersion: number;
}

export interface PrivateWhatsAppSenderDay {
  id: string;
  userId: string;
  sourceAccountId: string;
  senderKey: string;
  eventDayKey: string;
  eventTimeZone: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  firstEventAt: string;
  lastEventAt: string;
  messageCount: number;
  chatIds: string[];
  messageTypeCounts: Partial<Record<PrivateWhatsAppMessageType, number>>;
  summaryStatus: PrivateWhatsAppSummaryStatus;
  summaryText?: string;
  summaryGeneratedAt?: string;
  summarySourceMessageCount: number;
  updatedAt: string;
  schemaVersion: number;
}

export interface PrivateWhatsAppIngestOutcome {
  outcome: 'created' | 'duplicate';
  chatId: string;
  messageId: string;
  matrixEventId: string;
  chatTranscriptionEnabled?: boolean;
}

export interface PrivateWhatsAppIngestEventResult {
  matrixEventId: string;
  outcome: 'created' | 'duplicate' | 'rejected';
  chatId?: string;
  messageId?: string;
  reason?: string;
}

export interface PrivateWhatsAppIngestResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  messages: PrivateWhatsAppIngestEventResult[];
}

export interface PrivateWhatsAppMessageQueryInput {
  sourceAccountId: string;
  chatId?: string;
  senderKey?: string;
  from?: string;
  to?: string;
  eventDayKey?: string;
  limit: number;
  cursor?: string;
}

export interface PrivateWhatsAppMessageQueryResult {
  messages: PrivateWhatsAppMessage[];
  nextCursor?: string;
}

export interface PrivateWhatsAppConversationContextMessageResult {
  messages: PrivateWhatsAppMessage[];
  totalCount: number;
  nextCursor?: string;
}

export interface PrivateWhatsAppReactionQueryInput {
  sourceAccountId: string;
  chatId?: string;
  targets: {
    messageId: string;
    matrixEventId: string;
  }[];
}

export interface PrivateWhatsAppReactionQueryResult {
  reactionsByMessageId: Record<string, PrivateWhatsAppReactionSummary[]>;
  attachedReactionMessageIds: string[];
}

export interface PrivateConversationContextRequest {
  userId: string;
  chatId: string;
  from: string;
  to: string;
  maxMessages?: number;
}

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

export type PrivateConversationContextOmissionReason =
  | 'media_only'
  | 'failed_transcription'
  | 'pending_transcription'
  | 'non_text'
  | 'over_limit';

export interface PrivateConversationContextOmittedMessage {
  id: string;
  eventTimestamp: string;
  importedAt: string;
  direction: PrivateWhatsAppMessageDirection;
  speakerLabel: string;
  messageType: PrivateWhatsAppMessageType;
  omissionReason: PrivateConversationContextOmissionReason;
  contentKind?: 'text' | 'transcription';
  content?: string;
  reactions?: PrivateWhatsAppReactionSummary[];
  reaction?: {
    emoji: string;
    targetMatrixEventId?: string;
    targetMessageId?: string;
  };
}

export interface PrivateConversationContextOmittedCounts {
  mediaOnly: number;
  failedTranscriptions: number;
  pendingTranscriptions: number;
  nonText: number;
  overLimit: number;
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
  range: {
    from: string;
    to: string;
  };
  messages: PrivateConversationContextMessage[];
  omittedMessages: PrivateConversationContextOmittedMessage[];
  omitted: PrivateConversationContextOmittedCounts;
  messageCount: number;
  transcriptSha256: string;
}

export interface PrivateConversationContextMessageQueryInput {
  sourceAccountId: string;
  chatId: string;
  from: string;
  to: string;
  limit: number;
  cursor?: string;
}

export interface UpdatePrivateWhatsAppChatTranscriptionInput {
  sourceAccountId: string;
  chatId: string;
  enabled: boolean;
  now: string;
}

export interface UpdatePrivateWhatsAppMessageTranscriptionInput {
  userId: string;
  messageId: string;
  transcription: PrivateWhatsAppTranscriptionState;
}

export interface UpdatePrivateWhatsAppMessageStoredMediaInput {
  sourceAccountId: string;
  messageId: string;
  media: PrivateWhatsAppMediaInfo;
  now: string;
}

export interface UpdatePrivateWhatsAppMessageStoredMediaResult {
  status: 'updated' | 'already_stored';
  message: PrivateWhatsAppMessage;
  chat: PrivateWhatsAppChat;
}

export interface PrivateWhatsAppChatQueryInput {
  sourceAccountId: string;
  limit: number;
  cursor?: string;
}

export interface PrivateWhatsAppChatQueryResult {
  chats: PrivateWhatsAppChat[];
  nextCursor?: string;
}

export interface PrivateWhatsAppSenderQueryInput {
  sourceAccountId: string;
  limit: number;
  cursor?: string;
}

export interface PrivateWhatsAppSenderQueryResult {
  senders: PrivateWhatsAppSender[];
  nextCursor?: string;
}

export interface PrivateWhatsAppSenderDayQueryInput {
  sourceAccountId: string;
  senderKey?: string;
  fromDay?: string;
  toDay?: string;
  limit: number;
  cursor?: string;
}

export interface PrivateWhatsAppSenderDayQueryResult {
  senderDays: PrivateWhatsAppSenderDay[];
  nextCursor?: string;
}

export interface PrivateWhatsAppAggregateRebuildInput {
  sourceAccountId: string;
  from?: string;
  to?: string;
  limit: number;
}

export interface PrivateWhatsAppAggregateRebuildResult {
  scannedMessages: number;
  upgradedMessages: number;
  senderCount: number;
  senderDayCount: number;
}
