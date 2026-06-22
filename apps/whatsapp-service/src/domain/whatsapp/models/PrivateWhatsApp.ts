/**
 * Domain model for private WhatsApp messages synchronized through Matrix.
 */

export type PrivateWhatsAppDeliveryMode = 'live' | 'backfill';
export type PrivateWhatsAppChatType = 'direct' | 'group' | 'unknown';
export type PrivateWhatsAppMessageDirection = 'incoming';
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
  sha256?: string;
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
  direction: PrivateWhatsAppMessageDirection;
  type: PrivateWhatsAppMessageType;
  text?: string;
  media?: PrivateWhatsAppMediaInfo;
  eventTimestamp: string;
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

export interface PrivateWhatsAppChat {
  id: string;
  userId: string;
  sourceAccountId: string;
  matrixRoomId: string;
  chatType: PrivateWhatsAppChatType;
  displayName?: string;
  avatarMxcUri?: string;
  firstSeenAt: string;
  lastEventAt: string;
  updatedAt: string;
}

export interface PrivateWhatsAppMessage {
  id: string;
  chatId: string;
  userId: string;
  sourceAccountId: string;
  matrixRoomId: string;
  matrixEventId: string;
  matrixSenderId: string;
  senderDisplayName?: string;
  senderPhoneNumber?: string;
  direction: PrivateWhatsAppMessageDirection;
  messageType: PrivateWhatsAppMessageType;
  text?: string;
  media?: PrivateWhatsAppMediaInfo;
  eventTimestamp: string;
  receivedAt: string;
  ingestedAt: string;
  deliveryMode: PrivateWhatsAppDeliveryMode;
  rawMatrixEvent: unknown;
}

export interface PrivateWhatsAppIngestOutcome {
  outcome: 'created' | 'duplicate';
  chatId: string;
  messageId: string;
  matrixEventId: string;
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
