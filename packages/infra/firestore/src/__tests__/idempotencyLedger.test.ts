/**
 * Tests for FirestoreIdempotencyLedger.
 *
 * Uses real Firestore implementation against emulator.
 */
import { describe, it, expect } from 'vitest';
import { FirestoreIdempotencyLedger } from '../idempotencyLedger.js';

describe('FirestoreIdempotencyLedger', () => {
  function createLedger(): FirestoreIdempotencyLedger {
    return new FirestoreIdempotencyLedger();
  }

  const userId = 'user-test-1';
  const idempotencyKey = 'idem-key-abc';
  const createdNote = {
    id: 'note-123',
    url: 'https://notion.so/note-123',
    title: 'Test Note',
  };

  describe('get', () => {
    it('returns null when no record exists', async (): Promise<void> => {
      const ledger = createLedger();

      const result = await ledger.get(userId, idempotencyKey);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns stored record when it exists', async (): Promise<void> => {
      const ledger = createLedger();

      await ledger.set(userId, idempotencyKey, createdNote);

      const result = await ledger.get(userId, idempotencyKey);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(createdNote);
      }
    });
  });

  describe('set', () => {
    it('stores record successfully', async (): Promise<void> => {
      const ledger = createLedger();

      const result = await ledger.set(userId, idempotencyKey, createdNote);

      expect(result.ok).toBe(true);

      // Verify persisted
      const getResult = await ledger.get(userId, idempotencyKey);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toEqual(createdNote);
      }
    });

    it('overwrites existing record', async (): Promise<void> => {
      const ledger = createLedger();

      await ledger.set(userId, idempotencyKey, createdNote);

      const newNote = {
        id: 'note-456',
        url: 'https://notion.so/note-456',
        title: 'Updated Note',
      };
      const result = await ledger.set(userId, idempotencyKey, newNote);

      expect(result.ok).toBe(true);

      const getResult = await ledger.get(userId, idempotencyKey);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toEqual(newNote);
      }
    });
  });

  describe('composite key behavior', () => {
    it('isolates records by userId', async (): Promise<void> => {
      const ledger = createLedger();

      const note1 = { id: 'note-1', url: 'https://notion.so/1', title: 'Note 1' };
      const note2 = { id: 'note-2', url: 'https://notion.so/2', title: 'Note 2' };

      await ledger.set('user-1', idempotencyKey, note1);
      await ledger.set('user-2', idempotencyKey, note2);

      const result1 = await ledger.get('user-1', idempotencyKey);
      const result2 = await ledger.get('user-2', idempotencyKey);

      expect(result1.ok && result1.value).toEqual(note1);
      expect(result2.ok && result2.value).toEqual(note2);
    });

    it('isolates records by idempotencyKey', async (): Promise<void> => {
      const ledger = createLedger();

      const note1 = { id: 'note-1', url: 'https://notion.so/1', title: 'Note 1' };
      const note2 = { id: 'note-2', url: 'https://notion.so/2', title: 'Note 2' };

      await ledger.set(userId, 'key-1', note1);
      await ledger.set(userId, 'key-2', note2);

      const result1 = await ledger.get(userId, 'key-1');
      const result2 = await ledger.get(userId, 'key-2');

      expect(result1.ok && result1.value).toEqual(note1);
      expect(result2.ok && result2.value).toEqual(note2);
    });
  });
});
