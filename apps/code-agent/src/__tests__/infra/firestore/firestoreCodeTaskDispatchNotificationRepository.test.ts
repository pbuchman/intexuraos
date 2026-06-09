import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Logger } from '@intexuraos/common-core';
import {
  createFirestoreCodeTaskDispatchNotificationRepository,
  DISPATCH_NOTIFICATION_RETRY_AFTER_MS,
  isRetryableExistingReservation,
  timestampMillis,
} from '../../../infra/firestore/firestoreCodeTaskDispatchNotificationRepository.js';

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
  const id = 'task-1:whatsapp:workers_unreachable:waiting';
  const nowMs = new Date('2026-06-08T10:00:00.000Z').getTime();

  async function seedNotification(data: Record<string, unknown>): Promise<void> {
    await (fakeFirestore as unknown as Firestore)
      .collection('code_task_dispatch_notifications')
      .doc(id)
      .set(data);
  }

  it('parses retry timestamp formats defensively', () => {
    expect(timestampMillis({
      toDate: () => new Date('2026-06-08T09:00:00.000Z'),
    })).toBe(new Date('2026-06-08T09:00:00.000Z').getTime());
    expect(timestampMillis('2026-06-08T09:00:00.000Z')).toBe(new Date('2026-06-08T09:00:00.000Z').getTime());
    expect(timestampMillis('not-a-date')).toBeUndefined();
    expect(timestampMillis(null)).toBeUndefined();
    expect(timestampMillis(undefined)).toBeUndefined();
    expect(timestampMillis({ toDate: 'not-a-function' })).toBeUndefined();
  });

  it('classifies existing notification reservations for retry leases', () => {
    expect(isRetryableExistingReservation({ status: 'delivered' }, nowMs)).toBe(false);
    expect(isRetryableExistingReservation({ status: 'created' }, nowMs)).toBe(true);
    expect(isRetryableExistingReservation({ status: 'reserved' }, nowMs)).toBe(true);
    expect(isRetryableExistingReservation(undefined, nowMs)).toBe(true);
    expect(isRetryableExistingReservation({
      status: 'reserved',
      updatedAt: {
        toDate: () => new Date(nowMs - DISPATCH_NOTIFICATION_RETRY_AFTER_MS),
      },
    }, nowMs)).toBe(false);
    expect(isRetryableExistingReservation({
      status: 'failed',
      updatedAt: {
        toDate: () => new Date(nowMs - DISPATCH_NOTIFICATION_RETRY_AFTER_MS - 1),
      },
    }, nowMs)).toBe(true);
  });

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

    const freshRetry = await notificationRepo.reserve(input);
    expect(freshRetry.ok).toBe(true);
    if (!freshRetry.ok) return;
    expect(freshRetry.value.reserved).toBe(false);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

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

  it('allows retry after a reserved side effect becomes stale', async () => {
    const notificationRepo = repo();
    const first = await notificationRepo.reserve(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const freshRetry = await notificationRepo.reserve(input);
    expect(freshRetry.ok).toBe(true);
    if (!freshRetry.ok) return;
    expect(freshRetry.value.reserved).toBe(false);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

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

  it('allows retry for stale reservations stored with string timestamps', async () => {
    await seedNotification({
      taskId: input.taskId,
      channel: input.channel,
      reason: input.reason,
      phase: input.phase,
      status: 'reserved',
      attempts: 1,
      updatedAt: '2026-06-08T09:54:59.999Z',
    });
    const notificationRepo = repo();

    const retry = await notificationRepo.reserve(input);

    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value).toEqual({ reserved: true, id });
  });

  it('keeps fresh reservations stored with string timestamps reserved', async () => {
    await seedNotification({
      taskId: input.taskId,
      channel: input.channel,
      reason: input.reason,
      phase: input.phase,
      status: 'reserved',
      attempts: 1,
      updatedAt: '2026-06-08T09:59:00.000Z',
    });
    const notificationRepo = repo();

    const retry = await notificationRepo.reserve(input);

    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value).toEqual({ reserved: false, id });
  });

  it('allows retry when reservation updatedAt is missing or invalid', async () => {
    const notificationRepo = repo();
    await seedNotification({
      taskId: input.taskId,
      channel: input.channel,
      reason: input.reason,
      phase: input.phase,
      status: 'failed',
      attempts: 1,
    });

    const missingTimestampRetry = await notificationRepo.reserve(input);

    expect(missingTimestampRetry.ok).toBe(true);
    if (!missingTimestampRetry.ok) return;
    expect(missingTimestampRetry.value).toEqual({ reserved: true, id });

    await seedNotification({
      taskId: input.taskId,
      channel: input.channel,
      reason: input.reason,
      phase: input.phase,
      status: 'failed',
      attempts: 2,
      updatedAt: 'not-a-date',
    });

    const invalidTimestampRetry = await notificationRepo.reserve(input);

    expect(invalidTimestampRetry.ok).toBe(true);
    if (!invalidTimestampRetry.ok) return;
    expect(invalidTimestampRetry.value).toEqual({ reserved: true, id });
  });

  it('allows retry for an unexpected nonterminal status', async () => {
    await seedNotification({
      taskId: input.taskId,
      channel: input.channel,
      reason: input.reason,
      phase: input.phase,
      status: 'created',
      attempts: 1,
      updatedAt: '2026-06-08T09:59:59.999Z',
    });
    const notificationRepo = repo();

    const retry = await notificationRepo.reserve(input);

    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value).toEqual({ reserved: true, id });
  });
});
