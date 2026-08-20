/**
 * Tests for atomic Sentry task reservation persistence and idempotency.
 */

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type {
  AcquireSentryTaskReservationInput,
  AcquireSentryTaskReservationResult,
  NormalizedSentryIssueEvent,
} from '../../../domain/models/sentryIssueEvent.js';
import type { SentryIssueEventRepository } from '../../../domain/repositories/sentryIssueEventRepository.js';
import {
  createFirestoreSentryIssueEventRepository,
  createSentryIssueDedupeKey,
  createSentryProblemDedupeKey,
} from '../../../infra/firestore/sentryIssueEventRepository.js';

function buildEvent(overrides: Partial<NormalizedSentryIssueEvent> = {}): NormalizedSentryIssueEvent {
  return {
    resource: 'issue',
    action: 'created',
    organizationSlug: 'intexuraos-dev-pbuchman',
    projectSlug: 'intexuraos-development',
    projectId: '100',
    issueId: '4509001',
    issueShortId: 'INTEXURAOS-DEVELOPMENT-7',
    issueTitle: 'TypeError: Cannot read properties of undefined',
    issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
    status: 'unresolved',
    eventId: undefined,
    ...overrides,
  };
}

function buildAcquireInput(
  event: NormalizedSentryIssueEvent,
  overrides: Partial<AcquireSentryTaskReservationInput> = {}
): AcquireSentryTaskReservationInput {
  return {
    event,
    receivedAt: new Date('2026-07-29T10:00:00.000Z'),
    proposedCodeTaskId: 'task_proposed',
    leaseOwner: 'delivery-1',
    leaseDurationMs: 60_000,
    payload: { delivery: 1 },
    ...overrides,
  };
}

function createLegacyProblemKey(event: NormalizedSentryIssueEvent): string {
  const projectIdentity = event.projectId ?? event.projectSlug;
  const normalizedTitle = event.issueTitle.trim().toLowerCase().replace(/\s+/g, ' ') || 'unknown';
  const fingerprint = createHash('sha256')
    .update(`${event.organizationSlug}\0${projectIdentity}\0${normalizedTitle}`)
    .digest('hex')
    .slice(0, 32);
  return `sentry-task:${event.organizationSlug}:${projectIdentity}:${fingerprint}`;
}

function expectAcquired(
  result: Awaited<ReturnType<SentryIssueEventRepository['acquire']>>
): Extract<AcquireSentryTaskReservationResult, { kind: 'acquired' }> {
  if (!result.ok || result.value.kind !== 'acquired') throw new Error('Expected acquired reservation');
  return result.value;
}

describe('createFirestoreSentryIssueEventRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repo: SentryIssueEventRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repo = createFirestoreSentryIssueEventRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger: pino({ level: 'silent' }),
    });
  });

  afterEach(() => {
    resetFirestore();
  });

  it('builds transition identity from organization, stable project, issue, and event id', () => {
    expect(createSentryIssueDedupeKey(buildEvent({
      resource: 'event_alert',
      action: 'triggered',
      eventId: 'ABC-123',
    }))).toBe('sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:event:abc-123');
  });

  it('preserves resource and normalized action when historical payloads omit event id', () => {
    expect(createSentryIssueDedupeKey(buildEvent({ action: '   ' }))).toBe(
      'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:unknown'
    );
  });

  it('builds issue identity from organization, stable project, and stable issue id', () => {
    const original = createSentryProblemDedupeKey(buildEvent({ issueTitle: 'Original title' }));
    const renamed = createSentryProblemDedupeKey(buildEvent({ issueTitle: 'Renamed title' }));
    const differentIssue = createSentryProblemDedupeKey(buildEvent({
      issueId: '4509002',
      issueTitle: 'Original title',
    }));

    expect(original).toBe('sentry-task:intexuraos-dev-pbuchman:intexuraos-development:4509001');
    expect(renamed).toBe(original);
    expect(differentIssue).not.toBe(original);
  });

  it('uses one canonical project identity with and without a project id', () => {
    expect(createSentryProblemDedupeKey(buildEvent({ projectId: '100' }))).toBe(
      createSentryProblemDedupeKey(buildEvent({ projectId: undefined }))
    );
  });

  it('falls back to project slug when Sentry omits project id', () => {
    expect(createSentryProblemDedupeKey(buildEvent({ projectId: undefined }))).toBe(
      'sentry-task:intexuraos-dev-pbuchman:intexuraos-development:4509001'
    );
  });

  it('atomically creates transition and issue leases with serialized audit data', async () => {
    const event = buildEvent({
      resource: 'event_alert',
      action: 'triggered',
      projectId: undefined,
      issueShortId: undefined,
      status: undefined,
      eventId: 'event-1',
    });
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event, {
      payload: { '': [['nested', 'array']], raw: true },
    })));
    const transition = await fakeFirestore.collection('sentry-issue-events').doc(acquired.transitionKey).get();
    const issue = await fakeFirestore.collection('sentry-issue-events').doc(acquired.issueKey).get();

    expect(transition.data()).toEqual(expect.objectContaining({
      dedupeKey: acquired.transitionKey,
      recordType: 'transition',
      state: 'reserved',
      projectId: null,
      issueShortId: null,
      status: null,
      eventId: 'event-1',
      proposedCodeTaskId: 'task_proposed',
      leaseToken: acquired.leaseToken,
      leaseOwner: 'delivery-1',
      failureReason: null,
      codeTaskId: null,
      linearIssueId: null,
      duplicateCount: 0,
      payload: '{"":[["nested","array"]],"raw":true}',
    }));
    expect(issue.data()).toEqual(expect.objectContaining({
      dedupeKey: acquired.issueKey,
      recordType: 'issue',
      state: 'reserved',
      leaseToken: acquired.leaseToken,
    }));
  });

  it('serializes an undefined payload as null', async () => {
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(buildEvent(), {
      payload: undefined,
    })));
    const transition = await fakeFirestore.collection('sentry-issue-events').doc(acquired.transitionKey).get();

    expect(transition.data()?.['payload']).toBe('null');
  });

  it('returns retryable for an exact event with an active lease but no task', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event)));
    const retryAt = new Date('2026-07-29T10:00:10.000Z');

    const retry = await repo.acquire(buildAcquireInput(event, {
      receivedAt: retryAt,
      proposedCodeTaskId: 'task_retry',
      leaseOwner: 'delivery-2',
      payload: { delivery: 2 },
    }));
    const transition = await fakeFirestore.collection('sentry-issue-events').doc(acquired.transitionKey).get();

    expect(retry).toEqual({ ok: true, value: { kind: 'retryable' } });
    expect(transition.data()).toEqual(expect.objectContaining({
      duplicateCount: 1,
      payload: '{"delivery":2}',
      leaseOwner: 'delivery-1',
    }));
    expect((transition.data()?.['latestReceivedAt'] as { toDate(): Date }).toDate()).toEqual(retryAt);
  });

  it('returns duplicate when an active exact-event lease already records its task', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-active-task' });
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event)));
    const transitionRef = fakeFirestore.collection('sentry-issue-events').doc(acquired.transitionKey);
    const transition = await transitionRef.get();
    await transitionRef.set({ ...transition.data(), codeTaskId: 'task-active-known' });

    const retry = await repo.acquire(buildAcquireInput(event, {
      receivedAt: new Date('2026-07-29T10:00:01.000Z'),
      leaseOwner: 'delivery-2',
    }));

    expect(retry).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task-active-known' },
    });
  });

  it('rebuilds a missing issue tombstone from an exact transition with a known task', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-exact-known' });
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event)));
    await repo.failReservation({
      transitionKey: acquired.transitionKey,
      issueKey: acquired.issueKey,
      leaseToken: acquired.leaseToken,
      reason: 'task already exists',
      codeTaskId: 'task-exact-known',
    });
    await fakeFirestore.collection('sentry-issue-events').doc(acquired.issueKey).delete();

    const retry = await repo.acquire(buildAcquireInput(event, {
      receivedAt: new Date('2026-07-29T10:00:01.000Z'),
      leaseOwner: 'delivery-2',
    }));
    const rebuiltIssue = await fakeFirestore.collection('sentry-issue-events').doc(acquired.issueKey).get();

    expect(retry).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task-exact-known' },
    });
    expect(rebuiltIssue.data()).toEqual(expect.objectContaining({ codeTaskId: 'task-exact-known' }));
  });

  it('returns the known task tombstone for an exact event after a recorded task failure', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-known' });
    const first = expectAcquired(await repo.acquire(buildAcquireInput(event)));
    await repo.failReservation({
      transitionKey: first.transitionKey,
      issueKey: first.issueKey,
      leaseToken: first.leaseToken,
      reason: 'enqueue failed',
      codeTaskId: first.codeTaskId,
    });
    const retry = await repo.acquire(buildAcquireInput(event, {
      receivedAt: new Date('2026-07-29T10:00:01.000Z'),
      leaseOwner: 'delivery-2',
    }));

    expect(retry).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: first.codeTaskId },
    });
  });

  it('blocks a later event for the same stable issue while its lease is unexpired despite a title change', async () => {
    const firstEvent = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    expectAcquired(await repo.acquire(buildAcquireInput(firstEvent)));

    const renamed = await repo.acquire(buildAcquireInput(buildEvent({
      resource: 'event_alert',
      action: 'triggered',
      eventId: 'event-2',
      issueTitle: 'A completely different title',
    }), {
      receivedAt: new Date('2026-07-29T10:00:10.000Z'),
      proposedCodeTaskId: 'task_parallel',
      leaseOwner: 'delivery-2',
    }));

    expect(renamed).toEqual({ ok: true, value: { kind: 'retryable' } });
  });

  it('keeps completed tombstones with identical titles on different stable issues independent', async () => {
    const receivedAt = new Date('2026-07-29T10:00:00.000Z');
    const first = expectAcquired(await repo.acquire(buildAcquireInput(buildEvent({
      resource: 'event_alert', action: 'triggered', eventId: 'event-1',
    }), { receivedAt, proposedCodeTaskId: 'task_first' })));
    await repo.completeReservation({
      transitionKey: first.transitionKey,
      issueKey: first.issueKey,
      leaseToken: first.leaseToken,
      codeTaskId: first.codeTaskId,
    });

    const second = await repo.acquire(buildAcquireInput(buildEvent({
      resource: 'event_alert',
      action: 'triggered',
      issueId: '4509002',
      issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509002/',
      eventId: 'event-2',
    }), { receivedAt, proposedCodeTaskId: 'task_second' }));

    expect(second.ok && second.value.kind).toBe('acquired');
  });

  it('atomically grants only one lease to concurrent deliveries', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    const results = await Promise.all([
      repo.acquire(buildAcquireInput(event, { proposedCodeTaskId: 'task_first', leaseOwner: 'delivery-1' })),
      repo.acquire(buildAcquireInput(event, { proposedCodeTaskId: 'task_second', leaseOwner: 'delivery-2' })),
    ]);

    expect(results.filter((result) => result.ok && result.value.kind === 'acquired')).toHaveLength(1);
    expect(results.filter((result) => result.ok && result.value.kind === 'retryable')).toHaveLength(1);
  });

  it('reacquires an expired crash lease without a task and retains the proposed task id', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    expectAcquired(await repo.acquire(buildAcquireInput(event, { proposedCodeTaskId: 'task_retained' })));

    const recovered = expectAcquired(await repo.acquire(buildAcquireInput(event, {
      receivedAt: new Date('2026-07-29T10:01:01.000Z'),
      proposedCodeTaskId: 'task_discarded',
      leaseOwner: 'delivery-2',
    })));

    expect(recovered.codeTaskId).toBe('task_retained');
  });

  it('does not let an older failed transition steal a newer active issue lease', async () => {
    const firstEvent = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    const first = expectAcquired(await repo.acquire(buildAcquireInput(firstEvent, {
      proposedCodeTaskId: 'task_first',
    })));
    await repo.failReservation({
      transitionKey: first.transitionKey,
      issueKey: first.issueKey,
      leaseToken: first.leaseToken,
      reason: 'first attempt failed',
    });
    const secondEvent = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-2' });
    const second = expectAcquired(await repo.acquire(buildAcquireInput(secondEvent, {
      receivedAt: new Date('2026-07-29T10:00:01.000Z'),
      proposedCodeTaskId: 'task_second',
    })));

    const firstRetry = await repo.acquire(buildAcquireInput(firstEvent, {
      receivedAt: new Date('2026-07-29T10:00:02.000Z'),
      proposedCodeTaskId: 'task_first_retry',
    }));

    expect(firstRetry).toEqual({ ok: true, value: { kind: 'retryable' } });
    const issue = await fakeFirestore.collection('sentry-issue-events').doc(second.issueKey).get();
    expect(issue.data()).toEqual(expect.objectContaining({
      proposedCodeTaskId: 'task_first',
      leaseToken: second.leaseToken,
    }));
  });

  it('releases a failed pre-task reservation for retry while preserving its task identity', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event, {
      proposedCodeTaskId: 'task_retained',
    })));

    const failed = await repo.failReservation({
      transitionKey: acquired.transitionKey,
      issueKey: acquired.issueKey,
      leaseToken: acquired.leaseToken,
      reason: 'settings failed',
    });
    const failedDoc = await fakeFirestore.collection('sentry-issue-events').doc(acquired.transitionKey).get();
    const retried = expectAcquired(await repo.acquire(buildAcquireInput(event, {
      receivedAt: new Date('2026-07-29T10:00:01.000Z'),
      proposedCodeTaskId: 'task_discarded',
      leaseOwner: 'delivery-2',
    })));

    expect(failed).toEqual({ ok: true, value: undefined });
    expect(failedDoc.data()).toEqual(expect.objectContaining({
      state: 'failed',
      failureReason: 'settings failed',
      leaseToken: null,
      codeTaskId: null,
    }));
    expect(retried.codeTaskId).toBe('task_retained');
    expect(await repo.failReservation({
      transitionKey: retried.transitionKey,
      issueKey: retried.issueKey,
      leaseToken: retried.leaseToken,
      reason: 'settings failed again',
      codeTaskId: undefined,
    })).toEqual({ ok: true, value: undefined });
  });

  it('turns a known task id recorded on failure into an issue-level tombstone', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event)));
    await repo.failReservation({
      transitionKey: acquired.transitionKey,
      issueKey: acquired.issueKey,
      leaseToken: acquired.leaseToken,
      reason: 'enqueue failed',
      codeTaskId: acquired.codeTaskId,
      linearIssueId: 'INT-200',
    });

    const retried = await repo.acquire(buildAcquireInput(event, {
      receivedAt: new Date('2026-07-29T10:00:01.000Z'),
      proposedCodeTaskId: 'task_discarded',
      leaseOwner: 'delivery-2',
    }));

    expect(retried).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_proposed' },
    });
  });

  it('retries a later transition without a known task while preserving the issue proposed task id', async () => {
    const firstEvent = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    const first = expectAcquired(await repo.acquire(buildAcquireInput(firstEvent, {
      proposedCodeTaskId: 'task_retained',
    })));
    await repo.failReservation({
      transitionKey: first.transitionKey,
      issueKey: first.issueKey,
      leaseToken: first.leaseToken,
      reason: 'settings failed before task creation',
    });

    const retried = expectAcquired(await repo.acquire(buildAcquireInput(buildEvent({
      resource: 'event_alert', action: 'triggered', eventId: 'event-2',
    }), {
      receivedAt: new Date('2026-07-29T10:00:01.000Z'),
      proposedCodeTaskId: 'task_discarded',
      leaseOwner: 'delivery-2',
    })));

    expect(retried.codeTaskId).toBe('task_retained');
  });

  it('completes both reservation records with task and Linear linkage', async () => {
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(buildEvent())));

    const completed = await repo.completeReservation({
      transitionKey: acquired.transitionKey,
      issueKey: acquired.issueKey,
      leaseToken: acquired.leaseToken,
      codeTaskId: acquired.codeTaskId,
      linearIssueId: 'INT-200',
    });
    const transition = await fakeFirestore.collection('sentry-issue-events').doc(acquired.transitionKey).get();
    const issue = await fakeFirestore.collection('sentry-issue-events').doc(acquired.issueKey).get();

    expect(completed).toEqual({ ok: true, value: undefined });
    for (const snapshot of [transition, issue]) {
      expect(snapshot.data()).toEqual(expect.objectContaining({
        state: 'task_created',
        leaseToken: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        codeTaskId: 'task_proposed',
        linearIssueId: 'INT-200',
      }));
    }
  });

  it('checkpoints a Linear issue under the lease and returns it on retry', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-linear' });
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event)));
    await repo.checkpointLinearIssue({
      transitionKey: acquired.transitionKey,
      issueKey: acquired.issueKey,
      leaseToken: acquired.leaseToken,
      linearIssueId: 'INT-200',
    });
    for (const key of [acquired.transitionKey, acquired.issueKey]) {
      expect((await fakeFirestore.collection('sentry-issue-events').doc(key).get()).data()).toEqual(
        expect.objectContaining({ linearIssueId: 'INT-200' })
      );
    }
    await repo.failReservation({
      transitionKey: acquired.transitionKey,
      issueKey: acquired.issueKey,
      leaseToken: acquired.leaseToken,
      reason: 'task create failed',
      linearIssueId: 'INT-200',
    });

    const retried = expectAcquired(await repo.acquire(buildAcquireInput(event, {
      receivedAt: new Date('2026-07-29T10:00:01.000Z'),
      proposedCodeTaskId: 'task_discarded',
    })));

    expect(retried).toEqual(expect.objectContaining({
      codeTaskId: acquired.codeTaskId,
      linearIssueId: 'INT-200',
    }));
  });

  it('guards completion and failure with the current lease token', async () => {
    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(buildEvent())));

    const staleCheckpoint = await repo.checkpointLinearIssue({
      transitionKey: acquired.transitionKey,
      issueKey: acquired.issueKey,
      leaseToken: 'stale-token',
      linearIssueId: 'INT-stale',
    });
    const staleCompletion = await repo.completeReservation({
      transitionKey: acquired.transitionKey,
      issueKey: acquired.issueKey,
      leaseToken: 'stale-token',
      codeTaskId: acquired.codeTaskId,
    });
    const staleFailure = await repo.failReservation({
      transitionKey: acquired.transitionKey,
      issueKey: acquired.issueKey,
      leaseToken: 'stale-token',
      reason: 'stale failure',
    });
    const transition = await fakeFirestore.collection('sentry-issue-events').doc(acquired.transitionKey).get();

    for (const result of [staleCheckpoint, staleCompletion, staleFailure]) {
      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'FIRESTORE_ERROR' }),
      });
    }
    expect(transition.data()?.['state']).toBe('reserved');
    expect(transition.data()?.['linearIssueId']).toBeNull();
  });

  it('returns the issue-level task tombstone for every later transition', async () => {
    const firstEvent = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    const first = expectAcquired(await repo.acquire(buildAcquireInput(firstEvent)));
    await repo.completeReservation({
      transitionKey: first.transitionKey,
      issueKey: first.issueKey,
      leaseToken: first.leaseToken,
      codeTaskId: first.codeTaskId,
      linearIssueId: 'INT-200',
    });

    const later = await repo.acquire(buildAcquireInput(buildEvent({
      resource: 'event_alert', action: 'triggered', eventId: 'event-2',
    }), { proposedCodeTaskId: 'task_later' }));

    expect(later).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_proposed' },
    });
  });

  it('does not replace an issue-level task tombstone even with replacement approval', async () => {
    const first = expectAcquired(await repo.acquire(buildAcquireInput(buildEvent())));
    await repo.completeReservation({
      transitionKey: first.transitionKey,
      issueKey: first.issueKey,
      leaseToken: first.leaseToken,
      codeTaskId: first.codeTaskId,
      linearIssueId: 'INT-200',
    });
    const laterEvent = buildEvent({ action: 'regressed' });

    const staleApproval = await repo.acquire(buildAcquireInput(laterEvent, {
      proposedCodeTaskId: 'task_later',
      replaceLinkedCodeTaskId: 'task_stale',
    }));
    const approved = await repo.acquire(buildAcquireInput(laterEvent, {
      proposedCodeTaskId: 'task_later',
      replaceLinkedCodeTaskId: 'task_proposed',
    }));

    expect(staleApproval).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_proposed' },
    });
    expect(approved).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_proposed' },
    });
  });

  it('lazily migrates a linked legacy transition and preserves exact-event duplicate behavior', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-1' });
    const legacyKey = 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:event_alert:triggered';
    await fakeFirestore.collection('sentry-issue-events').doc(legacyKey).set({
      dedupeKey: legacyKey,
      organizationSlug: event.organizationSlug,
      projectSlug: event.projectSlug,
      projectId: event.projectId,
      issueId: event.issueId,
      issueTitle: event.issueTitle,
      issueUrl: event.issueUrl,
      action: event.action,
      resource: event.resource,
      eventId: event.eventId,
      receivedAt: '2026-07-28T10:00:00.000Z',
      latestReceivedAt: '2026-07-28T10:00:00.000Z',
      payload: '{}',
      codeTaskId: 'task_legacy',
      linearIssueId: 'INT-1775',
    });

    const result = await repo.acquire(buildAcquireInput(event));
    const migrated = await fakeFirestore
      .collection('sentry-issue-events')
      .doc(createSentryIssueDedupeKey(event))
      .get();

    expect(result).toEqual({ ok: true, value: { kind: 'duplicate', codeTaskId: 'task_legacy' } });
    expect(migrated.data()).toEqual(expect.objectContaining({
      state: 'task_created',
      codeTaskId: 'task_legacy',
      linearIssueId: 'INT-1775',
    }));
    expect((migrated.data()?.['receivedAt'] as { toDate(): Date }).toDate().toISOString()).toBe(
      '2026-07-28T10:00:00.000Z'
    );
  });

  it('migrates an exact transition stored under the previous project-id key', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-project-id' });
    const previousKey = [
      'sentry',
      event.organizationSlug,
      event.projectId,
      event.issueId,
      'event',
      event.eventId,
    ].join(':');
    await fakeFirestore.collection('sentry-issue-events').doc(previousKey).set({
      dedupeKey: previousKey,
      transitionKey: previousKey,
      recordType: 'transition',
      state: 'task_created',
      organizationSlug: event.organizationSlug,
      projectSlug: event.projectSlug,
      projectId: event.projectId,
      issueId: event.issueId,
      resource: event.resource,
      action: event.action,
      eventId: event.eventId,
      receivedAt: '2026-07-28T10:00:00.000Z',
      proposedCodeTaskId: 'task_previous_key',
      codeTaskId: 'task_previous_key',
    });

    const result = await repo.acquire(buildAcquireInput(event));

    expect(result).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_previous_key' },
    });
    expect((await fakeFirestore
      .collection('sentry-issue-events')
      .doc(createSentryIssueDedupeKey(event))
      .get()).exists).toBe(true);
  });

  it('lazily recovers a legacy reservation without a linked task', async () => {
    const event = buildEvent();
    const legacyKey = 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001:issue:created';
    await fakeFirestore.collection('sentry-issue-events').doc(legacyKey).set({
      dedupeKey: legacyKey,
      issueId: event.issueId,
      eventId: null,
      receivedAt: '2026-07-28T10:00:00.000Z',
      duplicateCount: 'legacy',
      codeTaskId: null,
      linearIssueId: null,
    });

    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event, {
      proposedCodeTaskId: 'task_recovered',
    })));
    const migrated = await fakeFirestore.collection('sentry-issue-events').doc(acquired.transitionKey).get();

    expect(acquired.codeTaskId).toBe('task_recovered');
    expect(migrated.data()).toEqual(expect.objectContaining({
      state: 'reserved',
      duplicateCount: 1,
    }));
  });

  it('migrates an unnormalized legacy transition without an event id', async () => {
    const event = buildEvent({
      organizationSlug: 'IntexuraOS-Dev-PBuchman',
      projectSlug: 'IntexuraOS-Development',
      eventId: undefined,
    });
    const legacyKey = [
      'sentry',
      event.organizationSlug,
      event.projectSlug,
      event.issueId,
      event.resource,
      event.action,
    ].join(':');
    await fakeFirestore.collection('sentry-issue-events').doc(legacyKey).set({
      dedupeKey: legacyKey,
      receivedAt: '2026-07-28T10:00:00.000Z',
      codeTaskId: 'task_unnormalized_legacy',
    });

    const result = await repo.acquire(buildAcquireInput(event));

    expect(result).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_unnormalized_legacy' },
    });
  });

  it('uses a matching legacy issue link with a native received-at date', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-legacy' });
    const legacyKey = createLegacyProblemKey(event);
    const receivedAt = new Date('2026-07-28T10:00:00.000Z');
    await fakeFirestore.collection('sentry-issue-events').doc(legacyKey).set({
      dedupeKey: legacyKey,
      issueId: event.issueId,
      receivedAt,
      codeTaskId: 'task_legacy_issue',
    });

    const result = await repo.acquire(buildAcquireInput(event));

    expect(result).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_legacy_issue' },
    });
    const migrated = await fakeFirestore
      .collection('sentry-issue-events')
      .doc(createSentryProblemDedupeKey(event))
      .get();
    expect((migrated.data()?.['receivedAt'] as { toDate(): Date }).toDate()).toEqual(receivedAt);
  });

  it('normalizes blank legacy identity fields and falls back from an invalid received-at date', async () => {
    const event = buildEvent({ action: '   ', issueTitle: '   ' });
    const legacyKey = createLegacyProblemKey(event);
    const receivedAt = new Date('2026-07-29T10:00:00.000Z');
    await fakeFirestore.collection('sentry-issue-events').doc(legacyKey).set({
      dedupeKey: legacyKey,
      issueId: event.issueId,
      receivedAt: 'not-a-date',
      codeTaskId: null,
    });

    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event, { receivedAt })));
    const issue = await fakeFirestore.collection('sentry-issue-events').doc(acquired.issueKey).get();

    expect(acquired.codeTaskId).toBe('task_proposed');
    expect((issue.data()?.['receivedAt'] as { toDate(): Date }).toDate()).toEqual(receivedAt);
  });

  it('recreates a missing issue record from a completed exact transition', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-complete' });
    const transitionKey = createSentryIssueDedupeKey(event);
    await fakeFirestore.collection('sentry-issue-events').doc(transitionKey).set({
      state: 'task_created',
      receivedAt: new Date('2026-07-28T10:00:00.000Z'),
      proposedCodeTaskId: 'task_completed',
      codeTaskId: 'task_completed',
      duplicateCount: 0,
    });

    const result = await repo.acquire(buildAcquireInput(event));
    const issue = await fakeFirestore
      .collection('sentry-issue-events')
      .doc(createSentryProblemDedupeKey(event))
      .get();

    expect(result).toEqual({ ok: true, value: { kind: 'duplicate', codeTaskId: 'task_completed' } });
    expect(issue.data()).toEqual(expect.objectContaining({
      state: 'task_created',
      codeTaskId: 'task_completed',
    }));
  });

  it('rebuilds a missing issue record from an active exact lease', async () => {
    const event = buildEvent({ resource: 'event_alert', action: 'triggered', eventId: 'event-active' });
    const transitionKey = createSentryIssueDedupeKey(event);
    await fakeFirestore.collection('sentry-issue-events').doc(transitionKey).set({
      state: 'reserved',
      receivedAt: new Date('2026-07-29T09:59:00.000Z'),
      proposedCodeTaskId: 'task_active',
      leaseToken: 'active-token',
      leaseExpiresAt: new Date('2026-07-29T10:01:00.000Z'),
      codeTaskId: null,
      duplicateCount: 0,
    });

    const result = await repo.acquire(buildAcquireInput(event));
    const issue = await fakeFirestore
      .collection('sentry-issue-events')
      .doc(createSentryProblemDedupeKey(event))
      .get();

    expect(result).toEqual({ ok: true, value: { kind: 'retryable' } });
    expect(issue.data()).toEqual(expect.objectContaining({
      state: 'reserved',
      proposedCodeTaskId: 'task_active',
      leaseToken: 'active-token',
      transitionKey,
    }));
  });

  it('honors active and expired issue-only leases during replacement', async () => {
    const activeEvent = buildEvent({ issueId: '4509010', eventId: 'event-active-issue' });
    const activeIssueKey = createSentryProblemDedupeKey(activeEvent);
    await fakeFirestore.collection('sentry-issue-events').doc(activeIssueKey).set({
      state: 'reserved',
      receivedAt: new Date('2026-07-29T09:59:00.000Z'),
      proposedCodeTaskId: 'task_active_issue',
      leaseToken: 'active-issue-token',
      leaseExpiresAt: new Date('2026-07-29T10:01:00.000Z'),
      codeTaskId: 'task_active_issue',
      duplicateCount: 0,
    });

    const active = await repo.acquire(buildAcquireInput(activeEvent, {
      replaceLinkedCodeTaskId: 'task_active_issue',
    }));

    const expiredEvent = buildEvent({ issueId: '4509011', eventId: 'event-expired-issue' });
    const expiredIssueKey = createSentryProblemDedupeKey(expiredEvent);
    await fakeFirestore.collection('sentry-issue-events').doc(expiredIssueKey).set({
      state: 'reserved',
      receivedAt: new Date('2026-07-29T09:58:00.000Z'),
      proposedCodeTaskId: 'task_expired_issue',
      leaseToken: 'expired-issue-token',
      leaseExpiresAt: new Date('2026-07-29T09:59:00.000Z'),
      codeTaskId: null,
      duplicateCount: 0,
    });

    const expired = expectAcquired(await repo.acquire(buildAcquireInput(expiredEvent, {
      proposedCodeTaskId: 'task_discarded',
    })));

    expect(active).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_active_issue' },
    });
    expect(expired.codeTaskId).toBe('task_expired_issue');
  });

  it('does not let a title-colliding legacy issue document block a different stable issue', async () => {
    const event = buildEvent({ issueId: '4509002' });
    const firstIssue = buildEvent({ issueId: '4509001' });
    const legacyKey = createLegacyProblemKey(firstIssue);
    await fakeFirestore.collection('sentry-issue-events').doc(legacyKey).set({
      dedupeKey: legacyKey,
      issueId: firstIssue.issueId,
      receivedAt: '2026-07-28T10:00:00.000Z',
      codeTaskId: 'task_first_issue',
    });

    const acquired = expectAcquired(await repo.acquire(buildAcquireInput(event)));

    expect(acquired.codeTaskId).toBe('task_proposed');
  });

  it('finds a linked legacy reservation after title and action changes', async () => {
    const original = buildEvent({ action: 'created', issueTitle: 'Original failure title' });
    const legacyKey = createLegacyProblemKey(original);
    await fakeFirestore.collection('sentry-issue-events').doc(legacyKey).set({
      dedupeKey: legacyKey,
      organizationSlug: original.organizationSlug,
      projectSlug: original.projectSlug,
      projectId: original.projectId,
      issueId: original.issueId,
      issueTitle: original.issueTitle,
      action: original.action,
      receivedAt: '2026-07-28T10:00:00.000Z',
      codeTaskId: 'task_legacy_linked',
    });
    const changed = buildEvent({
      action: 'regressed',
      issueTitle: 'Renamed failure title',
      eventId: 'event-renamed',
    });

    const result = await repo.acquire(buildAcquireInput(changed));

    expect(result).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_legacy_linked' },
    });
  });

  it('treats a legacy record without an action as an issue link, not an exact transition', async () => {
    const event = buildEvent({ eventId: undefined });
    const legacyKey = 'legacy-stable-issue-without-action';
    await fakeFirestore.collection('sentry-issue-events').doc(legacyKey).set({
      dedupeKey: legacyKey,
      organizationSlug: event.organizationSlug,
      projectSlug: event.projectSlug,
      projectId: event.projectId,
      issueId: event.issueId,
      resource: event.resource,
      receivedAt: '2026-07-28T10:00:00.000Z',
      codeTaskId: 'task_legacy_without_action',
    });

    const result = await repo.acquire(buildAcquireInput(event));

    expect(result).toEqual({
      ok: true,
      value: { kind: 'duplicate', codeTaskId: 'task_legacy_without_action' },
    });
  });

  it('keeps mixed project-id and slug-only deliveries in one lease', async () => {
    const withProjectId = buildEvent({ eventId: 'event-mixed-project' });
    const withoutProjectId = buildEvent({ eventId: 'event-mixed-project', projectId: undefined });
    const first = expectAcquired(await repo.acquire(buildAcquireInput(withProjectId, {
      proposedCodeTaskId: 'task_mixed',
    })));

    const retry = await repo.acquire(buildAcquireInput(withoutProjectId, {
      receivedAt: new Date('2026-07-29T10:00:01.000Z'),
      proposedCodeTaskId: 'task_duplicate',
    }));

    expect(createSentryIssueDedupeKey(withProjectId)).toBe(createSentryIssueDedupeKey(withoutProjectId));
    expect(first.issueKey).toBe(createSentryProblemDedupeKey(withoutProjectId));
    expect(retry).toEqual({ ok: true, value: { kind: 'retryable' } });
  });

  it('returns FIRESTORE_ERROR when a completion references missing reservation records', async () => {
    const result = await repo.completeReservation({
      transitionKey: 'missing-transition',
      issueKey: 'missing-issue',
      leaseToken: 'missing-token',
      codeTaskId: 'task_missing',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'FIRESTORE_ERROR',
        message: 'Sentry task reservation is missing',
      },
    });
  });

  it('returns FIRESTORE_ERROR when a Linear checkpoint references missing reservation records', async () => {
    const result = await repo.checkpointLinearIssue({
      transitionKey: 'missing-transition',
      issueKey: 'missing-issue',
      leaseToken: 'missing-token',
      linearIssueId: 'INT-404',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'FIRESTORE_ERROR',
        message: 'Sentry task reservation is missing',
      },
    });
  });

  it('maps Firestore checkpoint failures to FIRESTORE_ERROR', async () => {
    vi.spyOn(fakeFirestore, 'runTransaction').mockRejectedValueOnce(new Error('checkpoint unavailable'));

    const result = await repo.checkpointLinearIssue({
      transitionKey: 'transition',
      issueKey: 'issue',
      leaseToken: 'token',
      linearIssueId: 'INT-500',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'FIRESTORE_ERROR', message: 'checkpoint unavailable' },
    });
  });

  it('maps Firestore acquisition failures to FIRESTORE_ERROR', async () => {
    vi.spyOn(fakeFirestore, 'runTransaction').mockRejectedValueOnce(new Error('firestore unavailable'));

    const result = await repo.acquire(buildAcquireInput(buildEvent()));

    expect(result).toEqual({
      ok: false,
      error: { code: 'FIRESTORE_ERROR', message: 'firestore unavailable' },
    });
  });
});
