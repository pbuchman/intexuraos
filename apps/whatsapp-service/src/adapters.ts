/**
 * Class-based adapters wrapping the function-based repositories.
 * Provides compatibility with existing domain use cases.
 */
import type { Result } from '@intexuraos/common-core';
import type {
  IgnoredReason,
  WhatsAppError,
  LinkPreviewState,
  TranscriptionState,
  WebhookProcessingStatus,
  WhatsAppMessage,
  WhatsAppMessageRepository,
  WhatsAppUserMappingPublic,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEvent,
  WhatsAppWebhookEventRepository,
} from './domain/whatsapp/index.js';
import {
  deleteMessage,
  disconnectUserMapping,
  findById,
  findPhoneByUserId,
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
  ): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>> {
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
  ): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>> {
    return await updateWebhookEventStatus(eventId, status, metadata);
  }

  async getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, WhatsAppError>> {
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
  ): Promise<Result<WhatsAppUserMappingPublic, WhatsAppError>> {
    return await saveUserMapping(userId, phoneNumbers);
  }

  async getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, WhatsAppError>> {
    return await getUserMapping(userId);
  }

  async findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, WhatsAppError>> {
    return await findUserByPhoneNumber(phoneNumber);
  }

  async findPhoneByUserId(userId: string): Promise<Result<string | null, WhatsAppError>> {
    return await findPhoneByUserId(userId);
  }

  async disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, WhatsAppError>> {
    return await disconnectUserMapping(userId);
  }

  async isConnected(userId: string): Promise<Result<boolean, WhatsAppError>> {
    return await isUserConnected(userId);
  }
}

/**
 * Class adapter for WhatsAppMessageRepository.
 */
export class MessageRepositoryAdapter implements WhatsAppMessageRepository {
  async saveMessage(
    message: Omit<WhatsAppMessage, 'id'>
  ): Promise<Result<WhatsAppMessage, WhatsAppError>> {
    return await saveMessage(message);
  }

  async getMessagesByUser(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ messages: WhatsAppMessage[]; nextCursor?: string }, WhatsAppError>> {
    return await getMessagesByUser(userId, options);
  }

  async getMessage(messageId: string): Promise<Result<WhatsAppMessage | null, WhatsAppError>> {
    return await getMessage(messageId);
  }

  async findById(
    userId: string,
    messageId: string
  ): Promise<Result<WhatsAppMessage | null, WhatsAppError>> {
    return await findById(userId, messageId);
  }

  async updateTranscription(
    userId: string,
    messageId: string,
    transcription: TranscriptionState
  ): Promise<Result<void, WhatsAppError>> {
    return await updateTranscription(userId, messageId, transcription);
  }

  async updateLinkPreview(
    userId: string,
    messageId: string,
    linkPreview: LinkPreviewState
  ): Promise<Result<void, WhatsAppError>> {
    return await updateLinkPreview(userId, messageId, linkPreview);
  }

  async deleteMessage(messageId: string): Promise<Result<void, WhatsAppError>> {
    return await deleteMessage(messageId);
  }
}
