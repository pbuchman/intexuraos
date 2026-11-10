import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { observeFirestoreWatch, releaseFirestoreWatchObserver } from '../watchTransport.js';
import type { Firestore } from '../firestore.js';

describe('pinned Firestore native watch transport observer', () => {
  it('releases every request tag owned by an observer without instrumenting unrelated streams', async () => {
    const db = {
      requestStream: async (_method: string, ..._args: unknown[]): Promise<EventEmitter> =>
        new EventEmitter(),
    };
    const events: string[] = [];
    const observer = {
      opened: (): void => {
        events.push('opened');
      },
      frame: (): void => {
        events.push('frame');
      },
      disconnected: (): void => {
        events.push('disconnected');
      },
    };
    await observeFirestoreWatch(db as unknown as Firestore, observer, async () => {
      await db.requestStream('listen', true, {}, 'first');
      await db.requestStream('listen', true, {}, 'second');
    });
    releaseFirestoreWatchObserver(observer);
    for (const tag of ['first', 'second']) {
      const unrelated = await db.requestStream('listen', true, {}, tag);
      unrelated.emit('data', {});
      unrelated.emit('end');
    }
    expect(events).toEqual(['opened', 'opened']);
  });

  it('requires a compatibility review when the pinned SDK version changes', () => {
    const require = createRequire(import.meta.url);
    const sdk = require('@google-cloud/firestore/package.json') as { version: string };
    const previous = sdk.version;
    try {
      sdk.version = 'future';
      const db = { requestStream: async (): Promise<EventEmitter> => new EventEmitter() };
      expect(() =>
        observeFirestoreWatch(
          db as unknown as Firestore,
          {
            opened: (): void => undefined,
            frame: (): void => undefined,
            disconnected: (): void => undefined,
          },
          () => undefined
        )
      ).toThrow('compatibility verification');
    } finally {
      sdk.version = previous;
    }
  });
  it('retains stable request ownership through another observer context and ignores stale streams', async () => {
    const db = {
      requestStream: async (_method: string, ..._args: unknown[]): Promise<EventEmitter> =>
        new EventEmitter(),
    };
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const observer = (
      events: string[]
    ): { opened(): void; frame(): void; disconnected(): void } => ({
      opened: (): void => {
        events.push('opened');
      },
      frame: (): void => {
        events.push('frame');
      },
      disconnected: (): void => {
        events.push('disconnected');
      },
    });
    const a = observer(receivedA);
    const b = observer(receivedB);
    const first = await observeFirestoreWatch(
      db as unknown as Firestore,
      a,
      async () => await db.requestStream('listen', true, {}, 'A')
    );
    const second = await observeFirestoreWatch(
      db as unknown as Firestore,
      b,
      async () => await db.requestStream('listen', true, {}, 'B')
    );
    const resumed = await observeFirestoreWatch(
      db as unknown as Firestore,
      b,
      async () => await db.requestStream('listen', true, {}, 'A')
    );
    first.emit('data', {});
    first.emit('end');
    resumed.emit('data', {});
    second.emit('close');
    expect(receivedA).toEqual(['opened', 'opened', 'frame']);
    expect(receivedB).toEqual(['opened', 'disconnected']);
    releaseFirestoreWatchObserver(a);
    releaseFirestoreWatchObserver(a);
    releaseFirestoreWatchObserver(undefined);
  });

  it('propagates stream creation failure and leaves unrelated requests unobserved', async () => {
    const events: string[] = [];
    const observer = {
      opened: (): void => {
        events.push('opened');
      },
      frame: (): void => {
        events.push('frame');
      },
      disconnected: (): void => {
        events.push('disconnected');
      },
    };
    const db = {
      requestStream: async (_method: string): Promise<EventEmitter> => {
        throw new Error('transport unavailable');
      },
    };
    await expect(
      observeFirestoreWatch(
        db as unknown as Firestore,
        observer,
        async () => await db.requestStream('listen')
      )
    ).rejects.toThrow('transport unavailable');
    await expect(db.requestStream('runQuery')).rejects.toThrow('transport unavailable');
    expect(events).toEqual(['disconnected']);
    expect(() => observeFirestoreWatch({} as Firestore, observer, () => undefined)).toThrow(
      'transport is unavailable'
    );
  });
  it('observes native frames and transient reconnects without adding a request or consuming SDK listeners', async () => {
    const streams: EventEmitter[] = [];
    let calls = 0;
    const db = {
      requestStream: async (_method: string): Promise<EventEmitter> => {
        calls++;
        const stream = new EventEmitter();
        streams.push(stream);
        return stream;
      },
    };
    const events: string[] = [];
    const observer = {
      opened: (): void => {
        events.push('opened');
      },
      frame: (): void => {
        events.push('frame');
      },
      disconnected: (): void => {
        events.push('disconnected');
      },
    };
    const listen = async (): Promise<EventEmitter> => await db.requestStream('listen');
    let sdkFrames = 0;
    await observeFirestoreWatch(db as unknown as Firestore, observer, async () => {
      const first = await listen();
      first.on('data', () => {
        sdkFrames++;
      });
      first.emit('data', { targetChange: { readTime: {} } });
      first.emit('error', new Error('transient'));
      const resumed = await listen();
      resumed.emit('data', { targetChange: { targetChangeType: 'CURRENT' } });
    });
    expect(events).toEqual(['opened', 'frame', 'disconnected', 'opened', 'frame']);
    expect(sdkFrames).toBe(1);
    expect(calls).toBe(2);
    expect(streams).toHaveLength(2);
  });
});
