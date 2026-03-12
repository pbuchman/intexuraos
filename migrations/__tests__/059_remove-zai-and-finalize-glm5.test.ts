/**
 * Tests for migration 059: Remove ZAI and finalize GLM-5
 */

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { metadata, up } from '../059_remove-zai-and-finalize-glm5.mjs';

// Mock console.log during tests to prevent stdout noise
let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => {
  logSpy?.mockRestore();
});

// Mock firebase-admin/firestore to provide FieldValue
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: function () {
      return { isEqual: () => true };
    },
  },
}));

// Minimal fake Firestore implementation for testing
class FakeDocRef {
  constructor(
    private collectionName: string,
    private docId: string,
    private store: Map<string, Map<string, unknown>>,
    private docData: Record<string, unknown> = {}
  ) {}

  get id() {
    return this.docId;
  }

  async get() {
    const collection = this.store.get(this.collectionName);
    const data = collection?.get(this.docId);
    return new FakeDocSnapshot(
      this.docId,
      data,
      data !== undefined,
      this.collectionName,
      this.store
    );
  }

  async update(data: Record<string, unknown>) {
    const collection = this.store.get(this.collectionName);
    const existing = collection?.get(this.docId);
    if (existing === undefined) {
      throw new Error(`Document ${this.collectionName}/${this.docId} does not exist`);
    }

    const updated = { ...existing } as Record<string, unknown>;
    for (const key of Object.keys(data)) {
      const value = data[key];
      // Handle FieldValue.delete() - check for isEqual method
      if (value && typeof value === 'object' && 'isEqual' in value) {
        if (key.includes('.')) {
          const parts = key.split('.');
          let current: Record<string, unknown> = updated;
          for (let i = 0; i < parts.length - 1; i++) {
            current = (current[parts[i]] as Record<string, unknown>) || {};
          }
          delete current[parts[parts.length - 1]];
        } else {
          delete updated[key];
        }
      } else if (key.includes('.')) {
        const parts = key.split('.');
        let current: Record<string, unknown> = updated;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) current[parts[i]] = {};
          current = current[parts[i]] as Record<string, unknown>;
        }
        current[parts[parts.length - 1]] = value;
      } else {
        updated[key] = value;
      }
    }
    collection?.set(this.docId, updated);
    return { writeTime: { toDate: () => new Date() } };
  }

  async set(data: Record<string, unknown>) {
    let collection = this.store.get(this.collectionName);
    if (!collection) {
      collection = new Map();
      this.store.set(this.collectionName, collection);
    }
    collection.set(this.docId, data);
    return { writeTime: { toDate: () => new Date() } };
  }

  async delete() {
    const collection = this.store.get(this.collectionName);
    collection?.delete(this.docId);
    return { writeTime: { toDate: () => new Date() } };
  }
}

class FakeDocSnapshot {
  constructor(
    private _id: string,
    private _data: Record<string, unknown> | undefined,
    private _exists: boolean,
    private _collectionName: string,
    private _store: Map<string, Map<string, unknown>>
  ) {}

  get id() {
    return this._id;
  }

  get exists() {
    return this._exists;
  }

  data() {
    return this._data;
  }

  get ref() {
    return new FakeDocRef(this._collectionName, this._id, this._store, this._data);
  }
}

class FakeQuery {
  private filters: { field: string; op: string; value: unknown }[] = [];

  constructor(
    private collectionName: string,
    private store: Map<string, Map<string, unknown>>
  ) {}

  where(field: string, op: string, value: unknown) {
    const query = new FakeQuery(this.collectionName, this.store);
    query.filters.push({ field, op, value });
    return query;
  }

  async get() {
    let collection = this.store.get(this.collectionName);
    if (!collection) {
      collection = new Map();
    }
    let docs = Array.from(collection.entries()).map(
      ([id, data]) => new FakeDocSnapshot(id, data, true, this.collectionName, this.store)
    );

    // Apply filters
    for (const filter of this.filters) {
      docs = docs.filter((doc) => {
        const data = doc.data();
        if (!data) return false;
        const fieldValue = data[filter.field];
        switch (filter.op) {
          case '==':
            return fieldValue === filter.value;
          default:
            return true;
        }
      });
    }

    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeCollectionRef {
  constructor(
    private collectionName: string,
    private store: Map<string, Map<string, unknown>>,
    private docCounter = { value: 0 }
  ) {}

  doc(docId?: string) {
    const id = docId || `auto-${String(++this.docCounter.value)}`;
    const collection = this.store.get(this.collectionName);
    const existing = collection?.get(id);
    return new FakeDocRef(this.collectionName, id, this.store, existing as Record<string, unknown>);
  }

  where(field: string, op: string, value: unknown) {
    return new FakeQuery(this.collectionName, this.store).where(field, op, value);
  }

  async get() {
    let collection = this.store.get(this.collectionName);
    if (!collection) {
      collection = new Map();
    }
    const docs = Array.from(collection.entries()).map(
      ([id, data]) => new FakeDocSnapshot(id, data, true, this.collectionName, this.store)
    );
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeFirestore {
  private store = new Map<string, Map<string, unknown>>();
  private docCounter = { value: 0 };

  collection(name: string) {
    return new FakeCollectionRef(name, this.store, this.docCounter);
  }

  doc(path: string) {
    const parts = path.split('/');
    const collectionName = parts.slice(0, -1).join('/');
    const docId = parts[parts.length - 1];
    return new FakeDocRef(collectionName, docId, this.store);
  }

  batch() {
    const operations: (() => void)[] = [];
    return {
      update: (ref: FakeDocRef, data: Record<string, unknown>) => {
        operations.push(() => ref.update(data));
        return this;
      },
      delete: (ref: FakeDocRef) => {
        operations.push(() => ref.delete());
        return this;
      },
      commit: async () => {
        for (const op of operations) {
          op();
        }
        return [];
      },
    };
  }
}

describe('059_remove-zai-and-finalize-glm5 migration', () => {
  let fakeFirestore: FakeFirestore;

  beforeEach(() => {
    fakeFirestore = new FakeFirestore();
  });

  describe('metadata', () => {
    it('should have correct metadata structure', () => {
      expect(metadata).toMatchObject({
        id: '059',
        name: 'remove-zai-and-finalize-glm5',
        description: 'Remove ZAI/GLM-4.7 from user settings, code tasks, and researches',
        createdAt: '2026-03-12',
      });
    });

    it('should have sequential ID', () => {
      expect(Number.parseInt(metadata.id, 10)).toBe(59);
    });
  });

  describe('up function', () => {
    it('should be a function', () => {
      expect(typeof up).toBe('function');
    });
  });

  describe('user_settings migration', () => {
    it('should remove zai from llmApiKeys', async () => {
      // Seed user_settings with zai key
      const collection = fakeFirestore.collection('user_settings');
      await collection.doc('user1').set({
        userId: 'user1',
        llmApiKeys: {
          google: { encrypted: 'abc' },
          zai: { encrypted: 'secret' },
        },
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('user1').get();
      const data = doc.data();

      expect(data?.llmApiKeys).toBeDefined();
      expect(data?.llmApiKeys.zai).toBeUndefined();
      expect(data?.llmApiKeys.google).toBeDefined();
    });

    it('should remove zai from llmTestResults', async () => {
      const collection = fakeFirestore.collection('user_settings');
      await collection.doc('user2').set({
        userId: 'user2',
        llmTestResults: {
          google: { status: 'success', message: 'OK', testedAt: '2026-01-01' },
          zai: { status: 'failure', message: 'Error', testedAt: '2026-01-01' },
        },
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('user2').get();
      const data = doc.data();

      expect(data?.llmTestResults).toBeDefined();
      expect(data?.llmTestResults.zai).toBeUndefined();
      expect(data?.llmTestResults.google).toBeDefined();
    });

    it('should change glm-4.7 default model to gemini-2.5-flash', async () => {
      const collection = fakeFirestore.collection('user_settings');
      await collection.doc('user3').set({
        userId: 'user3',
        llmPreferences: {
          defaultModel: 'glm-4.7',
        },
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('user3').get();
      const data = doc.data();

      expect(data?.llmPreferences?.defaultModel).toBe('gemini-2.5-flash');
    });

    it('should change glm-4.7-flash default model to gemini-2.5-flash', async () => {
      const collection = fakeFirestore.collection('user_settings');
      await collection.doc('user4').set({
        userId: 'user4',
        llmPreferences: {
          defaultModel: 'glm-4.7-flash',
        },
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('user4').get();
      const data = doc.data();

      expect(data?.llmPreferences?.defaultModel).toBe('gemini-2.5-flash');
    });

    it('should not change other models', async () => {
      const collection = fakeFirestore.collection('user_settings');
      await collection.doc('user5').set({
        userId: 'user5',
        llmPreferences: {
          defaultModel: 'gemini-2.5-flash',
        },
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('user5').get();
      const data = doc.data();

      expect(data?.llmPreferences?.defaultModel).toBe('gemini-2.5-flash');
    });
  });

  describe('code_tasks migration', () => {
    it('should change workerType from glm to glm-5', async () => {
      const collection = fakeFirestore.collection('code_tasks');
      await collection.doc('task1').set({
        userId: 'user1',
        workerType: 'glm',
        status: 'completed',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('task1').get();
      const data = doc.data();

      expect(data?.workerType).toBe('glm-5');
    });

    it('should not change other worker types', async () => {
      const collection = fakeFirestore.collection('code_tasks');
      await collection.doc('task2').set({
        userId: 'user1',
        workerType: 'opus',
        status: 'completed',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('task2').get();
      const data = doc.data();

      expect(data?.workerType).toBe('opus');
    });
  });

  describe('llm_pricing deletion', () => {
    it('should delete zai provider document', async () => {
      const collection = fakeFirestore.collection('settings/llm_pricing/providers');
      await collection.doc('zai').set({
        provider: 'zai',
        models: { 'glm-4.7': { inputPricePerMillion: 1.0 } },
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('zai').get();
      expect(doc.exists).toBe(false);
    });

    it('should handle missing zai document gracefully', async () => {
      // No zai document seeded
      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      const result = await up(context);

      expect(result.zaiPricing.zaiPricingDeleted).toBe(false);
    });
  });

  describe('researches migration', () => {
    it('should remove glm-4.7 from selectedModels', async () => {
      const collection = fakeFirestore.collection('researches');
      await collection.doc('research1').set({
        userId: 'user1',
        selectedModels: ['glm-4.7', 'gemini-2.5-flash'],
        synthesisModel: 'gemini-2.5-flash',
        llmResults: [],
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('research1').get();
      const data = doc.data();

      expect(data?.selectedModels).toEqual(['gemini-2.5-flash']);
    });

    it('should remove glm-4.7 from llmResults', async () => {
      const collection = fakeFirestore.collection('researches');
      await collection.doc('research2').set({
        userId: 'user1',
        selectedModels: ['gemini-2.5-flash'],
        synthesisModel: 'gemini-2.5-flash',
        llmResults: [
          { provider: 'google', model: 'gemini-2.5-flash', status: 'completed' },
          { provider: 'zai', model: 'glm-4.7', status: 'completed' },
        ],
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('research2').get();
      const data = doc.data();

      expect(data?.llmResults).toHaveLength(1);
      expect(data?.llmResults[0].model).toBe('gemini-2.5-flash');
    });

    it('should delete research when synthesisModel was glm-4.7', async () => {
      const collection = fakeFirestore.collection('researches');
      await collection.doc('research3').set({
        userId: 'user1',
        selectedModels: ['glm-4.7'],
        synthesisModel: 'glm-4.7',
        llmResults: [],
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      const result = await up(context);

      // Verify the migration correctly identified and marked the document for deletion
      expect(result.researches.researchesDeleted).toBe(1);
    });

    it('should delete research when selectedModels becomes empty', async () => {
      const collection = fakeFirestore.collection('researches');
      await collection.doc('research4').set({
        userId: 'user1',
        selectedModels: ['glm-4.7'],
        synthesisModel: 'gemini-2.5-flash',
        llmResults: [],
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      const result = await up(context);

      // Verify the migration correctly identified and marked the document for deletion
      expect(result.researches.researchesDeleted).toBe(1);
    });

    it('should not modify research with no glm-4.7 references', async () => {
      const collection = fakeFirestore.collection('researches');
      await collection.doc('research5').set({
        userId: 'user1',
        selectedModels: ['gemini-2.5-flash', 'claude-3-5-haiku-20241022'],
        synthesisModel: 'gemini-2.5-flash',
        llmResults: [{ provider: 'google', model: 'gemini-2.5-flash', status: 'completed' }],
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('research5').get();
      const data = doc.data();

      expect(data?.selectedModels).toEqual(['gemini-2.5-flash', 'claude-3-5-haiku-20241022']);
      expect(data?.synthesisModel).toBe('gemini-2.5-flash');
    });
  });

  describe('idempotency', () => {
    it('should handle multiple up calls safely', async () => {
      const collection = fakeFirestore.collection('user_settings');
      await collection.doc('user1').set({
        userId: 'user1',
        llmApiKeys: {
          zai: { encrypted: 'secret' },
        },
        llmPreferences: {
          defaultModel: 'glm-4.7',
        },
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };

      // Run migration twice
      await up(context);
      await up(context);

      const doc = await collection.doc('user1').get();
      const data = doc.data();

      // After second run, zai should still be removed
      expect(data?.llmApiKeys?.zai).toBeUndefined();
      expect(data?.llmPreferences?.defaultModel).toBe('gemini-2.5-flash');
    });
  });

  describe('empty collections', () => {
    it('should handle empty user_settings collection', async () => {
      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      const result = await up(context);

      expect(result.userSettings.userSettingsModified).toBe(0);
    });

    it('should handle empty code_tasks collection', async () => {
      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      const result = await up(context);

      expect(result.codeTasks.codeTasksModified).toBe(0);
    });

    it('should handle empty researches collection', async () => {
      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      const result = await up(context);

      expect(result.researches.researchesModified).toBe(0);
    });
  });
});
