import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setFirestore } from '@intexuraos/infra-firestore';
import { isErr, isOk } from '@intexuraos/common-core';
import { getResearchPageId, saveResearchPageId } from '../researchExportSettingsRepository.js';

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

describe('ResearchExportSettingsRepository', () => {
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

  describe('getResearchPageId', () => {
    it('returns researchPageId when user has settings', async () => {
      const userId = 'user-123';
      const pageId = 'page-abc';

      // Pre-populate store
      const collection = new Map();
      collection.set(userId, {
        userId,
        researchPageId: pageId,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      store.set('research_export_settings', collection);

      const result = await getResearchPageId(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(pageId);
      }
    });

    it('returns null when user has no settings', async () => {
      const userId = 'user-456';

      const result = await getResearchPageId(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(null);
      }
    });

    it('returns null when document exists but has no researchPageId', async () => {
      const userId = 'user-789';

      // Pre-populate with incomplete data
      const collection = new Map();
      collection.set(userId, {
        userId,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      store.set('research_export_settings', collection);

      const result = await getResearchPageId(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(null);
      }
    });

    it('returns error when Firestore operation fails', async () => {
      const errorFirestore = {
        collection(): { doc(): { get(): Promise<never> } } {
          return {
            doc(): { get(): Promise<never> } {
              return {
                async get(): Promise<never> {
                  throw new Error('Firestore connection failed');
                },
              };
            },
          };
        },
      };
      // @ts-expect-error -- Fake Firestore that throws errors
      setFirestore(errorFirestore);

      const result = await getResearchPageId('user-error');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to get research page ID');
      }
    });
  });

  describe('saveResearchPageId', () => {
    it('creates new settings document when user has no settings', async () => {
      const userId = 'user-new';
      const pageId = 'page-xyz';

      const result = await saveResearchPageId(userId, pageId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.researchPageId).toBe(pageId);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }

      // Verify stored in Firestore
      const collection = store.get('research_export_settings');
      expect(collection).toBeDefined();
      const doc = collection?.get(userId) as
        | { userId: string; researchPageId: string; createdAt: string; updatedAt: string }
        | undefined;
      expect(doc).toBeDefined();
      expect(doc?.researchPageId).toBe(pageId);
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
        researchPageId: oldPageId,
        createdAt,
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      store.set('research_export_settings', collection);

      const result = await saveResearchPageId(userId, newPageId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.researchPageId).toBe(newPageId);
        expect(result.value.createdAt).toBe(createdAt); // Preserved
        expect(result.value.updatedAt).not.toBe(createdAt); // Updated
      }

      // Verify stored in Firestore
      const doc = collection.get(userId) as
        | { userId: string; researchPageId: string; createdAt: string; updatedAt: string }
        | undefined;
      expect(doc?.researchPageId).toBe(newPageId);
      expect(doc?.createdAt).toBe(createdAt);
    });

    it('handles missing createdAt in existing document', async () => {
      const userId = 'user-no-created-at';
      const pageId = 'page-fix';

      // Pre-populate with incomplete data
      const collection = new Map();
      collection.set(userId, {
        userId,
        researchPageId: 'page-old',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      store.set('research_export_settings', collection);

      const result = await saveResearchPageId(userId, pageId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('returns error when Firestore operation fails', async () => {
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

      const result = await saveResearchPageId('user-error', 'page-error');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to save research page ID');
      }
    });
  });
});
