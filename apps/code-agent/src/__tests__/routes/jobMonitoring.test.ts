import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import {
  createFakeFirestore,
  createJobHeartbeatStore,
  type Firestore,
} from '@intexuraos/infra-firestore';
import { CODE_SCHEDULER_JOBS, registerCodeJobMonitoring } from '../../routes/jobMonitoring.js';

describe('code scheduler monitoring', () => {
  it('ignores unknown POST routes and records binary or string-error scheduler responses as failed', async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'monitor-test';
    const store = createJobHeartbeatStore({
      collectionName: 'test_jobs',
      firestore: createFakeFirestore() as unknown as Firestore,
    });
    const app = Fastify();
    await app.register(intexuraFastifyPlugin);
    registerCodeJobMonitoring(app, () => store);
    app.post('/internal/drain-queue', async (request, reply) =>
      request.headers['x-binary']
        ? await reply.send(Buffer.from('invalid-binary-result'))
        : await reply.ok({ error: 'provider unavailable' })
    );
    expect((await app.inject({ method: 'POST', url: '/unknown' })).statusCode).toBe(404);
    expect((await store.list(['drain_task_queue']))[0]?.lastOutcome).toBe('never');
    for (const headers of [
      { 'x-internal-auth': 'monitor-test', 'x-binary': '1' },
      { 'x-internal-auth': 'monitor-test' },
    ]) {
      await app.inject({ method: 'POST', url: '/internal/drain-queue', headers });
      expect((await store.list(['drain_task_queue']))[0]?.lastOutcome).toBe('failed');
    }
    await app.close();
  });
  it.each(Object.entries(CODE_SCHEDULER_JOBS))(
    'persists an empty successful tick for %s',
    async (path, key) => {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'monitor-test';
      const fake = createFakeFirestore();
      const store = createJobHeartbeatStore({
        collectionName: 'test_jobs',
        firestore: fake as unknown as Firestore,
      });
      const app = Fastify();
      await app.register(intexuraFastifyPlugin);
      registerCodeJobMonitoring(app, () => store);
      app.post(path, async (_request, reply) => await reply.ok({ processed: 0 }));
      const response = await app.inject({
        method: 'POST',
        url: path,
        headers: { 'x-internal-auth': 'monitor-test' },
      });
      expect(response.statusCode).toBe(200);
      expect((await store.list([key]))[0]).toMatchObject({
        lastOutcome: 'succeeded',
        lastSucceededAt: expect.any(String),
      });
      await app.close();
    }
  );

  it.each([
    ['/internal/drain-queue', { action: 'failed', taskId: 'synthetic' }],
    ['/internal/merge-conflicts/reconcile', { scanned: 1, dispatched: 0, skipped: 0, error: 1 }],
    [
      '/internal/merge-queue/tick',
      {
        results: [
          { action: 'skipped', reason: 'checks_pending' },
          { action: 'error', reason: 'API_ERROR' },
        ],
      },
    ],
    [
      '/internal/code/detect-zombies',
      { detected: 1, interrupted: 0, errors: ['worker unavailable'] },
    ],
    ['/internal/archive-stale-groups', { tasksArchived: 0, tasksFailed: 1 }],
    ['/internal/auto-archive-merged-tasks', { tasksArchived: 0, tasksFailed: 1 }],
    ['/internal/execution-memory/process', { processed: 1, applied: 0, errored: 1 }],
    ['/internal/execution-memory/sweep-errored', { swept: 0, failedCount: 1 }],
    ['/internal/execution-memory/prune-stale', { pruned: 0, failedCount: 1 }],
  ] as const)('records partial logical failure using %s result shape', async (path, result) => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'monitor-test';
    const fake = createFakeFirestore();
    const store = createJobHeartbeatStore({
      collectionName: 'test_jobs',
      firestore: fake as unknown as Firestore,
    });
    const app = Fastify();
    await app.register(intexuraFastifyPlugin);
    registerCodeJobMonitoring(app, () => store);
    app.post(path, async (_request, reply) => await reply.ok(result));
    await app.inject({ method: 'POST', url: path, headers: { 'x-internal-auth': 'monitor-test' } });
    expect((await store.list([CODE_SCHEDULER_JOBS[path] ?? '']))[0]).toMatchObject({
      lastOutcome: 'failed',
      lastSucceededAt: null,
    });
    await app.close();
  });

  it('treats benign skips as successful, malformed output as failure and missing storage as unavailable', async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'monitor-test';
    const fake = createFakeFirestore();
    const store = createJobHeartbeatStore({
      collectionName: 'test_jobs',
      firestore: fake as unknown as Firestore,
    });
    const monitoring: { store: typeof store | undefined } = { store: undefined };
    const app = Fastify();
    await app.register(intexuraFastifyPlugin);
    registerCodeJobMonitoring(app, () => monitoring.store);
    app.post('/internal/drain-queue', async (request, reply) =>
      request.headers['x-malformed']
        ? await reply.send('malformed')
        : await reply.ok({ action: 'skipped', reason: 'queue_empty', errors: [], failedCount: 0 })
    );
    expect(
      (
        await app.inject({
          url: '/internal/monitoring/status',
          headers: { 'x-internal-auth': 'monitor-test' },
        })
      ).statusCode
    ).toBe(503);
    await app.inject({
      method: 'POST',
      url: '/internal/drain-queue',
      headers: { 'x-internal-auth': 'monitor-test' },
    });
    monitoring.store = store;
    await app.inject({
      method: 'POST',
      url: '/internal/drain-queue',
      headers: { 'x-internal-auth': 'monitor-test' },
    });
    expect((await store.list(['drain_task_queue']))[0]?.lastOutcome).toBe('succeeded');
    await app.inject({
      method: 'POST',
      url: '/internal/drain-queue',
      headers: { 'x-internal-auth': 'monitor-test', 'x-malformed': '1' },
    });
    expect((await store.list(['drain_task_queue']))[0]?.lastOutcome).toBe('failed');
    await app.close();
  });

  it('protects status, omits unauthenticated ticks, and records thrown failures', async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'monitor-test';
    const fake = createFakeFirestore();
    const store = createJobHeartbeatStore({
      collectionName: 'test_jobs',
      firestore: fake as unknown as Firestore,
    });
    const app = Fastify();
    await app.register(intexuraFastifyPlugin);
    registerCodeJobMonitoring(app, () => store);
    app.post('/internal/drain-queue', async () => {
      throw new Error('failed');
    });
    expect((await app.inject({ url: '/internal/monitoring/status' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/internal/drain-queue' })).statusCode).toBe(
      401
    );
    expect((await store.list(['drain_task_queue']))[0]?.lastOutcome).toBe('never');
    await app.inject({
      method: 'POST',
      url: '/internal/drain-queue',
      headers: { 'x-internal-auth': 'monitor-test' },
    });
    const response = await app.inject({
      url: '/internal/monitoring/status',
      headers: { 'x-internal-auth': 'monitor-test' },
    });
    expect(response.json().data.jobs).toHaveLength(9);
    expect((await store.list(['drain_task_queue']))[0]?.lastOutcome).toBe('failed');
    await app.close();
  });
});
