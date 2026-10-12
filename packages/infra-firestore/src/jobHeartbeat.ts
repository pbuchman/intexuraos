import { randomUUID } from 'node:crypto';
import type { JobExecutionRecord } from '@intexuraos/common-core';
import { getFirestore, type Firestore } from './firestore.js';

export interface JobExecutionToken {
  key: string;
  runId: string;
  startedAt: string;
}

export interface JobHeartbeatStore {
  start(key: string): Promise<JobExecutionToken>;
  finish(token: JobExecutionToken, outcome: 'succeeded' | 'failed'): Promise<void>;
  list(keys: readonly string[]): Promise<JobExecutionRecord[]>;
}

interface PersistedHeartbeat extends JobExecutionRecord {
  latestRunId: string;
}

function emptyRecord(key: string): JobExecutionRecord {
  return {
    key,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSucceededAt: null,
    lastOutcome: 'never',
  };
}

function latest(left: string | null, right: string): string {
  return left === null || right > left ? right : left;
}

/** Each app supplies its owned collection. Transactions protect overlapping ticks. */
export function createJobHeartbeatStore(options: {
  collectionName: string;
  firestore?: Firestore;
  now?: () => Date;
}): JobHeartbeatStore {
  const firestore = (): Firestore => options.firestore ?? getFirestore();
  const now = options.now ?? ((): Date => new Date());
  return {
    async start(key): Promise<JobExecutionToken> {
      const runId = randomUUID();
      const observedAt = now().toISOString();
      const db = firestore();
      const ref = db.collection(options.collectionName).doc(key);
      return await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const previous = snapshot.data() as PersistedHeartbeat | undefined;
        const startedAt = latest(previous?.lastStartedAt ?? null, observedAt);
        transaction.set(ref, {
          ...(previous ?? emptyRecord(key)),
          schemaVersion: 1,
          latestRunId: runId,
          lastStartedAt: startedAt,
          lastOutcome: 'running',
        });
        return { key, runId, startedAt };
      });
    },
    async finish(token, outcome): Promise<void> {
      const db = firestore();
      const ref = db.collection(options.collectionName).doc(token.key);
      const observedAt = latest(token.startedAt, now().toISOString());
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const previous = snapshot.data() as PersistedHeartbeat | undefined;
        if (previous === undefined) throw new Error('Job heartbeat was not started');
        transaction.set(ref, {
          ...previous,
          lastFinishedAt: latest(previous.lastFinishedAt, observedAt),
          lastSucceededAt:
            outcome === 'succeeded'
              ? latest(previous.lastSucceededAt, observedAt)
              : previous.lastSucceededAt,
          lastOutcome: previous.latestRunId === token.runId ? outcome : previous.lastOutcome,
        });
      });
    },
    async list(keys): Promise<JobExecutionRecord[]> {
      const db = firestore();
      return await Promise.all(
        keys.map(async (key) => {
          const snapshot = await db.collection(options.collectionName).doc(key).get();
          const data = snapshot.data() as PersistedHeartbeat | undefined;
          if (data === undefined) return emptyRecord(key);
          return {
            key,
            lastStartedAt: data.lastStartedAt,
            lastFinishedAt: data.lastFinishedAt,
            lastSucceededAt: data.lastSucceededAt,
            lastOutcome: data.lastOutcome,
          };
        })
      );
    },
  };
}
