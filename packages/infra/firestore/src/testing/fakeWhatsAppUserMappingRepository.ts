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

  saveMapping(
    userId: string,
    phoneNumbers: string[],
    inboxNotesDbId: string
  ): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    // Check for conflicts with other users
    for (const phoneNumber of phoneNumbers) {
      for (const [existingUserId, mapping] of this.mappings.entries()) {
        if (existingUserId !== userId && mapping.connected) {
          if (mapping.phoneNumbers.includes(phoneNumber)) {
            return Promise.resolve(
              err({
                code: 'VALIDATION_ERROR',
                message: `Phone number ${phoneNumber} is already mapped to another user`,
                details: { phoneNumber, conflictingUserId: existingUserId },
              })
            );
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

    return Promise.resolve(
      ok({
        phoneNumbers: mapping.phoneNumbers,
        inboxNotesDbId: mapping.inboxNotesDbId,
        connected: mapping.connected,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
      })
    );
  }

  getMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic | null, InboxError>> {
    const mapping = this.mappings.get(userId);
    if (mapping === undefined) {
      return Promise.resolve(ok(null));
    }

    return Promise.resolve(
      ok({
        phoneNumbers: mapping.phoneNumbers,
        inboxNotesDbId: mapping.inboxNotesDbId,
        connected: mapping.connected,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
      })
    );
  }

  findUserByPhoneNumber(phoneNumber: string): Promise<Result<string | null, InboxError>> {
    for (const [userId, mapping] of this.mappings.entries()) {
      if (mapping.connected && mapping.phoneNumbers.includes(phoneNumber)) {
        return Promise.resolve(ok(userId));
      }
    }
    return Promise.resolve(ok(null));
  }

  disconnectMapping(userId: string): Promise<Result<WhatsAppUserMappingPublic, InboxError>> {
    const mapping = this.mappings.get(userId);
    if (mapping === undefined) {
      return Promise.resolve(
        err({
          code: 'NOT_FOUND',
          message: 'Mapping not found',
        })
      );
    }

    const now = new Date().toISOString();
    mapping.connected = false;
    mapping.updatedAt = now;

    return Promise.resolve(
      ok({
        phoneNumbers: mapping.phoneNumbers,
        inboxNotesDbId: mapping.inboxNotesDbId,
        connected: mapping.connected,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
      })
    );
  }

  isConnected(userId: string): Promise<Result<boolean, InboxError>> {
    const mapping = this.mappings.get(userId);
    return Promise.resolve(ok(mapping?.connected ?? false));
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
