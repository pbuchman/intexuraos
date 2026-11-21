import { lstat, mkdir, open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type KeyObject } from 'node:crypto';
import {
  TASK_ACCESS_TTL_MS,
  sameTaskBinding,
  verifyTaskAccess,
  type TaskAccessClaims,
  type TaskBinding,
} from '@intexuraos/code-task-domain/task-access';
import type { Task } from '../types/task.js';
import type { DispatchMetadata } from './dispatch-metadata-client.js';

export interface TaskAccessConfig {
  key: KeyObject;
  audience: string;
  nonceDir: string;
  resolveLegacy: (taskId: string) => Promise<DispatchMetadata | null>;
}

export class TaskAccess {
  private nextCleanup = 0;

  constructor(private readonly config: TaskAccessConfig) {}

  async authenticate(
    proof: unknown,
    method: string,
    path: string,
    taskId: string,
    body: string
  ): Promise<TaskAccessClaims | null> {
    if (typeof proof !== 'string') return null;
    const now = Date.now();
    const claims = verifyTaskAccess(
      this.config.key,
      proof,
      {
        method,
        path,
        taskId,
        body,
        audience: this.config.audience,
      },
      now
    );
    if (claims === null) return null;
    await mkdir(this.config.nonceDir, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.config.nonceDir);
    if (!directory.isDirectory() || (directory.mode & 0o077) !== 0)
      throw new Error('Unsafe task nonce directory');
    if (now >= this.nextCleanup) {
      this.nextCleanup = now + TASK_ACCESS_TTL_MS;
      for (const file of await readdir(this.config.nonceDir)) {
        if (!/^[a-f0-9-]{36}$/u.test(file)) continue;
        const marker = join(this.config.nonceDir, file);
        try {
          if ((await stat(marker)).mtimeMs + TASK_ACCESS_TTL_MS <= now)
            await rm(marker, { force: true });
        } catch (error) {
          // A second verifier that shares this persistent directory may have pruned it first.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    // Exclusive creation consumes this signed request across concurrent handlers and restarts.
    const marker = join(this.config.nonceDir, claims.nonce);
    try {
      await writeFile(marker, '', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
      throw error;
    }
    // Commit the directory entry before a task operation can take effect.
    const ledger = await open(this.config.nonceDir, 'r');
    try {
      await ledger.sync();
    } finally {
      await ledger.close();
    }
    return Date.now() - claims.issued < TASK_ACCESS_TTL_MS ? claims : null;
  }

  async ownsTask(claims: TaskBinding, task: Task): Promise<boolean> {
    const bound = task.accessBinding;
    if (bound !== undefined) {
      return sameTaskBinding(bound, claims);
    }
    // Pre-upgrade records have no authenticated owner. Resolve only against the
    // configured code-agent, never the task's callback or a request-supplied URL.
    const metadata = await this.config.resolveLegacy(task.taskId);
    return (
      metadata !== null &&
      metadata.taskId === task.taskId &&
      metadata.ownerId === claims.ownerId &&
      metadata.workerLocation === claims.worker &&
      (metadata.workerAudience === undefined || metadata.workerAudience === claims.audience) &&
      metadata.webhookSecret !== null &&
      metadata.webhookSecret === task.webhookSecret
    );
  }
}
