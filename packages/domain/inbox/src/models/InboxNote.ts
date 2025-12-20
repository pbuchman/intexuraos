/**
 * Domain models for Inbox Notes.
 * Represents messages captured from various sources (WhatsApp, Email, Manual, etc.).
 */

/**
 * Status workflow for inbox notes.
 */
export type InboxNoteStatus = 'Inbox' | 'Processing' | 'Processed' | 'Archived' | 'DeletedCandidate';

/**
 * Source channels for inbox notes.
 */
export type InboxNoteSource = 'WhatsApp' | 'Manual' | 'WebClipper' | 'Email' | 'API' | 'Automation';

/**
 * Message type categories.
 */
export type InboxNoteMessageType = 'Text' | 'Image' | 'Video' | 'Audio' | 'Document' | 'Mixed';

/**
 * Content type classification.
 */
export type InboxNoteType = 'Web' | 'Prompt' | 'Meeting' | 'Idea' | 'Task' | 'Log' | 'Quote' | 'Research' | 'Other';

/**
 * Topic tags for categorization.
 */
export type InboxNoteTopic = 'AI' | 'Work' | 'Health' | 'Fishing' | 'PraxOS' | 'Home' | 'Family';

/**
 * Processor types for notes.
 */
export type InboxNoteProcessor = 'MasterNotesAssistant' | 'None' | 'Manual';

/**
 * Media file reference.
 */
export interface InboxNoteMedia {
  name: string;
  url: string;
}

/**
 * Core domain entity for an Inbox Note.
 * This is the pure domain model - no Notion concepts here.
 */
export interface InboxNote {
  /**
   * Unique identifier (Notion page ID when persisted).
   */
  id?: string;

  /**
   * Title of the inbox item.
   */
  title: string;

  /**
   * Current status in workflow.
   */
  status: InboxNoteStatus;

  /**
   * Source channel.
   */
  source: InboxNoteSource;

  /**
   * Message type category.
   */
  messageType: InboxNoteMessageType;

  /**
   * Content type classification.
   */
  type: InboxNoteType;

  /**
   * Topic tags for categorization.
   */
  topics: InboxNoteTopic[];

  /**
   * Raw original text from source.
   */
  originalText: string;

  /**
   * Normalized/cleaned text.
   */
  cleanText?: string | undefined;

  /**
   * Speech-to-text transcript (for audio/video).
   */
  transcript?: string | undefined;

  /**
   * Media file attachments.
   */
  media: InboxNoteMedia[];

  /**
   * Timestamp when message was captured.
   */
  capturedAt: Date;

  /**
   * Sender identifier (phone number, email, username, etc.).
   */
  sender?: string | undefined;

  /**
   * External idempotency key (e.g., WhatsApp message ID).
   */
  externalId?: string | undefined;

  /**
   * Processing run identifier.
   */
  processingRunId?: string | undefined;

  /**
   * Processor type that handled this note.
   */
  processedBy: InboxNoteProcessor;

  /**
   * Error messages from processing.
   */
  errors?: string | undefined;

  /**
   * Related action IDs.
   */
  actionIds: string[];

  /**
   * Optional URL reference.
   */
  url?: string | undefined;
}

/**
 * Parameters for creating a new inbox note.
 */
export interface CreateInboxNoteParams {
  title: string;
  source: InboxNoteSource;
  messageType: InboxNoteMessageType;
  originalText: string;
  capturedAt: Date;
  sender?: string;
  externalId?: string;
  url?: string;
  cleanText?: string;
  transcript?: string;
  media?: InboxNoteMedia[];
  topics?: InboxNoteTopic[];
  type?: InboxNoteType;
}

/**
 * Parameters for updating an inbox note.
 */
export interface UpdateInboxNoteParams {
  id: string;
  status?: InboxNoteStatus;
  cleanText?: string;
  transcript?: string;
  processedBy?: InboxNoteProcessor;
  processingRunId?: string;
  errors?: string;
  actionIds?: string[];
  topics?: InboxNoteTopic[];
  type?: InboxNoteType;
}
