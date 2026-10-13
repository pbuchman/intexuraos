import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import {
  createFakeFirestore,
  createJobHeartbeatStore,
  type Firestore,
} from '@intexuraos/infra-firestore';
import {
  getDigestNotificationSummary,
  registerDigestJobMonitoring,
  summarizeDigestNotifications,
} from './jobMonitoring.js';

describe('digest scheduler monitoring', () => {
  it('records HTTP failures even when the response has no logical failure body', async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'monitor-test';
    const store = createJobHeartbeatStore({
      collectionName: 'test_digest_jobs',
      firestore: createFakeFirestore() as unknown as Firestore,
    });
    const app = Fastify();
    await app.register(intexuraFastifyPlugin);
    registerDigestJobMonitoring(
      app,
      () => store,
      async () => summarizeDigestNotifications([], [], '2026-10-12T09:00:00.000Z')
    );
    app.post(
      '/internal/message-digests/scheduler/tick',
      async (_request, reply) => await reply.code(503).send('storage unavailable')
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/message-digests/scheduler/tick',
          headers: { 'x-internal-auth': 'monitor-test' },
        })
      ).statusCode
    ).toBe(503);
    expect((await store.list(['message_digest_tick']))[0]?.lastOutcome).toBe('failed');
    await app.close();
  });

  it('tracks newest delivery evidence and rejects windows or due cursors before a definition cutoff', () => {
    const cutoff = '2026-10-12T12:00:00.000Z';
    const definition = {
      definitionId: 'd',
      userId: 'u',
      status: 'active',
      resumeCutoff: cutoff,
      nextRunAt: '2026-10-12T07:00:00.000Z',
    };
    const base = {
      userId: 'u',
      definitionId: 'd',
      generationStatus: 'completed' as const,
      scheduledBoundary: cutoff,
      windowEnd: cutoff,
    };
    const runs: Parameters<typeof summarizeDigestNotifications>[0] = [
      {
        ...base,
        delivery: {
          status: 'sent',
          transportConfirmation: { status: 'delivered', deliveredAt: '2026-10-12T12:05:00.000Z' },
        },
      },
      {
        ...base,
        scheduledBoundary: '2026-10-13T07:00:00.000Z',
        delivery: {
          status: 'sent',
          transportConfirmation: { status: 'read', readAt: '2026-10-13T08:00:00.000Z' },
        },
      },
      {
        ...base,
        delivery: {
          status: 'sent',
          transportConfirmation: { status: 'delivered', deliveredAt: '2026-10-12T12:04:00.000Z' },
        },
      },
      {
        ...base,
        scheduledBoundary: '2026-10-14T07:00:00.000Z',
        windowEnd: '2026-10-12T07:00:00.000Z',
        delivery: { status: 'pending' },
      },
      {
        ...base,
        scheduledBoundary: '2026-10-14T07:00:00.000Z',
        windowEnd: '2026-10-14T07:00:00.000Z',
        delivery: { status: 'pending' },
      },
    ];
    expect(summarizeDigestNotifications(runs, [definition], '2026-10-14T08:00:00.000Z')).toEqual({
      pendingCount: 1,
      failedCount: 0,
      oldestPendingScheduledFor: '2026-10-14T07:00:00.000Z',
      lastDeliveredAt: '2026-10-13T08:00:00.000Z',
    });
  });
  it.each([{ ok: true, reservedRuns: 0 }, { ok: false }, { ok: true, failures: 1 }])(
    'records empty ticks and logical failures %j',
    async (result) => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'monitor-test';
      const fake = createFakeFirestore();
      const store = createJobHeartbeatStore({
        collectionName: 'test_digest_jobs',
        firestore: fake as unknown as Firestore,
      });
      const app = Fastify();
      await app.register(intexuraFastifyPlugin);
      registerDigestJobMonitoring(
        app,
        () => store,
        async () => summarizeDigestNotifications([], [], '2026-10-12T09:00:00.000Z')
      );
      app.post(
        '/internal/message-digests/scheduler/tick',
        async (_request, reply) => await reply.ok(result)
      );
      await app.inject({
        method: 'POST',
        url: '/internal/message-digests/scheduler/tick',
        headers: { 'x-internal-auth': 'monitor-test' },
      });
      expect((await store.list(['message_digest_tick']))[0]?.lastOutcome).toBe(
        result.ok && !('failures' in result) ? 'succeeded' : 'failed'
      );
      const response = await app.inject({
        url: '/internal/monitoring/status',
        headers: { 'x-internal-auth': 'monitor-test' },
      });
      expect(response.json().data.notifications).toEqual({
        pendingCount: 0,
        failedCount: 0,
        oldestPendingScheduledFor: null,
        lastDeliveredAt: null,
      });
      expect((await app.inject({ url: '/internal/monitoring/status' })).statusCode).toBe(401);
      await app.close();
    }
  );

  it('counts accepted-but-unconfirmed work as pending and excludes skipped and silent history', () => {
    const run = {
      userId: 'u',
      definitionId: 'd',
      generationStatus: 'completed' as const,
      scheduledBoundary: '2026-10-11T07:00:00.000Z',
    };
    expect(
      summarizeDigestNotifications(
        [
          { ...run, delivery: { status: 'sent', transportConfirmation: { status: 'pending' } } },
          {
            ...run,
            scheduledBoundary: '2026-10-12T07:00:00.000Z',
            delivery: { status: 'pending' },
          },
          { ...run, delivery: { status: 'failed', failureCode: 'SKIPPED_BEFORE_RESUME' } },
          { ...run, deliveryMode: 'silent', delivery: { status: 'not_sent' } },
          {
            ...run,
            scheduledBoundary: '2026-10-10T07:00:00.000Z',
            delivery: {
              status: 'sent',
              transportConfirmation: { status: 'read', deliveredAt: '2026-10-12T08:00:00.000Z' },
            },
          },
          { ...run, delivery: { status: 'sent', transportConfirmation: { status: 'failed' } } },
        ],
        [
          {
            definitionId: 'd',
            userId: 'u',
            status: 'active',
            nextRunAt: '2026-10-13T07:00:00.000Z',
          },
        ],
        '2026-10-12T09:00:00.000Z'
      )
    ).toEqual({
      pendingCount: 2,
      failedCount: 1,
      oldestPendingScheduledFor: '2026-10-11T07:00:00.000Z',
      lastDeliveredAt: '2026-10-12T08:00:00.000Z',
    });
  });

  it('summarizes only active unsuperseded work, generation failures and due definitions with no run', async () => {
    const fake = createFakeFirestore();
    const definition = {
      definitionId: 'd',
      userId: 'u',
      status: 'active',
      nextRunAt: '2026-10-13T07:00:00.000Z',
    };
    fake.seedCollection('message_digest_definitions', [
      { id: 'd', data: definition },
      {
        id: 'empty',
        data: { ...definition, definitionId: 'empty', nextRunAt: '2026-10-12T07:00:00.000Z' },
      },
      ...['paused', 'migrating'].map((status) => ({
        id: status,
        data: {
          ...definition,
          definitionId: status,
          status,
          nextRunAt: '2026-09-01T07:00:00.000Z',
        },
      })),
    ]);
    const run = {
      userId: 'u',
      definitionId: 'd',
      recordRole: 'canonical',
      visibilityMigrationId: null,
      generationStatus: 'failed',
      delivery: { status: 'not_sent' },
      scheduledBoundary: '2026-10-09T07:00:00.000Z',
    };
    fake.seedCollection('message_digest_runs', [
      { id: 'old-failed', data: run },
      {
        id: 'delivered',
        data: {
          ...run,
          generationStatus: 'completed',
          scheduledBoundary: '2026-10-10T07:00:00.000Z',
          delivery: {
            status: 'sent',
            transportConfirmation: { status: 'delivered', deliveredAt: '2026-10-10T08:00:00.000Z' },
          },
        },
      },
      { id: 'new-failed', data: { ...run, scheduledBoundary: '2026-10-11T07:00:00.000Z' } },
      {
        id: 'queued',
        data: { ...run, generationStatus: 'queued', scheduledBoundary: '2026-10-12T07:00:00.000Z' },
      },
      { id: 'hidden', data: { ...run, visibilityMigrationId: 'migration' } },
      { id: 'paused', data: { ...run, definitionId: 'paused' } },
      { id: 'audit', data: { ...run, recordRole: 'audit' } },
      {
        id: 'skipped',
        data: {
          ...run,
          generationStatus: 'skipped_no_activity',
          scheduledBoundary: '2026-10-12T07:00:00.000Z',
        },
      },
    ]);
    expect(
      await getDigestNotificationSummary(fake as unknown as Firestore, '2026-10-12T09:00:00.000Z')
    ).toEqual({
      pendingCount: 2,
      failedCount: 1,
      oldestPendingScheduledFor: '2026-10-12T07:00:00.000Z',
      lastDeliveredAt: '2026-10-10T08:00:00.000Z',
    });
    expect(
      fake.getAllData().get('message_digest_runs')?.get('old-failed')?.['generationStatus']
    ).toBe('failed');
    expect(
      summarizeDigestNotifications(
        [],
        [{ ...definition, status: 'paused' }],
        '2026-10-14T09:00:00.000Z'
      ).pendingCount
    ).toBe(0);
  });

  it('retains accepted history while excluding pre-resume windows from actionable counts', () => {
    const cutoff = '2026-10-12T12:00:00.000Z';
    const definition = {
      definitionId: 'd',
      userId: 'u',
      status: 'active',
      nextRunAt: '2026-10-13T07:00:00.000Z',
      resumeCutoff: cutoff,
    };
    const base = {
      userId: 'u',
      definitionId: 'd',
      generationStatus: 'completed' as const,
      scheduledBoundary: '2026-10-12T07:00:00.000Z',
    };
    const history: Parameters<typeof summarizeDigestNotifications>[0] = [
      {
        ...base,
        delivery: { status: 'sent', transportConfirmation: { status: 'pending' as const } },
      },
      {
        ...base,
        delivery: { status: 'sent', transportConfirmation: { status: 'failed' as const } },
      },
      {
        ...base,
        scheduledBoundary: '2026-10-11T07:00:00.000Z',
        delivery: {
          status: 'sent',
          transportConfirmation: {
            status: 'delivered' as const,
            deliveredAt: '2026-10-11T08:00:00.000Z',
          },
        },
      },
      { ...base, scheduledBoundary: cutoff, delivery: { status: 'pending' } },
    ];
    const before = JSON.stringify(history);
    expect(summarizeDigestNotifications(history, [definition], cutoff)).toEqual({
      pendingCount: 1,
      failedCount: 0,
      oldestPendingScheduledFor: cutoff,
      lastDeliveredAt: '2026-10-11T08:00:00.000Z',
    });
    expect(JSON.stringify(history)).toBe(before);
  });

  it('fails closed without a store, ignores unrelated requests, rejects unauthenticated ticks and records malformed or HTTP failures', async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'monitor-test';
    const fake = createFakeFirestore();
    const store = createJobHeartbeatStore({
      collectionName: 'test_digest_jobs',
      firestore: fake as unknown as Firestore,
    });
    const monitoring: { store: typeof store | undefined } = { store: undefined };
    const app = Fastify();
    await app.register(intexuraFastifyPlugin);
    registerDigestJobMonitoring(
      app,
      () => monitoring.store,
      async () => summarizeDigestNotifications([], [], '2026-10-12T09:00:00.000Z')
    );
    app.post(
      '/internal/message-digests/scheduler/tick',
      async (_request, reply) => await reply.send('malformed')
    );
    app.post('/other', async () => 'ok');
    expect(
      (
        await app.inject({
          url: '/internal/monitoring/status',
          headers: { 'x-internal-auth': 'monitor-test' },
        })
      ).statusCode
    ).toBe(503);
    expect(
      (await app.inject({ method: 'POST', url: '/internal/message-digests/scheduler/tick' }))
        .statusCode
    ).toBe(401);
    await app.inject({
      method: 'POST',
      url: '/internal/message-digests/scheduler/tick',
      headers: { 'x-internal-auth': 'monitor-test' },
    });
    monitoring.store = store;
    await app.inject({ method: 'POST', url: '/other' });
    await app.inject({
      method: 'POST',
      url: '/internal/message-digests/scheduler/tick',
      headers: { 'x-internal-auth': 'monitor-test' },
    });
    expect((await store.list(['message_digest_tick']))[0]?.lastOutcome).toBe('failed');
    await app.close();
  });
});
