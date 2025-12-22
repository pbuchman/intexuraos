/**
 * Domain ports for Inbox repositories.
 * These interfaces define what the domain needs from infrastructure.
 */
import type { Result } from '@praxos/common';
import type { InboxNote, InboxAction, InboxError } from '../models/InboxNote.js';

/**
 * Repository for persisting and retrieving Inbox Notes.
 */
export interface InboxNotesRepository {
  /**
   * Create a new inbox note.
   */
  createNote(note: InboxNote): Promise<Result<InboxNote, InboxError>>;

  /**
   * Get a note by ID.
   */
  getNote(noteId: string): Promise<Result<InboxNote | null, InboxError>>;

  /**
   * Update an existing note.
   */
  updateNote(noteId: string, updates: Partial<InboxNote>): Promise<Result<InboxNote, InboxError>>;
}

/**
 * Repository for reading Inbox Actions (read-only for phase 1).
 */
export interface InboxActionsRepository {
  /**
   * Get an action by ID.
   */
  getAction(actionId: string): Promise<Result<InboxAction | null, InboxError>>;

  /**
   * List actions for a source note.
   */
  listActionsForNote(noteId: string): Promise<Result<InboxAction[], InboxError>>;
}

/**
 * WhatsApp user mapping configuration.
 */
export interface WhatsAppUserMapping {
  /**
   * User ID.
   */
  userId: string;

  /**
   * WhatsApp phone numbers associated with this user.
   * One user can have multiple numbers.
   */
  phoneNumbers: string[];

  /**
   * Notion Inbox Notes database ID for this user.
   */
  inboxNotesDbId: string;

  /**
   * Whether mapping is active.
   */
  connected: boolean;

  /**
   * Creation timestamp.
   */
  createdAt: string;

  /**
   * Last update timestamp.
   */
  updatedAt: string;
}

/**
 * Public view of WhatsApp mapping (no userId).
 */
export type WhatsAppUserMappingPublic = Omit<WhatsAppUserMapping, 'userId'>;

/**
 * Repository for WhatsApp user mappings.
 */
export interface WhatsAppUserMappingRepository {
  /**
   * Save or update user mapping.
   * Enforces global uniqueness: a phone number cannot be mapped to multiple users.
   */
  saveMapping(
    userId: string,
    phoneNumbers: string[],
    inboxNotesDbId: string
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>>;

  /**
   * Get user mapping by user ID.
   */
  getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, InboxError>>;

  /**
   * Find user ID by phone number.
   * Returns null if no mapping exists.
   */
  findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, InboxError>>;

  /**
   * Disconnect user mapping.
   */
  disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, InboxError>>;

  /**
   * Check if user has active mapping.
   */
  isConnected(userId: string): Promise<Result<boolean, InboxError>>;
}

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
  /**
   * Short reason code.
   */
  code: string;

  /**
   * Human-readable explanation.
   */
  message: string;

  /**
   * Additional context.
   */
  details?: Record<string, unknown>;
}

/**
 * Enhanced webhook event with processing metadata.
 */
export interface WhatsAppWebhookEvent {
  /**
   * Unique event ID.
   */
  id: string;

  /**
   * Raw webhook payload.
   */
  payload: unknown;

  /**
   * Whether signature was valid.
   */
  signatureValid: boolean;

  /**
   * ISO timestamp when received.
   */
  receivedAt: string;

  /**
   * Phone number ID from metadata.
   */
  phoneNumberId: string | null;

  /**
   * Processing status.
   */
  status: WebhookProcessingStatus;

  /**
   * Reason for ignored events.
   */
  ignoredReason?: IgnoredReason;

  /**
   * Failure details for FAILED status.
   */
  failureDetails?: string;

  /**
   * Created inbox note ID (if PROCESSED).
   */
  inboxNoteId?: string;

  /**
   * Processing timestamp.
   */
  processedAt?: string;
}

/**
 * Repository for WhatsApp webhook events.
 */
export interface WhatsAppWebhookEventRepository {
  /**
   * Save a webhook event.
   */
  saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>>;

  /**
   * Update event processing status.
   */
  updateEventStatus(
    eventId: string,
    status: WebhookProcessingStatus,
    metadata: {
      ignoredReason?: IgnoredReason;
      failureDetails?: string;
      inboxNoteId?: string;
    }
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>>;

  /**
   * Get event by ID.
   */
  getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, InboxError>>;
}
