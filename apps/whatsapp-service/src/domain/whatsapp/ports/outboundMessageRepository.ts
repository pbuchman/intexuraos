/**
 * Outbound Message Repository Port.
 * Tracks sent WhatsApp messages for reply correlation.
 */
import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from './repositories.js';

/**
 * Record of a sent outbound message.
 */
export interface OutboundMessage {
  /** WhatsApp message ID (wamid) */
  wamid: string;
  /** Correlation ID from the original send request */
  correlationId: string;
  /** User ID who received the message */
  userId: string;
  /** Timestamp when the message was sent */
  sentAt: string;
  /** TTL for auto-cleanup (Unix timestamp) */
  expiresAt: number;
}

/**
 * Port for storing and retrieving outbound message records.
 */
export interface OutboundMessageRepository {
  /**
   * Save an outbound message record.
   * @param message - The outbound message to save
   */
  save(message: OutboundMessage): Promise<Result<void, WhatsAppError>>;

  /**
   * Find an outbound message by its wamid.
   * @param wamid - The WhatsApp message ID
   * @returns The outbound message or null if not found
   */
  findByWamid(wamid: string): Promise<Result<OutboundMessage | null, WhatsAppError>>;

  /**
   * Delete an outbound message by wamid.
   * @param wamid - The WhatsApp message ID
   */
  deleteByWamid(wamid: string): Promise<Result<void, WhatsAppError>>;
}
