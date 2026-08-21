import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { Timestamp, type Firestore, type Transaction } from '@google-cloud/firestore';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type {
  CodeTaskRepository,
  CreateTaskInput,
} from '../../domain/repositories/codeTaskRepository.js';
import {
  buildReviewTaskEventPath,
  buildReviewTaskId,
  buildReviewTaskSlotPath,
  reserveReviewTask,
} from '../../domain/usecases/reserveReviewTask.js';

const TASK_INPUT: CreateTaskInput = {
  userId: 'user-1',
  prompt: 'review prompt',
  sanitizedPrompt: 'review prompt',
  systemPromptHash: 'review-auto',
  workerType: 'auto',
  workerLocation: 'queued',
  repository: 'pbuchman/intexuraos',
  baseBranch: 'development',
  traceId: 'event-1',
  prNumber: 42,
  prBranch: 'feature/review',
  agentType: 'review',
  reviewTypes: ['code_quality'],
};

function makeTask(input: CreateTaskInput): CodeTask {
  return {
    ...input,
    id: input.id ?? 'missing-id',
    status: input.initialStatus ?? 'queued',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as CodeTask;
}

function createHarness(): {
  firestore: Firestore;
  codeTaskRepo: CodeTaskRepository;
  tasks: Map<string, CodeTask>;
  slots: Map<string, Record<string, unknown>>;
} {
  const tasks = new Map<string, CodeTask>();
  const slots = new Map<string, Record<string, unknown>>();
  let transactionTail: Promise<unknown> = Promise.resolve();

  interface QueryFilter { field: string; value: unknown }
  interface FakeQuery {
    kind: 'query';
    filters: QueryFilter[];
    maxResults?: number;
    where(field: string, operator: string, value: unknown): FakeQuery;
    limit(maxResults: number): FakeQuery;
  }

  function createQuery(filters: QueryFilter[] = [], maxResults?: number): FakeQuery {
    return {
      kind: 'query',
      filters,
      ...(maxResults !== undefined && { maxResults }),
      where(field, operator, value): FakeQuery {
        if (operator !== '==') throw new Error(`Unsupported fake query operator: ${operator}`);
        return createQuery([...filters, { field, value }], maxResults);
      },
      limit(nextMaxResults): FakeQuery {
        return createQuery(filters, nextMaxResults);
      },
    };
  }

  const transaction = {
    get: vi.fn(async (ref: { path?: string; kind?: string; filters?: QueryFilter[]; maxResults?: number }) => {
      if (ref.kind === 'query') {
        const matching = [...tasks.values()].filter((task) =>
          (ref.filters ?? []).every(({ field, value }) =>
            (task as unknown as Record<string, unknown>)[field] === value
          )
        ).slice(0, ref.maxResults);
        return {
          empty: matching.length === 0,
          docs: matching.map((task) => ({ id: task.id, data: (): CodeTask => task })),
        };
      }
      const data = ref.path === undefined ? undefined : slots.get(ref.path);
      return {
        exists: data !== undefined,
        data: (): Record<string, unknown> | undefined => data,
      };
    }),
    set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
      slots.set(ref.path, data);
    }),
    update: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
      const taskId = ref.path.startsWith('code_tasks/')
        ? ref.path.slice('code_tasks/'.length)
        : undefined;
      if (taskId === undefined) throw new Error(`Unexpected update path: ${ref.path}`);
      const task = tasks.get(taskId);
      if (task === undefined) throw new Error(`Task not found for update: ${taskId}`);
      tasks.set(taskId, { ...task, ...data } as CodeTask);
    }),
  } as unknown as Transaction;

  const firestore = {
    doc: vi.fn((path: string) => ({ path })),
    collection: vi.fn(() => createQuery()),
    runTransaction: vi.fn(<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> => {
      const run = transactionTail.then(async () => await operation(transaction));
      transactionTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }),
  } as unknown as Firestore;

  const codeTaskRepo = {
    findById: vi.fn(async (taskId: string) => {
      const task = tasks.get(taskId);
      return task === undefined
        ? err({ code: 'NOT_FOUND' as const, message: 'not found' })
        : ok(task);
    }),
    create: vi.fn(async (input: CreateTaskInput) => {
      const task = makeTask(input);
      tasks.set(task.id, task);
      return ok(task);
    }),
  } as unknown as CodeTaskRepository;

  return { firestore, codeTaskRepo, tasks, slots };
}

describe('reserveReviewTask', () => {
  it('creates one deterministic task for two concurrent deliveries of the same event', async () => {
    const harness = createHarness();

    const [first, second] = await Promise.all([
      reserveReviewTask(harness, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        eventId: 'event-same',
        taskInput: TASK_INPUT,
      }),
      reserveReviewTask(harness, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        eventId: 'event-same',
        taskInput: TASK_INPUT,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.task.id).toBe(buildReviewTaskId('event-same'));
    expect(second.value.task.id).toBe(first.value.task.id);
    expect([first.value.created, second.value.created].sort()).toEqual([false, true]);
    expect(harness.codeTaskRepo.create).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent different events for one PR into one active review task', async () => {
    const harness = createHarness();

    const [first, second] = await Promise.all([
      reserveReviewTask(harness, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        eventId: 'event-a',
        taskInput: TASK_INPUT,
      }),
      reserveReviewTask(harness, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        eventId: 'event-b',
        taskInput: { ...TASK_INPUT, traceId: 'event-b' },
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.task.id).toBe(second.value.task.id);
    expect(harness.codeTaskRepo.create).toHaveBeenCalledTimes(1);
  });

  it('keeps review slots isolated by user for the same repository and PR', async () => {
    const harness = createHarness();
    const first = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-user-1',
      taskInput: TASK_INPUT,
    });
    const second = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-user-2',
      taskInput: {
        ...TASK_INPUT,
        userId: 'user-2',
        traceId: 'event-user-2',
      },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.task.id).not.toBe(first.value.task.id);
    expect(second.value.task.userId).toBe('user-2');
    expect(harness.codeTaskRepo.create).toHaveBeenCalledTimes(2);
    expect(buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1'))
      .not.toBe(buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-2'));
  });

  it('durably maps a coalesced event to its queued task across a later redelivery', async () => {
    const harness = createHarness();
    const first = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-owner',
      taskInput: TASK_INPUT,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const coalesced = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-coalesced',
      taskInput: { ...TASK_INPUT, traceId: 'event-coalesced' },
    });
    expect(coalesced.ok).toBe(true);
    if (!coalesced.ok) return;
    expect(coalesced.value.task.id).toBe(first.value.task.id);

    const taskBeforeRunning = harness.tasks.get(first.value.task.id);
    expect(taskBeforeRunning).toBeDefined();
    if (taskBeforeRunning === undefined) return;
    harness.tasks.set(first.value.task.id, { ...taskBeforeRunning, status: 'running' });

    const redelivery = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-coalesced',
      taskInput: { ...TASK_INPUT, traceId: 'event-coalesced' },
    });

    expect(redelivery).toMatchObject(ok({
      created: false,
      task: { id: first.value.task.id, status: 'running' },
    }));
    expect(harness.codeTaskRepo.create).toHaveBeenCalledTimes(1);
  });

  it('atomically refreshes a queued successor with the latest event context and unions review types', async () => {
    const harness = createHarness();
    const first = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-initial',
      taskInput: {
        ...TASK_INPUT,
        traceId: 'event-initial',
        prompt: 'initial review prompt',
        sanitizedPrompt: 'initial review prompt',
        reviewTypes: ['code_quality'],
        reviewCommitSha: 'commit-old',
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-latest',
      taskInput: {
        ...TASK_INPUT,
        traceId: 'event-latest',
        prompt: 'latest review prompt',
        sanitizedPrompt: 'latest sanitized review prompt',
        reviewTypes: ['security', 'code_quality'],
        reviewCommitSha: 'commit-latest',
      },
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toBe(false);
    expect(second.value.task).toMatchObject({
      id: first.value.task.id,
      prompt: 'latest review prompt',
      sanitizedPrompt: 'latest sanitized review prompt',
      traceId: 'event-latest',
      reviewTypes: ['code_quality', 'security'],
      reviewCommitSha: 'commit-latest',
    });
    expect(harness.tasks.get(first.value.task.id)).toMatchObject({
      prompt: 'latest review prompt',
      sanitizedPrompt: 'latest sanitized review prompt',
      traceId: 'event-latest',
      reviewTypes: ['code_quality', 'security'],
      reviewCommitSha: 'commit-latest',
    });
  });

  it('does not replace explicit review context with an ordinary synchronize prompt', async () => {
    const harness = createHarness();
    const first = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-comment',
      promptPriority: 'review_comment',
      taskInput: {
        ...TASK_INPUT,
        prompt: 'Review types requested: code_quality\n\nexplicit review comment context',
        sanitizedPrompt: 'Review types requested: code_quality\n\nexplicit review comment context',
        traceId: 'event-comment',
        workerType: 'openrouter-free',
        linearIssueId: 'INT-PRIMARY',
        reviewCommitSha: 'commit-comment',
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const synchronize = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-synchronize',
      promptPriority: 'ordinary',
      taskInput: {
        ...TASK_INPUT,
        prompt: 'ordinary synchronize prompt',
        sanitizedPrompt: 'ordinary synchronize prompt',
        traceId: 'event-synchronize',
        workerType: 'opus',
        linearIssueId: 'INT-SECONDARY',
        reviewCommitSha: 'commit-synchronize',
        reviewTypes: ['security'],
      },
    });

    expect(synchronize).toMatchObject(ok({
      created: false,
      task: {
        id: first.value.task.id,
        prompt: 'Review types requested: code_quality, security\n\nexplicit review comment context',
        sanitizedPrompt: 'Review types requested: code_quality, security\n\nexplicit review comment context',
        traceId: 'event-synchronize',
        workerType: 'openrouter-free',
        linearIssueId: 'INT-PRIMARY',
        reviewCommitSha: 'commit-synchronize',
        reviewTypes: ['code_quality', 'security'],
      },
    }));
  });

  it('does not replace explicit Linear context with an ordinary synchronize prompt', async () => {
    const harness = createHarness();
    const first = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-linear',
      promptPriority: 'linear_context',
      taskInput: {
        ...TASK_INPUT,
        prompt: 'review prompt with Linear requirements',
        sanitizedPrompt: 'review prompt with Linear requirements',
        traceId: 'event-linear',
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const synchronize = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-synchronize-after-linear',
      promptPriority: 'ordinary',
      taskInput: {
        ...TASK_INPUT,
        prompt: 'ordinary synchronize prompt',
        sanitizedPrompt: 'ordinary synchronize prompt',
        traceId: 'event-synchronize-after-linear',
      },
    });

    expect(synchronize).toMatchObject(ok({
      created: false,
      task: {
        id: first.value.task.id,
        prompt: 'review prompt with Linear requirements',
        sanitizedPrompt: 'review prompt with Linear requirements',
      },
    }));
  });

  it('refreshes all dispatch metadata while preserving the task owner', async () => {
    const harness = createHarness();
    const first = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-metadata-old',
      taskInput: {
        ...TASK_INPUT,
        baseBranch: 'development',
        prBranch: 'feature/old',
        workerType: 'auto',
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const refreshed = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-metadata-new',
      taskInput: {
        ...TASK_INPUT,
        traceId: 'event-metadata-new',
        baseBranch: 'main',
        prBranch: 'feature/new',
        workerType: 'openrouter-free',
        linearIssueId: 'INT-2000',
      },
    });

    expect(refreshed).toMatchObject(ok({
      created: false,
      task: {
        id: first.value.task.id,
        userId: 'user-1',
        workerType: 'openrouter-free',
        baseBranch: 'main',
        prBranch: 'feature/new',
        linearIssueId: 'INT-2000',
      },
    }));
  });

  it('admits a new review to the persistent queue atomically and stamps queuedAt', async () => {
    const harness = createHarness();
    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-atomic-queue',
      maxQueueSize: 50,
      taskInput: TASK_INPUT,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task.queuedAt).toBeInstanceOf(Timestamp);
    expect(harness.tasks.get(result.value.task.id)?.queuedAt).toBeInstanceOf(Timestamp);
  });

  it('rejects a new review atomically when the persistent queue is full', async () => {
    const harness = createHarness();
    const queuedTask = makeTask({
      ...TASK_INPUT,
      id: 'task-unrelated-queued',
      repository: 'other/repository',
      prNumber: 9,
      agentType: 'execution',
    });
    harness.tasks.set(queuedTask.id, queuedTask);

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-queue-full',
      maxQueueSize: 1,
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({
      code: 'QUEUE_FULL',
      message: 'Code task queue is full',
    }));
    expect(harness.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('requests deterministic creation with generic prompt dedup disabled', async () => {
    const harness = createHarness();
    await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-dedup-bypass',
      taskInput: TASK_INPUT,
    });

    expect(harness.codeTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: buildReviewTaskId('event-dedup-bypass') }),
      expect.objectContaining({ skipPromptDedup: true }),
    );
  });

  it('creates a new review for a later event after the slot task becomes terminal', async () => {
    const harness = createHarness();
    const first = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-old',
      taskInput: TASK_INPUT,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    harness.tasks.set(first.value.task.id, {
      ...first.value.task,
      status: 'reviewed',
    });

    const second = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-new',
      taskInput: { ...TASK_INPUT, traceId: 'event-new' },
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toBe(true);
    expect(second.value.task.id).toBe(buildReviewTaskId('event-new'));
    expect(second.value.task.id).not.toBe(first.value.task.id);
    expect(harness.codeTaskRepo.create).toHaveBeenCalledTimes(2);
  });

  it.each(['dispatched', 'running'] as const)(
    'creates one queued successor when the slot task is %s and coalesces later events into it',
    async (status) => {
      const harness = createHarness();
      const first = await reserveReviewTask(harness, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        eventId: `event-${status}-old`,
        taskInput: TASK_INPUT,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      harness.tasks.set(first.value.task.id, { ...first.value.task, status });

      const successor = await reserveReviewTask(harness, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        eventId: `event-${status}-successor`,
        taskInput: { ...TASK_INPUT, traceId: `event-${status}-successor` },
      });
      const coalesced = await reserveReviewTask(harness, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        eventId: `event-${status}-later`,
        taskInput: { ...TASK_INPUT, traceId: `event-${status}-later` },
      });

      expect(successor.ok).toBe(true);
      expect(coalesced.ok).toBe(true);
      if (!successor.ok || !coalesced.ok) return;
      expect(successor.value.created).toBe(true);
      expect(successor.value.task.status).toBe('queued');
      expect(successor.value.task.id).toBe(buildReviewTaskId(`event-${status}-successor`));
      expect(coalesced.value).toMatchObject({
        created: false,
        task: {
          id: successor.value.task.id,
          traceId: `event-${status}-later`,
        },
      });
      expect(harness.slots.get(buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1')))
        .toMatchObject({ taskId: successor.value.task.id });
    },
  );

  it('reuses a valid legacy queued review and adopts it into the slot transactionally', async () => {
    const harness = createHarness();
    const legacy = makeTask({
      ...TASK_INPUT,
      id: 'task-legacy-queued-review',
      traceId: 'legacy-event',
    });
    harness.tasks.set(legacy.id, legacy);

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-adopt-legacy',
      taskInput: { ...TASK_INPUT, traceId: 'event-adopt-legacy' },
    });

    expect(result).toMatchObject(ok({
      task: {
        id: legacy.id,
        traceId: 'event-adopt-legacy',
      },
      created: false,
    }));
    expect(harness.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(harness.slots.get(buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1')))
      .toMatchObject({ taskId: legacy.id });
  });

  it('adopts the newest matching legacy review so queue cleanup keeps the slot survivor', async () => {
    const harness = createHarness();
    const older = makeTask({
      ...TASK_INPUT,
      id: 'task-legacy-older',
      traceId: 'legacy-older',
    });
    const newer = makeTask({
      ...TASK_INPUT,
      id: 'task-legacy-newer',
      traceId: 'legacy-newer',
    });
    older.createdAt = Timestamp.fromDate(new Date('2026-08-20T08:00:00.000Z'));
    newer.createdAt = Timestamp.fromDate(new Date('2026-08-20T09:00:00.000Z'));
    harness.tasks.set(older.id, older);
    harness.tasks.set(newer.id, newer);

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-adopt-newest-legacy',
      taskInput: { ...TASK_INPUT, traceId: 'event-adopt-newest-legacy' },
    });

    expect(result).toMatchObject(ok({
      task: { id: newer.id },
      created: false,
    }));
    expect(harness.slots.get(buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1')))
      .toMatchObject({ taskId: newer.id });
  });

  it('stores event markers in a dedicated TTL collection group', async () => {
    const harness = createHarness();

    await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-retained-boundedly',
      taskInput: TASK_INPUT,
    });

    const marker = [...harness.slots.entries()].find(([path]) =>
      path.includes('/code_review_events/')
    );
    expect(marker).toBeDefined();
    expect(marker?.[1]['expireAt']).toBeInstanceOf(Timestamp);
  });

  it('ignores and replaces a slot that points at a foreign queued task', async () => {
    const harness = createHarness();
    const slotPath = buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1');
    const foreign = makeTask({
      ...TASK_INPUT,
      id: 'task-foreign',
      repository: 'other/repository',
      prNumber: 99,
      agentType: 'execution',
    });
    harness.tasks.set(foreign.id, foreign);
    harness.slots.set(slotPath, { taskId: foreign.id });

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-replace-foreign',
      taskInput: { ...TASK_INPUT, traceId: 'event-replace-foreign' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(true);
    expect(result.value.task.id).toBe(buildReviewTaskId('event-replace-foreign'));
    expect(harness.slots.get(slotPath)).toMatchObject({ taskId: result.value.task.id });
  });

  it('replaces a corrupt slot and stores updatedAt as a Firestore Timestamp', async () => {
    const harness = createHarness();
    const slotPath = buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1');
    harness.slots.set(slotPath, { taskId: '' });

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-replace-corrupt',
      taskInput: { ...TASK_INPUT, traceId: 'event-replace-corrupt' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = harness.slots.get(slotPath);
    expect(slot).toMatchObject({ taskId: result.value.task.id });
    expect(slot?.['updatedAt']).toBeInstanceOf(Timestamp);
  });

  it('returns the deterministic event task without consulting the PR slot', async () => {
    const harness = createHarness();
    const taskId = buildReviewTaskId('event-known');
    harness.tasks.set(taskId, makeTask({ ...TASK_INPUT, id: taskId }));

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-known',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(ok({ task: harness.tasks.get(taskId), created: false }));
    expect(harness.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('fails closed when the deterministic task lookup fails', async () => {
    const harness = createHarness();
    vi.mocked(harness.codeTaskRepo.findById).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'event lookup failed' }),
    );

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-error',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'event lookup failed' }));
    expect(harness.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('fails closed when the active slot task lookup fails', async () => {
    const harness = createHarness();
    harness.slots.set(buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1'), {
      taskId: 'task-slot',
    });
    vi.mocked(harness.codeTaskRepo.findById)
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'event missing' }))
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'slot lookup failed' }));

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-slot-error',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'slot lookup failed' }));
    expect(harness.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('propagates task creation failures without moving the PR slot', async () => {
    const harness = createHarness();
    vi.mocked(harness.codeTaskRepo.create).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'create failed' }),
    );

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-create-error',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'create failed' }));
    expect(harness.slots.size).toBe(0);
  });

  it('wraps a Firestore transaction exception', async () => {
    const harness = createHarness();
    vi.mocked(harness.firestore.runTransaction).mockRejectedValueOnce(new Error('transaction aborted'));

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-transaction-error',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({
      code: 'FIRESTORE_ERROR',
      message: 'Firestore error: transaction aborted',
    }));
  });

  it.each([
    ['Triggered by review request comment:', 'review_comment'],
    ['### Issue Requirements', 'linear_context'],
  ] as const)('infers %s priority while adopting a legacy review', async (prompt, expectedPriority) => {
    const harness = createHarness();
    const taskInputWithoutReviewTypes: CreateTaskInput = { ...TASK_INPUT };
    delete taskInputWithoutReviewTypes.reviewTypes;
    harness.tasks.set('task-legacy-priority', makeTask({
      ...TASK_INPUT,
      id: 'task-legacy-priority',
      prompt: `${prompt}\nReview types requested: code_quality`,
      sanitizedPrompt: `${prompt}\nReview types requested: code_quality`,
    }));

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: `event-${expectedPriority}`,
      taskInput: {
        ...taskInputWithoutReviewTypes,
        dispatchSchedule: {
          notBeforeAt: new Date('2026-08-20T10:00:00.000Z'),
          source: 'retry_cooloff',
          derivedBy: 'fallback',
          derivedFromTaskId: 'task-source',
        },
      },
      promptPriority: 'ordinary',
    });

    expect(result.ok).toBe(true);
    const slot = harness.slots.get(buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1'));
    expect(slot?.['promptPriority']).toBe(expectedPriority);
    if (!result.ok) return;
    expect(result.value.task.dispatchSchedule?.notBeforeAt).toBeInstanceOf(Timestamp);
  });

  it('rejects a corrupt event marker without a task id', async () => {
    const harness = createHarness();
    const slotPath = buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1');
    harness.slots.set(buildReviewTaskEventPath(slotPath, 'event-corrupt-marker'), {});

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-corrupt-marker',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({
      code: 'FIRESTORE_ERROR',
      message: 'Invalid review reservation: event marker has no taskId',
    }));
  });

  it('fails closed when an event marker task cannot be read', async () => {
    const harness = createHarness();
    const slotPath = buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1');
    harness.slots.set(buildReviewTaskEventPath(slotPath, 'event-marker-read-error'), {
      taskId: 'task-marker',
    });
    vi.mocked(harness.codeTaskRepo.findById).mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'marker lookup failed' }),
    );

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-marker-read-error',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'marker lookup failed' }));
  });

  it('rejects an event marker that points to another owner task', async () => {
    const harness = createHarness();
    const slotPath = buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1');
    const foreignTask = makeTask({ ...TASK_INPUT, id: 'task-foreign-marker', userId: 'user-2' });
    harness.tasks.set(foreignTask.id, foreignTask);
    harness.slots.set(buildReviewTaskEventPath(slotPath, 'event-foreign-marker'), {
      taskId: foreignTask.id,
    });

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-foreign-marker',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({
      code: 'FIRESTORE_ERROR',
      message: 'Invalid review reservation: event marker points to a foreign task',
    }));
  });

  it('refreshes a marked queued task when its slot document is missing', async () => {
    const harness = createHarness();
    const slotPath = buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1');
    const task = makeTask({ ...TASK_INPUT, id: 'task-marked-queued' });
    harness.tasks.set(task.id, task);
    harness.slots.set(buildReviewTaskEventPath(slotPath, 'event-marked-queued'), {
      taskId: task.id,
    });

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-marked-queued',
      taskInput: { ...TASK_INPUT, prompt: 'new prompt', sanitizedPrompt: 'new prompt' },
    });

    expect(result.ok).toBe(true);
    expect(harness.slots.get(slotPath)?.['taskId']).toBe(task.id);
  });

  it('rejects a deterministic task id owned by another review', async () => {
    const harness = createHarness();
    const taskId = buildReviewTaskId('event-foreign-deterministic');
    harness.tasks.set(taskId, makeTask({ ...TASK_INPUT, id: taskId, repository: 'other/repo' }));

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-foreign-deterministic',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({
      code: 'FIRESTORE_ERROR',
      message: 'Invalid review reservation: deterministic task id belongs to a foreign task',
    }));
  });

  it('refreshes a deterministic queued task when its slot document is missing', async () => {
    const harness = createHarness();
    const taskId = buildReviewTaskId('event-deterministic-queued');
    harness.tasks.set(taskId, makeTask({ ...TASK_INPUT, id: taskId }));

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-deterministic-queued',
      taskInput: { ...TASK_INPUT, traceId: 'latest-trace' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task.traceId).toBe('latest-trace');
  });

  it('replaces a slot whose referenced task disappeared', async () => {
    const harness = createHarness();
    harness.slots.set(buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1'), {
      taskId: 'task-missing-slot-target',
    });

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-missing-slot-target',
      taskInput: TASK_INPUT,
    });

    expect(result.ok).toBe(true);
    expect(harness.codeTaskRepo.create).toHaveBeenCalledOnce();
  });

  it('ignores a legacy query row that disappears before its transactional read', async () => {
    const harness = createHarness();
    harness.tasks.set('task-legacy-disappeared', makeTask({
      ...TASK_INPUT,
      id: 'task-legacy-disappeared',
    }));
    vi.mocked(harness.codeTaskRepo.findById)
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'event missing' }))
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'legacy disappeared' }));

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-legacy-disappeared',
      taskInput: TASK_INPUT,
    });

    expect(result.ok).toBe(true);
    expect(harness.codeTaskRepo.create).toHaveBeenCalledOnce();
  });

  it('fails closed when a legacy query row cannot be read', async () => {
    const harness = createHarness();
    harness.tasks.set('task-legacy-error', makeTask({ ...TASK_INPUT, id: 'task-legacy-error' }));
    vi.mocked(harness.codeTaskRepo.findById)
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'event missing' }))
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'legacy read failed' }));

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-legacy-error',
      taskInput: TASK_INPUT,
    });

    expect(result).toEqual(err({ code: 'FIRESTORE_ERROR', message: 'legacy read failed' }));
  });

  it('rejects all new review admissions when queue capacity is zero', async () => {
    const result = await reserveReviewTask(createHarness(), {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-zero-capacity',
      taskInput: TASK_INPUT,
      maxQueueSize: 0,
    });

    expect(result).toEqual(err({ code: 'QUEUE_FULL', message: 'Code task queue is full' }));
  });

  it('refreshes a deterministic queued task using its existing slot priority', async () => {
    const harness = createHarness();
    const eventId = 'event-deterministic-with-slot';
    const taskId = buildReviewTaskId(eventId);
    const slotPath = buildReviewTaskSlotPath('pbuchman/intexuraos', 42, 'user-1');
    harness.tasks.set(taskId, makeTask({ ...TASK_INPUT, id: taskId }));
    harness.slots.set(slotPath, { taskId, promptPriority: 'ordinary' });

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId,
      taskInput: TASK_INPUT,
    });

    expect(result.ok).toBe(true);
    expect(harness.slots.get(slotPath)?.['taskId']).toBe(taskId);
  });

  it('skips a legacy query row whose transactional task belongs to another owner', async () => {
    const harness = createHarness();
    harness.tasks.set('task-legacy-query-row', makeTask({
      ...TASK_INPUT,
      id: 'task-legacy-query-row',
    }));
    vi.mocked(harness.codeTaskRepo.findById)
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'event missing' }))
      .mockResolvedValueOnce(ok(makeTask({
        ...TASK_INPUT,
        id: 'task-legacy-query-row',
        userId: 'different-user',
      })));

    const result = await reserveReviewTask(harness, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      eventId: 'event-legacy-owner-race',
      taskInput: TASK_INPUT,
    });

    expect(result.ok).toBe(true);
    expect(harness.codeTaskRepo.create).toHaveBeenCalledOnce();
  });
});
