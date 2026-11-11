import { beforeEach, describe, expect, it } from 'vitest';
import { resetFirestore, setFirestore, type Firestore } from '../firestore.js';
import { createFakeFirestore } from '../testing/index.js';
import { createJobHeartbeatStore } from '../jobHeartbeat.js';

describe('persisted job heartbeats', () => {
  const fake = createFakeFirestore();
  let instant = '2026-10-12T10:00:00.000Z';
  const makeStore = (): ReturnType<typeof createJobHeartbeatStore> =>
    createJobHeartbeatStore({
      collectionName: 'test_job_heartbeats',
      firestore: fake as unknown as Firestore,
      now: () => new Date(instant),
    });
  beforeEach(() => {
    fake.clear();
    instant = '2026-10-12T10:00:00.000Z';
  });

  it('returns never for missing jobs and persists a successful no-work tick across instances', async () => {
    const store = makeStore();
    expect(await store.list(['tick'])).toEqual([
      {
        key: 'tick',
        lastStartedAt: null,
        lastFinishedAt: null,
        lastSucceededAt: null,
        lastOutcome: 'never',
      },
    ]);
    const token = await store.start('tick');
    expect((await store.list(['tick']))[0]?.lastOutcome).toBe('running');
    instant = '2026-10-12T10:01:00.000Z';
    await store.finish(token, 'succeeded');
    expect(await makeStore().list(['tick'])).toEqual([
      {
        key: 'tick',
        lastStartedAt: token.startedAt,
        lastFinishedAt: instant,
        lastSucceededAt: instant,
        lastOutcome: 'succeeded',
      },
    ]);
  });

  it('preserves last success when a later job fails', async () => {
    const store = makeStore();
    await store.finish(await store.start('tick'), 'succeeded');
    instant = '2026-10-12T11:00:00.000Z';
    await store.finish(await store.start('tick'), 'failed');
    expect((await store.list(['tick']))[0]).toMatchObject({
      lastOutcome: 'failed',
      lastSucceededAt: '2026-10-12T10:00:00.000Z',
    });
  });

  it('does not let older overlapping completions overwrite the newest run outcome', async () => {
    const store = makeStore();
    const older = await store.start('tick');
    instant = '2026-10-12T10:02:00.000Z';
    const newer = await store.start('tick');
    instant = '2026-10-12T10:03:00.000Z';
    await store.finish(newer, 'failed');
    instant = '2026-10-12T10:04:00.000Z';
    await store.finish(older, 'succeeded');
    expect((await store.list(['tick']))[0]).toEqual({
      key: 'tick',
      lastStartedAt: newer.startedAt,
      lastFinishedAt: instant,
      lastSucceededAt: instant,
      lastOutcome: 'failed',
    });
  });

  it('serializes simultaneous starts and keeps timestamps monotonic under clock rollback', async () => {
    const store = makeStore();
    const [first, second] = await Promise.all([store.start('tick'), store.start('tick')]);
    instant = '2026-10-12T09:00:00.000Z';
    await store.finish(second, 'failed');
    await store.finish(first, 'succeeded');
    expect((await store.list(['tick']))[0]).toMatchObject({
      lastStartedAt: '2026-10-12T10:00:00.000Z',
      lastFinishedAt: '2026-10-12T10:00:00.000Z',
      lastOutcome: 'failed',
    });
  });

  it('isolates service collections and propagates storage failures', async () => {
    const store = makeStore();
    const token = await store.start('tick');
    const other = createJobHeartbeatStore({
      collectionName: 'other_job_heartbeats',
      firestore: fake as unknown as Firestore,
    });
    expect((await other.list(['tick']))[0]?.lastOutcome).toBe('never');
    fake.configure({ errorToThrow: new Error('storage unavailable') });
    await expect(store.start('tick')).rejects.toThrow('storage unavailable');
    await expect(store.finish(token, 'failed')).rejects.toThrow('storage unavailable');
    await expect(store.list(['tick'])).rejects.toThrow('storage unavailable');
  });

  it('uses the shared client and actual clock by default and rejects a missing start', async () => {
    setFirestore(fake as unknown as Firestore);
    try {
      const store = createJobHeartbeatStore({ collectionName: 'test_job_heartbeats' });
      await expect(
        store.finish({ key: 'missing', runId: 'missing', startedAt: instant }, 'failed')
      ).rejects.toThrow('not started');
      const token = await store.start('tick');
      await store.finish(token, 'succeeded');
      expect((await store.list(['tick']))[0]?.lastSucceededAt).toEqual(expect.any(String));
    } finally {
      resetFirestore();
    }
  });
});
