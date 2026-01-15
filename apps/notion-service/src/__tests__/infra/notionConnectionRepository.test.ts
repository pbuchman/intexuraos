/**
 * Tests for Notion connection Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import {
  disconnectNotion,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  saveNotionConnection,
} from '../../infra/firestore/index.js';

describe('notionConnectionRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('saveNotionConnection', () => {
    it('saves new connection and returns public data', async () => {
      const result = await saveNotionConnection('user-123', 'secret-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('preserves createdAt on update', async () => {
      await saveNotionConnection('user-123', 'token-1');
      const first = await getNotionConnection('user-123');
      const firstCreatedAt = first.ok && first.value ? first.value.createdAt : undefined;

      await new Promise((r) => setTimeout(r, 10));
      await saveNotionConnection('user-123', 'token-2');

      const second = await getNotionConnection('user-123');

      expect(second.ok).toBe(true);
      if (second.ok && second.value) {
        expect(second.value.createdAt).toBe(firstCreatedAt);
      }
    });
  });

  describe('getNotionConnection', () => {
    it('returns null for non-existent user', async () => {
      const result = await getNotionConnection('unknown');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns connection for existing user', async () => {
      await saveNotionConnection('user-123', 'token');

      const result = await getNotionConnection('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.connected).toBe(true);
      }
    });
  });

  describe('getNotionToken', () => {
    it('returns null for non-existent user', async () => {
      const result = await getNotionToken('unknown');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns token for connected user', async () => {
      await saveNotionConnection('user-123', 'my-secret-token');

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('my-secret-token');
      }
    });

    it('returns null for disconnected user', async () => {
      await saveNotionConnection('user-123', 'token');
      await disconnectNotion('user-123');

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('isNotionConnected', () => {
    it('returns false for non-existent user', async () => {
      const result = await isNotionConnected('unknown');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true for connected user', async () => {
      await saveNotionConnection('user-123', 'token');

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for disconnected user', async () => {
      await saveNotionConnection('user-123', 'token');
      await disconnectNotion('user-123');

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('disconnectNotion', () => {
    it('sets connected to false', async () => {
      await saveNotionConnection('user-123', 'token');

      const result = await disconnectNotion('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
      }
    });

    it('preserves createdAt when disconnecting existing connection', async () => {
      await saveNotionConnection('user-123', 'token');
      const before = await getNotionConnection('user-123');
      const createdAt = before.ok && before.value ? before.value.createdAt : undefined;

      const result = await disconnectNotion('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBe(createdAt);
      }
    });
  });

  describe('error handling', () => {
    it('returns error when saveNotionConnection fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('DB unavailable') });

      const result = await saveNotionConnection('user', 'token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('DB unavailable');
      }
    });

    it('returns error when getNotionConnection fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await getNotionConnection('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when getNotionToken fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when isNotionConnected fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('Read failed') });

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when disconnectNotion fails', async () => {
      await saveNotionConnection('user-123', 'token');
      fakeFirestore.configure({ errorToThrow: new Error('Update failed') });

      const result = await disconnectNotion('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
