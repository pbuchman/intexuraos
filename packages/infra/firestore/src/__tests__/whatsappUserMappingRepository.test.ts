/**
 * Tests for FirestoreWhatsAppUserMappingRepository.
 *
 * Uses real Firestore implementation against emulator.
 * Production code is unaware of emulator - only env vars differ.
 */
import { describe, it, expect } from 'vitest';
import { FirestoreWhatsAppUserMappingRepository } from '../whatsappUserMappingRepository.js';

describe('FirestoreWhatsAppUserMappingRepository', () => {
  // Each test gets fresh emulator state via vitest.setup.ts

  function createRepo(): FirestoreWhatsAppUserMappingRepository {
    return new FirestoreWhatsAppUserMappingRepository();
  }

  describe('saveMapping', () => {
    it('creates new mapping successfully', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.saveMapping('user-1', ['+1234567890'], 'notion-db-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.phoneNumbers).toEqual(['+1234567890']);
        expect(result.value.inboxNotesDbId).toBe('notion-db-id');
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('updates existing mapping preserving createdAt', async (): Promise<void> => {
      const repo = createRepo();

      // Create initial mapping
      const first = await repo.saveMapping('user-1', ['+9999999999'], 'old-db-id');
      expect(first.ok).toBe(true);
      const originalCreatedAt = first.ok ? first.value.createdAt : '';

      // Update mapping
      const result = await repo.saveMapping('user-1', ['+1234567890'], 'new-db-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBe(originalCreatedAt);
        expect(result.value.phoneNumbers).toEqual(['+1234567890']);
        expect(result.value.inboxNotesDbId).toBe('new-db-id');
        expect(result.value.connected).toBe(true);
      }
    });

    it('rejects mapping when phone number is already mapped to different user', async (): Promise<void> => {
      const repo = createRepo();

      // User 2 claims the phone number
      await repo.saveMapping('user-2', ['+1234567890'], 'other-db-id');

      // User 1 tries to use the same phone number
      const result = await repo.saveMapping('user-1', ['+1234567890'], 'my-db-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('already mapped');
        expect(result.error.details).toEqual({
          phoneNumber: '+1234567890',
          conflictingUserId: 'user-2',
        });
      }
    });

    it('allows same user to update their own phone numbers', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveMapping('user-1', ['+1111111111'], 'db-id');
      const result = await repo.saveMapping('user-1', ['+1111111111', '+2222222222'], 'db-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.phoneNumbers).toEqual(['+1111111111', '+2222222222']);
      }
    });

    it('allows reusing phone number from disconnected user', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveMapping('user-1', ['+1234567890'], 'db-id');
      await repo.disconnectMapping('user-1');

      const result = await repo.saveMapping('user-2', ['+1234567890'], 'other-db-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.phoneNumbers).toEqual(['+1234567890']);
      }
    });
  });

  describe('getMapping', () => {
    it('returns mapping when it exists', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveMapping('user-1', ['+1234567890'], 'notion-db-id');

      const result = await repo.getMapping('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.phoneNumbers).toEqual(['+1234567890']);
        expect(result.value?.inboxNotesDbId).toBe('notion-db-id');
        expect(result.value?.connected).toBe(true);
      }
    });

    it('returns null when mapping does not exist', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.getMapping('non-existent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('findUserByPhoneNumber', () => {
    it('finds user by phone number', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveMapping('user-1', ['+1234567890', '+0987654321'], 'db-id');

      const result = await repo.findUserByPhoneNumber('+1234567890');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('user-1');
      }
    });

    it('returns null when phone number not found', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.findUserByPhoneNumber('+9999999999');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('ignores disconnected mappings', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveMapping('user-1', ['+1234567890'], 'db-id');
      await repo.disconnectMapping('user-1');

      const result = await repo.findUserByPhoneNumber('+1234567890');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('disconnectMapping', () => {
    it('disconnects existing mapping', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveMapping('user-1', ['+1234567890'], 'db-id');

      const result = await repo.disconnectMapping('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
        expect(result.value.phoneNumbers).toEqual(['+1234567890']);
      }

      // Verify persisted
      const getResult = await repo.getMapping('user-1');
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value?.connected).toBe(false);
      }
    });

    it('returns error when mapping not found', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.disconnectMapping('non-existent-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('Mapping not found');
      }
    });
  });

  describe('isConnected', () => {
    it('returns true for connected mapping', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveMapping('user-1', ['+1234567890'], 'db-id');

      const result = await repo.isConnected('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for disconnected mapping', async (): Promise<void> => {
      const repo = createRepo();

      await repo.saveMapping('user-1', ['+1234567890'], 'db-id');
      await repo.disconnectMapping('user-1');

      const result = await repo.isConnected('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns false for non-existent mapping', async (): Promise<void> => {
      const repo = createRepo();

      const result = await repo.isConnected('non-existent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });
});
