import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FirestoreNotionConnectionRepository } from '../notionConnectionRepository.js';

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
  update: (data: unknown) => Promise<void>;
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
        update: (data: unknown): Promise<void> => {
          const existing = docs.get(id);
          if (existing) {
            const existingData = existing.data() as Record<string, unknown>;
            const updatedData = { ...existingData, ...(data as Record<string, unknown>) };
            docs.set(id, { exists: true, data: (): unknown => updatedData });
          }
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

describe('FirestoreNotionConnectionRepository', () => {
  let repo: FirestoreNotionConnectionRepository;
  let mockFs: ReturnType<typeof createMockFirestore>;
  const userId = 'user-test-1';
  const pageId = 'page-abc-123';
  const token = 'secret_notion_token';

  beforeEach(() => {
    mockFs = createMockFirestore();
    vi.mocked(getFirestore).mockReturnValue(
      mockFs.getFirestore() as unknown as ReturnType<typeof getFirestore>
    );
    repo = new FirestoreNotionConnectionRepository();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('saveConnection', () => {
    it('creates a new connection when none exists', async () => {
      const result = await repo.saveConnection(userId, pageId, token);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.promptVaultPageId).toBe(pageId);
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('updates an existing connection preserving createdAt', async () => {
      // Create initial connection
      await repo.saveConnection(userId, pageId, token);

      // Get initial timestamps
      const firstResult = await repo.getConnection(userId);
      expect(firstResult.ok).toBe(true);
      const firstCreatedAt = firstResult.ok ? firstResult.value?.createdAt : undefined;

      // Update connection
      const newPageId = 'page-new-456';
      const updateResult = await repo.saveConnection(userId, newPageId, token);

      expect(updateResult.ok).toBe(true);
      if (updateResult.ok) {
        expect(updateResult.value.promptVaultPageId).toBe(newPageId);
        expect(updateResult.value.createdAt).toBe(firstCreatedAt);
      }
    });

    it('returns error when Firestore throws', async () => {
      const throwingFs: MockFirestoreInstance = {
        collection: (): MockCollectionRef => ({
          doc: (): MockDocRef => ({
            get: (): Promise<MockDocSnapshot> =>
              Promise.reject(new Error('Firestore connection failed')),
            set: (): Promise<void> => Promise.resolve(),
            update: (): Promise<void> => Promise.resolve(),
          }),
        }),
      };
      vi.mocked(getFirestore).mockReturnValue(
        throwingFs as unknown as ReturnType<typeof getFirestore>
      );

      const result = await repo.saveConnection(userId, pageId, token);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Firestore connection failed');
      }
    });
  });

  describe('getConnection', () => {
    it('returns null when no connection exists', async () => {
      const result = await repo.getConnection(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns connection when it exists', async () => {
      await repo.saveConnection(userId, pageId, token);

      const result = await repo.getConnection(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.promptVaultPageId).toBe(pageId);
        expect(result.value?.connected).toBe(true);
      }
    });

    it('returns error when Firestore throws', async () => {
      const throwingFs: MockFirestoreInstance = {
        collection: (): MockCollectionRef => ({
          doc: (): MockDocRef => ({
            get: (): Promise<MockDocSnapshot> => Promise.reject(new Error('Read failed')),
            set: (): Promise<void> => Promise.resolve(),
            update: (): Promise<void> => Promise.resolve(),
          }),
        }),
      };
      vi.mocked(getFirestore).mockReturnValue(
        throwingFs as unknown as ReturnType<typeof getFirestore>
      );

      const result = await repo.getConnection(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Read failed');
      }
    });
  });

  describe('disconnectConnection', () => {
    it('marks connection as disconnected', async () => {
      await repo.saveConnection(userId, pageId, token);

      const result = await repo.disconnectConnection(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
        expect(result.value.promptVaultPageId).toBe(pageId);
      }
    });

    it('returns error when Firestore throws', async () => {
      const throwingFs: MockFirestoreInstance = {
        collection: (): MockCollectionRef => ({
          doc: (): MockDocRef => ({
            get: (): Promise<MockDocSnapshot> => Promise.reject(new Error('Disconnect failed')),
            set: (): Promise<void> => Promise.resolve(),
            update: (): Promise<void> => Promise.resolve(),
          }),
        }),
      };
      vi.mocked(getFirestore).mockReturnValue(
        throwingFs as unknown as ReturnType<typeof getFirestore>
      );

      const result = await repo.disconnectConnection(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Disconnect failed');
      }
    });
  });

  describe('isConnected', () => {
    it('returns false when no connection exists', async () => {
      const result = await repo.isConnected(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns true when connected', async () => {
      await repo.saveConnection(userId, pageId, token);

      const result = await repo.isConnected(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false when disconnected', async () => {
      await repo.saveConnection(userId, pageId, token);
      await repo.disconnectConnection(userId);

      const result = await repo.isConnected(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns error when Firestore throws', async () => {
      const throwingFs: MockFirestoreInstance = {
        collection: (): MockCollectionRef => ({
          doc: (): MockDocRef => ({
            get: (): Promise<MockDocSnapshot> => Promise.reject(new Error('Check failed')),
            set: (): Promise<void> => Promise.resolve(),
            update: (): Promise<void> => Promise.resolve(),
          }),
        }),
      };
      vi.mocked(getFirestore).mockReturnValue(
        throwingFs as unknown as ReturnType<typeof getFirestore>
      );

      const result = await repo.isConnected(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('getToken', () => {
    it('returns null when no connection exists', async () => {
      const result = await repo.getToken(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns token when connected', async () => {
      await repo.saveConnection(userId, pageId, token);

      const result = await repo.getToken(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(token);
      }
    });

    it('returns null when disconnected', async () => {
      await repo.saveConnection(userId, pageId, token);
      await repo.disconnectConnection(userId);

      const result = await repo.getToken(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when Firestore throws', async () => {
      const throwingFs: MockFirestoreInstance = {
        collection: (): MockCollectionRef => ({
          doc: (): MockDocRef => ({
            get: (): Promise<MockDocSnapshot> => Promise.reject(new Error('Token fetch failed')),
            set: (): Promise<void> => Promise.resolve(),
            update: (): Promise<void> => Promise.resolve(),
          }),
        }),
      };
      vi.mocked(getFirestore).mockReturnValue(
        throwingFs as unknown as ReturnType<typeof getFirestore>
      );

      const result = await repo.getToken(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
