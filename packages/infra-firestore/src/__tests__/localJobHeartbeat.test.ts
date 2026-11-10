import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJobHeartbeatStore } from '../localJobHeartbeat.js';
import { createJobHeartbeatStore } from '../jobHeartbeat.js';
import { createFakeFirestore } from '../testing/index.js';
import type { Firestore } from '../firestore.js';
import { getFirestoreSnapshotCacheDiagnostics } from '../snapshotCache.js';

describe('local durable job heartbeats', () => {
  let directory: string;
  let instant: string;
  const stores: ReturnType<typeof createLocalJobHeartbeatStore>[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'heartbeat-test-'));
    instant = '2026-11-10T10:00:00.000Z';
  });
  afterEach(async () => {
    for (const store of stores) await store.close?.();
    stores.length = 0;
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  const make = (
    seed = async (): Promise<Record<string, never>> => ({})
  ): ReturnType<typeof createLocalJobHeartbeatStore> => {
    const store = createLocalJobHeartbeatStore({
      directory,
      collectionName: 'jobs',
      now: () => new Date(instant),
      seed,
    });
    stores.push(store);
    return store;
  };

  it('seeds once, persists across restarts, and runs idle ticks without database access', async () => {
    let seeds = 0;
    const first = make(async () => {
      seeds++;
      return {};
    });
    await first.finish(await first.start('tick'), 'succeeded');
    for (let poll = 0; poll < 500; poll++)
      expect((await first.list(['tick']))[0]?.lastOutcome).toBe('succeeded');
    await first.close?.();
    const restarted = make(async () => {
      throw new Error('database unavailable');
    });
    expect((await restarted.list(['tick']))[0]?.lastSucceededAt).toBe(instant);
    await restarted.finish(await restarted.start('tick'), 'failed');
    expect((await restarted.list(['tick']))[0]).toMatchObject({
      lastOutcome: 'failed',
      lastSucceededAt: instant,
    });
    expect(seeds).toBe(1);
    expect(JSON.parse(await readFile(join(directory, 'jobs.json'), 'utf8'))).toMatchObject({
      version: 1,
      records: { tick: { lastOutcome: 'failed' } },
    });
  });

  it('acquires kernel ownership with Python alone on PATH and no platform flock executable', async () => {
    const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {
      encoding: 'utf8',
    }).trim();
    const bin = join(directory, 'bin');
    await mkdir(bin);
    await symlink(python, join(bin, 'python3'));
    vi.stubEnv('PATH', bin);
    const store = make();
    await store.finish(await store.start('tick'), 'succeeded');
    await expect(make().list(['tick'])).rejects.toThrow('ownership unavailable');
    expect((await store.list(['tick']))[0]?.lastOutcome).toBe('succeeded');
  });

  it('fails closed when the portable kernel lock helper is unavailable', async () => {
    const bin = join(directory, 'empty-bin');
    await mkdir(bin);
    vi.stubEnv('PATH', bin);
    await expect(make().list(['tick'])).rejects.toThrow('ownership unavailable');
  });

  it('selects local persistence only for explicit PROD, counts initial migration, and retains prior success', async () => {
    const fake = createFakeFirestore();
    fake.seedCollection('jobs', [
      {
        id: 'tick',
        data: {
          key: 'tick',
          latestRunId: 'previous',
          lastStartedAt: instant,
          lastFinishedAt: instant,
          lastSucceededAt: instant,
          lastOutcome: 'succeeded',
        },
      },
    ]);
    vi.stubEnv('INTEXURAOS_MONITORING_STATE_DIR', directory);
    vi.stubEnv('INTEXURAOS_ENVIRONMENT', 'prod');
    const before = getFirestoreSnapshotCacheDiagnostics();
    const store = createJobHeartbeatStore({
      collectionName: 'jobs',
      firestore: fake as unknown as Firestore,
    });
    stores.push(store);
    expect((await store.list(['tick']))[0]?.lastSucceededAt).toBe(instant);
    expect(getFirestoreSnapshotCacheDiagnostics().queryStarts - before.queryStarts).toBe(1);
    expect(
      getFirestoreSnapshotCacheDiagnostics().receivedDocuments - before.receivedDocuments
    ).toBe(1);
    fake.configure({ errorToThrow: new Error('cloud unavailable') });
    await store.finish(await store.start('tick'), 'failed');
    expect((await store.list(['tick']))[0]?.lastSucceededAt).toBe(instant);
  });

  it('fails closed if legacy bootstrap exceeds the bounded fixed job inventory', async () => {
    const fake = createFakeFirestore();
    fake.seedCollection(
      'jobs',
      Array.from({ length: 100 }, (_, index) => ({ id: String(index), data: {} }))
    );
    vi.stubEnv('INTEXURAOS_MONITORING_STATE_DIR', directory);
    vi.stubEnv('INTEXURAOS_ENVIRONMENT', 'prod');
    const store = createJobHeartbeatStore({
      collectionName: 'jobs',
      firestore: fake as unknown as Firestore,
    });
    stores.push(store);
    await expect(store.list(['tick'])).rejects.toThrow('fixed job inventory');
  });

  it('serializes overlapping runs and preserves monotonic timestamps under clock rollback', async () => {
    const store = make();
    const [older, newer] = await Promise.all([store.start('tick'), store.start('tick')]);
    instant = '2026-11-10T09:00:00.000Z';
    await store.finish(newer, 'failed');
    instant = '2026-11-10T11:00:00.000Z';
    await store.finish(older, 'succeeded');
    expect((await store.list(['tick']))[0]).toEqual({
      key: 'tick',
      lastStartedAt: '2026-11-10T10:00:00.000Z',
      lastFinishedAt: instant,
      lastSucceededAt: instant,
      lastOutcome: 'failed',
    });
    await expect(store.finish({ ...older, key: 'missing' }, 'failed')).rejects.toThrow(
      'not started'
    );
  });

  it('refuses simultaneous process owners and releases the lock on close', async () => {
    const first = make();
    await first.list(['tick']);
    const second = make();
    await expect(second.list(['tick'])).rejects.toThrow('ownership unavailable');
    await first.close?.();
    expect((await make().list(['tick']))[0]?.lastOutcome).toBe('never');
  });

  it('fails closed for corrupt persisted state without falling back to Firestore', async () => {
    await writeFile(
      join(directory, 'jobs.json'),
      '{"version":1,"records":{"tick":{"lastOutcome":"success"}}}'
    );
    let seeds = 0;
    const store = make(async () => {
      seeds++;
      return {};
    });
    await expect(store.list(['tick'])).rejects.toThrow('Invalid local heartbeat state');
    await expect(store.start('tick')).rejects.toThrow('Invalid local heartbeat state');
    expect(seeds).toBe(0);
  });

  it('releases kernel ownership after SIGKILL and retains the last durable result', async () => {
    const moduleUrl = new URL('../localJobHeartbeat.ts', import.meta.url).href;
    const owner = spawn(process.execPath, [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `import { createLocalJobHeartbeatStore } from ${JSON.stringify(moduleUrl)};
       const store = createLocalJobHeartbeatStore({directory: process.argv[1], collectionName: 'jobs', now: () => new Date('2026-11-10T10:00:00.000Z'), seed: async () => ({})});
       await store.finish(await store.start('tick'), 'succeeded'); process.stdout.write('ready'); process.stdin.resume();`,
      directory,
    ]);
    await new Promise<void>((resolve, reject) => {
      owner.stdout.once('data', () => {
        resolve();
      });
      owner.once('error', reject);
      owner.once('exit', (code) => {
        if (code !== null) reject(new Error('owner startup failed'));
      });
    });
    owner.kill('SIGKILL');
    await new Promise<void>((resolve) => {
      owner.once('close', () => {
        resolve();
      });
    });
    await vi.waitFor(async () => {
      const recovered = make(async () => {
        throw new Error('database must not be read');
      });
      try {
        expect((await recovered.list(['tick']))[0]?.lastOutcome).toBe('succeeded');
      } finally {
        await recovered.close?.();
      }
    });
  });

  it('fails closed after an atomic state replacement fails', async () => {
    const store = make();
    const run = await store.start('tick');
    await rm(join(directory, 'jobs.json'));
    await mkdir(join(directory, 'jobs.json'));
    await expect(store.finish(run, 'succeeded')).rejects.toThrow('persistence unavailable');
    await expect(store.list(['tick'])).rejects.toThrow('persistence unavailable');
    await store.close?.();
    await expect(store.list(['tick'])).rejects.toThrow('closed');
  });

  it.each([
    null,
    [],
    { tick: null },
    {
      tick: {
        key: 'tick',
        latestRunId: '',
        lastOutcome: 'never',
        lastStartedAt: 'bad',
        lastFinishedAt: null,
        lastSucceededAt: null,
      },
    },
  ])('rejects invalid local records %j', async (records) => {
    await writeFile(join(directory, 'jobs.json'), JSON.stringify({ version: 1, records }));
    await expect(make().list(['tick'])).rejects.toThrow('Invalid local heartbeat state');
  });

  it.each([null, { version: 2, records: {} }])(
    'rejects invalid local envelopes %j',
    async (envelope) => {
      await writeFile(join(directory, 'jobs.json'), JSON.stringify(envelope));
      await expect(make().list(['tick'])).rejects.toThrow('Invalid local heartbeat state');
    }
  );

  it('rejects paths outside the explicit absolute local state directory contract', () => {
    expect(() =>
      createLocalJobHeartbeatStore({
        directory: 'relative',
        collectionName: 'jobs',
        now: () => new Date(),
        seed: async () => ({}),
      })
    ).toThrow('Invalid local heartbeat location');
    expect(() =>
      createLocalJobHeartbeatStore({
        directory,
        collectionName: '../escape',
        now: () => new Date(),
        seed: async () => ({}),
      })
    ).toThrow('Invalid local heartbeat location');
  });
});
