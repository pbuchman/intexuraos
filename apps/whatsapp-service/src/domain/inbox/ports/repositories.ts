/**
 * Domain ports for Inbox repositories.
 * These interfaces define what the domain needs from infrastructure.
 */
import type { Result } from '@praxos/common';
import type { InboxNote, InboxAction, InboxError } from '../models/InboxNote.js';

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
  inboxNotesDbId: string;
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
  inboxNotesDbId: string;
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
    phoneNumbers: string[],
    inboxNotesDbId: string
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>>;
  getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, InboxError>>;
  findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, InboxError>>;
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
