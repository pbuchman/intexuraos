import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FirestoreIdempotencyLedger } from '../idempotencyLedger.js';

// Mock the client module
vi.mock('../client.js', () => ({
  getFirestore: vi.fn(),
}));

// Import after mock setup
import { getFirestore } from '../client.js';

interface MockDocSnapshot {
  exists: boolean;
  data: () => unknown;
}

interface MockDocRef {
  get: () => Promise<MockDocSnapshot>;
  set: (data: unknown) => Promise<void>;
}

interface MockCollectionRef {
  doc: (id: string) => MockDocRef;
}

interface MockFirestoreInstance {
  collection: (name: string) => MockCollectionRef;
}

/**
 * In-memory Firestore stub for testing.
 */
function createMockFirestore(): {
  docs: Map<string, MockDocSnapshot>;
  getFirestore: () => MockFirestoreInstance;
} {
  const docs = new Map<string, MockDocSnapshot>();

  const mockFirestore: MockFirestoreInstance = {
    collection: (_name: string): MockCollectionRef => ({
      doc: (id: string): MockDocRef => ({
        get: (): Promise<MockDocSnapshot> => {
          const doc = docs.get(id);
          if (!doc) {
            return Promise.resolve({ exists: false, data: (): unknown => undefined });
          }
          return Promise.resolve(doc);
        },
        set: (data: unknown): Promise<void> => {
          docs.set(id, { exists: true, data: (): unknown => data });
          return Promise.resolve();
        },
      }),
    }),
  };

  return {
    docs,
    getFirestore: (): MockFirestoreInstance => mockFirestore,
  };
}

describe('FirestoreIdempotencyLedger', () => {
  let ledger: FirestoreIdempotencyLedger;
  let mockFs: ReturnType<typeof createMockFirestore>;
  const userId = 'user-test-1';
  const idempotencyKey = 'idem-key-abc';
  const createdNote = {
    id: 'note-123',
    url: 'https://notion.so/note-123',
    title: 'Test Note',
  };

  beforeEach(() => {
    mockFs = createMockFirestore();
    vi.mocked(getFirestore).mockReturnValue(
      mockFs.getFirestore() as unknown as ReturnType<typeof getFirestore>
    );
    ledger = new FirestoreIdempotencyLedger();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('returns null when no record exists', async () => {
      const result = await ledger.get(userId, idempotencyKey);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns stored record when it exists', async () => {
      // Store a record first
      await ledger.set(userId, idempotencyKey, createdNote);

      const result = await ledger.get(userId, idempotencyKey);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(createdNote);
      }
    });

    it('returns error when Firestore throws', async () => {
      const throwingFs: MockFirestoreInstance = {
        collection: (): MockCollectionRef => ({
          doc: (): MockDocRef => ({
            get: (): Promise<MockDocSnapshot> => Promise.reject(new Error('Read failed')),
            set: (): Promise<void> => Promise.resolve(),
          }),
        }),
      };
      vi.mocked(getFirestore).mockReturnValue(
        throwingFs as unknown as ReturnType<typeof getFirestore>
      );

      const result = await ledger.get(userId, idempotencyKey);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Read failed');
      }
    });
  });

  describe('set', () => {
    it('stores a record successfully', async () => {
      const result = await ledger.set(userId, idempotencyKey, createdNote);

      expect(result.ok).toBe(true);

      // Verify it was stored
      const getResult = await ledger.get(userId, idempotencyKey);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value).toEqual(createdNote);
      }
    });

    it('creates composite key from userId and idempotencyKey', async () => {
      await ledger.set(userId, idempotencyKey, createdNote);

      // Check that the key was created correctly
      const expectedKey = `${userId}__${idempotencyKey}`;
      expect(mockFs.docs.has(expectedKey)).toBe(true);
    });

    it('returns error when Firestore throws', async () => {
      const throwingFs: MockFirestoreInstance = {
        collection: (): MockCollectionRef => ({
          doc: (): MockDocRef => ({
            get: (): Promise<MockDocSnapshot> =>
              Promise.resolve({ exists: false, data: (): unknown => undefined }),
            set: (): Promise<void> => Promise.reject(new Error('Write failed')),
          }),
        }),
      };
      vi.mocked(getFirestore).mockReturnValue(
        throwingFs as unknown as ReturnType<typeof getFirestore>
      );

      const result = await ledger.set(userId, idempotencyKey, createdNote);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Write failed');
      }
    });
  });

  describe('composite key isolation', () => {
    it('different users have separate records', async () => {
      const user1 = 'user-1';
      const user2 = 'user-2';
      const note1 = { ...createdNote, id: 'note-1' };
      const note2 = { ...createdNote, id: 'note-2' };

      await ledger.set(user1, idempotencyKey, note1);
      await ledger.set(user2, idempotencyKey, note2);

      const result1 = await ledger.get(user1, idempotencyKey);
      const result2 = await ledger.get(user2, idempotencyKey);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value?.id).toBe('note-1');
        expect(result2.value?.id).toBe('note-2');
      }
    });

    it('different keys for same user have separate records', async () => {
      const key1 = 'key-1';
      const key2 = 'key-2';
      const note1 = { ...createdNote, id: 'note-1' };
      const note2 = { ...createdNote, id: 'note-2' };

      await ledger.set(userId, key1, note1);
      await ledger.set(userId, key2, note2);

      const result1 = await ledger.get(userId, key1);
      const result2 = await ledger.get(userId, key2);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value?.id).toBe('note-1');
        expect(result2.value?.id).toBe('note-2');
      }
    });
  });
});
