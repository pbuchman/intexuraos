/**
 * Domain models for Inbox.
 * Pure domain entities with no external dependencies.
 */
import type { Result } from '@intexuraos/common-core';

/**
 * Source of the inbox note.
 */
export type InboxNoteSource = 'WhatsApp' | 'Manual' | 'WebClipper' | 'Email' | 'API' | 'Automation';

/**
 * Message type category.
 */
export type InboxMessageType = 'Text' | 'Image' | 'Video' | 'Audio' | 'Document' | 'Mixed';

/**
 * Content type classification.
 */
export type InboxContentType =
  | 'Web'
  | 'Prompt'
  | 'Meeting'
  | 'Idea'
  | 'Task'
  | 'Log'
  | 'Quote'
  | 'Research'
  | 'Other';

/**
 * Processing status lifecycle.
 */
export type InboxNoteStatus =
  | 'Inbox'
  | 'Processing'
  | 'Processed'
  | 'Archived'
  | 'DeletedCandidate';

/**
 * Processor that handled the note.
 */
export type InboxProcessor = 'MasterNotesAssistant' | 'None' | 'Manual';

/**
 * Topics for multi-select categorization.
 */
export type InboxTopic = 'AI' | 'Work' | 'Health' | 'Fishing' | 'IntexuraOS' | 'Home' | 'Family';

/**
 * Core inbox note entity.
 * Represents a captured piece of information awaiting processing.
 */
export interface InboxNote {
  /**
   * Unique identifier (assigned by persistence layer).
   */
  id?: string;

  /**
   * Title/summary of the note.
   */
  title: string;

  /**
   * Current processing status.
   */
  status: InboxNoteStatus;

  /**
   * Source channel that created this note.
   */
  source: InboxNoteSource;

  /**
   * Message format category.
   */
  messageType: InboxMessageType;

  /**
   * Content classification.
   */
  contentType: InboxContentType;

  /**
   * Topic tags.
   */
  topics: InboxTopic[];

  /**
   * Raw/original text content.
   */
  originalText: string;

  /**
   * Cleaned/normalized text.
   */
  cleanText?: string;

  /**
   * Speech-to-text transcript (for audio/video).
   */
  transcript?: string;

  /**
   * Media file references.
   */
  mediaFiles?: string[];

  /**
   * Timestamp when note was captured.
   */
  capturedAt: string;

  /**
   * Sender identifier (phone, email, username).
   */
  sender: string;

  /**
   * External idempotency key (e.g., WhatsApp message ID).
   */
  externalId: string;

  /**
   * Processing run identifier.
   */
  processingRunId?: string;

  /**
   * Processor that handled this note.
   */
  processedBy: InboxProcessor;

  /**
   * Processing errors (if any).
   */
  errors?: string;

  /**
   * Optional URL associated with note.
   */
  url?: string;

  /**
   * Related action IDs (relations to InboxAction).
   */
  actionIds?: string[];
}

/**
 * Action status lifecycle.
 */
export type InboxActionStatus =
  | 'Proposed'
  | 'Needs approval'
  | 'Approved'
  | 'Rejected'
  | 'Executing'
  | 'Done'
  | 'Failed';

/**
 * Type of action operation.
 */
export type InboxActionType = 'Create' | 'Update' | 'Move' | 'Delete' | 'Notify' | 'Enrich';

/**
 * Agent responsible for action.
 */
export type InboxActionAgent =
  | 'TodoAgent'
  | 'KnowledgeAgent'
  | 'CalendarAgent'
  | 'PromptAgent'
  | 'FinanceAgent';

/**
 * Priority level.
 */
export type InboxActionPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

/**
 * Inbox action entity (read-only for phase 1).
 * Represents a proposed or executed action derived from an inbox note.
 */
export interface InboxAction {
  /**
   * Unique identifier.
   */
  id?: string;

  /**
   * Action title/description.
   */
  title: string;

  /**
   * Current workflow state.
   */
  status: InboxActionStatus;

  /**
   * Operation kind.
   */
  actionType: InboxActionType;

  /**
   * Owning agent.
   */
  agent: InboxActionAgent;

  /**
   * Priority level.
   */
  priority: InboxActionPriority;

  /**
   * Optional due date.
   */
  dueDate?: string;

  /**
   * Source note ID (backlink).
   */
  sourceNoteId?: string;

  /**
   * Action payload (JSON string).
   */
  payloadJson?: string;

  /**
   * Execution log.
   */
  executionLog?: string;

  /**
   * Approval token.
   */
  approvalToken?: string;

  /**
   * External correlation ID.
   */
  externalCorrelationId?: string;

  /**
   * User WhatsApp identifier.
   */
  userWhatsApp?: string;

  /**
   * User notification flag.
   */
  userNotify: boolean;
}

/**
 * Domain error codes for Inbox operations.
 */
export type InboxErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PERSISTENCE_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Domain error type.
 */
export interface InboxError {
  code: InboxErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Result type for Inbox operations.
 */
export type InboxResult<T> = Result<T, InboxError>;
