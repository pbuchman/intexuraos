import { describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { createDigestNotificationMonitoring } from './digestNotificationMonitoring.js';
import {
  buildDigestMonitoringProjection,
  DIGEST_MONITORING_COLLECTION,
} from './digestMonitoringProjection.js';

describe('bounded digest notification monitoring', () => {
  it('reports the latest delivery across active definitions regardless of definition order', async () => {
    const db = createFakeFirestore();
    db.seedCollection(
      'message_digest_definitions',
      ['first', 'newest', 'oldest'].map((definitionId) => ({
        id: definitionId,
        data: {
          definitionId,
          userId: 'u',
          status: 'active',
          nextRunAt: '2026-11-11T08:00:00.000Z',
        },
      }))
    );
    db.seedCollection(DIGEST_MONITORING_COLLECTION, [
      { id: '_initialization', data: { schemaVersion: 1, complete: true } },
      ...['2026-11-10T09:00:00.000Z', '2026-11-10T10:00:00.000Z', '2026-11-10T08:00:00.000Z'].map(
        (deliveredAt, index) => ({
          id: `run-${index}`,
          data: {
            schemaVersion: 1,
            runId: `run-${index}`,
            definitionId: ['first', 'newest', 'oldest'][index],
            userId: 'u',
            scheduledBoundary: '2026-11-10T07:00:00.000Z',
            windowEnd: '2026-11-10T07:00:00.000Z',
            outcome: 'delivered',
            deliveredAt,
          },
        })
      ),
    ]);
    const monitoring = createDigestNotificationMonitoring(db as unknown as Firestore);
    expect(await monitoring.read('2026-11-10T12:00:00.000Z')).toEqual({
      pendingCount: 0,
      failedCount: 0,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: '2026-11-10T10:00:00.000Z',
    });
    monitoring.close();
  });

  it('fails closed and cleans up owners whose projection queries fail before unresolved state initializes', async () => {
    const db = createFakeFirestore();
    db.seedCollection('message_digest_definitions', [
      {
        id: 'd',
        data: {
          definitionId: 'd',
          userId: 'u',
          status: 'active',
          nextRunAt: '2026-11-11T08:00:00.000Z',
        },
      },
    ]);
    db.seedCollection(DIGEST_MONITORING_COLLECTION, [
      { id: '_initialization', data: { schemaVersion: 1, complete: true } },
    ]);
    const collection = db.collection.bind(db);
    let monitoringQueries = 0;
    vi.spyOn(db, 'collection').mockImplementation((name) => {
      if (name === DIGEST_MONITORING_COLLECTION && ++monitoringQueries > 1)
        throw new Error('Projection backend unavailable');
      return collection(name);
    });
    const monitoring = createDigestNotificationMonitoring(db as unknown as Firestore);
    await expect(monitoring.read('2026-11-10T12:00:00.000Z')).rejects.toThrow(
      'Projection backend unavailable'
    );
    expect(monitoring.diagnostics()).toMatchObject({ queryStarts: 5, documentReads: 2 });
    monitoring.close();
    await expect(monitoring.read('2026-11-10T12:00:00.000Z')).rejects.toThrow('closed');
  });

  it('retains old failures, lets skipped runs cover a due cursor, and honors a later resume cutoff', async () => {
    const db = createFakeFirestore();
    db.seedCollection('message_digest_definitions', [
      {
        id: 'd',
        data: {
          definitionId: 'd',
          userId: 'u',
          status: 'active',
          nextRunAt: '2026-11-10T08:00:00.000Z',
        },
      },
    ]);
    const row = {
      schemaVersion: 1,
      runId: 'failed',
      userId: 'u',
      definitionId: 'd',
      scheduledBoundary: '2020-01-01T00:00:00.000Z',
      windowEnd: '2020-01-01T00:00:00.000Z',
      outcome: 'failed',
      deliveredAt: null,
    };
    db.seedCollection(DIGEST_MONITORING_COLLECTION, [
      { id: '_initialization', data: { schemaVersion: 1, complete: true } },
      { id: 'failed', data: row },
      {
        id: 'skipped',
        data: {
          ...row,
          runId: 'skipped',
          scheduledBoundary: '2026-11-10T08:00:00.000Z',
          windowEnd: '2026-11-10T08:00:00.000Z',
          outcome: 'skipped',
        },
      },
    ]);
    const monitoring = createDigestNotificationMonitoring(db as unknown as Firestore);
    expect(await monitoring.read('2026-11-10T09:00:00.000Z')).toEqual({
      pendingCount: 0,
      failedCount: 1,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: null,
    });
    await db.collection(DIGEST_MONITORING_COLLECTION).doc('skipped').delete();
    expect((await monitoring.read('2026-11-10T09:00:00.000Z')).pendingCount).toBe(1);
    await db
      .collection('message_digest_definitions')
      .doc('d')
      .update({ resumeCutoff: '2026-11-10T09:00:00.000Z' });
    expect(await monitoring.read('2026-11-10T10:00:00.000Z')).toEqual({
      pendingCount: 0,
      failedCount: 0,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: null,
    });
    monitoring.close();
  });
  it('does not start additional listeners when closed during initialization', async () => {
    const db = createFakeFirestore();
    db.seedCollection(DIGEST_MONITORING_COLLECTION, [
      { id: '_initialization', data: { schemaVersion: 1, complete: true } },
    ]);
    const monitoring = createDigestNotificationMonitoring(db as unknown as Firestore);
    const reading = monitoring.read('2026-11-10T12:00:00.000Z');
    await Promise.resolve();
    monitoring.close();
    const before = monitoring.diagnostics();
    await expect(reading).rejects.toThrow('closed');
    expect(monitoring.diagnostics()).toEqual(before);
  });
  it('uses an explicit bootstrap mode only until a valid initialization marker completes', async () => {
    const db = createFakeFirestore();
    const expected = {
      pendingCount: 2,
      failedCount: 1,
      oldestPendingScheduledFor: '2026-11-10T08:00:00.000Z',
      lastDeliveredAt: null,
    };
    const monitoring = createDigestNotificationMonitoring(
      db as unknown as Firestore,
      async () => expected
    );
    expect(await monitoring.read('2026-11-10T12:00:00.000Z')).toEqual(expected);
    expect(monitoring.mode()).toBe('legacy-bootstrap');
    await db
      .collection(DIGEST_MONITORING_COLLECTION)
      .doc('_initialization')
      .set({ schemaVersion: 1, complete: true });
    expect((await monitoring.read('2026-11-10T12:00:00.000Z')).pendingCount).toBe(0);
    expect(monitoring.mode()).toBe('incremental');
    await db
      .collection(DIGEST_MONITORING_COLLECTION)
      .doc('_initialization')
      .set({ schemaVersion: 2, complete: true });
    await expect(monitoring.read('2026-11-10T12:00:00.000Z')).rejects.toThrow('not initialized');
    monitoring.close();
  });
  it('fails closed until the one-time projection backfill is complete', async () => {
    const db = createFakeFirestore();
    const monitoring = createDigestNotificationMonitoring(db as unknown as Firestore);
    await expect(monitoring.read('2026-11-10T12:00:00.000Z')).rejects.toThrow('not initialized');
    monitoring.close();
  });

  it('reads constant completed history, preserves unresolved work, and performs zero reads for idle polls', async () => {
    const db = createFakeFirestore();
    db.seedCollection('message_digest_definitions', [
      {
        id: 'd',
        data: {
          definitionId: 'd',
          userId: 'u',
          status: 'active',
          nextRunAt: '2026-11-11T08:00:00.000Z',
          resumeCutoff: '2026-11-09T00:00:00.000Z',
        },
      },
    ]);
    const base = {
      runId: 'r',
      userId: 'u',
      definitionId: 'd',
      recordRole: 'canonical',
      visibilityMigrationId: null,
      generationStatus: 'completed',
      scheduledBoundary: '2026-11-08T08:00:00.000Z',
      windowEnd: '2026-11-08T08:00:00.000Z',
      delivery: {
        status: 'sent',
        transportConfirmation: { status: 'delivered', deliveredAt: '2026-11-10T08:10:00.000Z' },
      },
    };
    const history = Array.from({ length: 10_000 }, (_, index) => ({
      id: `r${index}`,
      data: buildDigestMonitoringProjection({
        ...base,
        runId: `r${index}`,
        scheduledBoundary: new Date(
          Date.parse('2026-11-01T00:00:00.000Z') + index * 60_000
        ).toISOString(),
      }) as unknown as Record<string, unknown>,
    }));
    db.seedCollection(DIGEST_MONITORING_COLLECTION, [
      { id: '_initialization', data: { schemaVersion: 1, complete: true } },
      ...history,
      {
        id: 'newer-boundary',
        data: {
          ...history[0]?.data,
          runId: 'newer-boundary',
          scheduledBoundary: '2026-11-08T08:00:00.000Z',
          deliveredAt: '2026-11-08T08:01:00.000Z',
        },
      },
      { id: 'old-failed', data: { ...history[0]?.data, runId: 'old-failed', outcome: 'failed' } },
      {
        id: 'pending',
        data: {
          ...history[0]?.data,
          runId: 'pending',
          scheduledBoundary: '2026-11-09T08:00:00.000Z',
          windowEnd: '2026-11-09T08:00:00.000Z',
          outcome: 'pending',
          deliveredAt: null,
        },
      },
      {
        id: 'failed',
        data: {
          ...history[0]?.data,
          runId: 'failed',
          scheduledBoundary: '2026-11-10T08:00:00.000Z',
          windowEnd: '2026-11-10T08:00:00.000Z',
          outcome: 'failed',
          deliveredAt: null,
        },
      },
      {
        id: 'invalid-window',
        data: {
          ...history[0]?.data,
          runId: 'invalid-window',
          scheduledBoundary: '2026-11-12T08:00:00.000Z',
          windowEnd: '2026-11-08T08:00:00.000Z',
          outcome: 'pending',
          deliveredAt: null,
        },
      },
    ]);
    const monitoring = createDigestNotificationMonitoring(db as unknown as Firestore);
    expect(await monitoring.read('2026-11-10T12:00:00.000Z')).toEqual({
      pendingCount: 1,
      failedCount: 1,
      oldestPendingScheduledFor: '2026-11-09T08:00:00.000Z',
      lastDeliveredAt: '2026-11-10T08:10:00.000Z',
    });
    expect(monitoring.diagnostics().documentReads).toBeLessThan(10);
    const before = monitoring.diagnostics();
    for (let index = 0; index < 1000; index++) await monitoring.read('2026-11-10T12:00:00.000Z');
    expect(monitoring.diagnostics()).toEqual(before);
    expect((await monitoring.read('2026-11-11T09:00:00.000Z')).pendingCount).toBe(2);
    await db
      .collection(DIGEST_MONITORING_COLLECTION)
      .doc('failed')
      .update({ outcome: 'delivered', deliveredAt: '2026-11-11T09:05:00.000Z' });
    expect(await monitoring.read('2026-11-10T12:00:00.000Z')).toEqual({
      pendingCount: 0,
      failedCount: 0,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: '2026-11-11T09:05:00.000Z',
    });
    await db.collection('message_digest_definitions').doc('d').delete();
    expect(await monitoring.read('2026-11-12T12:00:00.000Z')).toEqual({
      pendingCount: 0,
      failedCount: 0,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: null,
    });
    monitoring.close();
    await expect(monitoring.read('2026-11-12T12:00:00.000Z')).rejects.toThrow('closed');
  });
});
