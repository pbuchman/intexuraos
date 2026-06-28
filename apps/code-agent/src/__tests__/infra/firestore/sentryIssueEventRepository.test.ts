/**
 * Tests for Sentry issue event Firestore persistence and idempotency.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { NormalizedSentryIssueEvent } from '../../../domain/models/sentryIssueEvent.js';
import {
  createFirestoreSentryIssueEventRepository,
  createSentryIssueDedupeKey,
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

describe('createFirestoreSentryIssueEventRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
  });

  afterEach(() => {
    resetFirestore();
  });

  it('creates a deterministic dedupe key for a Sentry issue', () => {
    expect(createSentryIssueDedupeKey(buildEvent())).toBe(
      'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001'
    );
  });

  it('reserves a new Sentry issue event and persists audit fields', async () => {
    const repo = createFirestoreSentryIssueEventRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger: pino({ level: 'silent' }),
    });
    const receivedAt = new Date('2026-06-28T10:00:00.000Z');

    const result = await repo.reserve({
      event: buildEvent(),
      receivedAt,
      payload: { raw: true },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        created: true,
        record: expect.objectContaining({
          dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001',
          organizationSlug: 'intexuraos-dev-pbuchman',
          projectSlug: 'intexuraos-development',
          projectId: '100',
          issueId: '4509001',
          issueShortId: 'INTEXURAOS-DEVELOPMENT-7',
          issueTitle: 'TypeError: Cannot read properties of undefined',
          issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
          action: 'created',
          resource: 'issue',
          status: 'unresolved',
          eventId: undefined,
          receivedAt,
          latestReceivedAt: receivedAt,
          duplicateCount: 0,
          payload: { raw: true },
        }),
      });
    }
  });

  it('reserves Sentry issue events with nullable optional fields', async () => {
    const repo = createFirestoreSentryIssueEventRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger: pino({ level: 'silent' }),
    });
    const receivedAt = new Date('2026-06-28T10:00:00.000Z');

    const result = await repo.reserve({
      event: buildEvent({
        resource: 'event_alert',
        projectId: undefined,
        issueShortId: undefined,
        status: undefined,
        eventId: 'event-1',
      }),
      receivedAt,
      payload: { raw: true },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.record).toEqual(expect.objectContaining({
        projectId: undefined,
        issueShortId: undefined,
        status: undefined,
        eventId: 'event-1',
      }));
    }
  });

  it('returns an existing reservation on duplicate delivery and keeps the linked task', async () => {
    const repo = createFirestoreSentryIssueEventRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger: pino({ level: 'silent' }),
    });
    const firstReceivedAt = new Date('2026-06-28T10:00:00.000Z');
    const secondReceivedAt = new Date('2026-06-28T11:00:00.000Z');

    const first = await repo.reserve({
      event: buildEvent(),
      receivedAt: firstReceivedAt,
      payload: { delivery: 1 },
    });
    expect(first.ok && first.value.created).toBe(true);

    await repo.markCodeTaskCreated({
      dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001',
      codeTaskId: 'task_sentry',
      linearIssueId: 'INT-200',
    });

    const second = await repo.reserve({
      event: buildEvent({ action: 'triggered', resource: 'event_alert', eventId: 'event-1' }),
      receivedAt: secondReceivedAt,
      payload: { delivery: 2 },
    });

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value).toEqual({
        created: false,
        record: expect.objectContaining({
          dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001',
          codeTaskId: 'task_sentry',
          linearIssueId: 'INT-200',
          action: 'triggered',
          resource: 'event_alert',
          eventId: 'event-1',
          receivedAt: firstReceivedAt,
          latestReceivedAt: secondReceivedAt,
          duplicateCount: 1,
          payload: { delivery: 2 },
        }),
      });
    }
  });

  it('falls back duplicateCount to zero for legacy duplicate audit records', async () => {
    const repo = createFirestoreSentryIssueEventRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger: pino({ level: 'silent' }),
    });
    const dedupeKey = createSentryIssueDedupeKey(buildEvent());
    const firstReceivedAt = new Date('2026-06-28T10:00:00.000Z');
    const secondReceivedAt = new Date('2026-06-28T11:00:00.000Z');
    await fakeFirestore.collection('sentry-issue-events').doc(dedupeKey).set({
      dedupeKey,
      organizationSlug: 'intexuraos-dev-pbuchman',
      projectSlug: 'intexuraos-development',
      projectId: null,
      issueId: '4509001',
      issueShortId: null,
      issueTitle: 'Original title',
      issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
      action: 'created',
      resource: 'issue',
      status: null,
      eventId: null,
      receivedAt: firstReceivedAt,
      latestReceivedAt: firstReceivedAt,
      duplicateCount: 'legacy',
      payload: { delivery: 1 },
      codeTaskId: null,
      linearIssueId: null,
    });

    const result = await repo.reserve({
      event: buildEvent({
        projectId: undefined,
        issueShortId: undefined,
        status: undefined,
        eventId: undefined,
      }),
      receivedAt: secondReceivedAt,
      payload: { delivery: 2 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.record).toEqual(expect.objectContaining({
        projectId: undefined,
        issueShortId: undefined,
        status: undefined,
        eventId: undefined,
        receivedAt: firstReceivedAt,
        latestReceivedAt: secondReceivedAt,
        duplicateCount: 1,
      }));
    }
  });

  it('links an audit record to a code task without a Linear issue id', async () => {
    const repo = createFirestoreSentryIssueEventRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger: pino({ level: 'silent' }),
    });
    const receivedAt = new Date('2026-06-28T10:00:00.000Z');
    const reserved = await repo.reserve({
      event: buildEvent(),
      receivedAt,
      payload: { raw: true },
    });
    expect(reserved.ok).toBe(true);

    const result = await repo.markCodeTaskCreated({
      dedupeKey: 'sentry:intexuraos-dev-pbuchman:intexuraos-development:4509001',
      codeTaskId: 'task_sentry',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expect.objectContaining({
        codeTaskId: 'task_sentry',
        linearIssueId: undefined,
      }));
    }
  });

  it('reads legacy string timestamps when linking an audit record', async () => {
    const repo = createFirestoreSentryIssueEventRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger: pino({ level: 'silent' }),
    });
    const dedupeKey = createSentryIssueDedupeKey(buildEvent());
    await fakeFirestore.collection('sentry-issue-events').doc(dedupeKey).set({
      dedupeKey,
      organizationSlug: 'intexuraos-dev-pbuchman',
      projectSlug: 'intexuraos-development',
      projectId: null,
      issueId: '4509001',
      issueShortId: null,
      issueTitle: 'TypeError',
      issueUrl: 'https://intexuraos-dev-pbuchman.sentry.io/issues/4509001/',
      action: 'created',
      resource: 'issue',
      status: null,
      eventId: null,
      receivedAt: '2026-06-28T10:00:00.000Z',
      latestReceivedAt: '2026-06-28T11:00:00.000Z',
      duplicateCount: 0,
      payload: { raw: true },
      codeTaskId: null,
      linearIssueId: null,
    });

    const result = await repo.markCodeTaskCreated({
      dedupeKey,
      codeTaskId: 'task_sentry',
      linearIssueId: 'INT-200',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.receivedAt.toISOString()).toBe('2026-06-28T10:00:00.000Z');
      expect(result.value.latestReceivedAt.toISOString()).toBe('2026-06-28T11:00:00.000Z');
      expect(result.value.linearIssueId).toBe('INT-200');
    }
  });

  it('returns FIRESTORE_ERROR when linking a missing audit record', async () => {
    const repo = createFirestoreSentryIssueEventRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger: pino({ level: 'silent' }),
    });

    const result = await repo.markCodeTaskCreated({
      dedupeKey: 'sentry:missing:issue',
      codeTaskId: 'task_missing',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'FIRESTORE_ERROR',
        message: 'Missing Sentry issue event: sentry:missing:issue',
      },
    });
  });
});
