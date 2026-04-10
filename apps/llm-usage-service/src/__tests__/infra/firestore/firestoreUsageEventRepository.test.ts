import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FirestoreUsageEventRepository } from '../../../infra/firestore/firestoreUsageEventRepository.js';
import { encodeCursor } from '../../../domain/models/cursor.js';
import type { UsageEvent } from '../../../domain/models/usageEvent.js';
import { createTestEvent } from '../../helpers.js';

// ── Chainable query mock ──────────────────────────────────────────────
// Builds a mock that mirrors Firestore's fluent query API: .where().orderBy()...
// Every query method returns `self` so calls can be chained indefinitely.
interface MockQuery {
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  startAfter: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
}

interface MockDoc {
  data: () => UsageEvent;
}

function toMockDoc(evt: UsageEvent): MockDoc {
  return { data: (): UsageEvent => evt };
}

function createMockQuery(docs: MockDoc[] = [], countValue = 0): MockQuery {
  const self: MockQuery = {
    where: vi.fn(),
    orderBy: vi.fn(),
    startAfter: vi.fn(),
    limit: vi.fn(),
    get: vi.fn().mockResolvedValue({ docs }),
    count: vi.fn(),
  };
  // Every chainable method returns `self`
  self.where.mockReturnValue(self);
  self.orderBy.mockReturnValue(self);
  self.startAfter.mockReturnValue(self);
  self.limit.mockReturnValue(self);
  self.count.mockReturnValue({
    get: vi.fn().mockResolvedValue({ data: (): { count: number } => ({ count: countValue }) }),
  });
  return self;
}

// ── Module-level mocks ────────────────────────────────────────────────
const mockCreate = vi.fn();
const mockGet = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ create: mockCreate, get: mockGet });

let mockQuery: MockQuery;

const mockCollection = vi.fn().mockImplementation(() => {
  const coll = { doc: mockDoc, where: mockQuery.where };
  // collection(...).where() should return our query mock
  return coll;
});

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: (): { collection: typeof mockCollection } => ({ collection: mockCollection }),
}));

describe('FirestoreUsageEventRepository', () => {
  let repo: FirestoreUsageEventRepository;

  beforeEach(() => {
    repo = new FirestoreUsageEventRepository();
    vi.clearAllMocks();
    mockDoc.mockReturnValue({ create: mockCreate, get: mockGet });
    mockQuery = createMockQuery();
    mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));
  });

  // ── createEvent ─────────────────────────────────────────────────────
  it('returns created status on successful create', async () => {
    mockCreate.mockResolvedValue(undefined);
    const event = createTestEvent({ eventId: 'evt_1' });

    const result = await repo.createEvent(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('created');
    }
    expect(mockCollection).toHaveBeenCalledWith('llm_usage_events');
    expect(mockDoc).toHaveBeenCalledWith('evt_1');
  });

  it('returns duplicate status when Firestore throws code 6', async () => {
    mockCreate.mockRejectedValue({ code: 6, message: 'ALREADY_EXISTS' });
    const event = createTestEvent({ eventId: 'evt_dup' });

    const result = await repo.createEvent(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('duplicate');
    }
  });

  it('returns error for other Firestore errors', async () => {
    mockCreate.mockRejectedValue({ code: 13, message: 'Internal error' });
    const event = createTestEvent({ eventId: 'evt_fail' });

    const result = await repo.createEvent(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('13');
      expect(result.error.message).toBe('Internal error');
    }
  });

  it('handles errors without code or message', async () => {
    mockCreate.mockRejectedValue({});
    const event = createTestEvent({ eventId: 'evt_unknown' });

    const result = await repo.createEvent(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN');
      expect(result.error.message).toBe('Unknown Firestore error');
    }
  });

  // ── list ────────────────────────────────────────────────────────────
  describe('list', () => {
    it('returns events with default sort (occurredAt desc)', async () => {
      const evt = createTestEvent({ eventId: 'evt_list_1' });
      mockQuery = createMockQuery([toMockDoc(evt)], 1);
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const result = await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        limit: 10,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.events).toHaveLength(1);
        expect(result.value.events[0]?.eventId).toBe('evt_list_1');
        expect(result.value.totalMatched).toBe(1);
        expect(result.value.nextCursor).toBeUndefined();
      }
    });

    it('detects next page when more docs than limit', async () => {
      const evt1 = createTestEvent({ eventId: 'evt_a', occurredAt: '2026-04-10T12:00:00Z' });
      const evt2 = createTestEvent({ eventId: 'evt_b', occurredAt: '2026-04-10T11:00:00Z' });
      const evt3 = createTestEvent({ eventId: 'evt_c', occurredAt: '2026-04-10T10:00:00Z' });
      // limit=2, 3 docs returned → hasMore=true
      mockQuery = createMockQuery(
        [toMockDoc(evt1), toMockDoc(evt2), toMockDoc(evt3)],
        3,
      );
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const result = await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        limit: 2,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.events).toHaveLength(2);
        expect(result.value.nextCursor).toBeDefined();
      }
    });

    it('applies cursor via startAfter', async () => {
      mockQuery = createMockQuery([], 0);
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const cursor = encodeCursor('2026-04-10T11:00:00Z', 'evt_b');

      await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        limit: 10,
        cursor,
      });

      expect(mockQuery.startAfter).toHaveBeenCalledWith('2026-04-10T11:00:00Z', 'evt_b');
    });

    it('ignores invalid cursor gracefully', async () => {
      mockQuery = createMockQuery([], 0);
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const result = await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        limit: 10,
        cursor: 'not-a-valid-cursor',
      });

      expect(result.ok).toBe(true);
      expect(mockQuery.startAfter).not.toHaveBeenCalled();
    });

    it('applies costUsd sort field', async () => {
      const evt = createTestEvent({ eventId: 'evt_cost', cost: { billedUsd: 0.5, providerReportedUsd: null, calculatedUsd: null, pricingSource: 'calculated' } });
      // limit=1, 2 docs → hasMore, cursor uses costUsd
      const evt2 = createTestEvent({ eventId: 'evt_cost2', cost: { billedUsd: 0.1, providerReportedUsd: null, calculatedUsd: null, pricingSource: 'calculated' } });
      mockQuery = createMockQuery(
        [toMockDoc(evt), toMockDoc(evt2)],
        2,
      );
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const result = await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        sortBy: { field: 'costUsd', direction: 'desc' },
        limit: 1,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nextCursor).toBeDefined();
      }
      expect(mockQuery.orderBy).toHaveBeenCalledWith('cost.billedUsd', 'desc');
    });

    it('applies totalTokens sort field', async () => {
      const evt = createTestEvent({ eventId: 'evt_tok' });
      const evt2 = createTestEvent({ eventId: 'evt_tok2' });
      mockQuery = createMockQuery(
        [toMockDoc(evt), toMockDoc(evt2)],
        2,
      );
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const result = await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        sortBy: { field: 'totalTokens', direction: 'asc' },
        limit: 1,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nextCursor).toBeDefined();
      }
      expect(mockQuery.orderBy).toHaveBeenCalledWith('usage.totalTokens', 'asc');
    });

    it('applies first array filter to Firestore, remaining in-memory', async () => {
      const evt1 = createTestEvent({
        eventId: 'evt_f1',
        source: { service: 'orchestrator', component: 'research', client: 'web', environment: 'dev' },
      });
      const evt2 = createTestEvent({
        eventId: 'evt_f2',
        source: { service: 'orchestrator', component: 'other', client: 'web', environment: 'dev' },
      });
      mockQuery = createMockQuery(
        [toMockDoc(evt1), toMockDoc(evt2)],
        2,
      );
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const result = await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        filters: {
          services: ['orchestrator'],
          components: ['research'], // second array filter → in-memory
        },
        limit: 10,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // evt2 has component 'other', filtered in-memory
        expect(result.value.events).toHaveLength(1);
        expect(result.value.events[0]?.eventId).toBe('evt_f1');
      }
    });

    it('applies success filter to Firestore alongside array filter', async () => {
      mockQuery = createMockQuery([], 0);
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        filters: {
          services: ['orchestrator'],
          success: true,
        },
        limit: 10,
      });

      // where called: occurredAt>=, occurredAt<=, services in, success ==
      expect(mockQuery.where).toHaveBeenCalledWith('source.service', 'in', ['orchestrator']);
      expect(mockQuery.where).toHaveBeenCalledWith('request.success', '==', true);
    });

    it('applies only success filter when no array filters present', async () => {
      mockQuery = createMockQuery([], 0);
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        filters: { success: false },
        limit: 10,
      });

      expect(mockQuery.where).toHaveBeenCalledWith('request.success', '==', false);
    });

    it('passes no filters when filters is undefined', async () => {
      mockQuery = createMockQuery([], 0);
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        limit: 10,
      });

      // Only the two time range where calls
      expect(mockQuery.where).toHaveBeenCalledTimes(2);
    });

    it('returns error on Firestore failure', async () => {
      mockQuery = createMockQuery();
      // Make count().get() throw
      mockQuery.count.mockReturnValue({
        get: vi.fn().mockRejectedValue({ code: 14, message: 'Unavailable' }),
      });
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const result = await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        limit: 10,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('14');
        expect(result.error.message).toBe('Unavailable');
      }
    });

    it('returns error with UNKNOWN code when error has no code/message', async () => {
      mockQuery = createMockQuery();
      mockQuery.count.mockReturnValue({
        get: vi.fn().mockRejectedValue({}),
      });
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const result = await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        limit: 10,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Unknown Firestore error');
      }
    });

    it('returns empty events when no docs match', async () => {
      mockQuery = createMockQuery([], 0);
      mockCollection.mockImplementation(() => ({ doc: mockDoc, where: mockQuery.where }));

      const result = await repo.list({
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        limit: 10,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.events).toHaveLength(0);
        expect(result.value.totalMatched).toBe(0);
        expect(result.value.nextCursor).toBeUndefined();
      }
    });
  });

  // ── getById ─────────────────────────────────────────────────────────
  describe('getById', () => {
    it('returns the event when it exists', async () => {
      const evt = createTestEvent({ eventId: 'evt_get_1' });
      mockGet.mockResolvedValue({ exists: true, data: (): UsageEvent => evt });

      const result = await repo.getById('evt_get_1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.eventId).toBe('evt_get_1');
      }
    });

    it('returns null when event does not exist', async () => {
      mockGet.mockResolvedValue({ exists: false, data: (): undefined => undefined });

      const result = await repo.getById('evt_missing');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error on Firestore failure', async () => {
      mockGet.mockRejectedValue({ code: 5, message: 'NOT_FOUND' });

      const result = await repo.getById('evt_err');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('5');
        expect(result.error.message).toBe('NOT_FOUND');
      }
    });

    it('returns error with UNKNOWN code when error has no code/message', async () => {
      mockGet.mockRejectedValue({});

      const result = await repo.getById('evt_err_unknown');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Unknown Firestore error');
      }
    });
  });
});
