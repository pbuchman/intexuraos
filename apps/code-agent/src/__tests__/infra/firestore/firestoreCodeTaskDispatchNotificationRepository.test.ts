import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Logger } from '@intexuraos/common-core';
import { createFirestoreCodeTaskDispatchNotificationRepository } from '../../../infra/firestore/firestoreCodeTaskDispatchNotificationRepository.js';

describe('FirestoreCodeTaskDispatchNotificationRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T10:00:00.000Z'));
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

  function repo(): ReturnType<typeof createFirestoreCodeTaskDispatchNotificationRepository> {
    return createFirestoreCodeTaskDispatchNotificationRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });
  }

  const input = {
    taskId: 'task-1',
    channel: 'whatsapp' as const,
    reason: 'workers_unreachable' as const,
    phase: 'waiting' as const,
  };

  it('reserves a task/channel/reason/phase only once while reserved or delivered', async () => {
    const notificationRepo = repo();

    const first = await notificationRepo.reserve(input);
    const second = await notificationRepo.reserve(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).toEqual({
      reserved: true,
      id: 'task-1:whatsapp:workers_unreachable:waiting',
    });
    expect(second.value).toEqual({
      reserved: false,
      id: 'task-1:whatsapp:workers_unreachable:waiting',
    });

    const delivered = await notificationRepo.markDelivered(first.value.id);
    expect(delivered.ok).toBe(true);
    const afterDelivered = await notificationRepo.reserve(input);
    expect(afterDelivered.ok).toBe(true);
    if (!afterDelivered.ok) return;
    expect(afterDelivered.value.reserved).toBe(false);
  });

  it('allows retry after a failed side effect and increments attempts', async () => {
    const notificationRepo = repo();
    const first = await notificationRepo.reserve(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const failed = await notificationRepo.markFailed(first.value.id, 'pubsub down');
    expect(failed.ok).toBe(true);

    const retry = await notificationRepo.reserve(input);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.reserved).toBe(true);

    const snapshot = await (fakeFirestore as unknown as Firestore)
      .collection('code_task_dispatch_notifications')
      .doc(first.value.id)
      .get();
    expect(snapshot.data()).toEqual(expect.objectContaining({
      status: 'reserved',
      attempts: 2,
      lastError: null,
    }));
  });
});
