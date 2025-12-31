/**
 * Use case for processing WhatsApp webhooks and creating inbox notes.
 * Implements the core business logic for phase 1 ingestion flow.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  InboxContentType,
  InboxError,
  InboxMessageType,
  InboxNote,
  InboxNoteSource,
  InboxNoteStatus,
  InboxProcessor,
} from '../models/InboxNote.js';
import type {
  IgnoredReason,
  InboxNotesRepository,
  WebhookProcessingStatus,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEventRepository,
} from '../ports/repositories.js';

/**
 * WhatsApp webhook payload structure (simplified for phase 1).
 */
export interface WhatsAppWebhookPayload {
  object: string;
  entry?: {
    id: string;
    changes?: {
      value: {
        messaging_product: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: {
          profile?: {
            name?: string;
          };
          wa_id?: string;
        }[];
        messages?: {
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: {
            body: string;
          };
          image?: {
            id: string;
            mime_type: string;
            sha256: string;
            caption?: string;
          };
          audio?: {
            id: string;
            mime_type: string;
            sha256: string;
          };
        }[];
        statuses?: {
          id: string;
          status: string;
          timestamp: string;
        }[];
      };
      field: string;
    }[];
  }[];
}

/**
 * Configuration for webhook processing.
 */
export interface WebhookProcessingConfig {
  /**
   * Allowed business phone number IDs.
   * If webhook targets a different number, it's ignored.
   */
  allowedPhoneNumberIds: string[];
}

/**
 * Result of webhook processing.
 */
export interface WebhookProcessingResult {
  /**
   * Processing status.
   */
  status: WebhookProcessingStatus;

  /**
   * Created inbox note (if PROCESSED).
   */
  inboxNote?: InboxNote;

  /**
   * Reason for ignored events.
   */
  ignoredReason?: IgnoredReason;

  /**
   * Failure details.
   */
  failureDetails?: string;
}

/**
 * Use case for processing WhatsApp webhooks.
 */
export class ProcessWhatsAppWebhookUseCase {
  constructor(
    private readonly config: WebhookProcessingConfig,
    private readonly webhookRepo: WhatsAppWebhookEventRepository,
    private readonly mappingRepo: WhatsAppUserMappingRepository,
    private readonly notesRepo: InboxNotesRepository
  ) {}

  /**
   * Process a WhatsApp webhook and create inbox note if applicable.
   */
  async execute(
    eventId: string,
    payload: WhatsAppWebhookPayload
  ): Promise<Result<WebhookProcessingResult, InboxError>> {
    // Step 1: Classify the webhook
    const classification = this.classifyWebhook(payload);

    if (classification.status === 'IGNORED') {
      // Update event status and return
      await this.webhookRepo.updateEventStatus(eventId, 'IGNORED', {
        ignoredReason: classification.ignoredReason,
      });

      return ok({
        status: 'IGNORED',
        ignoredReason: classification.ignoredReason,
      });
    }

    // classification.status === 'VALID' here, so classification.message is defined

    // Step 2: Check user mapping
    const userResult = await this.mappingRepo.findUserByPhoneNumber(classification.message.from);

    if (!userResult.ok) {
      return err(userResult.error);
    }

    if (userResult.value === null) {
      // No mapping found
      const reason: IgnoredReason = {
        code: 'USER_UNMAPPED',
        message: `No user mapping found for phone number: ${classification.message.from}`,
        details: { phoneNumber: classification.message.from },
      };
      await this.webhookRepo.updateEventStatus(eventId, 'USER_UNMAPPED', {
        ignoredReason: reason,
      });
      return ok({ status: 'USER_UNMAPPED', ignoredReason: reason });
    }

    const userId = userResult.value;

    // Step 3: Get user mapping config (for Notion DB ID)
    const mappingResult = await this.mappingRepo.getMapping(userId);
    if (!mappingResult.ok) {
      return err(mappingResult.error);
    }

    if (mappingResult.value?.connected === false || mappingResult.value === null) {
      const reason: IgnoredReason = {
        code: 'USER_DISCONNECTED',
        message: 'User mapping exists but is disconnected',
        details: { userId },
      };
      await this.webhookRepo.updateEventStatus(eventId, 'USER_UNMAPPED', {
        ignoredReason: reason,
      });
      return ok({ status: 'USER_UNMAPPED', ignoredReason: reason });
    }

    // Step 4: Create inbox note
    const inboxNote = this.createInboxNoteFromMessage(classification.message);

    // Step 5: Persist to Notion (via repository)
    const createResult = await this.notesRepo.createNote(inboxNote);

    if (!createResult.ok) {
      // Notion write failed
      const failureDetails = `Failed to create inbox note: ${createResult.error.message}`;
      await this.webhookRepo.updateEventStatus(eventId, 'FAILED', {
        failureDetails,
      });
      return ok({
        status: 'FAILED',
        failureDetails,
      });
    }

    const createdNote = createResult.value;

    // Step 6: Update event status to PROCESSED (only if we got an ID back)
    if (createdNote.id !== undefined) {
      await this.webhookRepo.updateEventStatus(eventId, 'PROCESSED', {
        inboxNoteId: createdNote.id,
      });
    } else {
      await this.webhookRepo.updateEventStatus(eventId, 'PROCESSED', {});
    }

    return ok({
      status: 'PROCESSED',
      inboxNote: createdNote,
    });
  }

  /**
   * Classify webhook and extract message if applicable.
   */
  private classifyWebhook(payload: WhatsAppWebhookPayload):
    | {
        status: 'VALID';
        message: {
          from: string;
          text: string;
          messageId: string;
          timestamp: string;
          senderName?: string;
        };
      }
    | {
        status: 'IGNORED';
        ignoredReason: IgnoredReason;
      } {
    // Check if it's a WhatsApp webhook
    if (payload.object !== 'whatsapp_business_account') {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'INVALID_OBJECT_TYPE',
          message: `Expected object type "whatsapp_business_account", got "${payload.object}"`,
          details: { object: payload.object },
        },
      };
    }

    // Extract entry
    if (!payload.entry || payload.entry.length === 0) {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'NO_ENTRIES',
          message: 'Webhook payload has no entries',
        },
      };
    }

    const entry = payload.entry[0];
    if (!entry) {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'NO_ENTRY_DATA',
          message: 'Entry array has no first element',
        },
      };
    }

    if (!entry.changes || entry.changes.length === 0) {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'NO_CHANGES',
          message: 'Entry has no changes',
        },
      };
    }

    const change = entry.changes[0];
    if (!change) {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'NO_CHANGE_DATA',
          message: 'Changes array has no first element',
        },
      };
    }

    const value = change.value;

    // Check phone number ID
    const phoneNumberId = value.metadata?.phone_number_id;
    if (phoneNumberId === undefined || phoneNumberId === '') {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'NO_PHONE_NUMBER_ID',
          message: 'No phone number ID in metadata',
        },
      };
    }

    if (!this.config.allowedPhoneNumberIds.includes(phoneNumberId)) {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'UNSUPPORTED_PHONE_NUMBER',
          message: `Phone number ID ${phoneNumberId} is not in allowed list`,
          details: { phoneNumberId, allowed: this.config.allowedPhoneNumberIds },
        },
      };
    }

    // Check if it's a message (not status update)
    if (!value.messages || value.messages.length === 0) {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'NO_MESSAGES',
          message: 'Change has no messages (possibly a status update)',
          details: { hasStatuses: Boolean(value.statuses) },
        },
      };
    }

    const message = value.messages[0];
    if (!message) {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'NO_MESSAGE_DATA',
          message: 'Message array has no first element',
        },
      };
    }

    // Check if it's a text message
    if (message.type !== 'text') {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'NON_TEXT_MESSAGE',
          message: `Message type "${message.type}" is not supported in phase 1`,
          details: { messageType: message.type },
        },
      };
    }

    const textBody = message.text?.body;
    if (textBody === undefined || textBody === '') {
      return {
        status: 'IGNORED',
        ignoredReason: {
          code: 'NO_TEXT_BODY',
          message: 'Text message has no body',
        },
      };
    }

    // Extract sender name from contacts
    const senderName = value.contacts?.[0]?.profile?.name;

    return {
      status: 'VALID',
      message: {
        from: message.from,
        text: textBody,
        messageId: message.id,
        timestamp: message.timestamp,
        ...(senderName !== undefined && senderName !== '' && { senderName }),
      },
    };
  }

  /**
   * Create domain InboxNote from extracted message.
   */
  private createInboxNoteFromMessage(message: {
    from: string;
    text: string;
    messageId: string;
    timestamp: string;
    senderName?: string;
  }): InboxNote {
    // Create a title from first 50 chars of text
    const titleText =
      message.text.length > 50 ? message.text.substring(0, 50) + '...' : message.text;
    const title = `WA: ${titleText}`;

    const sender =
      message.senderName !== undefined ? `${message.senderName} (${message.from})` : message.from;

    const note: InboxNote = {
      title,
      status: 'Inbox' as InboxNoteStatus,
      source: 'WhatsApp' as InboxNoteSource,
      messageType: 'Text' as InboxMessageType,
      contentType: 'Other' as InboxContentType,
      topics: [],
      originalText: message.text,
      cleanText: message.text,
      capturedAt: new Date(parseInt(message.timestamp) * 1000).toISOString(),
      sender,
      externalId: message.messageId,
      processedBy: 'None' as InboxProcessor,
    };

    return note;
  }
}
