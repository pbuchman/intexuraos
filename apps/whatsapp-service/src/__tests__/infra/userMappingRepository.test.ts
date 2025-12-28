/**
 * Tests for WhatsApp user mapping Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/common';
import type { Firestore } from '@google-cloud/firestore';
import {
  saveUserMapping,
  getUserMapping,
  findUserByPhoneNumber,
  disconnectUserMapping,
  isUserConnected,
} from '../../infra/firestore/index.js';

describe('userMappingRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('saveUserMapping', () => {
    it('saves mapping and returns public data', async () => {
      const result = await saveUserMapping('user-123', ['15551234567']);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.phoneNumbers).toEqual(['15551234567']);
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBeDefined();
      }
    });

    it('allows updating own mapping with same phone', async () => {
      await saveUserMapping('user-123', ['15551234567']);
      const result = await saveUserMapping('user-123', ['15551234567', '15559999999']);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.phoneNumbers).toHaveLength(2);
      }
    });

    it('returns error when phone is mapped to different user', async () => {
      await saveUserMapping('user-123', ['15551234567']);

      const result = await saveUserMapping('user-456', ['15551234567']);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('already mapped to another user');
      }
    });
  });

  describe('getUserMapping', () => {
    it('returns null for non-existent user', async () => {
      const result = await getUserMapping('unknown');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns mapping for existing user', async () => {
      await saveUserMapping('user-123', ['15551234567']);

      const result = await getUserMapping('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.phoneNumbers).toEqual(['15551234567']);
        expect(result.value.connected).toBe(true);
      }
    });
  });

  describe('findUserByPhoneNumber', () => {
    it('returns null for unmapped phone', async () => {
      const result = await findUserByPhoneNumber('15559999999');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns userId for mapped phone', async () => {
      await saveUserMapping('user-123', ['15551234567']);

      const result = await findUserByPhoneNumber('15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('user-123');
      }
    });

    it('normalizes phone number format', async () => {
      await saveUserMapping('user-123', ['15551234567']);

      // Search with + prefix
      const result = await findUserByPhoneNumber('+15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('user-123');
      }
    });

    it('returns null for disconnected user', async () => {
      await saveUserMapping('user-123', ['15551234567']);
      await disconnectUserMapping('user-123');

      const result = await findUserByPhoneNumber('15551234567');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('disconnectUserMapping', () => {
    it('sets connected to false', async () => {
      await saveUserMapping('user-123', ['15551234567']);

      const result = await disconnectUserMapping('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
      }
    });

    it('returns NOT_FOUND for non-existent user', async () => {
      const result = await disconnectUserMapping('unknown');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('isUserConnected', () => {
    it('returns false for non-existent user', async () => {
      const result = await isUserConnected('unknown');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true for connected user', async () => {
      await saveUserMapping('user-123', ['15551234567']);

      const result = await isUserConnected('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for disconnected user', async () => {
      await saveUserMapping('user-123', ['15551234567']);
      await disconnectUserMapping('user-123');

      const result = await isUserConnected('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('error handling', () => {
    it('returns error when saveUserMapping fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('DB error') });

      const result = await saveUserMapping('user-123', ['15551234567']);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });

    it('returns error when getUserMapping fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read error') });

      const result = await getUserMapping('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });

    it('returns error when findUserByPhoneNumber fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Query error') });

      const result = await findUserByPhoneNumber('15551234567');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });

    it('returns error when disconnectUserMapping fails', async () => {
      await saveUserMapping('user-123', ['15551234567']);
      fakeFirestore.configure({ errorToThrow: new Error('Update error') });

      const result = await disconnectUserMapping('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });

    it('returns error when isUserConnected fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read error') });

      const result = await isUserConnected('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
      }
    });
  });
});
