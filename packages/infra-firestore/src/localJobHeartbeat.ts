import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { JobExecutionRecord } from '@intexuraos/common-core';
import type { JobHeartbeatStore, JobExecutionToken, PersistedHeartbeat } from './jobHeartbeat.js';

const empty = (key: string): PersistedHeartbeat => ({
  key,
  latestRunId: '',
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSucceededAt: null,
  lastOutcome: 'never',
});
const latest = (left: string | null, right: string): string =>
  left === null || right > left ? right : left;

function validateRecords(input: unknown): Record<string, PersistedHeartbeat> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid local heartbeat state');
  for (const [key, value] of Object.entries(input)) {
    if (value === null || typeof value !== 'object')
      throw new Error('Invalid local heartbeat state');
    const record = value as Record<string, unknown>;
    if (
      record['key'] !== key ||
      typeof record['latestRunId'] !== 'string' ||
      !['never', 'running', 'succeeded', 'failed'].includes(String(record['lastOutcome'])) ||
      ['lastStartedAt', 'lastFinishedAt', 'lastSucceededAt'].some((field) => {
        const value = record[field];
        return value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)));
      })
    )
      throw new Error('Invalid local heartbeat state');
  }
  return input as Record<string, PersistedHeartbeat>;
}

/**
 * Home PROD has one forked process per app. A kernel flock enforces that owner
 * boundary. flock acquires the kernel lock on an inherited open file description;
 * the parent retains that descriptor for its lifetime, including atomic writes.
 * It closes automatically on SIGKILL. No stale-owner guesses are involved.
 */
export function createLocalJobHeartbeatStore(options: {
  directory: string;
  collectionName: string;
  now: () => Date;
  seed: () => Promise<Record<string, PersistedHeartbeat>>;
}): JobHeartbeatStore {
  if (!isAbsolute(options.directory) || !/^[a-zA-Z0-9_-]+$/u.test(options.collectionName))
    throw new Error('Invalid local heartbeat location');
  const filename = join(options.directory, `${options.collectionName}.json`);
  let records: Record<string, PersistedHeartbeat> = Object.create(null) as Record<
    string,
    PersistedHeartbeat
  >;
  let lockFile: FileHandle | undefined;
  let failure: Error | undefined;
  let closed = false;
  let initialized: Promise<void> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const persist = async (next: Record<string, PersistedHeartbeat>): Promise<void> => {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify({ version: 1, records: next }));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, filename);
      const directory = await open(options.directory, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      records = next;
    } catch {
      failure = new Error('Local heartbeat persistence unavailable');
      throw failure;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  };

  const initialize = async (): Promise<void> => {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const lockPath = join(options.directory, `${options.collectionName}.lock`);
    lockFile = await open(lockPath, 'a', 0o600);
    // fd 3 in the child is a dup of the parent's descriptor. flock(2) ownership
    // belongs to that shared open file description, not to the short-lived child.
    // Python's stdlib exposes the same kernel lock on Linux and macOS without
    // requiring the Linux-specific flock executable. Isolated mode loads only
    // the trusted interpreter and standard library.
    const owner = spawn(
      'python3',
      ['-I', '-S', '-c', 'import fcntl; fcntl.flock(3, fcntl.LOCK_EX | fcntl.LOCK_NB)'],
      { stdio: ['ignore', 'ignore', 'ignore', lockFile.fd] }
    );
    await new Promise<void>((resolve, reject) => {
      owner.once('error', () => {
        reject(new Error('Local heartbeat ownership unavailable'));
      });
      owner.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Local heartbeat ownership unavailable'));
      });
    });
    try {
      const parsed: unknown = JSON.parse(await readFile(filename, 'utf8'));
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        (parsed as Record<string, unknown>)['version'] !== 1
      )
        throw new Error('Invalid local heartbeat state');
      records = validateRecords((parsed as Record<string, unknown>)['records']);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Invalid local heartbeat state');
      await persist(validateRecords(await options.seed()));
    }
  };
  const ready = async (): Promise<void> => {
    if (closed) throw new Error('Local heartbeat store is closed');
    assertHealthy();
    initialized ??= initialize().catch(async (error: unknown) => {
      await lockFile?.close();
      lockFile = undefined;
      throw error;
    });
    await initialized;
    assertHealthy();
  };
  const assertHealthy = (): void => {
    if (failure !== undefined) throw failure;
  };
  const serialized = async <T>(action: () => Promise<T>): Promise<T> => {
    const operation = queue
      .catch(() => undefined)
      .then(async () => {
        await ready();
        return await action();
      });
    queue = operation;
    return await operation;
  };
  return {
    async start(key): Promise<JobExecutionToken> {
      return await serialized(async () => {
        const previous = records[key] ?? empty(key);
        const token = {
          key,
          runId: randomUUID(),
          startedAt: latest(previous.lastStartedAt, options.now().toISOString()),
        };
        await persist({
          ...records,
          [key]: {
            ...previous,
            latestRunId: token.runId,
            lastStartedAt: token.startedAt,
            lastOutcome: 'running',
          },
        });
        return token;
      });
    },
    async finish(token, outcome): Promise<void> {
      await serialized(async () => {
        const previous = records[token.key];
        if (previous === undefined) throw new Error('Job heartbeat was not started');
        const observedAt = latest(token.startedAt, options.now().toISOString());
        await persist({
          ...records,
          [token.key]: {
            ...previous,
            lastFinishedAt: latest(previous.lastFinishedAt, observedAt),
            lastSucceededAt:
              outcome === 'succeeded'
                ? latest(previous.lastSucceededAt, observedAt)
                : previous.lastSucceededAt,
            lastOutcome: previous.latestRunId === token.runId ? outcome : previous.lastOutcome,
          },
        });
      });
    },
    async list(keys): Promise<JobExecutionRecord[]> {
      return await serialized(() =>
        Promise.resolve(
          keys.map((key) => {
            const data = records[key] ?? empty(key);
            return {
              key,
              lastStartedAt: data.lastStartedAt,
              lastFinishedAt: data.lastFinishedAt,
              lastSucceededAt: data.lastSucceededAt,
              lastOutcome: data.lastOutcome,
            };
          })
        )
      );
    },
    async close(): Promise<void> {
      if (closed) return;
      await queue.catch(() => undefined);
      closed = true;
      await lockFile?.close();
      lockFile = undefined;
    },
  };
}
