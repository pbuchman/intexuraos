import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setFirestore } from '@intexuraos/infra-firestore';
import { isOk, isErr } from '@intexuraos/common-core';
import { getPromptVaultPageId, savePromptVaultPageId } from '../promptVaultSettingsRepository.js';

interface DocumentSnapshot {
  exists: boolean;
  data(): unknown;
}

interface DocumentReference {
  get(): Promise<DocumentSnapshot>;
  set(data: unknown): Promise<void>;
}

interface CollectionReference {
  doc(id: string): DocumentReference;
}

interface FakeFirestore {
  collection(name: string): CollectionReference;
}

function createFakeFirestore(store: Map<string, Map<string, unknown>>): FakeFirestore {
  return {
    collection(name: string): CollectionReference {
      if (!store.has(name)) {
        store.set(name, new Map());
      }
      const collection = store.get(name);
      if (collection === undefined) {
        throw new Error(`Collection ${name} not found`);
      }

      return {
        doc(id: string): DocumentReference {
          return {
            async get(): Promise<DocumentSnapshot> {
              const data = collection.get(id);
              return {
                exists: data !== undefined,
                data(): unknown {
                  return data;
                },
              };
            },
            async set(data: unknown): Promise<void> {
              collection.set(id, data);
            },
          };
        },
      };
    },
  };
}

describe('PromptVaultSettingsRepository', () => {
  let store: Map<string, Map<string, unknown>>;

  beforeEach(() => {
    store = new Map();
    // @ts-expect-error -- Fake Firestore for testing
    setFirestore(createFakeFirestore(store));
  });

  afterEach(() => {
    // @ts-expect-error -- Reset Firestore
    setFirestore(undefined);
  });

  describe('getPromptVaultPageId', () => {
    it('returns promptVaultPageId when user has settings', async () => {
      const userId = 'user-123';
      const pageId = 'page-abc';

      // Pre-populate store
      const collection = new Map();
      collection.set(userId, {
        userId,
        promptVaultPageId: pageId,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      store.set('promptvault_settings', collection);

      const result = await getPromptVaultPageId(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(pageId);
      }
    });

    it('returns null when user has no settings', async () => {
      const userId = 'user-456';

      const result = await getPromptVaultPageId(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(null);
      }
    });

    it('returns null when document exists but has no promptVaultPageId', async () => {
      const userId = 'user-789';

      // Pre-populate with incomplete data
      const collection = new Map();
      collection.set(userId, {
        userId,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      store.set('promptvault_settings', collection);

      const result = await getPromptVaultPageId(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(null);
      }
    });
  });

  describe('savePromptVaultPageId', () => {
    it('creates new settings document when user has no settings', async () => {
      const userId = 'user-new';
      const pageId = 'page-xyz';

      const result = await savePromptVaultPageId(userId, pageId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.promptVaultPageId).toBe(pageId);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }

      // Verify stored in Firestore
      const collection = store.get('promptvault_settings');
      expect(collection).toBeDefined();
      const doc = collection?.get(userId) as
        | { userId: string; promptVaultPageId: string; createdAt: string; updatedAt: string }
        | undefined;
      expect(doc).toBeDefined();
      expect(doc?.promptVaultPageId).toBe(pageId);
    });

    it('updates existing settings and preserves createdAt', async () => {
      const userId = 'user-existing';
      const oldPageId = 'page-old';
      const newPageId = 'page-new';
      const createdAt = '2025-01-01T00:00:00.000Z';

      // Pre-populate with existing settings
      const collection = new Map();
      collection.set(userId, {
        userId,
        promptVaultPageId: oldPageId,
        createdAt,
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      store.set('promptvault_settings', collection);

      const result = await savePromptVaultPageId(userId, newPageId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.promptVaultPageId).toBe(newPageId);
        expect(result.value.createdAt).toBe(createdAt); // Preserved
        expect(result.value.updatedAt).not.toBe(createdAt); // Updated
      }

      // Verify stored in Firestore
      const doc = collection.get(userId) as
        | { userId: string; promptVaultPageId: string; createdAt: string; updatedAt: string }
        | undefined;
      expect(doc?.promptVaultPageId).toBe(newPageId);
      expect(doc?.createdAt).toBe(createdAt);
    });

    it('handles missing createdAt in existing document', async () => {
      const userId = 'user-no-created-at';
      const pageId = 'page-fix';

      // Pre-populate with incomplete data
      const collection = new Map();
      collection.set(userId, {
        userId,
        promptVaultPageId: 'page-old',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      store.set('promptvault_settings', collection);

      const result = await savePromptVaultPageId(userId, pageId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('returns error when Firestore operation fails', async () => {
      // Create a fake Firestore that throws errors
      const errorFirestore = {
        collection(): { doc(): { get(): Promise<never>; set(): Promise<never> } } {
          return {
            doc(): { get(): Promise<never>; set(): Promise<never> } {
              return {
                async get(): Promise<never> {
                  throw new Error('Firestore connection failed');
                },
                async set(): Promise<never> {
                  throw new Error('Firestore connection failed');
                },
              };
            },
          };
        },
      };
      // @ts-expect-error -- Fake Firestore that throws errors
      setFirestore(errorFirestore);

      const result = await savePromptVaultPageId('user-error', 'page-error');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to save prompt vault page ID');
      }
    });
  });
});
