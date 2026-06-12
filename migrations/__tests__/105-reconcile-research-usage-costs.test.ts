import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  metadata,
  reconcileResearchUsageCosts,
  up,
} from '../105_reconcile-research-usage-costs.mjs'; // @allow-missing-js -- .mjs import

type DocData = Record<string, unknown>;
type Store = Map<string, Map<string, DocData>>;

function getByPath(data: DocData, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, data);
}

class FakeDocRef {
  constructor(
    private readonly collectionName: string,
    private readonly docId: string,
    private readonly store: Store
  ) {}

  get id(): string {
    return this.docId;
  }

  async get(): Promise<FakeDocSnapshot> {
    const data = this.store.get(this.collectionName)?.get(this.docId);
    return new FakeDocSnapshot(this.collectionName, this.docId, data, this.store);
  }

  async set(data: DocData): Promise<void> {
    let collection = this.store.get(this.collectionName);
    if (collection === undefined) {
      collection = new Map();
      this.store.set(this.collectionName, collection);
    }
    collection.set(this.docId, { ...data });
  }

  async update(data: DocData): Promise<void> {
    const collection = this.store.get(this.collectionName);
    const existing = collection?.get(this.docId);
    if (existing === undefined) {
      throw new Error(`Missing document ${this.collectionName}/${this.docId}`);
    }
    collection?.set(this.docId, { ...existing, ...data });
  }
}

class FakeDocSnapshot {
  constructor(
    private readonly collectionName: string,
    private readonly docId: string,
    private readonly docData: DocData | undefined,
    private readonly store: Store
  ) {}

  get id(): string {
    return this.docId;
  }

  data(): DocData {
    return this.docData ?? {};
  }

  get ref(): FakeDocRef {
    return new FakeDocRef(this.collectionName, this.docId, this.store);
  }
}

class FakeQuery {
  constructor(
    protected readonly collectionName: string,
    protected readonly store: Store,
    private readonly filters: { field: string; op: string; value: unknown }[] = []
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.collectionName, this.store, [...this.filters, { field, op, value }]);
  }

  async get(): Promise<{ docs: FakeDocSnapshot[] }> {
    const entries = Array.from(this.store.get(this.collectionName)?.entries() ?? []);
    const docs = entries
      .filter(([_id, data]) =>
        this.filters.every((filter) => {
          if (filter.op !== '==') return false;
          return getByPath(data, filter.field) === filter.value;
        })
      )
      .map(([id, data]) => new FakeDocSnapshot(this.collectionName, id, data, this.store));

    return { docs };
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(collectionName: string, store: Store) {
    super(collectionName, store);
  }

  doc(docId: string): FakeDocRef {
    return new FakeDocRef(this.collectionName, docId, this.store);
  }
}

class FakeFirestore {
  private readonly store: Store = new Map();

  collection(name: string): FakeCollectionRef {
    if (!this.store.has(name)) {
      this.store.set(name, new Map());
    }
    return new FakeCollectionRef(name, this.store);
  }

  async seed(collectionName: string, docId: string, data: DocData): Promise<void> {
    await this.collection(collectionName).doc(docId).set(data);
  }

  getDoc(collectionName: string, docId: string): DocData | undefined {
    return this.store.get(collectionName)?.get(docId);
  }
}

describe('migration 105 - reconcile research usage costs', () => {
  let firestore: FakeFirestore;

  beforeEach(() => {
    firestore = new FakeFirestore();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '105',
      name: 'reconcile-research-usage-costs',
      description: 'Backfill zero research totals from correlated llm_usage_events',
      createdAt: '2026-05-06',
    });
  });

  it('backfills zero-cost completed researches from correlated usage events', async () => {
    await firestore.seed('researches', 'research-1', {
      id: 'research-1',
      userId: 'user-1',
      status: 'completed',
      totalCostUsd: 0,
    });
    await firestore.seed('llm_usage_events', 'evt-1', {
      owner: { id: 'user-1' },
      correlation: { researchId: 'research-1' },
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, imageCount: 0 },
      cost: { billedUsd: 0.03 },
    });
    await firestore.seed('llm_usage_events', 'evt-2', {
      owner: { id: 'user-1' },
      correlation: { researchId: 'research-1' },
      usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70, imageCount: 1 },
      cost: { billedUsd: 0.02 },
    });

    const result = await reconcileResearchUsageCosts({
      firestore: firestore as unknown,
    });

    const research = firestore.getDoc('researches', 'research-1');
    expect(result).toMatchObject({ scanned: 1, updated: 1 });
    expect(research?.['totalCostUsd']).toBeCloseTo(0.05, 6);
    expect(research?.['totalInputTokens']).toBe(150);
    expect(research?.['totalOutputTokens']).toBe(60);
    expect(research?.['usageCostReconciliation']).toMatchObject({
      migrationId: '105',
      eventCount: 2,
      totalTokens: 210,
      imageCount: 1,
    });
  });

  it('does not overwrite completed researches that already have a nonzero cost', async () => {
    await firestore.seed('researches', 'research-1', {
      id: 'research-1',
      userId: 'user-1',
      status: 'completed',
      totalCostUsd: 0.44,
    });
    await firestore.seed('llm_usage_events', 'evt-1', {
      owner: { id: 'user-1' },
      correlation: { researchId: 'research-1' },
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, imageCount: 0 },
      cost: { billedUsd: 0.03 },
    });

    const result = await reconcileResearchUsageCosts({
      firestore: firestore as unknown,
    });

    const research = firestore.getDoc('researches', 'research-1');
    expect(result).toMatchObject({ scanned: 1, updated: 0, skippedNonZeroCost: 1 });
    expect(research?.['totalCostUsd']).toBe(0.44);
    expect(research?.['usageCostReconciliation']).toBeUndefined();
  });

  it('skips events whose owner does not match the research owner', async () => {
    await firestore.seed('researches', 'research-1', {
      id: 'research-1',
      userId: 'user-1',
      status: 'completed',
      totalCostUsd: 0,
    });
    await firestore.seed('llm_usage_events', 'evt-1', {
      owner: { id: 'other-user' },
      correlation: { researchId: 'research-1' },
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, imageCount: 0 },
      cost: { billedUsd: 0.03 },
    });

    const result = await reconcileResearchUsageCosts({
      firestore: firestore as unknown,
    });

    const research = firestore.getDoc('researches', 'research-1');
    expect(result).toMatchObject({
      scanned: 1,
      updated: 0,
      skippedNoAttributedCost: 1,
      skippedOwnerMismatchEvents: 1,
    });
    expect(research?.['totalCostUsd']).toBe(0);
  });

  it('uses document id when the research payload has no id field', async () => {
    await firestore.seed('researches', 'research-1', {
      userId: 'user-1',
      status: 'completed',
      totalCostUsd: 0,
    });
    await firestore.seed('llm_usage_events', 'evt-1', {
      owner: { id: 'user-1' },
      correlation: { researchId: 'research-1' },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, imageCount: 0 },
      cost: { billedUsd: 0.01 },
    });

    await up({ firestore: firestore as unknown });

    expect(firestore.getDoc('researches', 'research-1')?.['totalCostUsd']).toBe(0.01);
  });
});
