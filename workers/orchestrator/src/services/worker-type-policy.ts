import { randomUUID } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { Mutex } from 'async-mutex';
import {
  CODE_TASK_WORKER_TYPES,
  isCodeTaskWorkerTypePolicy,
  type CodeTaskWorkerType,
  type CodeTaskWorkerTypePolicy,
} from '@intexuraos/code-task-domain/worker-types';
import { WorkerTypeDisabledError } from './worker-type-disabled-error.js';

export { WorkerTypeDisabledError } from './worker-type-disabled-error.js';

export function defaultWorkerTypePolicy(): CodeTaskWorkerTypePolicy {
  return { enabledWorkerTypes: [...CODE_TASK_WORKER_TYPES], workerTypesRevision: 0 };
}

export class WorkerTypePolicy {
  private readonly applyLock = new Mutex();
  private readonly starting = new Set<Promise<unknown>>();
  private changeListener?: (policy: CodeTaskWorkerTypePolicy) => Promise<void>;

  private constructor(
    private readonly filePath: string,
    private policy: CodeTaskWorkerTypePolicy
  ) {}

  static async load(filePath: string): Promise<WorkerTypePolicy> {
    let contents: string;
    try {
      contents = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new WorkerTypePolicy(filePath, defaultWorkerTypePolicy());
      }
      throw error;
    }
    let policy: unknown;
    try {
      policy = JSON.parse(contents);
    } catch {
      throw new Error(`Invalid worker type policy at ${filePath}`);
    }
    if (!isCodeTaskWorkerTypePolicy(policy)) {
      throw new Error(`Invalid worker type policy at ${filePath}`);
    }
    return new WorkerTypePolicy(filePath, policy);
  }

  snapshot(): CodeTaskWorkerTypePolicy {
    return {
      enabledWorkerTypes: [...this.policy.enabledWorkerTypes],
      workerTypesRevision: this.policy.workerTypesRevision,
    };
  }

  onChange(listener: (policy: CodeTaskWorkerTypePolicy) => Promise<void>): void {
    this.changeListener = listener;
  }

  isEnabled(workerType: CodeTaskWorkerType): boolean {
    return this.policy.enabledWorkerTypes.includes(workerType);
  }

  async withStart<T>(workerType: CodeTaskWorkerType, start: () => Promise<T>): Promise<T> {
    while (this.applyLock.isLocked()) {
      await this.applyLock.waitForUnlock();
    }
    if (!this.isEnabled(workerType)) {
      throw new WorkerTypeDisabledError(workerType);
    }

    const launch = Promise.resolve().then(start);
    this.starting.add(launch);
    try {
      return await launch;
    } finally {
      this.starting.delete(launch);
    }
  }

  async apply(
    requestedTypes: readonly CodeTaskWorkerType[],
    expectedRevision: number
  ): Promise<CodeTaskWorkerTypePolicy | null> {
    const enabledWorkerTypes = CODE_TASK_WORKER_TYPES.filter((type) =>
      requestedTypes.includes(type)
    );
    return await this.applyLock.runExclusive(async () => {
      const current = this.policy;
      if (
        expectedRevision <= current.workerTypesRevision &&
        current.enabledWorkerTypes.length === enabledWorkerTypes.length &&
        enabledWorkerTypes.every((type) => current.enabledWorkerTypes.includes(type))
      ) {
        return this.snapshot();
      }
      if (expectedRevision !== current.workerTypesRevision) {
        return null;
      }

      // Starts may run concurrently. A policy change closes admission until
      // every launch that already entered the gate has settled.
      await Promise.allSettled(this.starting);

      const next = { enabledWorkerTypes, workerTypesRevision: current.workerTypesRevision + 1 };
      if (!Number.isSafeInteger(next.workerTypesRevision)) {
        throw new Error('Worker type policy revision limit reached');
      }
      await this.persist(next);
      await this.changeListener?.({
        enabledWorkerTypes: [...next.enabledWorkerTypes],
        workerTypesRevision: next.workerTypesRevision,
      });
      this.policy = next;
      return this.snapshot();
    });
  }

  private async persist(policy: CodeTaskWorkerTypePolicy): Promise<void> {
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    const file = await open(tempPath, 'wx', 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify(policy), 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(tempPath, this.filePath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }
}
