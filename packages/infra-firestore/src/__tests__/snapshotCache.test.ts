import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { Firestore } from '@google-cloud/firestore';
import type { Query, QueryDocumentSnapshot } from '../firestore.js';
import {
  createFirestoreSnapshotCache,
  closeFirestoreSnapshotCaches,
  getFirestoreSnapshotCacheDiagnostics,
  recordFirestoreMonitoringBootstrap,
} from '../snapshotCache.js';

function watchSource(): {
  query: () => Query;
  emit: (values: string[], removed?: string[]) => void;
  fail: (error: Error) => void;
  starts: () => number;
  stops: () => number;
} {
  let next: ((snapshot: unknown) => void) | undefined;
  let error: ((error: Error) => void) | undefined;
  let starts = 0;
  let stops = 0;
  return {
    query: () =>
      ({
        onSnapshot: (onNext: typeof next, onError: typeof error) => {
          starts++;
          next = onNext;
          error = onError;
          return (): void => {
            stops++;
          };
        },
      }) as unknown as Query,
    emit: (values, removed = []): void => {
      const docs = values.map((value) => ({
        id: value,
        data: (): { value: string } => ({ value }),
        toDocumentProto: (): { name: string } => ({ name: value }),
      }));
      const deleted = removed.map((value) => ({
        id: value,
        data: (): { value: string } => ({ value }),
        toDocumentProto: (): { name: string } => ({ name: value }),
      }));
      next?.({
        docs,
        docChanges: () => [
          ...docs.map((doc) => ({ type: 'added', doc })),
          ...deleted.map((doc) => ({ type: 'removed', doc })),
        ],
      });
    },
    fail: (cause): void => {
      error?.(cause);
    },
    starts: () => starts,
    stops: () => stops,
  };
}

const map = (doc: QueryDocumentSnapshot): string => doc.id;
afterEach(() => {
  closeFirestoreSnapshotCaches();
  vi.useRealTimers();
});

describe('Firestore monitoring snapshots', () => {
  it('counts native removals and deletions separately without attributing old document bodies to received payloads', async () => {
    const db = new Firestore({ projectId: 'monitoring-test' });
    const internal = db as unknown as {
      initializeIfNeeded(): Promise<void>;
      requestStream(): Promise<PassThrough>;
    };
    internal.initializeIfNeeded = async (): Promise<void> => {
      await Promise.resolve();
    };
    const stream = new PassThrough({ objectMode: true });
    let requested = false;
    internal.requestStream = async (): Promise<PassThrough> => {
      requested = true;
      return await Promise.resolve(stream);
    };
    const cache = createFirestoreSnapshotCache({ query: () => db.collection('items'), map });
    const first = cache.read();
    await vi.waitFor(() => {
      expect(requested).toBe(true);
    });
    const prefix = 'projects/monitoring-test/databases/(default)/documents/items/';
    for (const id of ['removed', 'deleted']) {
      stream.emit('data', {
        documentChange: {
          targetIds: [1],
          document: {
            name: `${prefix}${id}`,
            fields: { value: { stringValue: id } },
            createTime: { seconds: 1 },
            updateTime: { seconds: 1 },
          },
        },
      });
    }
    stream.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [1] } });
    stream.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 2 } },
    });
    expect(await first).toEqual(['deleted', 'removed']);
    const idle = cache.diagnostics();
    const globalIdle = getFirestoreSnapshotCacheDiagnostics();
    for (let poll = 0; poll < 100; poll++)
      expect(await cache.read()).toEqual(['deleted', 'removed']);
    expect(cache.diagnostics()).toEqual(idle);
    expect(idle).toMatchObject({ documentRemoveEvents: 0, documentDeleteEvents: 0 });
    stream.emit('data', {
      documentRemove: {
        document: `${prefix}removed`,
        removedTargetIds: [1],
        readTime: { seconds: 3 },
      },
    });
    stream.emit('data', {
      documentDelete: {
        document: `${prefix}deleted`,
        removedTargetIds: [1],
        readTime: { seconds: 3 },
      },
    });
    stream.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 3 } },
    });
    expect(await cache.read()).toEqual([]);
    expect(cache.diagnostics()).toMatchObject({
      documentReads: 2,
      documentRemoveEvents: 1,
      documentDeleteEvents: 1,
      protobufDocumentBytes: idle.protobufDocumentBytes,
    });
    expect(cache.diagnostics().listenResponseBytes).toBeGreaterThan(idle.listenResponseBytes);
    expect(
      getFirestoreSnapshotCacheDiagnostics().documentRemoveEvents - globalIdle.documentRemoveEvents
    ).toBe(1);
    expect(
      getFirestoreSnapshotCacheDiagnostics().documentDeleteEvents - globalIdle.documentDeleteEvents
    ).toBe(1);
    cache.close();
  });

  it('removes deleted documents without counting their previous bodies as received payloads', async () => {
    const source = watchSource();
    const cache = createFirestoreSnapshotCache({ query: source.query, map });
    const first = cache.read();
    source.emit(['a']);
    expect(await first).toEqual(['a']);
    const before = cache.diagnostics();
    source.emit([], ['a']);
    expect(await cache.read()).toEqual([]);
    expect(cache.diagnostics()).toEqual(before);
  });

  it('ignores backend readiness and frames when native stream creation finishes after close', async () => {
    const db = new Firestore({ projectId: 'monitoring-test' });
    const internal = db as unknown as {
      initializeIfNeeded(): Promise<void>;
      requestStream(): Promise<PassThrough>;
    };
    internal.initializeIfNeeded = async (): Promise<void> => {
      await Promise.resolve();
    };
    let release: ((stream: PassThrough) => void) | undefined;
    let requested = false;
    internal.requestStream = async (): Promise<PassThrough> => {
      requested = true;
      return await new Promise((resolve) => {
        release = resolve;
      });
    };
    const cache = createFirestoreSnapshotCache({ query: () => db.collection('items'), map });
    const pending = expect(cache.read()).rejects.toThrow('closed');
    await vi.waitFor(() => {
      expect(requested).toBe(true);
    });
    cache.close();
    await pending;
    const before = cache.diagnostics();
    const lateStream = new PassThrough({ objectMode: true });
    release?.(lateStream);
    await vi.waitFor(() => {
      expect(lateStream.listenerCount('data')).toBeGreaterThan(0);
    });
    lateStream.emit('data', { documentChange: { document: { name: 'late' } } });
    lateStream.emit('end');
    expect(cache.diagnostics()).toEqual(before);
    await expect(cache.read()).rejects.toThrow('closed');
  });

  it('rejects stale cached documents immediately when the native existence filter resets the query', async () => {
    const db = new Firestore({ projectId: 'monitoring-test' });
    const internal = db as unknown as {
      initializeIfNeeded(): Promise<void>;
      requestStream(): Promise<PassThrough>;
    };
    internal.initializeIfNeeded = async (): Promise<void> => {
      await Promise.resolve();
    };
    const streams: PassThrough[] = [];
    internal.requestStream = async (): Promise<PassThrough> => {
      const stream = new PassThrough({ objectMode: true });
      streams.push(stream);
      return await Promise.resolve(stream);
    };
    const cache = createFirestoreSnapshotCache({ query: () => db.collection('items'), map });
    const first = cache.read();
    await vi.waitFor(() => {
      expect(streams).toHaveLength(1);
    });
    const stream = streams[0] as PassThrough;
    stream.emit('data', {
      documentChange: {
        targetIds: [1],
        document: {
          name: 'projects/monitoring-test/databases/(default)/documents/items/old',
          fields: {},
          createTime: { seconds: 1 },
          updateTime: { seconds: 1 },
        },
      },
    });
    stream.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [1] } });
    stream.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 2 } },
    });
    expect(await first).toEqual(['old']);
    stream.emit('data', { filter: { targetId: 1, count: 1 } });
    await expect(cache.read()).rejects.toThrow('not synchronized');
    // A matching filter does not reset the SDK's current target or send CURRENT.
    stream.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 3 } },
    });
    expect(await cache.read()).toEqual(['old']);
    stream.emit('data', { filter: { targetId: 1, count: 0 } });
    await expect(cache.read()).rejects.toThrow('not synchronized');
    stream.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 4 } },
    });
    await expect(cache.read()).rejects.toThrow('not synchronized');
    await vi.waitFor(
      () => {
        expect(streams).toHaveLength(2);
      },
      { timeout: 3000 }
    );
    const replacement = streams[1] as PassThrough;
    replacement.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [1] } });
    await expect(cache.read()).rejects.toThrow('not synchronized');
    replacement.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 5 } },
    });
    expect(await cache.read()).toEqual([]);
    cache.close();
  });

  it('fails closed on native transient disconnect and only recovers at the SDK catch-up barrier', async () => {
    const db = new Firestore({ projectId: 'monitoring-test' });
    const internal = db as unknown as {
      initializeIfNeeded(): Promise<void>;
      requestStream(): Promise<PassThrough>;
    };
    internal.initializeIfNeeded = async (): Promise<void> => {
      await Promise.resolve();
    };
    const streams: PassThrough[] = [];
    internal.requestStream = async (): Promise<PassThrough> => {
      const stream = new PassThrough({ objectMode: true });
      streams.push(stream);
      return await Promise.resolve(stream);
    };
    const cache = createFirestoreSnapshotCache({ query: () => db.collection('items'), map });
    const first = cache.read();
    await vi.waitFor(() => {
      expect(streams).toHaveLength(1);
    });
    const stream = streams[0] as PassThrough;
    stream.emit('data', {
      documentChange: {
        targetIds: [1],
        document: {
          name: 'projects/monitoring-test/databases/(default)/documents/items/first',
          fields: { value: { stringValue: 'hello' } },
          createTime: { seconds: 1 },
          updateTime: { seconds: 1 },
        },
      },
    });
    stream.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [1] } });
    stream.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 2 } },
    });
    expect(await first).toEqual(['first']);
    expect(cache.diagnostics()).toMatchObject({
      queryStarts: 1,
      transportStreamStarts: 1,
      documentReads: 1,
    });
    const idle = cache.diagnostics();
    for (let poll = 0; poll < 100; poll++) expect(await cache.read()).toEqual(['first']);
    expect(cache.diagnostics()).toEqual(idle);
    expect(cache.diagnostics().protobufDocumentBytes).toBeGreaterThan(70);
    const bytesBeforeKeepalive = cache.diagnostics().listenResponseBytes;
    expect(getFirestoreSnapshotCacheDiagnostics()).toMatchObject({
      activeListeners: 1,
      readyListeners: 1,
      erroredListeners: 0,
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 120000);
    await expect(cache.read()).rejects.toThrow('not synchronized');
    // A native no-change keepalive restores the live stream without a query.
    stream.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 3 } },
    });
    expect(await cache.read()).toEqual(['first']);
    expect(cache.diagnostics().listenResponseBytes).toBeGreaterThan(bytesBeforeKeepalive);
    expect(cache.diagnostics().documentReads).toBe(1);
    stream.emit('data', { targetChange: { targetChangeType: 'RESET' } });
    await expect(cache.read()).rejects.toThrow('not synchronized');
    stream.emit('data', { targetChange: { targetChangeType: 'CURRENT' } });
    await expect(cache.read()).rejects.toThrow('not synchronized');
    stream.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', targetIds: [1], readTime: { seconds: 3 } },
    });
    await expect(cache.read()).rejects.toThrow('not synchronized');
    stream.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 3 } },
    });
    expect(await cache.read()).toEqual([]);
    stream.emit('error', Object.assign(new Error('offline'), { code: 14 }));
    await expect(cache.read()).rejects.toThrow('not synchronized');
    vi.useRealTimers();
    await vi.waitFor(
      () => {
        expect(streams).toHaveLength(2);
      },
      { timeout: 3000 }
    );
    const resumed = streams[1] as PassThrough;
    stream.emit('end'); // A late old-stream end cannot poison the new stream.
    resumed.emit('data', { targetChange: { targetChangeType: 'CURRENT' } });
    await expect(cache.read()).rejects.toThrow('not synchronized');
    resumed.emit('data', {
      targetChange: { targetChangeType: 'NO_CHANGE', readTime: { seconds: 4 } },
    });
    expect(await cache.read()).toEqual([]);
    expect(cache.diagnostics().queryStarts).toBe(1);
    expect(cache.diagnostics().transportStreamStarts).toBe(2);
    cache.close();
    resumed.emit('data', { targetChange: { targetChangeType: 'CURRENT' } });
  });

  it('accounts for canonical bootstrap protobuf documents without exposing their contents', () => {
    const before = getFirestoreSnapshotCacheDiagnostics();
    recordFirestoreMonitoringBootstrap([
      { toDocumentProto: () => ({ name: 'a' }) } as unknown as QueryDocumentSnapshot,
    ]);
    expect(
      getFirestoreSnapshotCacheDiagnostics().protobufDocumentBytes - before.protobufDocumentBytes
    ).toBe(3);
  });

  it('cancels a synchronously failed listener before retrying', async () => {
    vi.useFakeTimers();
    let stopped = 0;
    const query = {
      onSnapshot: (_next: unknown, error: (cause: Error) => void): (() => void) => {
        error(new Error('synchronous failure'));
        return (): void => {
          stopped++;
        };
      },
    } as unknown as Query;
    const cache = createFirestoreSnapshotCache({ query: () => query, map });
    await expect(cache.read()).rejects.toThrow('synchronous failure');
    expect(stopped).toBe(1);
  });

  it('rejects pending reads on close and ignores obsolete terminal callbacks', async () => {
    const source = watchSource();
    const cache = createFirestoreSnapshotCache({ query: source.query, map });
    const pending = expect(cache.read()).rejects.toThrow('closed');
    cache.close();
    cache.close();
    source.fail(new Error('late'));
    source.emit(['late']);
    await pending;
  });

  it.each([new Error('invalid document'), 'invalid document'])(
    'propagates query creation and mapping failures and retries without stale values: %s',
    async (mappingError) => {
      vi.useFakeTimers();
      let failed = true;
      const source = watchSource();
      const cache = createFirestoreSnapshotCache({
        query: () => {
          if (failed) throw 'query unavailable';
          return source.query();
        },
        map: () => {
          throw mappingError;
        },
      });
      await expect(cache.read()).rejects.toThrow('query unavailable');
      failed = false;
      await vi.advanceTimersByTimeAsync(1000);
      const pending = expect(cache.read()).rejects.toThrow('invalid document');
      source.emit(['bad']);
      await pending;
    }
  );
  it('waits for the initial snapshot and serves unchanged reads without another query', async () => {
    const source = watchSource();
    const cache = createFirestoreSnapshotCache({ query: source.query, map });
    const first = cache.read();
    source.emit(['first']);
    expect(await first).toEqual(['first']);
    for (let index = 0; index < 500; index++) expect(await cache.read()).toEqual(['first']);
    expect(source.starts()).toBe(1);
    source.emit(['changed']);
    expect(await cache.read()).toEqual(['changed']);
    expect(cache.diagnostics()).toMatchObject({ queryStarts: 1, documentReads: 2 });
    expect(cache.diagnostics().protobufDocumentBytes).toBe(16);
  });

  it('invalidates failed watches and recovers automatically after backoff', async () => {
    vi.useFakeTimers();
    const source = watchSource();
    const cache = createFirestoreSnapshotCache({ query: source.query, map });
    const first = cache.read();
    source.emit(['stale']);
    await first;
    source.fail(new Error('watch unavailable'));
    await expect(cache.read()).rejects.toThrow('watch unavailable');
    await vi.advanceTimersByTimeAsync(1000);
    const recovering = cache.read();
    source.emit(['fresh']);
    expect(await recovering).toEqual(['fresh']);
    expect(source.starts()).toBe(2);
    expect(source.stops()).toBe(1);
  });

  it('bounds initial readiness and cancels watches and retries on close', async () => {
    vi.useFakeTimers();
    const source = watchSource();
    const cache = createFirestoreSnapshotCache({ query: source.query, map, initialTimeoutMs: 20 });
    const pending = expect(cache.read()).rejects.toThrow('initial snapshot timed out');
    await vi.advanceTimersByTimeAsync(20);
    await pending;
    cache.close();
    source.emit(['late']);
    await expect(cache.read()).rejects.toThrow('closed');
    await vi.advanceTimersByTimeAsync(5000);
    expect(source.starts()).toBe(1);
    expect(source.stops()).toBe(1);
  });

  it('rebases an aged time window only when data changes', async () => {
    const source = watchSource();
    const cache = createFirestoreSnapshotCache({ query: source.query, map, rebaseAfterMs: 1000 });
    const first = cache.read(new Date(0));
    source.emit(['old']);
    await first;
    expect(await cache.read(new Date(2000))).toEqual(['old']);
    expect(source.starts()).toBe(1);
    source.emit(['new']);
    expect(source.starts()).toBe(2);
    const rebased = cache.read(new Date(2000));
    source.emit(['new']);
    expect(await rebased).toEqual(['new']);
    expect(source.stops()).toBe(1);
  });

  it('bounds window growth during a long gap in monitoring requests', async () => {
    vi.useFakeTimers();
    const source = watchSource();
    const cache = createFirestoreSnapshotCache({ query: source.query, map, rebaseAfterMs: 1000 });
    const first = cache.read(new Date(0));
    source.emit(['old']);
    await first;
    await vi.advanceTimersByTimeAsync(2000);
    expect(source.starts()).toBe(1);
    source.emit(['changed']);
    expect(source.starts()).toBe(2);
    const latest = cache.read(new Date(2000));
    source.emit(['bounded']);
    expect(await latest).toEqual(['bounded']);
  });
});
