/**
 * Domain ports for Inbox operations.
 * These interfaces define what the domain needs from infrastructure
 * without depending on external SDKs (Notion, etc.).
 */
import type { Result } from '@praxos/common';
import type { InboxNote, CreateInboxNoteParams, UpdateInboxNoteParams } from '../models/InboxNote.js';
import type { InboxAction, CreateInboxActionParams, UpdateInboxActionParams } from '../models/InboxAction.js';

/**
 * Inbox error codes.
 */
export type InboxErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'DUPLICATE'
  | 'INTERNAL_ERROR';

/**
 * Inbox domain error.
 */
export interface InboxError {
  code: InboxErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Repository port for Inbox Notes.
 * Infrastructure layer implements this using Notion API.
 */
export interface InboxNotesRepository {
  /**
   * Create a new inbox note.
   */
  create(params: CreateInboxNoteParams): Promise<Result<InboxNote, InboxError>>;

  /**
   * Get an inbox note by ID.
   */
  getById(id: string): Promise<Result<InboxNote | null, InboxError>>;

  /**
   * Get an inbox note by external ID (for idempotency).
   */
  getByExternalId(externalId: string): Promise<Result<InboxNote | null, InboxError>>;

  /**
   * Update an inbox note.
   */
  update(params: UpdateInboxNoteParams): Promise<Result<InboxNote, InboxError>>;

  /**
   * Query inbox notes by status.
   */
  queryByStatus(status: InboxNote['status']): Promise<Result<InboxNote[], InboxError>>;
}

/**
 * Repository port for Inbox Actions.
 * Infrastructure layer implements this using Notion API.
 */
export interface InboxActionsRepository {
  /**
   * Create a new inbox action.
   */
  create(params: CreateInboxActionParams): Promise<Result<InboxAction, InboxError>>;

  /**
   * Get an inbox action by ID.
   */
  getById(id: string): Promise<Result<InboxAction | null, InboxError>>;

  /**
   * Update an inbox action.
   */
  update(params: UpdateInboxActionParams): Promise<Result<InboxAction, InboxError>>;

  /**
   * Query actions by source note ID.
   */
  queryBySourceNote(sourceNoteId: string): Promise<Result<InboxAction[], InboxError>>;

  /**
   * Query actions by status.
   */
  queryByStatus(status: InboxAction['status']): Promise<Result<InboxAction[], InboxError>>;
}
