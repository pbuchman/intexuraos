import { describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
// Operator entry point is also imported by the rollout CLI; it never changes canonical data.
import { backfillDigestMonitoring } from '../../../../../scripts/message-digests/backfill-monitoring.mjs';
import { buildDigestMonitoringProjection } from './digestMonitoringProjection.js';
import { buildDigestMonitoringProjection as operatorProjection } from '../../../../../scripts/message-digests/monitoring-projection.mjs';

describe('digest monitoring backfill', () => {
  it('rereads a concurrent receipt and deletion after the source page was fetched', async () => {
    const db = createFakeFirestore();
    const run = {
      runId: 'a',
      generationStatus: 'completed',
      userId: 'u',
      definitionId: 'd',
      recordRole: 'canonical',
      visibilityMigrationId: null,
      scheduledBoundary: '2026-11-10T08:00:00.000Z',
      delivery: { status: 'sent', transportConfirmation: { status: 'pending' } },
    };
    db.seedCollection('message_digest_runs', [
      { id: 'a', data: run },
      { id: 'b', data: { ...run, runId: 'b' } },
    ]);
    db.seedCollection('message_digest_monitoring_runs', [
      { id: 'b', data: { ...buildDigestMonitoringProjection({ ...run, runId: 'b' }) } },
    ]);
    const transact = db.runTransaction.bind(db);
    let calls = 0;
    vi.spyOn(db, 'runTransaction').mockImplementation(async (callback) => {
      calls++;
      if (calls === 1)
        await db
          .collection('message_digest_runs')
          .doc('a')
          .update({
            delivery: {
              status: 'sent',
              transportConfirmation: {
                status: 'delivered',
                deliveredAt: '2026-11-10T08:01:00.000Z',
              },
            },
          });
      else await db.collection('message_digest_runs').doc('b').delete();
      return await transact(callback);
    });
    expect(await backfillDigestMonitoring(db as unknown as Firestore)).toEqual({
      scanned: 2,
      projected: 1,
    });
    expect(db.getAllData().get('message_digest_monitoring_runs')?.get('a')).toMatchObject({
      outcome: 'delivered',
    });
    expect(db.getAllData().get('message_digest_monitoring_runs')?.has('b')).toBe(false);
  });
  it('rebuilds from fresh transactional source and initializes only after all pages', async () => {
    const db = createFakeFirestore();
    const run = {
      runId: 'r',
      userId: 'u',
      definitionId: 'd',
      recordRole: 'canonical',
      visibilityMigrationId: null,
      generationStatus: 'completed',
      scheduledBoundary: '2026-11-10T08:00:00.000Z',
      windowEnd: '2026-11-10T08:00:00.000Z',
      delivery: {
        status: 'sent',
        transportConfirmation: { status: 'delivered', deliveredAt: '2026-11-10T08:01:00.000Z' },
      },
      summaryMarkdown: 'private content',
    };
    db.seedCollection('message_digest_runs', [
      { id: 'r', data: run },
      { id: 's', data: { ...run, runId: 's', deliveryMode: 'silent' } },
    ]);
    expect(
      await backfillDigestMonitoring(db as unknown as Firestore, { pageSize: 1 })
    ).toMatchObject({ scanned: 2, projected: 1 });
    expect(db.getAllData().get('message_digest_runs')?.get('r')).toEqual(run);
    expect(db.getAllData().get('message_digest_monitoring_runs')?.get('r')).toEqual(
      buildDigestMonitoringProjection(run)
    );
    expect(db.getAllData().get('message_digest_monitoring_runs')?.get('s')).toBeUndefined();
    expect(
      db.getAllData().get('message_digest_monitoring_runs')?.get('_initialization')
    ).toMatchObject({ schemaVersion: 1, complete: true });
  });

  it('leaves initialization incomplete for a malformed source without exposing its payload', async () => {
    const db = createFakeFirestore();
    db.seedCollection('message_digest_runs', [
      { id: 'broken', data: { runId: 'broken', summaryMarkdown: 'private content' } },
    ]);
    await expect(backfillDigestMonitoring(db as unknown as Firestore)).rejects.toThrow(
      'DIGEST_MONITORING_SOURCE_INVALID'
    );
    expect(db.getAllData().get('message_digest_monitoring_runs')?.get('_initialization')).toEqual({
      schemaVersion: 1,
      complete: false,
    });
  });

  it('keeps operator and service classifications identical', () => {
    const base = {
      runId: 'r',
      userId: 'u',
      definitionId: 'd',
      recordRole: 'canonical',
      visibilityMigrationId: null,
      scheduledBoundary: '2026-11-10T08:00:00.000Z',
      delivery: { status: 'pending' },
    };
    for (const patch of [
      {},
      { deliveryMode: 'silent' },
      { generationStatus: 'failed' },
      { generationStatus: 'skipped_no_activity' },
      { safeFailureCode: 'SKIPPED_BEFORE_RESUME' },
      {
        delivery: {
          status: 'sent',
          transportConfirmation: { status: 'read', readAt: '2026-11-10T08:01:00.000Z' },
        },
      },
    ])
      expect(operatorProjection({ ...base, ...patch })).toEqual(
        buildDigestMonitoringProjection({ ...base, ...patch })
      );
  });
});
