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

import type { CollectionReference, DocumentData, WriteResult } from '@google-cloud/firestore';

/**
 * In-memory document storage.
 */
type DocumentStore = Map<string, Map<string, DocumentData>>;

/**
 * Check if a value is a FieldValue.delete() sentinel.
 * The actual FieldValue.delete() returns an object with isEqual method.
 */
function isFieldValueDelete(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return 'isEqual' in value && typeof (value as { isEqual: unknown }).isEqual === 'function';
}

/**
 * Set a nested field using dot notation (e.g., "llmApiKeys.google").
 */
function setNestedField(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === undefined) continue;
    if (current[key] === undefined || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  if (lastKey !== undefined) {
    current[lastKey] = value;
  }
}

/**
 * Delete a nested field using dot notation (e.g., "llmApiKeys.google").
 */
function deleteNestedField(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === undefined) continue;
    if (current[key] === undefined || typeof current[key] !== 'object') {
      return;
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  if (lastKey !== undefined) {
    Reflect.deleteProperty(current, lastKey);
  }
}

/**
 * Fake DocumentSnapshot implementation.
 */
class FakeDocumentSnapshot {
  constructor(
    private readonly _id: string,
    private readonly _data: DocumentData | undefined,
    private readonly _exists: boolean,
    private readonly _collectionName: string,
    private readonly _store: DocumentStore
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

  get ref(): FakeDocumentReference {
    return new FakeDocumentReference(this._collectionName, this._id, this._store);
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
      ([id, data]: [string, DocumentData | undefined]) =>
        new FakeDocumentSnapshot(id, data, true, this.collectionName, this.store)
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
    return Promise.resolve(
      new FakeDocumentSnapshot(
        this.docId,
        data,
        data !== undefined,
        this.collectionName,
        this.store
      )
    );
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
    const updated = { ...existing };
    for (const key of Object.keys(data)) {
      const value: unknown = data[key as keyof typeof data];
      if (isFieldValueDelete(value)) {
        if (key.includes('.')) {
          deleteNestedField(updated, key);
        } else {
          Reflect.deleteProperty(updated, key);
        }
      } else if (key.includes('.')) {
        setNestedField(updated, key, value);
      } else {
        (updated as Record<string, unknown>)[key] = value;
      }
    }
    collection?.set(this.docId, updated);
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
  constructor(
    collectionName: string,
    store: DocumentStore,
    private readonly docCounterRef: { value: number }
  ) {
    super(collectionName, store);
    this.collectionNameInternal = collectionName;
    this.storeInternal = store;
  }

  private collectionNameInternal: string;
  private storeInternal: DocumentStore;

  doc(docId?: string): FakeDocumentReference {
    const id = docId ?? `auto-${String(++this.docCounterRef.value)}`;
    return new FakeDocumentReference(this.collectionNameInternal, id, this.storeInternal);
  }

  add(data: DocumentData): Promise<FakeDocumentReference> {
    const docRef = this.doc();
    return docRef.set(data).then(() => docRef);
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
  private readonly docCounter = { value: 0 };

  collection(name: string): FakeCollectionReference {
    if (this.config.errorToThrow !== undefined) {
      throw this.config.errorToThrow;
    }
    return new FakeCollectionReference(name, this.store, this.docCounter);
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

  /**
   * Create a batch for atomic writes.
   */
  batch(): FakeBatch {
    return new FakeBatch();
  }
}

/**
 * Fake WriteBatch implementation.
 */
class FakeBatch {
  private operations: (() => void)[] = [];

  delete(docRef: FakeDocumentReference): this {
    this.operations.push((): void => {
      void docRef.delete();
    });
    return this;
  }

  set(docRef: FakeDocumentReference, data: DocumentData): this {
    this.operations.push((): void => {
      void docRef.set(data);
    });
    return this;
  }

  update(docRef: FakeDocumentReference, data: Partial<DocumentData>): this {
    this.operations.push((): void => {
      void docRef.update(data);
    });
    return this;
  }

  commit(): Promise<WriteResult[]> {
    for (const op of this.operations) {
      op();
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
