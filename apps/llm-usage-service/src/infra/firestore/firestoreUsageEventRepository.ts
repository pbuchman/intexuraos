import { err, ok, type Result } from '@intexuraos/common-core';
import { getFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { decodeCursor, encodeCursor } from '../../domain/models/cursor.js';
import type { UsageEvent } from '../../domain/models/usageEvent.js';
import type {
  CreateEventResult,
  ListUsageEventsParams,
  ListUsageEventsResult,
  UsageEventFilters,
  UsageEventRepository,
} from '../../domain/repositories/usageEventRepository.js';

const COLLECTION = 'llm_usage_events';

type FirestoreQuery = ReturnType<ReturnType<Firestore['collection']>['where']>;

const SORT_FIELD_MAP: Record<string, string> = {
  occurredAt: 'occurredAt',
  costUsd: 'cost.billedUsd',
  totalTokens: 'usage.totalTokens',
};

interface FilterMapping {
  readonly filterKey: keyof UsageEventFilters;
  readonly firestoreField: string;
}

const ARRAY_FILTER_MAPPINGS: readonly FilterMapping[] = [
  { filterKey: 'services', firestoreField: 'source.service' },
  { filterKey: 'components', firestoreField: 'source.component' },
  { filterKey: 'clients', firestoreField: 'source.client' },
  { filterKey: 'providers', firestoreField: 'request.provider' },
  { filterKey: 'models', firestoreField: 'request.model' },
  { filterKey: 'operations', firestoreField: 'request.operation' },
  { filterKey: 'ownerIds', firestoreField: 'owner.id' },
  { filterKey: 'ownerTypes', firestoreField: 'owner.type' },
];

export class FirestoreUsageEventRepository implements UsageEventRepository {
  async createEvent(event: UsageEvent): Promise<Result<CreateEventResult, { code: string; message: string }>> {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION).doc(event.eventId);

    try {
      await docRef.create(event);
      return ok({ status: 'created' as const });
    } catch (error: unknown) {
      const firestoreError = error as { code?: number; message?: string };
      if (firestoreError.code === 6) {
        return ok({ status: 'duplicate' as const });
      }
      return err({
        code: String(firestoreError.code ?? 'UNKNOWN'),
        message: firestoreError.message ?? 'Unknown Firestore error',
      });
    }
  }

  async list(params: ListUsageEventsParams): Promise<Result<ListUsageEventsResult, { code: string; message: string }>> {
    const db = getFirestore();

    try {
      // Build base query with time range
      let query: FirestoreQuery = db
        .collection(COLLECTION)
        .where('occurredAt', '>=', params.timeRange.from)
        .where('occurredAt', '<=', params.timeRange.to);

      // Apply filters
      query = applyFilters(query, params.filters);

      // Determine sort
      const sortField = SORT_FIELD_MAP[params.sortBy?.field ?? 'occurredAt'] ?? 'occurredAt';
      const sortDirection = params.sortBy?.direction ?? 'desc';

      // Count query (same where clauses, no ordering/limit)
      const countSnapshot = await query.count().get();
      const totalMatched = countSnapshot.data().count;

      // Apply ordering
      query = query.orderBy(sortField, sortDirection).orderBy('__name__', sortDirection);

      // Apply cursor
      if (params.cursor !== undefined) {
        const decoded = decodeCursor(params.cursor);
        if (decoded !== null) {
          query = query.startAfter(decoded.lastOccurredAt, decoded.lastEventId);
        }
      }

      // Fetch limit + 1 to detect next page
      const fetchLimit = params.limit + 1;
      query = query.limit(fetchLimit);

      const snapshot = await query.get();
      const docs = snapshot.docs;
      const hasMore = docs.length > params.limit;
      const resultDocs = hasMore ? docs.slice(0, params.limit) : docs;

      const events = resultDocs.map((doc) => doc.data() as UsageEvent);

      const result: ListUsageEventsResult = {
        events,
        totalMatched,
      };

      if (hasMore && events.length > 0) {
        const lastEvent = events[events.length - 1];
        if (lastEvent !== undefined) {
          result.nextCursor = encodeCursor(lastEvent.occurredAt, lastEvent.eventId);
        }
      }

      return ok(result);
    } catch (error: unknown) {
      const firestoreError = error as { code?: number; message?: string };
      return err({
        code: String(firestoreError.code ?? 'UNKNOWN'),
        message: firestoreError.message ?? 'Unknown Firestore error',
      });
    }
  }

  async getById(eventId: string): Promise<Result<UsageEvent | null, { code: string; message: string }>> {
    const db = getFirestore();

    try {
      const snapshot = await db.collection(COLLECTION).doc(eventId).get();

      if (!snapshot.exists) {
        return ok(null);
      }

      return ok(snapshot.data() as UsageEvent);
    } catch (error: unknown) {
      const firestoreError = error as { code?: number; message?: string };
      return err({
        code: String(firestoreError.code ?? 'UNKNOWN'),
        message: firestoreError.message ?? 'Unknown Firestore error',
      });
    }
  }
}

function applyFilters(query: FirestoreQuery, filters: UsageEventFilters | undefined): FirestoreQuery {
  if (filters === undefined) {
    return query;
  }

  let q = query;

  for (const mapping of ARRAY_FILTER_MAPPINGS) {
    const values = filters[mapping.filterKey];
    if (values !== undefined && Array.isArray(values) && values.length > 0) {
      q = q.where(mapping.firestoreField, 'in', values);
    }
  }

  if (filters.success !== undefined) {
    q = q.where('request.success', '==', filters.success);
  }

  return q;
}
