/**
 * Domain layer for Inbox.
 * Exports all public domain types, models, and use cases.
 */

// Models
export type {
  InboxNote,
  InboxAction,
  InboxNoteSource,
  InboxMessageType,
  InboxContentType,
  InboxNoteStatus,
  InboxProcessor,
  InboxTopic,
  InboxActionStatus,
  InboxActionType,
  InboxActionAgent,
  InboxActionPriority,
  InboxErrorCode,
  InboxError,
  InboxResult,
} from './models/InboxNote.js';

export type { WhatsAppMessage, WhatsAppMessageMetadata } from './models/WhatsAppMessage.js';

// Ports
export type {
  InboxNotesRepository,
  InboxActionsRepository,
  WhatsAppUserMapping,
  WhatsAppUserMappingPublic,
  WhatsAppUserMappingRepository,
  WebhookProcessingStatus,
  IgnoredReason,
  WhatsAppWebhookEvent,
  WhatsAppWebhookEventRepository,
  WhatsAppMessageRepository,
} from './ports/repositories.js';

// Use cases
export {
  ProcessWhatsAppWebhookUseCase,
  type WhatsAppWebhookPayload,
  type WebhookProcessingConfig,
  type WebhookProcessingResult,
} from './usecases/processWhatsAppWebhook.js';
