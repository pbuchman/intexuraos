import { err, ok, type Result } from '@intexuraos/common-core';
import { getFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { decodeCursor, encodeCursor } from '../../domain/models/cursor.js';
import type { UsageEvent } from '../../domain/models/usageEvent.js';
import type {
  CreateEventResult,
  ListUsageEventsParams,
  ListUsageEventsResult,
  SortField,
  UsageEventFilters,
  UsageEventRepository,
} from '../../domain/repositories/usageEventRepository.js';

const COLLECTION = 'llm_usage_events';

type FirestoreQuery = ReturnType<ReturnType<Firestore['collection']>['where']>;

const SORT_FIELD_MAP: Record<SortField, string> = {
  occurredAt: 'occurredAt',
  costUsd: 'cost.billedUsd',
  totalTokens: 'usage.totalTokens',
};

interface FilterMapping {
  readonly filterKey: keyof UsageEventFilters;
  readonly firestoreField: string;
  readonly getEventValue: (e: UsageEvent) => string;
}

const ARRAY_FILTER_MAPPINGS: readonly FilterMapping[] = [
  { filterKey: 'services', firestoreField: 'source.service', getEventValue: (e) => e.source.service },
  { filterKey: 'components', firestoreField: 'source.component', getEventValue: (e) => e.source.component },
  { filterKey: 'clients', firestoreField: 'source.client', getEventValue: (e) => e.source.client },
  { filterKey: 'providers', firestoreField: 'request.provider', getEventValue: (e) => e.request.provider },
  { filterKey: 'models', firestoreField: 'request.model', getEventValue: (e) => e.request.model },
  { filterKey: 'operations', firestoreField: 'request.operation', getEventValue: (e) => e.request.operation },
  { filterKey: 'ownerIds', firestoreField: 'owner.id', getEventValue: (e) => e.owner.id },
  { filterKey: 'ownerTypes', firestoreField: 'owner.type', getEventValue: (e) => e.owner.type },
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

      // Apply filters — only the first populated array filter goes to Firestore;
      // remaining array filters are applied in-memory after fetch.
      // See applyFilters() for details on the disjunction-limit guard.
      const { query: filteredQuery, inMemoryFilters } = applyFilters(query, params.filters);
      query = filteredQuery;

      // Determine sort
      // TODO: Composite indexes for costUsd / totalTokens sort fields are created
      // in the Task 3 migration file. They must exist before these routes go live.
      const domainSortField: SortField = params.sortBy?.field ?? 'occurredAt';
      const sortField = SORT_FIELD_MAP[domainSortField];
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
          query = query.startAfter(decoded.lastSortValue, decoded.lastEventId);
        }
      }

      // Fetch limit + 1 to detect next page
      const fetchLimit = params.limit + 1;
      query = query.limit(fetchLimit);

      const snapshot = await query.get();
      const docs = snapshot.docs;

      // Apply in-memory filters for array filters not sent to Firestore.
      // NOTE: Because we filter post-fetch, pages may be shorter than `limit`
      // when in-memory filters discard rows. This is an accepted trade-off to
      // stay within Firestore's 30-disjunction limit.
      let allEvents = docs.map((doc) => doc.data() as UsageEvent);
      for (const memFilter of inMemoryFilters) {
        allEvents = allEvents.filter((e) => memFilter.values.includes(memFilter.getEventValue(e)));
      }

      const hasMore = allEvents.length > params.limit;
      const events = hasMore ? allEvents.slice(0, params.limit) : allEvents;

      const result: ListUsageEventsResult = {
        events,
        totalMatched,
      };

      if (hasMore && events.length > 0) {
        const lastEvent = events[events.length - 1];
        /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard — .length > 0 guarantees defined @preserve */
        if (lastEvent !== undefined) {
          /* v8 ignore stop @preserve */
          const lastSortValue = getFirestoreSortValue(lastEvent, domainSortField);
          result.nextCursor = encodeCursor(lastSortValue, lastEvent.eventId);
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

function getFirestoreSortValue(event: UsageEvent, field: SortField): string | number {
  switch (field) {
    case 'occurredAt':
      return event.occurredAt;
    case 'costUsd':
      return event.cost.billedUsd;
    case 'totalTokens':
      return event.usage.totalTokens;
  }
}

interface InMemoryFilter {
  readonly values: readonly string[];
  readonly getEventValue: (e: UsageEvent) => string;
}

interface ApplyFiltersResult {
  readonly query: FirestoreQuery;
  readonly inMemoryFilters: readonly InMemoryFilter[];
}

/**
 * Applies filters to a Firestore query with a disjunction-limit guard.
 *
 * Firestore limits queries to 30 disjunctions. Each `in` clause multiplies
 * the disjunction count by its cardinality, so combining multiple `in`
 * clauses can easily exceed the limit. To stay safe we push only the FIRST
 * populated array filter to Firestore (as a `where('field', 'in', values)`)
 * and apply all remaining array filters in-memory after fetch.
 *
 * The `success` filter is an equality (`==`) filter and does not contribute
 * to the disjunction count, so it is always applied to Firestore.
 */
function applyFilters(query: FirestoreQuery, filters: UsageEventFilters | undefined): ApplyFiltersResult {
  if (filters === undefined) {
    return { query, inMemoryFilters: [] };
  }

  let q = query;
  let firestoreArrayFilterApplied = false;
  const inMemoryFilters: InMemoryFilter[] = [];

  for (const mapping of ARRAY_FILTER_MAPPINGS) {
    const values = filters[mapping.filterKey];
    if (values !== undefined && Array.isArray(values) && values.length > 0) {
      if (!firestoreArrayFilterApplied) {
        // First populated array filter goes to Firestore.
        q = q.where(mapping.firestoreField, 'in', values);
        firestoreArrayFilterApplied = true;
      } else {
        // Subsequent array filters are applied in-memory after fetch.
        inMemoryFilters.push({ values, getEventValue: mapping.getEventValue });
      }
    }
  }

  if (filters.success !== undefined) {
    q = q.where('request.success', '==', filters.success);
  }

  return { query: q, inMemoryFilters };
}
