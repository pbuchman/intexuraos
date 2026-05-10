import {
  FieldPath,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from '@intexuraos/infra-firestore';

const DEFAULT_BATCH_SIZE = 500;

export interface PaginatedScanOptions {
  batchSize?: number;
}

export async function* paginatedScan<T extends DocumentData>(
  baseQuery: Query<T>,
  options: PaginatedScanOptions = {},
): AsyncGenerator<QueryDocumentSnapshot<T>, void, void> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`Invalid paginated scan batch size: ${String(batchSize)}`);
  }

  let lastDoc: QueryDocumentSnapshot<T> | undefined;

  for (;;) {
    let query = baseQuery.orderBy(FieldPath.documentId()).limit(batchSize);
    if (lastDoc !== undefined) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      return;
    }

    for (const doc of snapshot.docs) {
      yield doc;
    }

    if (snapshot.size < batchSize) {
      return;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    /* v8 ignore start -- upstream: Firestore QuerySnapshot.empty=false guarantees at least one doc; undefined guard is defensive for adapter corruption @preserve */
    if (lastDoc === undefined) {
      return;
    }
    /* v8 ignore stop @preserve */
  }
}
