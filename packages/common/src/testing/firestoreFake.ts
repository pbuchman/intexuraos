/**
 * Fake Firestore implementation for testing.
 * Provides an in-memory Firestore-like interface for unit tests.
 *
 * Usage:
 *   import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/common';
 *
 *   beforeEach(() => {
 *     const fake = createFakeFirestore();
 *     setFirestore(fake as unknown as Firestore);
 *   });
 *
 *   afterEach(() => {
 *     resetFirestore();
 *   });
 */

import type { WriteResult, DocumentData, CollectionReference } from '@google-cloud/firestore';

/**
 * In-memory document storage.
 */
type DocumentStore = Map<string, Map<string, DocumentData>>;

/**
 * Fake DocumentSnapshot implementation.
 */
class FakeDocumentSnapshot {
  constructor(
    private readonly _id: string,
    private readonly _data: DocumentData | undefined,
    private readonly _exists: boolean
  ) {}

  get id(): string {
    return this._id;
  }

  get exists(): boolean {
    return this._exists;
  }

  data(): DocumentData | undefined {
    return this._data;
  }
}

/**
 * Fake QuerySnapshot implementation.
 */
class FakeQuerySnapshot {
  constructor(private readonly _docs: FakeDocumentSnapshot[]) {}

  get docs(): FakeDocumentSnapshot[] {
    return this._docs;
  }

  get empty(): boolean {
    return this._docs.length === 0;
  }

  get size(): number {
    return this._docs.length;
  }
}

/**
 * Fake Query implementation with chainable methods.
 */
class FakeQuery {
  private filters: { field: string; op: string; value: unknown }[] = [];
  private ordering: { field: string; direction: 'asc' | 'desc' }[] = [];
  private limitCount: number | null = null;
  private startAfterValue: unknown = null;

  constructor(
    private readonly collectionName: string,
    private readonly store: DocumentStore
  ) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    const query = this.clone();
    query.filters.push({ field, op, value });
    return query;
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): FakeQuery {
    const query = this.clone();
    query.ordering.push({ field, direction });
    return query;
  }

  limit(count: number): FakeQuery {
    const query = this.clone();
    query.limitCount = count;
    return query;
  }

  startAfter(value: unknown): FakeQuery {
    const query = this.clone();
    query.startAfterValue = value;
    return query;
  }

  get(): Promise<FakeQuerySnapshot> {
    const collection = this.store.get(this.collectionName) ?? new Map<string, DocumentData>();
    let docs = Array.from(collection.entries()).map(
      ([id, data]: [string, DocumentData | undefined]) => new FakeDocumentSnapshot(id, data, true)
    );

    // Apply filters
    for (const filter of this.filters) {
      docs = docs.filter((doc) => {
        const data = doc.data();
        if (data === undefined) return false;
        const fieldValue: unknown = data[filter.field];
        switch (filter.op) {
          case '==':
            return fieldValue === filter.value;
          case '!=':
            return fieldValue !== filter.value;
          case '<':
            return (fieldValue as number) < (filter.value as number);
          case '<=':
            return (fieldValue as number) <= (filter.value as number);
          case '>':
            return (fieldValue as number) > (filter.value as number);
          case '>=':
            return (fieldValue as number) >= (filter.value as number);
          case 'array-contains':
            return Array.isArray(fieldValue) && fieldValue.includes(filter.value);
          default:
            return true;
        }
      });
    }

    // Apply ordering
    if (this.ordering.length > 0) {
      docs.sort((a, b) => {
        for (const order of this.ordering) {
          const aData = a.data();
          const bData = b.data();
          const aVal: unknown = aData?.[order.field];
          const bVal: unknown = bData?.[order.field];
          if (aVal === bVal) continue;
          // Compare values as numbers or strings
          const aNum = typeof aVal === 'number' ? aVal : 0;
          const bNum = typeof bVal === 'number' ? bVal : 0;
          const cmp = aNum < bNum ? -1 : 1;
          return order.direction === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }

    // Apply startAfter
    if (this.startAfterValue !== null && this.ordering.length > 0) {
      const orderField = this.ordering[0]?.field;
      if (orderField !== undefined) {
        const startIndex = docs.findIndex((doc) => {
          const data = doc.data();
          return data?.[orderField] === this.startAfterValue;
        });
        if (startIndex >= 0) {
          docs = docs.slice(startIndex + 1);
        }
      }
    }

    // Apply limit
    if (this.limitCount !== null) {
      docs = docs.slice(0, this.limitCount);
    }

    return Promise.resolve(new FakeQuerySnapshot(docs));
  }

  private clone(): FakeQuery {
    const query = new FakeQuery(this.collectionName, this.store);
    query.filters = [...this.filters];
    query.ordering = [...this.ordering];
    query.limitCount = this.limitCount;
    query.startAfterValue = this.startAfterValue;
    return query;
  }
}

/**
 * Fake DocumentReference implementation.
 */
class FakeDocumentReference {
  constructor(
    private readonly collectionName: string,
    private readonly docId: string,
    private readonly store: DocumentStore
  ) {}

  get id(): string {
    return this.docId;
  }

  get(): Promise<FakeDocumentSnapshot> {
    const collection = this.store.get(this.collectionName);
    const data = collection?.get(this.docId);
    return Promise.resolve(new FakeDocumentSnapshot(this.docId, data, data !== undefined));
  }

  set(data: DocumentData): Promise<WriteResult> {
    let collection = this.store.get(this.collectionName);
    if (collection === undefined) {
      collection = new Map();
      this.store.set(this.collectionName, collection);
    }
    collection.set(this.docId, { ...data });
    return Promise.resolve({ writeTime: { toDate: (): Date => new Date() } } as WriteResult);
  }

  update(data: Partial<DocumentData>): Promise<WriteResult> {
    const collection = this.store.get(this.collectionName);
    const existing = collection?.get(this.docId);
    if (existing === undefined) {
      throw new Error(`Document ${this.collectionName}/${this.docId} does not exist`);
    }
    collection?.set(this.docId, { ...existing, ...data });
    return Promise.resolve({ writeTime: { toDate: (): Date => new Date() } } as WriteResult);
  }

  delete(): Promise<WriteResult> {
    const collection = this.store.get(this.collectionName);
    collection?.delete(this.docId);
    return Promise.resolve({ writeTime: { toDate: (): Date => new Date() } } as WriteResult);
  }
}

/**
 * Fake CollectionReference implementation.
 */
class FakeCollectionReference extends FakeQuery {
  private docCounter = 0;

  constructor(collectionName: string, store: DocumentStore) {
    super(collectionName, store);
    this.collectionNameInternal = collectionName;
    this.storeInternal = store;
  }

  private collectionNameInternal: string;
  private storeInternal: DocumentStore;

  doc(docId?: string): FakeDocumentReference {
    const id = docId ?? `auto-${String(++this.docCounter)}`;
    return new FakeDocumentReference(this.collectionNameInternal, id, this.storeInternal);
  }
}

/**
 * Configuration for fake Firestore behavior.
 */
export interface FakeFirestoreConfig {
  /** If set, all operations will throw this error */
  errorToThrow?: Error;
}

/**
 * Fake Firestore implementation.
 */
class FakeFirestoreImpl {
  private readonly store: DocumentStore = new Map();
  private config: FakeFirestoreConfig = {};

  collection(name: string): FakeCollectionReference {
    if (this.config.errorToThrow !== undefined) {
      throw this.config.errorToThrow;
    }
    return new FakeCollectionReference(name, this.store);
  }

  /**
   * Configure fake behavior.
   */
  configure(config: FakeFirestoreConfig): void {
    this.config = config;
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.store.clear();
    this.config = {};
  }

  /**
   * Get all data for inspection.
   */
  getAllData(): Map<string, Map<string, DocumentData>> {
    return new Map(this.store);
  }

  /**
   * Seed data for testing.
   */
  seedCollection(collectionName: string, docs: { id: string; data: DocumentData }[]): void {
    let collection = this.store.get(collectionName);
    if (collection === undefined) {
      collection = new Map();
      this.store.set(collectionName, collection);
    }
    for (const doc of docs) {
      collection.set(doc.id, doc.data);
    }
  }

  /**
   * Stub for listCollections (used in health checks).
   */
  listCollections(): Promise<CollectionReference[]> {
    if (this.config.errorToThrow !== undefined) {
      throw this.config.errorToThrow;
    }
    return Promise.resolve([]);
  }
}

/**
 * Create a new fake Firestore instance.
 * Cast to Firestore when passing to setFirestore().
 */
export function createFakeFirestore(): FakeFirestoreImpl {
  return new FakeFirestoreImpl();
}

/**
 * Type alias for the fake Firestore for use in tests.
 */
export type FakeFirestore = FakeFirestoreImpl;
