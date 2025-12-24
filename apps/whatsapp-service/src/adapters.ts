/**
 * Class-based adapters wrapping the function-based repositories.
 * Provides compatibility with existing domain use cases.
 */
import type { Result } from '@intexuraos/common';
import type {
  WhatsAppWebhookEventRepository,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEvent,
  WebhookProcessingStatus,
  IgnoredReason,
  WhatsAppUserMappingPublic,
  InboxError,
} from './domain/inbox/index.js';
import {
  saveWebhookEvent,
  updateWebhookEventStatus,
  getWebhookEvent,
  saveUserMapping,
  getUserMapping,
  findUserByPhoneNumber,
  disconnectUserMapping,
  isUserConnected,
  getNotionToken,
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
    phoneNumbers: string[],
    inboxNotesDbId: string
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    return await saveUserMapping(userId, phoneNumbers, inboxNotesDbId);
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
 * Notion connection repository adapter for getting tokens.
 */
export class NotionConnectionRepositoryAdapter {
  async getToken(userId: string): Promise<Result<string | null, InboxError>> {
    return await getNotionToken(userId);
  }
}
