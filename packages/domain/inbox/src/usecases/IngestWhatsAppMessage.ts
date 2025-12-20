/**
 * Use case: Ingest WhatsApp message to Inbox Notes.
 * Maps WhatsApp webhook payload to domain InboxNote and persists to repository.
 */
import type { Result } from '@praxos/common';
import { ok, err } from '@praxos/common';
import type { InboxNotesRepository, InboxError } from '../ports/repositories.js';
import type { InboxNote, CreateInboxNoteParams } from '../models/InboxNote.js';

/**
 * WhatsApp message data extracted from webhook.
 */
export interface WhatsAppMessage {
  /**
   * WhatsApp message ID (for idempotency).
   */
  messageId: string;

  /**
   * Sender phone number.
   */
  from: string;

  /**
   * Message timestamp (ISO string).
   */
  timestamp: string;

  /**
   * Message type (text, image, audio, video, document).
   */
  type: 'text' | 'image' | 'audio' | 'video' | 'document';

  /**
   * Text content (for text messages).
   */
  text?: string;

  /**
   * Media URL (for media messages).
   */
  mediaUrl?: string;

  /**
   * Media filename (for media messages).
   */
  mediaFilename?: string;
}

/**
 * Map WhatsApp message type to inbox message type.
 */
function mapMessageType(waType: WhatsAppMessage['type']): CreateInboxNoteParams['messageType'] {
  switch (waType) {
    case 'text':
      return 'Text';
    case 'image':
      return 'Image';
    case 'audio':
      return 'Audio';
    case 'video':
      return 'Video';
    case 'document':
      return 'Document';
    default:
      return 'Text';
  }
}

/**
 * Generate title from message content.
 */
function generateTitle(message: WhatsAppMessage): string {
  if (message.text) {
    const truncated = message.text.slice(0, 50);
    return `WA: ${truncated}${message.text.length > 50 ? '...' : ''}`;
  }
  return `WA: ${message.type} message`;
}

/**
 * Ingest WhatsApp message use case.
 */
export class IngestWhatsAppMessage {
  constructor(private readonly notesRepository: InboxNotesRepository) {}

  /**
   * Execute the use case.
   * Returns the created inbox note or existing one if idempotent.
   */
  async execute(message: WhatsAppMessage): Promise<Result<InboxNote, InboxError>> {
    // Check for existing note with same external ID (idempotency)
    const existingResult = await this.notesRepository.getByExternalId(message.messageId);
    if (!existingResult.ok) {
      return existingResult;
    }

    if (existingResult.value !== null) {
      // Already processed this message
      return ok(existingResult.value);
    }

    // Map WhatsApp message to inbox note parameters
    const params: CreateInboxNoteParams = {
      title: generateTitle(message),
      source: 'WhatsApp',
      messageType: mapMessageType(message.type),
      originalText: message.text ?? '',
      capturedAt: new Date(message.timestamp),
      sender: message.from,
      externalId: message.messageId,
      type: 'Other', // Default classification
      topics: [], // No automatic topic assignment yet
      media: message.mediaUrl && message.mediaFilename
        ? [{
            name: message.mediaFilename,
            url: message.mediaUrl,
          }]
        : [],
    };

    // Create the inbox note
    const createResult = await this.notesRepository.create(params);
    if (!createResult.ok) {
      return createResult;
    }

    return ok(createResult.value);
  }
}
