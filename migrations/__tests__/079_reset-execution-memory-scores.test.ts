/**
 * Tests for migration 079: Reset execution memory scores
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { metadata, up } from '../079_reset-execution-memory-scores.mjs'; // @allow-missing-js -- importing .mjs file directly

// Mock console.log during tests to prevent stdout noise
let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  logSpy?.mockRestore();
});

// Mock firebase-admin/firestore to provide FieldValue
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: function () {
      return { __fieldValueDelete: true, isEqual: () => true };
    },
    serverTimestamp: function () {
      return { __fieldValueServerTimestamp: true, isEqual: () => true };
    },
  },
}));

// Minimal fake Firestore implementation for testing batch-based migrations
class FakeDocRef {
  constructor(
    private collectionName: string,
    private docId: string,
    private store: Map<string, Map<string, unknown>>
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
      // Handle FieldValue.delete() - check for sentinel
      if (value && typeof value === 'object' && '__fieldValueDelete' in value) {
        delete updated[key];
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
    return new FakeDocRef(this._collectionName, this._id, this._store);
  }
}

class FakeCollectionRef {
  constructor(
    private collectionName: string,
    private store: Map<string, Map<string, unknown>>,
    private docCounter = { value: 0 }
  ) {}

  doc(docId?: string) {
    const id = docId ?? `auto-${String(++this.docCounter.value)}`;
    return new FakeDocRef(this.collectionName, id, this.store);
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

  batch() {
    const operations: (() => Promise<unknown>)[] = [];
    return {
      update: (ref: FakeDocRef, data: Record<string, unknown>) => {
        operations.push(() => ref.update(data));
      },
      commit: async () => {
        for (const op of operations) {
          await op();
        }
        operations.length = 0;
        return [];
      },
    };
  }
}

describe('079_reset-execution-memory-scores migration', () => {
  let fakeFirestore: FakeFirestore;

  beforeEach(() => {
    fakeFirestore = new FakeFirestore();
  });

  describe('metadata', () => {
    it('should have correct metadata structure', () => {
      expect(metadata).toMatchObject({
        id: '079',
        name: 'reset-execution-memory-scores',
        createdAt: '2026-04-05',
      });
    });

    it('should have sequential ID', () => {
      expect(Number.parseInt(metadata.id, 10)).toBe(79);
    });
  });

  describe('empty collection', () => {
    it('should return early when no execution memories exist', async () => {
      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      // Should log the empty message
      expect(logSpy).toHaveBeenCalledWith('  No execution memories found — nothing to reset.');
    });
  });

  describe('score resetting', () => {
    it('should reset all scoring counters to zero', async () => {
      const collection = fakeFirestore.collection('execution_memories');
      await collection.doc('mem1').set({
        distillationConfidence: 0.8,
        applicationCount: 10,
        positiveCount: 5,
        negativeCount: 3,
        qualityScore: 0.2,
        status: 'active',
        lastAppliedAt: '2026-04-01',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('mem1').get();
      const data = doc.data() as Record<string, unknown>;

      expect(data.applicationCount).toBe(0);
      expect(data.positiveCount).toBe(0);
      expect(data.negativeCount).toBe(0);
    });

    it('should recompute qualityScore from distillationConfidence', async () => {
      const collection = fakeFirestore.collection('execution_memories');
      await collection.doc('mem1').set({
        distillationConfidence: 0.8,
        applicationCount: 10,
        positiveCount: 5,
        negativeCount: 3,
        qualityScore: 0.2,
        status: 'active',
        lastAppliedAt: '2026-04-01',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('mem1').get();
      const data = doc.data() as Record<string, unknown>;

      // freshQualityScore = (0.5 * 0.5) + (0.3 * 0.8) + (0.2 * 1.0) = 0.25 + 0.24 + 0.2 = 0.69
      expect(data.qualityScore).toBeCloseTo(0.69, 10);
    });

    it('should delete lastAppliedAt for maximum recency score', async () => {
      const collection = fakeFirestore.collection('execution_memories');
      await collection.doc('mem1').set({
        distillationConfidence: 0.7,
        applicationCount: 5,
        positiveCount: 2,
        negativeCount: 1,
        qualityScore: 0.3,
        status: 'active',
        lastAppliedAt: '2026-04-01',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('mem1').get();
      const data = doc.data() as Record<string, unknown>;

      expect(data.lastAppliedAt).toBeUndefined();
    });

    it('should set status to active for all memories', async () => {
      const collection = fakeFirestore.collection('execution_memories');
      await collection.doc('mem1').set({
        distillationConfidence: 0.6,
        applicationCount: 0,
        positiveCount: 0,
        negativeCount: 0,
        qualityScore: 0.5,
        status: 'active',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('mem1').get();
      const data = doc.data() as Record<string, unknown>;

      expect(data.status).toBe('active');
    });
  });

  describe('distillationConfidence fallback', () => {
    it('should fall back to 0.5 when distillationConfidence is missing', async () => {
      const collection = fakeFirestore.collection('execution_memories');
      await collection.doc('mem1').set({
        applicationCount: 3,
        positiveCount: 1,
        negativeCount: 2,
        qualityScore: 0.1,
        status: 'active',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('mem1').get();
      const data = doc.data() as Record<string, unknown>;

      // freshQualityScore = (0.5 * 0.5) + (0.3 * 0.5) + (0.2 * 1.0) = 0.25 + 0.15 + 0.2 = 0.6
      expect(data.qualityScore).toBeCloseTo(0.6, 10);
    });

    it('should fall back to 0.5 when distillationConfidence is not a number', async () => {
      const collection = fakeFirestore.collection('execution_memories');
      await collection.doc('mem1').set({
        distillationConfidence: 'invalid',
        applicationCount: 1,
        positiveCount: 0,
        negativeCount: 1,
        qualityScore: 0.2,
        status: 'active',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('mem1').get();
      const data = doc.data() as Record<string, unknown>;

      // Falls back to 0.5: (0.5*0.5) + (0.3*0.5) + (0.2*1.0) = 0.6
      expect(data.qualityScore).toBeCloseTo(0.6, 10);
    });
  });

  describe('suppressed memory reactivation', () => {
    it('should reactivate suppressed memories to active', async () => {
      const collection = fakeFirestore.collection('execution_memories');
      await collection.doc('mem1').set({
        distillationConfidence: 0.9,
        applicationCount: 20,
        positiveCount: 2,
        negativeCount: 18,
        qualityScore: 0.05,
        status: 'suppressed',
        lastAppliedAt: '2026-03-01',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      const doc = await collection.doc('mem1').get();
      const data = doc.data() as Record<string, unknown>;

      expect(data.status).toBe('active');
    });

    it('should track reactivated count in log output', async () => {
      const collection = fakeFirestore.collection('execution_memories');
      await collection.doc('mem1').set({
        distillationConfidence: 0.7,
        status: 'suppressed',
        applicationCount: 5,
        positiveCount: 0,
        negativeCount: 5,
        qualityScore: 0.1,
      });
      await collection.doc('mem2').set({
        distillationConfidence: 0.8,
        status: 'active',
        applicationCount: 3,
        positiveCount: 2,
        negativeCount: 1,
        qualityScore: 0.5,
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      expect(logSpy).toHaveBeenCalledWith('  Reset 2 memories (1 reactivated from suppressed).');
    });
  });

  describe('batch processing', () => {
    it('should handle more documents than batch size', async () => {
      const collection = fakeFirestore.collection('execution_memories');

      // Create 502 documents to trigger batch boundary (batchSize = 500)
      for (let i = 0; i < 502; i++) {
        await collection.doc(`mem${String(i)}`).set({
          distillationConfidence: 0.7,
          applicationCount: i,
          positiveCount: 0,
          negativeCount: 0,
          qualityScore: 0.3,
          status: 'active',
        });
      }

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };
      await up(context);

      // Verify all 502 documents were reset
      const snapshot = await collection.get();
      for (const doc of snapshot.docs) {
        const data = doc.data() as Record<string, unknown>;
        expect(data.applicationCount).toBe(0);
      }

      expect(logSpy).toHaveBeenCalledWith('  Reset 502 memories (0 reactivated from suppressed).');
    });
  });

  describe('idempotency', () => {
    it('should produce the same result when run twice', async () => {
      const collection = fakeFirestore.collection('execution_memories');
      await collection.doc('mem1').set({
        distillationConfidence: 0.75,
        applicationCount: 10,
        positiveCount: 5,
        negativeCount: 5,
        qualityScore: 0.3,
        status: 'suppressed',
        lastAppliedAt: '2026-03-15',
      });

      const context = {
        firestore: fakeFirestore as unknown as import('@google-cloud/firestore').Firestore,
      };

      // Run migration twice
      await up(context);
      await up(context);

      const doc = await collection.doc('mem1').get();
      const data = doc.data() as Record<string, unknown>;

      expect(data.applicationCount).toBe(0);
      expect(data.positiveCount).toBe(0);
      expect(data.negativeCount).toBe(0);
      expect(data.status).toBe('active');
      expect(data.lastAppliedAt).toBeUndefined();
      // freshQualityScore = (0.5*0.5) + (0.3*0.75) + (0.2*1.0) = 0.25 + 0.225 + 0.2 = 0.675
      expect(data.qualityScore).toBeCloseTo(0.675, 10);
    });
  });
});
