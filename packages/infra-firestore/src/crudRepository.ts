/**
 * Generic Firestore CRUD repository factory.
 *
 * Most app-level CRUD repositories share the same shape: take a typed entity,
 * map it to a Firestore document, set/get/list/delete by id. Without a shared
 * factory each app reimplements the same five methods, drifts on details
 * (merge vs replace, missing-doc handling, error wrapping), and must be
 * audited individually for correctness.
 *
 * This factory captures the canonical shape; consumers supply only the
 * collection name plus the entity ↔ document mappers.
 *
 * @example
 * ```ts
 * interface Note { id: string; title: string; body: string }
 * const repo = createFirestoreCrudRepository<Note>({
 *   firestore: getFirestore(),
 *   collection: 'notes',
 *   toFirestore: (n) => ({ title: n.title, body: n.body }),
 *   fromFirestore: (id, d) => ({ id, title: String(d.title), body: String(d.body) }),
 * });
 * await repo.create({ id: 'n1', title: 't', body: 'b' });
 * ```
 */
import { FieldPath, type Firestore, type QueryDocumentSnapshot } from '@google-cloud/firestore';

export interface CrudRepositoryOptions<T> {
  firestore: Firestore;
  collection: string;
  /** Map an entity to its Firestore document body. */
  toFirestore: (entity: T) => Record<string, unknown>;
  /** Map a Firestore document (id + raw data) back to an entity. */
  fromFirestore: (id: string, data: Record<string, unknown>) => T;
}

export interface CrudRepository<T extends { id: string }> {
  /** Returns the entity with the given id, or `null` if absent. */
  get: (id: string) => Promise<T | null>;
  /** Returns all entities in the collection. */
  list: () => Promise<T[]>;
  /** Creates or replaces the entity at its id. */
  create: (entity: T) => Promise<void>;
  /** Merges the supplied patch into the document with the given id. */
  update: (id: string, patch: Partial<T>) => Promise<void>;
  /** Deletes the document with the given id (no-op if absent). */
  delete: (id: string) => Promise<void>;
}

const LIST_BATCH_SIZE = 500;

export function createFirestoreCrudRepository<T extends { id: string }>(
  opts: CrudRepositoryOptions<T>
): CrudRepository<T> {
  const { firestore, collection, toFirestore, fromFirestore } = opts;
  return {
    get: async (id: string): Promise<T | null> => {
      const snap = await firestore.collection(collection).doc(id).get();
      if (!snap.exists) {
        return null;
      }
      return fromFirestore(id, (snap.data() ?? {}) as Record<string, unknown>);
    },
    list: async (): Promise<T[]> => {
      const docs: QueryDocumentSnapshot[] = [];
      let lastDoc: QueryDocumentSnapshot | undefined;

      for (;;) {
        let query = firestore
          .collection(collection)
          .orderBy(FieldPath.documentId())
          .limit(LIST_BATCH_SIZE);
        if (lastDoc !== undefined) {
          query = query.startAfter(lastDoc);
        }

        const snap = await query.get();
        if (snap.empty) {
          break;
        }

        docs.push(...snap.docs);
        if (snap.size < LIST_BATCH_SIZE) {
          break;
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        /* v8 ignore start -- upstream: Firestore QuerySnapshot.empty=false guarantees at least one doc; undefined guard is defensive for adapter corruption @preserve */
        if (lastDoc === undefined) {
          break;
        }
        /* v8 ignore stop @preserve */
      }

      return docs.map((d) => fromFirestore(d.id, d.data() as Record<string, unknown>));
    },
    create: async (entity: T): Promise<void> => {
      await firestore.collection(collection).doc(entity.id).set(toFirestore(entity));
    },
    update: async (id: string, patch: Partial<T>): Promise<void> => {
      await firestore
        .collection(collection)
        .doc(id)
        .set(patch as Record<string, unknown>, { merge: true });
    },
    delete: async (id: string): Promise<void> => {
      await firestore.collection(collection).doc(id).delete();
    },
  };
}
