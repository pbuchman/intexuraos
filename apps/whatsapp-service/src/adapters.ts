/**
 * Class-based adapters wrapping the function-based repositories.
 * Provides compatibility with existing domain use cases.
 */
import type { Result } from '@intexuraos/common-core';
import type {
  IgnoredReason,
  InboxError,
  LinkPreviewState,
  TranscriptionState,
  WebhookProcessingStatus,
  WhatsAppMessage,
  WhatsAppMessageRepository,
  WhatsAppUserMappingPublic,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEvent,
  WhatsAppWebhookEventRepository,
} from './domain/inbox/index.js';
import {
  deleteMessage,
  disconnectUserMapping,
  findById,
  findUserByPhoneNumber,
  getMessage,
  getMessagesByUser,
  getUserMapping,
  getWebhookEvent,
  isUserConnected,
  saveMessage,
  saveUserMapping,
  saveWebhookEvent,
  updateLinkPreview,
  updateTranscription,
  updateWebhookEventStatus,
} from './infra/firestore/index.js';

/**
 * Class adapter for WhatsAppWebhookEventRepository.
 */
export class WebhookEventRepositoryAdapter implements WhatsAppWebhookEventRepository {
  async saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>> {
    return await saveWebhookEvent(event);
  }

  async updateEventStatus(
    eventId: string,
    status: WebhookProcessingStatus,
    metadata: {
      ignoredReason?: IgnoredReason;
      failureDetails?: string;
      inboxNoteId?: string;
    }
  ): Promise<Result<WhatsAppWebhookEvent, InboxError>> {
    return await updateWebhookEventStatus(eventId, status, metadata);
  }

  async getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, InboxError>> {
    return await getWebhookEvent(eventId);
  }
}

/**
 * Class adapter for WhatsAppUserMappingRepository.
 */
export class UserMappingRepositoryAdapter implements WhatsAppUserMappingRepository {
  async saveMapping(
    userId: string,
    phoneNumbers: string[]
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    return await saveUserMapping(userId, phoneNumbers);
  }

  async getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, InboxError>> {
    return await getUserMapping(userId);
  }

  async findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, InboxError>> {
    return await findUserByPhoneNumber(phoneNumber);
  }

  async disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    return await disconnectUserMapping(userId);
  }

  async isConnected(userId: string): Promise<Result<boolean, InboxError>> {
    return await isUserConnected(userId);
  }
}

/**
 * Class adapter for WhatsAppMessageRepository.
 */
export class MessageRepositoryAdapter implements WhatsAppMessageRepository {
  async saveMessage(
    message: Omit<WhatsAppMessage, 'id'>
  ): Promise<Result<WhatsAppMessage, InboxError>> {
    return await saveMessage(message);
  }

  async getMessagesByUser(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ messages: WhatsAppMessage[]; nextCursor?: string }, InboxError>> {
    return await getMessagesByUser(userId, options);
  }

  async getMessage(messageId: string): Promise<Result<WhatsAppMessage | null, InboxError>> {
    return await getMessage(messageId);
  }

  async findById(
    userId: string,
    messageId: string
  ): Promise<Result<WhatsAppMessage | null, InboxError>> {
    return await findById(userId, messageId);
  }

  async updateTranscription(
    userId: string,
    messageId: string,
    transcription: TranscriptionState
  ): Promise<Result<void, InboxError>> {
    return await updateTranscription(userId, messageId, transcription);
  }

  async updateLinkPreview(
    userId: string,
    messageId: string,
    linkPreview: LinkPreviewState
  ): Promise<Result<void, InboxError>> {
    return await updateLinkPreview(userId, messageId, linkPreview);
  }

  async deleteMessage(messageId: string): Promise<Result<void, InboxError>> {
    return await deleteMessage(messageId);
  }
}
