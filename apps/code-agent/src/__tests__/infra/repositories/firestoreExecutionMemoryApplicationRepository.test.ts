import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { Timestamp } from '@google-cloud/firestore';
import { err, type Logger } from '@intexuraos/common-core';

import { createFirestoreExecutionMemoryApplicationRepository } from '../../../infra/repositories/firestoreExecutionMemoryApplicationRepository.js';

describe('firestoreExecutionMemoryApplicationRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    resetFirestore();
  });

  const createInput = (): {
    taskId: string;
    repository: string;
    linearIssueId: string;
    querySummary: string;
    queryText: string;
    queryComponents: string[];
    queryRiskFlags: string[];
    retrievalVersion: string;
    matchedMemories: {
      memoryId: string;
      vectorScore: number;
      rerankScore: number;
      title: string;
      memoryType: 'pitfall_pattern';
    }[];
    status: 'matched';
    memoryIdsUsed: string[];
    memoryIdsRejected: string[];
  } => ({
    taskId: 'task-123',
    repository: 'pbuchman/intexuraos',
    linearIssueId: 'INT-1098',
    querySummary: 'Auth0 callback bug with route logging risk',
    queryText: 'auth0 callback route logging route schema env propagation',
    queryComponents: ['auth0 callback', 'route logging'],
    queryRiskFlags: ['missing logging'],
    retrievalVersion: 'execution-memory-retrieval@1.0.0',
    matchedMemories: [
      {
        memoryId: 'mem-1',
        vectorScore: 0.87,
        rerankScore: 0.81,
        title: 'Always log incoming requests',
        memoryType: 'pitfall_pattern' as const,
      },
    ],
    status: 'matched' as const,
    memoryIdsUsed: [],
    memoryIdsRejected: [],
  });

  it('creates an application record and finds it by id', async () => {
    const repo = createFirestoreExecutionMemoryApplicationRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const created = await repo.create(createInput());

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await repo.findById(created.value.id);

    expect(found.ok).toBe(true);
    if (!found.ok) return;

    expect(found.value.id).toBe(created.value.id);
    expect(found.value.status).toBe('matched');
  });

  it('updates usage feedback and evaluation fields', async () => {
    const repo = createFirestoreExecutionMemoryApplicationRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const created = await repo.create(createInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await repo.update(created.value.id, {
      memoryIdsUsed: ['mem-1'],
      memoryIdsRejected: ['mem-2'],
      evaluationSummary: 'Logging memory helped; env propagation memory did not apply.',
      perMemoryOutcome: [
        {
          memoryId: 'mem-1',
          outcome: 'positive',
          reason: 'The worker explicitly used the logging guidance.',
          confidence: 0.9,
        },
      ],
      status: 'matched',
      completedAt: new Date('2025-03-25T12:00:00Z'),
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.value.memoryIdsUsed).toEqual(['mem-1']);
    expect(updated.value.memoryIdsRejected).toEqual(['mem-2']);
    expect(updated.value.evaluationSummary).toContain('Logging memory helped');
    expect(updated.value.perMemoryOutcome).toHaveLength(1);
  });

  it('updates only supplied fields without adding optional evaluation data', async () => {
    const repo = createFirestoreExecutionMemoryApplicationRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const created = await repo.create(createInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await repo.update(created.value.id, {});

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.value.status).toBe('matched');
    expect(updated.value.memoryIdsUsed).toEqual([]);
    expect(updated.value.memoryIdsRejected).toEqual([]);
    expect(updated.value.evaluationSummary).toBeUndefined();
    expect(updated.value.perMemoryOutcome).toBeUndefined();
    expect(updated.value.completedAt).toBeUndefined();
  });

  it('reads optional evaluation metadata when completedAt is present', async () => {
    const completedAt = Timestamp.now();
    const get = vi.fn().mockResolvedValue({
      exists: true,
      id: 'app-complete',
      data: (): Record<string, unknown> => ({
        taskId: 'task-123',
        repository: 'pbuchman/intexuraos',
        linearIssueId: 'INT-1098',
        querySummary: 'summary',
        queryText: 'query',
        queryComponents: ['route'],
        queryRiskFlags: [],
        retrievalVersion: 'execution-memory-retrieval@1.0.0',
        matchedMemories: [],
        status: 'matched',
        memoryIdsUsed: ['mem-1'],
        memoryIdsRejected: ['mem-2'],
        evaluationSummary: 'Worked well',
        perMemoryOutcome: [
          {
            memoryId: 'mem-1',
            outcome: 'positive',
            reason: 'It applied',
            confidence: 0.9,
          },
        ],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        completedAt,
      }),
    });
    const firestore = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({ get }),
      }),
    } as unknown as Firestore;
    const repo = createFirestoreExecutionMemoryApplicationRepository({ firestore, logger });

    const found = await repo.findById('app-complete');

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.completedAt).toBe(completedAt);
    expect(found.value.evaluationSummary).toBe('Worked well');
    expect(found.value.perMemoryOutcome).toHaveLength(1);
  });

  it('handles missing optional fields and malformed stored values when reading an application', async () => {
    const get = vi.fn().mockResolvedValue({
      exists: true,
      id: 'app-malformed',
      data: (): Record<string, unknown> => ({
        taskId: 42,
        repository: null,
        querySummary: { bad: true },
        queryText: ['bad'],
        queryComponents: 'bad',
        queryRiskFlags: 'bad',
        retrievalVersion: undefined,
        matchedMemories: 'bad',
        status: 'error',
        memoryIdsUsed: 'bad',
        memoryIdsRejected: 'bad',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    });
    const firestore = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({ get }),
      }),
    } as unknown as Firestore;
    const repo = createFirestoreExecutionMemoryApplicationRepository({ firestore, logger });

    const found = await repo.findById('app-malformed');

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toMatchObject({
      id: 'app-malformed',
      taskId: '',
      repository: '',
      querySummary: '',
      queryText: '',
      queryComponents: [],
      queryRiskFlags: [],
      retrievalVersion: '',
      matchedMemories: [],
      memoryIdsUsed: [],
      memoryIdsRejected: [],
    });
    expect(found.value.linearIssueId).toBeUndefined();
    expect(found.value.evaluationSummary).toBeUndefined();
    expect(found.value.perMemoryOutcome).toBeUndefined();
    expect(found.value.completedAt).toBeUndefined();
  });

  it('returns not found and firestore errors from create/find/update operations', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ exists: false })
      .mockRejectedValueOnce(new Error('get failed'))
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        id: 'app-error',
        data: (): Record<string, unknown> => ({
          taskId: 'task-123',
          repository: 'pbuchman/intexuraos',
          querySummary: 'summary',
          queryText: 'query',
          queryComponents: [],
          queryRiskFlags: [],
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          matchedMemories: [],
          status: 'matched',
          memoryIdsUsed: [],
          memoryIdsRejected: [],
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        }),
      });
    const failingFirestore = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          set: vi.fn().mockRejectedValue(new Error('set failed')),
          get,
          update: vi.fn().mockRejectedValue(new Error('update failed')),
        }),
      }),
    } as unknown as Firestore;
    const repo = createFirestoreExecutionMemoryApplicationRepository({
      firestore: failingFirestore,
      logger,
    });

    const created = await repo.create(createInput());
    expect(created).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'set failed' }));

    const missing = await repo.findById('app-missing');
    expect(missing).toEqual(err({
      code: 'NOT_FOUND',
      message: 'Execution memory application app-missing not found',
    }));

    const findFailure = await repo.findById('app-error');
    expect(findFailure).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'get failed' }));

    const updateMissing = await repo.update('app-missing', { status: 'matched' });
    expect(updateMissing).toEqual(err({
      code: 'NOT_FOUND',
      message: 'Execution memory application app-missing not found',
    }));

    const updateFailure = await repo.update('app-error', { status: 'matched' });
    expect(updateFailure).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
  });
});
