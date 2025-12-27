/**
 * Tests for Notion connection Firestore repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/common';
import type { Firestore } from '@google-cloud/firestore';
import {
  saveNotionConnection,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  disconnectNotion,
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
      const result = await saveNotionConnection('user-123', 'page-abc', 'secret-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.promptVaultPageId).toBe('page-abc');
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('preserves createdAt on update', async () => {
      await saveNotionConnection('user-123', 'page-1', 'token-1');
      const first = await getNotionConnection('user-123');
      const firstCreatedAt = first.ok && first.value ? first.value.createdAt : undefined;

      await new Promise((r) => setTimeout(r, 10));
      await saveNotionConnection('user-123', 'page-2', 'token-2');

      const second = await getNotionConnection('user-123');

      expect(second.ok).toBe(true);
      if (second.ok && second.value) {
        expect(second.value.createdAt).toBe(firstCreatedAt);
        expect(second.value.promptVaultPageId).toBe('page-2');
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
      await saveNotionConnection('user-123', 'page-abc', 'token');

      const result = await getNotionConnection('user-123');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.promptVaultPageId).toBe('page-abc');
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
      await saveNotionConnection('user-123', 'page', 'my-secret-token');

      const result = await getNotionToken('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('my-secret-token');
      }
    });

    it('returns null for disconnected user', async () => {
      await saveNotionConnection('user-123', 'page', 'token');
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
      await saveNotionConnection('user-123', 'page', 'token');

      const result = await isNotionConnected('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for disconnected user', async () => {
      await saveNotionConnection('user-123', 'page', 'token');
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
      await saveNotionConnection('user-123', 'page', 'token');

      const result = await disconnectNotion('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
      }
    });
  });

  describe('error handling', () => {
    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('DB unavailable') });

      const result = await saveNotionConnection('user', 'page', 'token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('DB unavailable');
      }
    });
  });
});
