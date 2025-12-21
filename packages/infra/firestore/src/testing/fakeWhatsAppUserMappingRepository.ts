/**
 * In-memory test fake for WhatsAppUserMappingRepository.
 */
import { ok, err, type Result } from '@praxos/common';
import type {
  WhatsAppUserMappingRepository,
  WhatsAppUserMappingPublic,
  InboxError,
} from '@praxos/domain-inbox';

interface MappingRecord {
  userId: string;
  phoneNumbers: string[];
  inboxNotesDbId: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * In-memory fake implementation of WhatsAppUserMappingRepository.
 * Mimics Firestore behavior for deterministic testing.
 */
export class FakeWhatsAppUserMappingRepository implements WhatsAppUserMappingRepository {
  private mappings = new Map<string, MappingRecord>();

  async saveMapping(
    userId: string,
    phoneNumbers: string[],
    inboxNotesDbId: string
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    // Check for conflicts with other users
    for (const phoneNumber of phoneNumbers) {
      for (const [existingUserId, mapping] of this.mappings.entries()) {
        if (existingUserId !== userId && mapping.connected) {
          if (mapping.phoneNumbers.includes(phoneNumber)) {
            return err({
              code: 'VALIDATION_ERROR',
              message: `Phone number ${phoneNumber} is already mapped to another user`,
              details: { phoneNumber, conflictingUserId: existingUserId },
            });
          }
        }
      }
    }

    const now = new Date().toISOString();
    const existing = this.mappings.get(userId);

    const mapping: MappingRecord = {
      userId,
      phoneNumbers,
      inboxNotesDbId,
      connected: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.mappings.set(userId, mapping);

    return ok({
      phoneNumbers: mapping.phoneNumbers,
      inboxNotesDbId: mapping.inboxNotesDbId,
      connected: mapping.connected,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    });
  }

  async getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, InboxError>> {
    const mapping = this.mappings.get(userId);
    if (!mapping) {
      return ok(null);
    }

    return ok({
      phoneNumbers: mapping.phoneNumbers,
      inboxNotesDbId: mapping.inboxNotesDbId,
      connected: mapping.connected,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    });
  }

  async findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, InboxError>> {
    for (const [userId, mapping] of this.mappings.entries()) {
      if (mapping.connected && mapping.phoneNumbers.includes(phoneNumber)) {
        return ok(userId);
      }
    }
    return ok(null);
  }

  async disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    const mapping = this.mappings.get(userId);
    if (!mapping) {
      return err({
        code: 'NOT_FOUND',
        message: 'Mapping not found',
      });
    }

    const now = new Date().toISOString();
    mapping.connected = false;
    mapping.updatedAt = now;

    return ok({
      phoneNumbers: mapping.phoneNumbers,
      inboxNotesDbId: mapping.inboxNotesDbId,
      connected: mapping.connected,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    });
  }

  async isConnected(userId: string): Promise<Result<boolean, InboxError>> {
    const mapping = this.mappings.get(userId);
    return ok(mapping?.connected ?? false);
  }

  /**
   * Clear all mappings (for test cleanup).
   */
  clear(): void {
    this.mappings.clear();
  }

  /**
   * Get all mappings (for testing assertions).
   */
  getAll(): MappingRecord[] {
    return Array.from(this.mappings.values());
  }
}
