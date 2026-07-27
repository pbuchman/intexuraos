import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Logger } from '@intexuraos/common-core';
import {
  buildCodeTaskSystemStatusId,
  createFirestoreCodeTaskSystemStatusRepository,
} from '../../../infra/firestore/codeTaskSystemStatusRepository.js';
import type { CodeTaskSystemStatusRepository } from '../../../domain/repositories/codeTaskSystemStatusRepository.js';

describe('FirestoreCodeTaskSystemStatusRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T10:00:00.000Z'));
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
    vi.useRealTimers();
    resetFirestore();
  });

  function repo(): CodeTaskSystemStatusRepository {
    return createFirestoreCodeTaskSystemStatusRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });
  }

  it('builds deterministic safe ids from user, worker type, and reason', () => {
    expect(
      buildCodeTaskSystemStatusId('auth0|user/with/slash', 'codex-xhigh', 'codex_auth_unavailable')
    ).toBe('code-task-dispatch__auth0%7Cuser%2Fwith%2Fslash__codex-xhigh__codex_auth_unavailable');
  });

  it('upserts an active status and preserves firstSeenAt on later observations', async () => {
    const statusRepo = repo();

    const first = await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      reason: 'codex_auth_unavailable',
      severity: 'critical',
      message: 'Codex unavailable',
      remediation: 'Refresh Codex auth',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-1'],
      workerNames: ['home-dev'],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('first upsert failed');

    vi.setSystemTime(new Date('2026-06-05T11:00:00.000Z'));
    const second = await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      reason: 'codex_auth_unavailable',
      severity: 'critical',
      message: 'Codex still unavailable',
      remediation: 'Refresh Codex auth',
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1', 'task-2'],
      workerNames: ['home-dev'],
    });

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('second upsert failed');
    expect(second.value.firstSeenAt.toISOString()).toBe('2026-06-05T10:00:00.000Z');
    expect(second.value.lastSeenAt.toISOString()).toBe('2026-06-05T11:00:00.000Z');
    expect(second.value.affectedTaskCount).toBe(2);
    expect(second.value.message).toBe('Codex still unavailable');
  });

  it('starts a fresh firstSeenAt when a resolved status becomes active again', async () => {
    const statusRepo = repo();
    const input = {
      userId: 'user-1',
      workerType: 'codex-xhigh',
      reason: 'workers_unreachable' as const,
      severity: 'critical' as const,
      message: 'Workers unreachable',
      remediation: 'Restore worker connectivity',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-1'],
      workerNames: ['home-dev'],
    };

    const first = await statusRepo.upsertActive(input);
    expect(first.ok).toBe(true);
    const resolved = await statusRepo.resolveActive({
      userId: input.userId,
      workerType: input.workerType,
    });
    expect(resolved.ok).toBe(true);

    vi.setSystemTime(new Date('2026-06-06T10:00:00.000Z'));
    const recurring = await statusRepo.upsertActive({
      ...input,
      exampleTaskIds: ['task-2'],
    });

    expect(recurring.ok).toBe(true);
    if (!recurring.ok) throw new Error('recurring upsert failed');
    expect(recurring.value.firstSeenAt.toISOString()).toBe('2026-06-06T10:00:00.000Z');
    expect(recurring.value.resolvedAt).toBeUndefined();
  });

  it('keeps only the latest active blocker reason for a user and worker type', async () => {
    const statusRepo = repo();
    await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      reason: 'workers_unreachable',
      severity: 'critical',
      message: 'Workers unreachable',
      remediation: 'Restore connectivity',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-1'],
      workerNames: ['home-dev'],
    });

    await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      reason: 'workers_at_capacity',
      severity: 'warning',
      message: 'Workers at capacity',
      remediation: 'Wait for capacity',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-1'],
      workerNames: ['home-dev'],
    });

    const result = await statusRepo.listActiveForUser('user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('list failed');
    expect(result.value.map((status) => status.reason)).toEqual(['workers_at_capacity']);
  });

  it('does not resolve a blocker observed after the resolver began reconciling the queue', async () => {
    const statusRepo = repo();
    vi.setSystemTime(new Date('2026-06-05T11:00:00.000Z'));
    await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      reason: 'workers_at_capacity',
      severity: 'warning',
      message: 'Workers at capacity',
      remediation: 'Wait for capacity',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-2'],
      workerNames: ['home-dev'],
    });

    const resolved = await statusRepo.resolveActive({
      userId: 'user-1',
      workerType: 'codex-xhigh',
      observedBefore: new Date('2026-06-05T10:30:00.000Z'),
    });
    const active = await statusRepo.listActiveForUser('user-1');

    expect(resolved).toEqual({ ok: true, value: 0 });
    expect(active.ok).toBe(true);
    if (!active.ok) throw new Error('list failed');
    expect(active.value).toHaveLength(1);
  });

  it('lists only active statuses for the requested user', async () => {
    const statusRepo = repo();
    await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'sonnet',
      reason: 'claude_auth_unavailable',
      severity: 'critical',
      message: 'Claude unavailable',
      remediation: 'Refresh Claude auth',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-1'],
      workerNames: ['home-dev'],
    });
    await statusRepo.upsertActive({
      userId: 'user-2',
      workerType: 'codex',
      reason: 'codex_auth_unavailable',
      severity: 'critical',
      message: 'Codex unavailable',
      remediation: 'Refresh Codex auth',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-2'],
      workerNames: ['home-dev'],
    });
    await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'opus',
      reason: 'workers_unreachable',
      severity: 'critical',
      message: 'Workers unreachable',
      remediation: 'Restore worker connectivity',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-3'],
      workerNames: ['home-dev'],
    });
    const resolved = await statusRepo.resolveActive({
      userId: 'user-1',
      workerType: 'sonnet',
      reasons: ['claude_auth_unavailable'],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('resolve failed');
    expect(resolved.value).toBe(1);

    const result = await statusRepo.listActiveForUser('user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('list failed');
    expect(result.value).toMatchObject([
      {
        userId: 'user-1',
        workerType: 'opus',
        reason: 'workers_unreachable',
        status: 'active',
      },
    ]);
  });

  it('marks a status as notified', async () => {
    const statusRepo = repo();
    const status = await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'glm',
      reason: 'provider_auth_unavailable',
      severity: 'critical',
      message: 'Provider key unavailable',
      remediation: 'Configure provider key',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-1'],
      workerNames: ['home-dev'],
    });
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error('upsert failed');

    const notifiedAt = new Date('2026-06-05T12:00:00.000Z');
    const markResult = await statusRepo.markNotified(status.value.id, notifiedAt);
    expect(markResult.ok).toBe(true);

    const doc = await (fakeFirestore as unknown as Firestore)
      .collection('code_task_system_statuses')
      .doc(status.value.id)
      .get();
    expect((doc.data()?.['lastNotifiedAt'] as Timestamp).toDate().toISOString()).toBe(
      notifiedAt.toISOString()
    );
  });

  it('preserves lastNotifiedAt when an active status is observed again', async () => {
    const statusRepo = repo();
    const status = await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'codex',
      reason: 'codex_auth_unavailable',
      severity: 'critical',
      message: 'Codex unavailable',
      remediation: 'Refresh Codex auth',
      affectedTaskCount: 1,
      exampleTaskIds: ['task-1'],
      workerNames: ['home-dev'],
    });
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error('upsert failed');

    const notifiedAt = new Date('2026-06-05T12:00:00.000Z');
    const markResult = await statusRepo.markNotified(status.value.id, notifiedAt);
    expect(markResult.ok).toBe(true);

    const updated = await statusRepo.upsertActive({
      userId: 'user-1',
      workerType: 'codex',
      reason: 'codex_auth_unavailable',
      severity: 'critical',
      message: 'Codex still unavailable',
      remediation: 'Refresh Codex auth',
      affectedTaskCount: 2,
      exampleTaskIds: ['task-1', 'task-2'],
      workerNames: ['home-dev'],
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error('second upsert failed');
    expect(updated.value.lastNotifiedAt?.toISOString()).toBe(notifiedAt.toISOString());
  });

  it('deserializes legacy Date and string timestamp fields', async () => {
    const statusRepo = repo();
    const statusId = buildCodeTaskSystemStatusId('user-1', 'opus', 'claude_auth_unavailable');
    await (fakeFirestore as unknown as Firestore)
      .collection('code_task_system_statuses')
      .doc(statusId)
      .set({
        userId: 'user-1',
        component: 'code-task-dispatch',
        status: 'active',
        severity: 'critical',
        workerType: 'opus',
        reason: 'claude_auth_unavailable',
        message: 'Claude unavailable',
        remediation: 'Refresh Claude auth',
        affectedTaskCount: 1,
        exampleTaskIds: ['task-1'],
        workerNames: ['home-dev'],
        firstSeenAt: '2026-06-05T09:00:00.000Z',
        lastSeenAt: new Date('2026-06-05T10:00:00.000Z'),
        resolvedAt: '2026-06-05T10:30:00.000Z',
        lastNotifiedAt: '2026-06-05T11:00:00.000Z',
      });

    const result = await statusRepo.listActiveForUser('user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('list failed');
    expect(result.value[0]?.firstSeenAt.toISOString()).toBe('2026-06-05T09:00:00.000Z');
    expect(result.value[0]?.lastSeenAt.toISOString()).toBe('2026-06-05T10:00:00.000Z');
    expect(result.value[0]?.resolvedAt?.toISOString()).toBe('2026-06-05T10:30:00.000Z');
    expect(result.value[0]?.lastNotifiedAt?.toISOString()).toBe('2026-06-05T11:00:00.000Z');
  });
});
