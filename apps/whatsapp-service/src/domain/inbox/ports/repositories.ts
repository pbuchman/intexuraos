/**
 * Domain ports for Inbox repositories.
 * These interfaces define what the domain needs from infrastructure.
 */
import type { Result } from '@intexuraos/common-core';
import type { InboxAction, InboxError, InboxNote } from '../models/InboxNote.js';
import type { TranscriptionState, WhatsAppMessage } from '../models/WhatsAppMessage.js';
import type { LinkPreviewState } from '../models/LinkPreview.js';

// Re-export InboxError for use in other ports
export type { InboxError };

/**
 * Processing status for webhook events.
 */
export type WebhookProcessingStatus =
  | 'PENDING'
  | 'PROCESSED'
  | 'IGNORED'
  | 'USER_UNMAPPED'
  | 'FAILED';

/**
 * Reason for ignored webhook.
 */
export interface IgnoredReason {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Enhanced webhook event with processing metadata.
 */
export interface WhatsAppWebhookEvent {
  id: string;
  payload: unknown;
  signatureValid: boolean;
  receivedAt: string;
  phoneNumberId: string | null;
  status: WebhookProcessingStatus;
  ignoredReason?: IgnoredReason;
  failureDetails?: string;
  inboxNoteId?: string;
  processedAt?: string;
}

/**
 * Public view of WhatsApp mapping (no userId).
 */
export interface WhatsAppUserMappingPublic {
  phoneNumbers: string[];
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Repository for persisting and retrieving Inbox Notes.
 */
export interface InboxNotesRepository {
  createNote(note: InboxNote): Promise<Result<InboxNote, InboxError>>;
  getNote(noteId: string): Promise<Result<InboxNote | null, InboxError>>;
  updateNote(noteId: string, updates: Partial<InboxNote>): Promise<Result<InboxNote, InboxError>>;
}

/**
 * Repository for reading Inbox Actions (read-only for phase 1).
 */
export interface InboxActionsRepository {
  getAction(actionId: string): Promise<Result<InboxAction | null, InboxError>>;
  listActionsForNote(noteId: string): Promise<Result<InboxAction[], InboxError>>;
}

/**
 * WhatsApp user mapping configuration.
 */
export interface WhatsAppUserMapping {
  userId: string;
  phoneNumbers: string[];
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Repository for WhatsApp user mappings.
 */
export interface WhatsAppUserMappingRepository {
  saveMapping(
    userId: string,
    phoneNumbers: string[]
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>>;
  getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, InboxError>>;
  findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, InboxError>>;
  findPhoneByUserId(userId: string): Promise<Result<string | null, InboxError>>;
  disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, InboxError>>;
  isConnected(userId: string): Promise<Result<boolean, InboxError>>;
}

/**
 * Repository for WhatsApp webhook events.
 */
export interface WhatsAppWebhookEventRepository {
  saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>>;
  updateEventStatus(
    eventId: string,
    status: WebhookProcessingStatus,
    metadata: {
      ignoredReason?: IgnoredReason;
      failureDetails?: string;
      inboxNoteId?: string;
    }
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>>;
  getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, InboxError>>;
}

/**
 * Repository for WhatsApp messages.
 */
export interface WhatsAppMessageRepository {
  /**
   * Save a new message.
   */
  saveMessage(message: Omit<WhatsAppMessage, 'id'>): Promise<Result<WhatsAppMessage, InboxError>>;

  /**
   * Get messages for a user, ordered by receivedAt descending.
   */
  /**
   * Get messages for a user with pagination.
   */
  getMessagesByUser(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ messages: WhatsAppMessage[]; nextCursor?: string }, InboxError>>;

  /**
   * Get a single message by ID.
   */
  getMessage(messageId: string): Promise<Result<WhatsAppMessage | null, InboxError>>;

  /**
   * Find a message by user ID and message ID.
   */
  findById(userId: string, messageId: string): Promise<Result<WhatsAppMessage | null, InboxError>>;

  /**
   * Update message transcription state.
   */
  updateTranscription(
    userId: string,
    messageId: string,
    transcription: TranscriptionState
  ): Promise<Result<void, InboxError>>;

  /**
   * Update message link preview state.
   */
  updateLinkPreview(
    userId: string,
    messageId: string,
    linkPreview: LinkPreviewState
  ): Promise<Result<void, InboxError>>;

  /**
   * Delete a message.
   */
  deleteMessage(messageId: string): Promise<Result<void, InboxError>>;
}
