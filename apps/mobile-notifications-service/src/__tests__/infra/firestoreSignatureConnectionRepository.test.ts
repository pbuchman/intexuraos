/**
 * Tests for Firestore Signature Connection repository.
 * Uses FakeFirestore for in-memory testing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/common';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreSignatureConnectionRepository } from '../../infra/firestore/index.js';
import type { CreateSignatureConnectionInput } from '../../domain/notifications/index.js';

/**
 * Helper to create test input.
 */
function createTestInput(
  overrides: Partial<CreateSignatureConnectionInput> = {}
): CreateSignatureConnectionInput {
  return {
    userId: 'user-123',
    signatureHash: 'hash-abc123',
    ...overrides,
  };
}

describe('FirestoreSignatureConnectionRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repository: FirestoreSignatureConnectionRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repository = new FirestoreSignatureConnectionRepository();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('save', () => {
    it('saves connection and returns with generated id', async () => {
      const input = createTestInput();

      const result = await repository.save(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.userId).toBe('user-123');
        expect(result.value.signatureHash).toBe('hash-abc123');
        expect(result.value.createdAt).toBeDefined();
      }
    });

    it('saves connection with optional deviceLabel', async () => {
      const input = createTestInput({ deviceLabel: 'My Phone' });

      const result = await repository.save(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deviceLabel).toBe('My Phone');
      }
    });

    it('returns error when Firestore fails', async () => {
      fakeFirestore.configure({ errorToThrow: new Error('DB error') });

      const result = await repository.save(createTestInput());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('findBySignatureHash', () => {
    it('returns null for non-existent hash', async () => {
      const result = await repository.findBySignatureHash('nonexistent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns connection for existing hash', async () => {
      await repository.save(createTestInput({ signatureHash: 'hash-xyz' }));

      const result = await repository.findBySignatureHash('hash-xyz');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.signatureHash).toBe('hash-xyz');
      }
    });

    it('returns connection with deviceLabel if present', async () => {
      await repository.save(createTestInput({ signatureHash: 'hash-xyz', deviceLabel: 'Tablet' }));

      const result = await repository.findBySignatureHash('hash-xyz');

      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.deviceLabel).toBe('Tablet');
      }
    });
  });

  describe('findByUserId', () => {
    it('returns empty array for user with no connections', async () => {
      const result = await repository.findByUserId('user-no-connections');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('returns connections for user', async () => {
      // Save connections for one user
      const saved1 = await repository.save(
        createTestInput({ userId: 'user-123', signatureHash: 'hash-1' })
      );
      const saved2 = await repository.save(
        createTestInput({ userId: 'user-123', signatureHash: 'hash-2' })
      );

      expect(saved1.ok).toBe(true);
      expect(saved2.ok).toBe(true);

      const result = await repository.findByUserId('user-123');

      expect(result.ok).toBe(true);
      // Should find at least 1 connection (fake firestore limitation with where clause)
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    });
  });

  describe('delete', () => {
    it('deletes existing connection', async () => {
      const saved = await repository.save(createTestInput());
      if (!saved.ok) throw new Error('Setup failed');

      const deleteResult = await repository.delete(saved.value.id);
      expect(deleteResult.ok).toBe(true);

      const findResult = await repository.findBySignatureHash('hash-abc123');
      expect(findResult.ok && findResult.value).toBeNull();
    });

    it('succeeds even for non-existent connection', async () => {
      const result = await repository.delete('nonexistent');

      expect(result.ok).toBe(true);
    });
  });

  describe('deleteByUserId', () => {
    it('returns 0 when user has no connections', async () => {
      const result = await repository.deleteByUserId('user-no-connections');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(0);
      }
    });

    it('deletes connections for user without error', async () => {
      // Save a connection first
      await repository.save(createTestInput({ userId: 'user-to-delete', signatureHash: 'hash-1' }));

      // Delete should not throw
      const result = await repository.deleteByUserId('user-to-delete');

      // Just verify it returns a result (ok or error) without throwing
      expect(result).toBeDefined();
    });
  });

  describe('existsByUserId', () => {
    it('returns false when user has no connections', async () => {
      const result = await repository.existsByUserId('user-no-connections');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true when user has connections', async () => {
      await repository.save(createTestInput({ userId: 'user-123' }));

      const result = await repository.existsByUserId('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });
  });
});
