import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApprovalMessage } from '../../domain/models/approvalMessage.js';

vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

import { getFirestore } from '@intexuraos/infra-firestore';
import { createFirestoreApprovalMessageRepository } from './approvalMessageRepository.js';

const mockGetFirestore = vi.mocked(getFirestore);

function createTestMessage(overrides: Partial<ApprovalMessage> = {}): ApprovalMessage {
  return {
    id: 'msg-1',
    wamid: 'wamid.abc123',
    actionId: 'action-1',
    userId: 'user-1',
    sentAt: '2026-01-01T00:00:00.000Z',
    actionType: 'calendar',
    actionTitle: 'Test Event',
    ...overrides,
  };
}

interface FakeDoc {
  id: string;
  data: () => Record<string, unknown>;
  ref: { delete: ReturnType<typeof vi.fn> };
}

function createFakeDoc(id: string, docData: Record<string, unknown>): FakeDoc {
  return {
    id,
    data: () => docData,
    ref: { delete: vi.fn().mockResolvedValue(undefined) },
  };
}

interface FakeFirestoreOptions {
  snapshotEmpty?: boolean;
  docs?: FakeDoc[];
  setFn?: ReturnType<typeof vi.fn>;
  getFn?: ReturnType<typeof vi.fn>;
  batchCommitFn?: ReturnType<typeof vi.fn>;
}

function setupFakeFirestore(options: FakeFirestoreOptions = {}): void {
  const fakeSnapshot = {
    empty: options.snapshotEmpty ?? true,
    docs: options.docs ?? [],
  };

  const setFn = options.setFn ?? vi.fn().mockResolvedValue(undefined);
  const getFn = options.getFn ?? vi.fn().mockResolvedValue(fakeSnapshot);
  const batchDeleteFn = vi.fn();
  const batchCommitFn = options.batchCommitFn ?? vi.fn().mockResolvedValue(undefined);

  const fakeQuery = {
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: getFn,
  };

  const fakeDocRef = {
    set: setFn,
  };

  const fakeBatch = {
    delete: batchDeleteFn,
    commit: batchCommitFn,
  };

  const fakeCollection = vi.fn().mockReturnValue({
    doc: vi.fn().mockReturnValue(fakeDocRef),
    where: fakeQuery.where.mockReturnValue(fakeQuery),
  });

  const fakeDb = {
    collection: fakeCollection,
    batch: vi.fn().mockReturnValue(fakeBatch),
  };

  mockGetFirestore.mockReturnValue(fakeDb as unknown as ReturnType<typeof getFirestore>);
}

describe('approvalMessageRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('save', () => {
    it('saves a message successfully', async () => {
      const setFn = vi.fn().mockResolvedValue(undefined);
      setupFakeFirestore({ setFn });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.save(createTestMessage());

      expect(result.ok).toBe(true);
      expect(setFn).toHaveBeenCalledWith({
        wamid: 'wamid.abc123',
        actionId: 'action-1',
        userId: 'user-1',
        sentAt: '2026-01-01T00:00:00.000Z',
        actionType: 'calendar',
        actionTitle: 'Test Event',
      });
    });

    it('returns error when Firestore throws', async () => {
      const setFn = vi.fn().mockRejectedValue(new Error('Firestore write failed'));
      setupFakeFirestore({ setFn });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.save(createTestMessage());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toBe('Firestore write failed');
      }
    });
  });

  describe('findByWamid', () => {
    it('returns null when snapshot is empty', async () => {
      setupFakeFirestore({ snapshotEmpty: true, docs: [] });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.findByWamid('wamid.abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null when docs[0] is undefined', async () => {
      setupFakeFirestore({ snapshotEmpty: false, docs: [] });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.findByWamid('wamid.abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns approval message when doc found', async () => {
      const fakeDoc = createFakeDoc('msg-1', {
        wamid: 'wamid.abc123',
        actionId: 'action-1',
        userId: 'user-1',
        sentAt: '2026-01-01T00:00:00.000Z',
        actionType: 'calendar',
        actionTitle: 'Test Event',
      });

      setupFakeFirestore({ snapshotEmpty: false, docs: [fakeDoc] });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.findByWamid('wamid.abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: 'msg-1',
          wamid: 'wamid.abc123',
          actionId: 'action-1',
          userId: 'user-1',
          sentAt: '2026-01-01T00:00:00.000Z',
          actionType: 'calendar',
          actionTitle: 'Test Event',
        });
      }
    });

    it('returns error on Firestore failure', async () => {
      const getFn = vi.fn().mockRejectedValue(new Error('Firestore read failed'));
      setupFakeFirestore({ getFn });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.findByWamid('wamid.abc123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toBe('Firestore read failed');
      }
    });
  });

  describe('deleteByActionId', () => {
    it('returns ok(undefined) when snapshot is empty', async () => {
      setupFakeFirestore({ snapshotEmpty: true, docs: [] });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.deleteByActionId('action-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
    });

    it('deletes docs and returns ok when found', async () => {
      const fakeDoc1 = createFakeDoc('msg-1', {
        wamid: 'wamid.abc123',
        actionId: 'action-1',
        userId: 'user-1',
        sentAt: '2026-01-01T00:00:00.000Z',
        actionType: 'calendar',
        actionTitle: 'Test Event',
      });

      const batchCommitFn = vi.fn().mockResolvedValue(undefined);
      setupFakeFirestore({
        snapshotEmpty: false,
        docs: [fakeDoc1],
        batchCommitFn,
      });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.deleteByActionId('action-1');

      expect(result.ok).toBe(true);
      expect(batchCommitFn).toHaveBeenCalled();
    });

    it('returns error on Firestore failure', async () => {
      const getFn = vi.fn().mockRejectedValue(new Error('Firestore delete failed'));
      setupFakeFirestore({ getFn });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.deleteByActionId('action-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toBe('Firestore delete failed');
      }
    });
  });

  describe('findByActionId', () => {
    it('returns null when snapshot is empty', async () => {
      setupFakeFirestore({ snapshotEmpty: true, docs: [] });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.findByActionId('action-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null when docs[0] is undefined', async () => {
      setupFakeFirestore({ snapshotEmpty: false, docs: [] });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.findByActionId('action-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns approval message when doc found', async () => {
      const fakeDoc = createFakeDoc('msg-2', {
        wamid: 'wamid.def456',
        actionId: 'action-1',
        userId: 'user-1',
        sentAt: '2026-01-02T00:00:00.000Z',
        actionType: 'todo',
        actionTitle: 'Test Todo',
      });

      setupFakeFirestore({ snapshotEmpty: false, docs: [fakeDoc] });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.findByActionId('action-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          id: 'msg-2',
          wamid: 'wamid.def456',
          actionId: 'action-1',
          userId: 'user-1',
          sentAt: '2026-01-02T00:00:00.000Z',
          actionType: 'todo',
          actionTitle: 'Test Todo',
        });
      }
    });

    it('returns error on Firestore failure', async () => {
      const getFn = vi.fn().mockRejectedValue(new Error('Firestore query failed'));
      setupFakeFirestore({ getFn });

      const repo = createFirestoreApprovalMessageRepository();
      const result = await repo.findByActionId('action-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toBe('Firestore query failed');
      }
    });
  });
});
