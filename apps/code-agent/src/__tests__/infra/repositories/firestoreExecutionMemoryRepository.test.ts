import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import { err, ok, type Logger } from '@intexuraos/common-core';

import { createFirestoreExecutionMemoryRepository } from '../../../infra/repositories/firestoreExecutionMemoryRepository.js';

describe('firestoreExecutionMemoryRepository', () => {
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
    repository: string;
    sourceTaskId: string;
    sourceLinearIssueId: string;
    memoryType: 'verification_pattern';
    title: string;
    appliesWhen: string;
    action: string;
    avoid: string;
    verification: string;
    evidenceSummary: string;
    retrievalText: string;
    keywords: string[];
    labelHints: string[];
    componentHints: string[];
    embedding: number[];
    embeddingModel: 'text-embedding-3-small';
    fingerprint: string;
    distillationVersion: string;
    qualityScore: number;
    applicationCount: number;
    positiveCount: number;
    negativeCount: number;
    status: 'active';
  } => ({
    repository: 'pbuchman/intexuraos',
    sourceTaskId: 'task-123',
    sourceLinearIssueId: 'INT-1098',
    memoryType: 'verification_pattern' as const,
    title: 'Update route schema and task serialization together',
    appliesWhen: 'Task detail response fields change',
    action: 'Update route schema, API client, and web types in the same change.',
    avoid: 'Do not change only the backend payload.',
    verification: 'Cover the route and UI serialization with tests.',
    evidenceSummary: 'A previous task regressed the task detail view because route and web types diverged.',
    retrievalText: 'route schema api client web types task detail serialization',
    keywords: ['route schema', 'task detail', 'serialization'],
    labelHints: ['backend'],
    componentHints: ['codeRoutes', 'CodeTaskViewPageV2'],
    embedding: Array.from({ length: 1536 }, () => 0.5),
    embeddingModel: 'text-embedding-3-small' as const,
    fingerprint: 'fingerprint-123',
    distillationVersion: 'execution-memory-distiller@1.0.0',
    qualityScore: 0.8,
    applicationCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    status: 'active' as const,
  });

  it('creates a memory and can find it by fingerprint', async () => {
    const repo = createFirestoreExecutionMemoryRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const created = await repo.create(createInput());

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await repo.findByFingerprint('pbuchman/intexuraos', 'fingerprint-123');

    expect(found.ok).toBe(true);
    if (!found.ok) return;

    expect(found.value?.id).toBe(created.value.id);
    expect(found.value?.title).toBe('Update route schema and task serialization together');
  });

  it('updates counters and status for an existing memory', async () => {
    const repo = createFirestoreExecutionMemoryRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const created = await repo.create(createInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await repo.update(created.value.id, {
      applicationCount: 3,
      positiveCount: 2,
      negativeCount: 1,
      status: 'suppressed',
      qualityScore: 0.2,
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    expect(updated.value.applicationCount).toBe(3);
    expect(updated.value.positiveCount).toBe(2);
    expect(updated.value.negativeCount).toBe(1);
    expect(updated.value.status).toBe('suppressed');
    expect(updated.value.qualityScore).toBe(0.2);
  });

  it('updates embeddings and ignores undefined fields', async () => {
    const repo = createFirestoreExecutionMemoryRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const created = await repo.create(createInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updateInput = {
      embedding: [0.1, 0.2, 0.3],
      status: undefined,
    } as unknown as Parameters<typeof repo.update>[1];

    const updated = await repo.update(created.value.id, updateInput);

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.status).toBe('active');
  });

  it('uses repository and status prefilters before vector search', async () => {
    const docs = [
      {
        id: 'mem-1',
        distance: 0.2,
        data: (): Record<string, unknown> => ({
          repository: 'pbuchman/intexuraos',
          sourceTaskId: 'task-1',
          memoryType: 'pitfall_pattern',
          title: 'Always log incoming requests',
          appliesWhen: 'Adding a new route',
          action: 'Call logIncomingRequest() at the top of the handler.',
          avoid: 'Do not rely on downstream logging only.',
          verification: 'Add route tests and assert logging path is exercised.',
          evidenceSummary: 'Several routes were missing required request logging.',
          retrievalText: 'log incoming request route handler',
          keywords: ['logging'],
          labelHints: ['backend'],
          componentHints: ['routes'],
          embeddingModel: 'text-embedding-3-small',
          fingerprint: 'fp-1',
          distillationVersion: 'execution-memory-distiller@1.0.0',
          qualityScore: 0.9,
          applicationCount: 4,
          positiveCount: 3,
          negativeCount: 0,
          status: 'active',
          createdAt: Timestamp.fromDate(new Date('2025-03-25T09:00:00Z')),
          updatedAt: Timestamp.fromDate(new Date('2025-03-25T10:00:00Z')),
        }),
      },
      {
        id: 'mem-2',
        data: (): Record<string, unknown> => ({
          repository: 'pbuchman/intexuraos',
          sourceTaskId: 'task-2',
          memoryType: 'verification_pattern',
          title: 'Use app.inject for route coverage',
          appliesWhen: 'Testing Fastify routes',
          action: 'Exercise the route through app.inject().',
          avoid: 'Do not unit test only the helper beneath the route.',
          verification: 'Assert response payload and side effects.',
          evidenceSummary: 'Route regressions slipped through helper-only tests.',
          retrievalText: 'app inject route coverage fastify',
          keywords: ['testing'],
          labelHints: ['backend'],
          componentHints: ['routes'],
          embeddingModel: 'text-embedding-3-small',
          fingerprint: 'fp-2',
          distillationVersion: 'execution-memory-distiller@1.0.0',
          qualityScore: 0.7,
          applicationCount: 2,
          positiveCount: 1,
          negativeCount: 0,
          status: 'active',
          createdAt: Timestamp.fromDate(new Date('2025-03-25T09:00:00Z')),
          updatedAt: Timestamp.fromDate(new Date('2025-03-25T10:00:00Z')),
        }),
      },
    ];

    const get = vi.fn().mockResolvedValue({ empty: false, docs });
    const findNearest = vi.fn().mockReturnValue({ get });
    const whereStatus = vi.fn().mockReturnValue({ findNearest });
    const whereRepository = vi.fn().mockReturnValue({ where: whereStatus });
    const firestore = {
      collection: vi.fn().mockReturnValue({ where: whereRepository }),
    } as unknown as Firestore;

    const repo = createFirestoreExecutionMemoryRepository({ firestore, logger });

    const result = await repo.findNearest({
      repository: 'pbuchman/intexuraos',
      embedding: Array.from({ length: 1536 }, () => 0.1),
      limit: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(whereRepository).toHaveBeenCalledWith('repository', '==', 'pbuchman/intexuraos');
    expect(whereStatus).toHaveBeenCalledWith('status', '==', 'active');
    expect(findNearest).toHaveBeenCalledWith(
      'embedding',
      expect.anything(),
      expect.objectContaining({ limit: 2, distanceMeasure: 'COSINE' })
    );
    expect(result.value.map((memory) => memory.vectorScore)).toEqual([0.8, 1]);
  });

  it('handles malformed memory documents and empty vector-search snapshots', async () => {
    const get = vi.fn().mockResolvedValue({
      exists: true,
      id: 'mem-malformed',
      data: (): Record<string, unknown> => ({
        repository: 123,
        sourceTaskId: null,
        memoryType: 'verification_pattern',
        title: ['bad'],
        appliesWhen: { bad: true },
        action: 42,
        avoid: null,
        verification: undefined,
        evidenceSummary: ['bad'],
        retrievalText: { bad: true },
        keywords: 'bad',
        labelHints: 'bad',
        componentHints: 'bad',
        embeddingModel: 'text-embedding-3-small',
        fingerprint: null,
        distillationVersion: undefined,
        qualityScore: null,
        applicationCount: undefined,
        positiveCount: null,
        negativeCount: undefined,
        status: 'active',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    });
    const emptyVectorGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const vectorQuery = { get: emptyVectorGet };
    const findNearest = vi.fn().mockReturnValue(vectorQuery);
    const whereStatus = vi.fn().mockReturnValue({ findNearest });
    const whereRepository = vi.fn().mockReturnValue({ where: whereStatus });
    const firestore = {
      collection: vi.fn()
        .mockReturnValueOnce({
          doc: vi.fn().mockReturnValue({ get }),
        })
        .mockReturnValueOnce({ where: whereRepository }),
    } as unknown as Firestore;
    const repo = createFirestoreExecutionMemoryRepository({ firestore, logger });

    const found = await repo.findById('mem-malformed');
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toMatchObject({
      id: 'mem-malformed',
      repository: '',
      sourceTaskId: '',
      title: '',
      appliesWhen: '',
      action: '',
      avoid: '',
      verification: '',
      evidenceSummary: '',
      retrievalText: '',
      keywords: [],
      labelHints: [],
      componentHints: [],
      fingerprint: '',
      distillationVersion: '',
    });

    const nearest = await repo.findNearest({
      repository: 'pbuchman/intexuraos',
      embedding: [0.1, 0.2],
      limit: 2,
      status: 'active',
    });
    expect(nearest).toEqual(ok([]));
  });

  it('returns not found and firestore errors across repository operations', async () => {
    const docRef = {
      set: vi.fn().mockRejectedValue(new Error('set failed')),
      get: vi.fn()
        .mockResolvedValueOnce({ exists: false })
        .mockRejectedValueOnce(new Error('get failed'))
        .mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ exists: true })
        .mockResolvedValueOnce({ exists: true }),
      update: vi.fn().mockRejectedValue(new Error('update failed')),
    };
    const fingerprintEmptyGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const fingerprintWeirdGet = vi.fn().mockResolvedValue({ empty: false, docs: [] });
    const fingerprintFailureGet = vi.fn().mockRejectedValue(new Error('fingerprint failed'));
    const collection = {
      doc: vi.fn().mockReturnValue(docRef),
      where: vi.fn()
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: fingerprintEmptyGet,
            }),
          }),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: fingerprintWeirdGet,
            }),
          }),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: fingerprintFailureGet,
            }),
          }),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            findNearest: vi.fn().mockImplementation(() => {
              throw new Error('vector failed');
            }),
          }),
        }),
    };
    const firestore = {
      collection: vi.fn().mockReturnValue(collection),
    } as unknown as Firestore;
    const repo = createFirestoreExecutionMemoryRepository({ firestore, logger });

    const createFailure = await repo.create(createInput());
    expect(createFailure).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'set failed' }));

    const missing = await repo.findById('mem-missing');
    expect(missing).toEqual(err({
      code: 'NOT_FOUND',
      message: 'Execution memory mem-missing not found',
    }));

    const findFailure = await repo.findById('mem-error');
    expect(findFailure).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'get failed' }));

    const emptyFingerprint = await repo.findByFingerprint('pbuchman/intexuraos', 'fp-empty');
    expect(emptyFingerprint).toEqual(ok(null));

    const weirdFingerprint = await repo.findByFingerprint('pbuchman/intexuraos', 'fp-weird');
    expect(weirdFingerprint).toEqual(ok(null));

    const fingerprintFailure = await repo.findByFingerprint('pbuchman/intexuraos', 'fp-error');
    expect(fingerprintFailure).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'fingerprint failed' }));

    const nearestFailure = await repo.findNearest({
      repository: 'pbuchman/intexuraos',
      embedding: [0.1, 0.2],
      limit: 2,
      status: 'active',
    });
    expect(nearestFailure).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'vector failed' }));

    const updateMissing = await repo.update('mem-missing', { status: 'suppressed' });
    expect(updateMissing).toEqual(err({
      code: 'NOT_FOUND',
      message: 'Execution memory mem-missing not found',
    }));

    const updateFailure = await repo.update('mem-error', { status: 'suppressed' });
    expect(updateFailure).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
  });
});
