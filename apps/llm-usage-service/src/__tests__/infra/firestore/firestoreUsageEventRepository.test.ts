import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FirestoreUsageEventRepository } from '../../../infra/firestore/firestoreUsageEventRepository.js';
import { createTestEvent } from '../../helpers.js';

// Mock getFirestore
const mockCreate = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ create: mockCreate });
const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: (): { collection: typeof mockCollection } => ({ collection: mockCollection }),
}));

describe('FirestoreUsageEventRepository', () => {
  let repo: FirestoreUsageEventRepository;

  beforeEach(() => {
    repo = new FirestoreUsageEventRepository();
    vi.clearAllMocks();
    mockDoc.mockReturnValue({ create: mockCreate });
    mockCollection.mockReturnValue({ doc: mockDoc });
  });

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
});
