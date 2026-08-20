import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeFirestore,
  resetFirestore,
  setFirestore,
} from '@intexuraos/infra-firestore';
import pino from 'pino';
import type { CreateGitHubPREventInput } from '../../../domain/models/gitHubPREvent.js';
import type {
  AcquireGitHubPRTriageResult,
  GitHubPREventRepository,
} from '../../../domain/repositories/gitHubPREventRepository.js';
import { createFirestoreGitHubPREventsRepository } from '../../../infra/firestore/gitHubPREventsRepository.js';

const RECEIVED_AT = new Date('2026-08-20T10:00:00.000Z');

function buildInput(deliveryId: string | null): CreateGitHubPREventInput {
  return {
    githubEventId: 123,
    deliveryId,
    repository: 'pbuchman/intexuraos',
    repositoryId: 456,
    pullRequestNumber: 2475,
    pullRequestId: 789,
    eventType: 'pull_request',
    action: 'opened',
    senderLogin: 'octocat',
    senderId: 1,
    senderType: 'User',
    prAuthorLogin: 'octocat',
    title: 'Atomic PR triage',
    body: null,
    state: 'open',
    isDraft: false,
    baseBranch: 'development',
    mergedAt: null,
    createdAt: new Date('2026-08-20T09:59:00.000Z'),
    payload: { action: 'opened' },
  };
}

function expectAcquired(
  result: Awaited<ReturnType<GitHubPREventRepository['acquireTriage']>>,
): Extract<AcquireGitHubPRTriageResult, { kind: 'acquired' }> {
  if (!result.ok || result.value.kind !== 'acquired') {
    throw new Error('Expected acquired triage lease');
  }
  return result.value;
}

describe('GitHub PR event delivery receipt and triage lease', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let repo: GitHubPREventRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    repo = createFirestoreGitHubPREventsRepository({ logger: pino({ level: 'silent' }) });
  });

  afterEach(() => {
    resetFirestore();
  });

  async function seedEvent(deliveryId: string): Promise<string> {
    const result = await repo.save(buildInput(deliveryId));
    if (!result.ok) throw new Error('Expected event save to succeed');
    return result.value.id;
  }

  it('atomically resolves concurrent saves for one delivery to one deterministic event', async () => {
    const deliveryId = 'delivery-concurrent-1';
    const expectedEventId = `github-delivery-${createHash('sha256').update(deliveryId).digest('hex')}`;

    const results = await Promise.all([
      repo.save(buildInput(deliveryId)),
      repo.save(buildInput(deliveryId)),
    ]);

    const saved = results.filter((result) => result.ok);
    const duplicate = results.filter((result) => !result.ok);
    expect(saved).toHaveLength(1);
    expect(duplicate).toHaveLength(1);
    expect(saved[0]?.ok && saved[0].value.id).toBe(expectedEventId);
    expect(duplicate[0]?.ok === false && duplicate[0].error).toEqual({
      code: 'DUPLICATE_EVENT',
      message: `Duplicate delivery: ${deliveryId}`,
      eventId: expectedEventId,
    });

    const snapshot = await fakeFirestore.collection('github-pr-events').get();
    expect(snapshot.docs).toHaveLength(1);
    expect(snapshot.docs[0]?.id).toBe(expectedEventId);
  });

  it('loads a deterministic receipt by id and preserves not-found reads', async () => {
    const eventId = await seedEvent('delivery-find-by-id');

    const found = await repo.findById(eventId);
    const missing = await repo.findById('missing-event');

    expect(found.ok && found.value?.id).toBe(eventId);
    expect(missing).toEqual({ ok: true, value: null });
  });

  it('returns not_found when triage targets a missing event', async () => {
    const result = await repo.acquireTriage({
      eventId: 'missing',
      leaseOwner: 'message-1',
      acquiredAt: RECEIVED_AT,
      leaseDurationMs: 60_000,
    });

    expect(result).toEqual({ ok: true, value: { kind: 'not_found' } });
  });

  it('returns busy while another delivery owns an active lease', async () => {
    const eventId = await seedEvent('delivery-active-lease');
    expectAcquired(await repo.acquireTriage({
      eventId,
      leaseOwner: 'message-1',
      acquiredAt: RECEIVED_AT,
      leaseDurationMs: 60_000,
    }));

    const second = await repo.acquireTriage({
      eventId,
      leaseOwner: 'message-2',
      acquiredAt: new Date(RECEIVED_AT.getTime() + 1),
      leaseDurationMs: 60_000,
    });

    expect(second).toEqual({ ok: true, value: { kind: 'busy' } });
  });

  it('grants exactly one new owner after an expired lease', async () => {
    const eventId = await seedEvent('delivery-expired-lease');
    expectAcquired(await repo.acquireTriage({
      eventId,
      leaseOwner: 'message-old',
      acquiredAt: RECEIVED_AT,
      leaseDurationMs: 1_000,
    }));
    const reacquiredAt = new Date(RECEIVED_AT.getTime() + 1_001);

    const results = await Promise.all([
      repo.acquireTriage({
        eventId,
        leaseOwner: 'message-new-1',
        acquiredAt: reacquiredAt,
        leaseDurationMs: 60_000,
      }),
      repo.acquireTriage({
        eventId,
        leaseOwner: 'message-new-2',
        acquiredAt: reacquiredAt,
        leaseDurationMs: 60_000,
      }),
    ]);

    expect(results.filter((result) => result.ok && result.value.kind === 'acquired')).toHaveLength(1);
    expect(results.filter((result) => result.ok && result.value.kind === 'busy')).toHaveLength(1);
    const acquired = results.find(
      (result): result is Extract<typeof result, { ok: true }> => result.ok && result.value.kind === 'acquired',
    );
    const stored = await fakeFirestore.collection('github-pr-events').doc(eventId).get();
    expect(stored.data()?.['triageLeaseToken']).toBe(
      acquired?.value.kind === 'acquired' ? acquired.value.leaseToken : undefined,
    );
  });

  it('does not complete a lease with the wrong token', async () => {
    const eventId = await seedEvent('delivery-wrong-token');
    const acquired = expectAcquired(await repo.acquireTriage({
      eventId,
      leaseOwner: 'message-1',
      acquiredAt: RECEIVED_AT,
      leaseDurationMs: 60_000,
    }));

    const stale = await repo.completeTriage({
      eventId,
      leaseToken: 'wrong-token',
      completedAt: new Date(RECEIVED_AT.getTime() + 10),
    });

    expect(stale).toEqual({
      ok: false,
      error: {
        code: 'TRIAGE_LEASE_NOT_OWNED',
        message: 'GitHub PR triage lease is no longer owned by this delivery',
      },
    });
    const stored = await fakeFirestore.collection('github-pr-events').doc(eventId).get();
    expect(stored.data()).toEqual(expect.objectContaining({
      triageState: 'processing',
      triageLeaseToken: acquired.leaseToken,
    }));
  });

  it('marks completion and turns every later delivery into a no-op', async () => {
    const eventId = await seedEvent('delivery-completed');
    const acquired = expectAcquired(await repo.acquireTriage({
      eventId,
      leaseOwner: 'message-1',
      acquiredAt: RECEIVED_AT,
      leaseDurationMs: 60_000,
    }));
    const complete = await repo.completeTriage({
      eventId,
      leaseToken: acquired.leaseToken,
      completedAt: new Date(RECEIVED_AT.getTime() + 10),
    });

    const redelivery = await repo.acquireTriage({
      eventId,
      leaseOwner: 'message-2',
      acquiredAt: new Date(RECEIVED_AT.getTime() + 20),
      leaseDurationMs: 60_000,
    });

    expect(complete).toEqual({ ok: true, value: undefined });
    expect(redelivery).toEqual({ ok: true, value: { kind: 'completed' } });
  });

  it('releases a failed lease so Pub/Sub can retry immediately', async () => {
    const eventId = await seedEvent('delivery-failed');
    const acquired = expectAcquired(await repo.acquireTriage({
      eventId,
      leaseOwner: 'message-1',
      acquiredAt: RECEIVED_AT,
      leaseDurationMs: 60_000,
    }));
    const failed = await repo.failTriage({
      eventId,
      leaseToken: acquired.leaseToken,
      failedAt: new Date(RECEIVED_AT.getTime() + 10),
      reason: 'evaluator_failed',
    });

    const retried = expectAcquired(await repo.acquireTriage({
      eventId,
      leaseOwner: 'message-2',
      acquiredAt: new Date(RECEIVED_AT.getTime() + 20),
      leaseDurationMs: 60_000,
    }));

    expect(failed).toEqual({ ok: true, value: undefined });
    expect(retried.leaseToken).not.toBe(acquired.leaseToken);
  });

  it('maps transaction failures to FIRESTORE_ERROR', async () => {
    vi.spyOn(fakeFirestore, 'runTransaction').mockRejectedValueOnce(new Error('transaction unavailable'));

    const result = await repo.acquireTriage({
      eventId: 'event-1',
      leaseOwner: 'message-1',
      acquiredAt: RECEIVED_AT,
      leaseDurationMs: 60_000,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'FIRESTORE_ERROR', message: 'transaction unavailable' },
    });
  });

  it('rejects completion without a lease and maps completion transaction failures', async () => {
    const missing = await repo.completeTriage({
      eventId: 'missing-event',
      leaseToken: 'missing-token',
      completedAt: RECEIVED_AT,
    });
    expect(missing).toEqual({ ok: false, error: {
      code: 'TRIAGE_LEASE_NOT_OWNED',
      message: 'GitHub PR triage lease is no longer owned by this delivery',
    } });

    const eventId = await seedEvent('delivery-completion-transaction-error');
    const acquired = expectAcquired(await repo.acquireTriage({
      eventId,
      leaseOwner: 'message-1',
      acquiredAt: RECEIVED_AT,
      leaseDurationMs: 60_000,
    }));
    vi.spyOn(fakeFirestore, 'runTransaction').mockRejectedValueOnce(new Error('completion unavailable'));

    const failed = await repo.completeTriage({
      eventId,
      leaseToken: acquired.leaseToken,
      completedAt: new Date(RECEIVED_AT.getTime() + 1),
    });
    expect(failed).toEqual({
      ok: false,
      error: { code: 'FIRESTORE_ERROR', message: 'completion unavailable' },
    });
  });
});
