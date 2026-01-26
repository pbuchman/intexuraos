/**
 * Domain ports for Inbox repositories.
 * These interfaces define what the domain needs from infrastructure.
 */
import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type { TranscriptionState, WhatsAppMessage } from '../models/WhatsAppMessage.js';
import type { LinkPreviewState } from '../models/LinkPreview.js';
import type {
  PhoneVerification,
  PhoneVerificationStatus,
} from '../models/PhoneVerification.js';

// Re-export WhatsAppError for use in other ports
export type { WhatsAppError };

/**
 * Processing status for webhook events.
 */
export type WebhookProcessingStatus =
  | 'pending'
  | 'completed'
  | 'ignored'
  | 'user_unmapped'
  | 'failed';

/**
 * Reason for ignored webhook.
 */
export interface IgnoredReason {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Enhanced webhook event with processing metadata.
 */
export interface WhatsAppWebhookEvent {
  id: string;
  payload: unknown;
  signatureValid: boolean;
  receivedAt: string;
  phoneNumberId: string | null;
  status: WebhookProcessingStatus;
  ignoredReason?: IgnoredReason;
  failureDetails?: string;
  processedAt?: string;
}

/**
 * Public view of WhatsApp mapping (no userId).
 */
export interface WhatsAppUserMappingPublic {
  phoneNumbers: string[];
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * WhatsApp user mapping configuration.
 */
export interface WhatsAppUserMapping {
  userId: string;
  phoneNumbers: string[];
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Repository for WhatsApp user mappings.
 */
export interface WhatsAppUserMappingRepository {
  saveMapping(
    userId: string,
    phoneNumbers: string[]
  ): Promise<Result<WhatsAppUserMappingPublic, WhatsAppError>>;
  getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, WhatsAppError>>;
  findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, WhatsAppError>>;
  findPhoneByUserId(userId: string): Promise<Result<string | null, WhatsAppError>>;
  disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, WhatsAppError>>;
  isConnected(userId: string): Promise<Result<boolean, WhatsAppError>>;
}

/**
 * Repository for WhatsApp webhook events.
 */
export interface WhatsAppWebhookEventRepository {
  saveEvent(
    event: Omit<WhatsAppWebhookEvent, 'id'>
  ): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>>;
  updateEventStatus(
    eventId: string,
    status: WebhookProcessingStatus,
    metadata: {
      ignoredReason?: IgnoredReason;
      failureDetails?: string;
    }
  ): Promise<Result<WhatsAppWebhookEvent, WhatsAppError>>;
  getEvent(eventId: string): Promise<Result<WhatsAppWebhookEvent | null, WhatsAppError>>;
}

/**
 * Repository for WhatsApp messages.
 */
export interface WhatsAppMessageRepository {
  /**
   * Save a new message.
   */
  saveMessage(
    message: Omit<WhatsAppMessage, 'id'>
  ): Promise<Result<WhatsAppMessage, WhatsAppError>>;

  /**
   * Get messages for a user, ordered by receivedAt descending.
   */
  /**
   * Get messages for a user with pagination.
   */
  getMessagesByUser(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ messages: WhatsAppMessage[]; nextCursor?: string }, WhatsAppError>>;

  /**
   * Get a single message by ID.
   */
  getMessage(messageId: string): Promise<Result<WhatsAppMessage | null, WhatsAppError>>;

  /**
   * Find a message by user ID and message ID.
   */
  findById(
    userId: string,
    messageId: string
  ): Promise<Result<WhatsAppMessage | null, WhatsAppError>>;

  /**
   * Update message transcription state.
   */
  updateTranscription(
    userId: string,
    messageId: string,
    transcription: TranscriptionState
  ): Promise<Result<void, WhatsAppError>>;

  /**
   * Update message link preview state.
   */
  updateLinkPreview(
    userId: string,
    messageId: string,
    linkPreview: LinkPreviewState
  ): Promise<Result<void, WhatsAppError>>;

  /**
   * Delete a message.
   */
  deleteMessage(messageId: string): Promise<Result<void, WhatsAppError>>;
}

/**
 * Repository for phone number verification.
 */
export interface PhoneVerificationRepository {
  /**
   * Create a new verification record.
   */
  create(
    verification: Omit<PhoneVerification, 'id'>
  ): Promise<Result<PhoneVerification, WhatsAppError>>;

  /**
   * Find a verification record by ID.
   */
  findById(id: string): Promise<Result<PhoneVerification | null, WhatsAppError>>;

  /**
   * Find the most recent pending verification for a user and phone number.
   */
  findPendingByUserAndPhone(
    userId: string,
    phoneNumber: string
  ): Promise<Result<PhoneVerification | null, WhatsAppError>>;

  /**
   * Check if a phone number is verified for a user.
   */
  isPhoneVerified(userId: string, phoneNumber: string): Promise<Result<boolean, WhatsAppError>>;

  /**
   * Update verification status.
   */
  updateStatus(
    id: string,
    status: PhoneVerificationStatus,
    metadata?: { verifiedAt?: string; lastAttemptAt?: string }
  ): Promise<Result<PhoneVerification, WhatsAppError>>;

  /**
   * Increment failed attempt count.
   */
  incrementAttempts(id: string): Promise<Result<PhoneVerification, WhatsAppError>>;

  /**
   * Count recent verification requests for rate limiting.
   * Returns count of verifications created within the time window.
   */
  countRecentByPhone(
    phoneNumber: string,
    windowStartTime: string
  ): Promise<Result<number, WhatsAppError>>;
}
