import { createRequire } from 'node:module';
import type { Query, QueryDocumentSnapshot } from './firestore.js';
import {
  observeFirestoreWatch,
  releaseFirestoreWatchObserver,
  type WatchTransportObserver,
} from './watchTransport.js';

const require = createRequire(import.meta.url);
const firestoreRequire = createRequire(require.resolve('@google-cloud/firestore'));
const protobuf = firestoreRequire('protobufjs') as {
  Root: {
    fromJSON(value: unknown): {
      lookupType(name: string): {
        encode(value: unknown): { finish(): Uint8Array };
      };
    };
  };
};
const protocol = protobuf.Root.fromJSON(firestoreRequire('../protos/v1.json'));
const documentEncoder = protocol.lookupType('google.firestore.v1.Document');
const responseEncoder = protocol.lookupType('google.firestore.v1.ListenResponse');

export interface FirestoreSnapshotDiagnostics {
  queryStarts: number;
  transportStreamStarts: number;
  documentReads: number;
  documentRemoveEvents: number;
  documentDeleteEvents: number;
  protobufDocumentBytes: number;
  listenResponseBytes: number;
}

export interface FirestoreMonitoringDiagnostics extends FirestoreSnapshotDiagnostics {
  receivedDocuments: number;
  activeListeners: number;
  readyListeners: number;
  erroredListeners: number;
}

export interface FirestoreSnapshotCache<T> {
  read(now?: Date): Promise<readonly T[]>;
  close(): void;
  diagnostics(): FirestoreSnapshotDiagnostics;
}

const caches = new Set<{
  close(): void;
  state(): { active: boolean; ready: boolean; error: boolean };
}>();
const totals: FirestoreSnapshotDiagnostics = {
  queryStarts: 0,
  transportStreamStarts: 0,
  documentReads: 0,
  documentRemoveEvents: 0,
  documentDeleteEvents: 0,
  protobufDocumentBytes: 0,
  listenResponseBytes: 0,
};

/** Aggregate counts only; no document identifiers or payloads leave the cache. */
export function getFirestoreSnapshotCacheDiagnostics(): FirestoreMonitoringDiagnostics {
  const states = [...caches].map((cache) => cache.state());
  return {
    ...totals,
    receivedDocuments: totals.documentReads,
    activeListeners: states.filter((state) => state.active).length,
    readyListeners: states.filter((state) => state.ready).length,
    erroredListeners: states.filter((state) => state.error).length,
  };
}

export function closeFirestoreSnapshotCaches(): void {
  for (const cache of caches) cache.close();
}

/** Account for the one-time migration read into durable local heartbeat state. */
export function recordFirestoreMonitoringBootstrap(docs: readonly QueryDocumentSnapshot[]): void {
  totals.queryStarts++;
  for (const document of docs) {
    totals.documentReads++;
    const proto = document as QueryDocumentSnapshot & { toDocumentProto?: () => unknown };
    if (proto.toDocumentProto !== undefined)
      totals.protobufDocumentBytes += documentEncoder
        .encode(proto.toDocumentProto())
        .finish().length;
  }
}

/**
 * A process-lifetime watch, rather than a query per monitoring request. Terminal
 * errors invalidate readiness and retry; callers never receive stale healthy data.
 */
export function createFirestoreSnapshotCache<T>(options: {
  query: (anchor: Date) => Query;
  map: (doc: QueryDocumentSnapshot) => T;
  rebaseAfterMs?: number;
  initialTimeoutMs?: number;
  retryDelayMs?: number;
}): FirestoreSnapshotCache<T> {
  let value: readonly T[] | undefined;
  let failure: Error | undefined;
  let closed = false;
  let started = false;
  let generation = 0;
  let anchor = new Date();
  let observedAt = anchor;
  let observedWallTime = Date.now();
  let nativeTransport = false;
  let transportCurrent = false;
  let transportReady = false;
  let lastFrameAt = 0;
  let transportObserver: WatchTransportObserver | undefined;
  let unsubscribe: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const waiters = new Set<{ resolve(value: readonly T[]): void; reject(error: Error): void }>();
  const diagnostics: FirestoreSnapshotDiagnostics = {
    queryStarts: 0,
    transportStreamStarts: 0,
    documentReads: 0,
    documentRemoveEvents: 0,
    documentDeleteEvents: 0,
    protobufDocumentBytes: 0,
    listenResponseBytes: 0,
  };
  const increment = (key: keyof FirestoreSnapshotDiagnostics, amount: number): void => {
    diagnostics[key] += amount;
    totals[key] += amount;
  };
  const reject = (error: Error): void => {
    value = undefined;
    failure = error;
    for (const waiter of waiters) waiter.reject(error);
    waiters.clear();
  };
  const stop = (): void => {
    generation++;
    releaseFirestoreWatchObserver(transportObserver);
    transportObserver = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    clearTimeout(timeout);
    timeout = undefined;
  };
  const fail = (error: Error): void => {
    stop();
    reject(error);
    retry = setTimeout(() => {
      retry = undefined;
      start();
    }, options.retryDelayMs ?? 1000);
    retry.unref();
  };
  const isReady = (): boolean => value !== undefined;
  const start = (): void => {
    started = true;
    failure = undefined;
    value = undefined;
    anchor = observedAt;
    const current = ++generation;
    let received = false;
    try {
      increment('queryStarts', 1);
      const query = options.query(anchor);
      transportObserver = {
        opened: (): void => {
          if (current === generation) {
            increment('transportStreamStarts', 1);
            nativeTransport = true;
            transportCurrent = false;
            transportReady = false;
            lastFrameAt = Date.now();
          }
        },
        disconnected: (): void => {
          if (current === generation) {
            transportCurrent = false;
            transportReady = false;
          }
        },
        frame: (input): void => {
          if (current !== generation || closed) return;
          lastFrameAt = Date.now();
          increment('listenResponseBytes', responseEncoder.encode(input).finish().length);
          const frame = input as {
            filter?: unknown;
            documentRemove?: unknown;
            documentDelete?: unknown;
            documentChange?: { document?: unknown };
            targetChange?: { targetChangeType?: string; targetIds?: unknown[]; readTime?: unknown };
          };
          if (frame.documentRemove !== undefined) increment('documentRemoveEvents', 1);
          if (frame.documentDelete !== undefined) increment('documentDeleteEvents', 1);
          // The SDK may synchronously reset its query after an existence-filter
          // mismatch. Matching filters retain CURRENT and recover at NO_CHANGE.
          if (frame.filter !== undefined) transportReady = false;
          const document = frame.documentChange?.document;
          if (document !== undefined) {
            increment('documentReads', 1);
            increment('protobufDocumentBytes', documentEncoder.encode(document).finish().length);
          }
          const target = frame.targetChange;
          if (target?.targetChangeType === 'CURRENT') transportCurrent = true;
          if (target?.targetChangeType === 'RESET') {
            transportCurrent = false;
            transportReady = false;
          }
          if (
            target?.targetChangeType === 'NO_CHANGE' &&
            target.readTime !== undefined &&
            (target.targetIds?.length ?? 0) === 0 &&
            transportCurrent
          )
            transportReady = true;
        },
      };
      unsubscribe = observeFirestoreWatch(query.firestore, transportObserver, () =>
        query.onSnapshot(
          (snapshot) => {
            if (closed || current !== generation) return;
            try {
              const changes = snapshot.docChanges();
              // Advance the last caller's clock by real elapsed time too: a live
              // watch must remain bounded even while nobody polls monitoring.
              const eventObservedAt = new Date(
                observedAt.getTime() + Math.max(0, Date.now() - observedWallTime)
              );
              if (!nativeTransport)
                for (const change of changes) {
                  if (change.type === 'removed') continue;
                  increment('documentReads', 1);
                  // The SDK's canonical protobuf includes field names, typed values,
                  // document name and timestamps. This measures document payloads,
                  // excluding transport framing and billing minimums.
                  const document = change.doc as QueryDocumentSnapshot & {
                    toDocumentProto?: () => unknown;
                  };
                  if (document.toDocumentProto !== undefined)
                    increment(
                      'protobufDocumentBytes',
                      documentEncoder.encode(document.toDocumentProto()).finish().length
                    );
                }
              if (
                received &&
                changes.length > 0 &&
                options.rebaseAfterMs !== undefined &&
                eventObservedAt.getTime() - anchor.getTime() >= options.rebaseAfterMs
              ) {
                observedAt = eventObservedAt;
                observedWallTime = Date.now();
                stop();
                start();
                return;
              }
              received = true;
              value = snapshot.docs.map(options.map);
              clearTimeout(timeout);
              timeout = undefined;
              for (const waiter of waiters) waiter.resolve(value);
              waiters.clear();
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)));
            }
          },
          (error) => {
            if (!closed && current === generation) fail(error);
          }
        )
      );
      // A synchronous source can emit or fail before returning its unsubscribe.
      if (current !== generation || closed) {
        unsubscribe();
        unsubscribe = undefined;
      } else if (!isReady()) {
        timeout = setTimeout(() => {
          fail(new Error('Firestore initial snapshot timed out'));
        }, options.initialTimeoutMs ?? 10000);
        timeout.unref();
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const cache: FirestoreSnapshotCache<T> & {
    state(): { active: boolean; ready: boolean; error: boolean };
  } = {
    async read(now = new Date()): Promise<readonly T[]> {
      if (closed) throw new Error('Firestore snapshot cache is closed');
      observedAt = now;
      observedWallTime = Date.now();
      if (!started) start();
      if (failure !== undefined) throw failure;
      if (
        nativeTransport &&
        value !== undefined &&
        (!transportReady || Date.now() - lastFrameAt >= 120000)
      )
        throw new Error('Firestore monitoring watch is not synchronized');
      if (value !== undefined) return value;
      return await new Promise((resolve, rejectWaiter) => {
        waiters.add({ resolve, reject: rejectWaiter });
      });
    },
    close(): void {
      if (closed) return;
      closed = true;
      stop();
      clearTimeout(retry);
      reject(new Error('Firestore snapshot cache is closed'));
      caches.delete(cache);
    },
    diagnostics: () => ({ ...diagnostics }),
    state: () => ({
      active: started && !closed && failure === undefined,
      ready:
        value !== undefined &&
        (!nativeTransport || (transportReady && Date.now() - lastFrameAt < 120000)),
      error:
        failure !== undefined ||
        (nativeTransport && (!transportReady || Date.now() - lastFrameAt >= 120000)),
    }),
  };
  caches.add(cache);
  return cache;
}
