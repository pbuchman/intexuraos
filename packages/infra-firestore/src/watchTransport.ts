import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import type { EventEmitter } from 'node:events';
import type { Firestore } from './firestore.js';

export interface WatchTransportObserver {
  opened(): void;
  frame(frame: unknown): void;
  disconnected(): void;
}

const require = createRequire(import.meta.url);
const sdk = require('@google-cloud/firestore/package.json') as { version: string };
const contexts = new AsyncLocalStorage<WatchTransportObserver>();
const patched = new WeakSet<Firestore>();
const currentStreams = new WeakMap<WatchTransportObserver, EventEmitter>();
const observerRequests = new WeakMap<
  WatchTransportObserver,
  Set<{ requests: Map<string, WatchTransportObserver>; tag: string }>
>();

export function releaseFirestoreWatchObserver(observer: WatchTransportObserver | undefined): void {
  if (observer === undefined) return;
  for (const { requests, tag } of observerRequests.get(observer) ?? []) requests.delete(tag);
  observerRequests.delete(observer);
  currentStreams.delete(observer);
}

/**
 * Public onSnapshot hides retryable disconnects and no-change keepalives. This
 * adapter passively observes the installed SDK's existing stream; it neither
 * creates requests nor changes any SDK listeners or retry behavior. Keep the
 * exact SDK guard and transport characterization test when upgrading it.
 */
export function observeFirestoreWatch<T>(
  firestore: Firestore | undefined,
  observer: WatchTransportObserver,
  start: () => T
): T {
  if (firestore === undefined) return start(); // In-memory Firestore test adapter.
  const client = firestore as Firestore & {
    requestStream?: (method: string, ...args: unknown[]) => Promise<EventEmitter>;
  };
  if (client.requestStream === undefined)
    throw new Error('Firestore watch transport is unavailable');
  if (sdk.version !== '7.11.6')
    throw new Error('Firestore watch transport requires SDK compatibility verification');
  if (!patched.has(firestore)) {
    const requestStream = client.requestStream;
    const requests = new Map<string, WatchTransportObserver>();
    client.requestStream = async function (method, ...args): Promise<EventEmitter> {
      const tag = typeof args[2] === 'string' ? args[2] : '';
      const context = method === 'listen' ? (requests.get(tag) ?? contexts.getStore()) : undefined;
      if (context !== undefined && tag !== '' && !requests.has(tag)) {
        requests.set(tag, context);
        let owned = observerRequests.get(context);
        if (owned === undefined) {
          owned = new Set();
          observerRequests.set(context, owned);
        }
        owned.add({ requests, tag });
      }
      try {
        const stream = await requestStream.call(this, method, ...args);
        if (context !== undefined) {
          currentStreams.set(context, stream);
          context.opened();
          stream.on('data', (frame: unknown) => {
            if (currentStreams.get(context) === stream) context.frame(frame);
          });
          const disconnected = (): void => {
            if (currentStreams.get(context) === stream) context.disconnected();
          };
          const writable = stream as EventEmitter & { end?: (...args: unknown[]) => unknown };
          const end = writable.end;
          if (end !== undefined) {
            // SDK existence-filter resets call end() before an end event is
            // emitted. Revoke synchronization at that exact reset boundary.
            writable.end = function (...endArgs): unknown {
              disconnected();
              return end.apply(this, endArgs);
            };
          }
          stream.on('end', disconnected);
          stream.on('error', disconnected);
          stream.on('close', disconnected);
        }
        return stream;
      } catch (error) {
        context?.disconnected();
        throw error;
      }
    };
    patched.add(firestore);
  }
  return contexts.run(observer, start);
}
