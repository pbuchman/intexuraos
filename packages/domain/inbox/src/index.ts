/**
 * Inbox domain module.
 * Contains domain entities, ports, and use cases for inbox notes and actions.
 */

// Models
export type {
  InboxNote,
  InboxNoteStatus,
  InboxNoteSource,
  InboxNoteMessageType,
  InboxNoteType,
  InboxNoteTopic,
  InboxNoteProcessor,
  InboxNoteMedia,
  CreateInboxNoteParams,
  UpdateInboxNoteParams,
} from './models/InboxNote.js';

export type {
  InboxAction,
  InboxActionStatus,
  InboxActionType,
  InboxActionAgent,
  InboxActionPriority,
  CreateInboxActionParams,
  UpdateInboxActionParams,
} from './models/InboxAction.js';

// Ports
export type {
  InboxError,
  InboxErrorCode,
  InboxNotesRepository,
  InboxActionsRepository,
} from './ports/repositories.js';

// Use cases
export { IngestWhatsAppMessage } from './usecases/IngestWhatsAppMessage.js';
export type { WhatsAppMessage } from './usecases/IngestWhatsAppMessage.js';
