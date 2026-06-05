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
    await statusRepo.resolveActive({
      userId: 'user-1',
      workerType: 'sonnet',
      reasons: ['claude_auth_unavailable'],
    });

    const result = await statusRepo.listActiveForUser('user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('list failed');
    expect(result.value).toEqual([]);
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
