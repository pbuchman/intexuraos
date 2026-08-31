import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Mutex } from 'async-mutex';
import type { OrchestratorState } from '../types/index.js';
import { HttpWebhookUrlSchema } from '../types/schemas.js';
import type { Logger } from '@intexuraos/common-core';

const execAsync = promisify(exec);

function assertPersistedTaskCallbackOwnership(state: unknown): asserts state is OrchestratorState {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new Error('Persisted state must be an object');
  }
  if (!('tasks' in state)) {
    throw new Error('Persisted state has no tasks object');
  }
  const tasks = state.tasks;
  if (typeof tasks !== 'object' || tasks === null || Array.isArray(tasks)) {
    throw new Error('Persisted state tasks must be an object');
  }
  for (const [taskId, task] of Object.entries(tasks)) {
    if (typeof task !== 'object' || task === null || Array.isArray(task)) {
      throw new Error(`Persisted task ${taskId} must be an object`);
    }
    const webhookUrl = 'webhookUrl' in task ? task.webhookUrl : undefined;
    if (!HttpWebhookUrlSchema.safeParse(webhookUrl).success) {
      throw new Error(`Persisted task ${taskId} has an invalid required webhookUrl`);
    }
    const webhookSecret = 'webhookSecret' in task ? task.webhookSecret : undefined;
    if (typeof webhookSecret !== 'string' || webhookSecret === '') {
      throw new Error(`Persisted task ${taskId} has an invalid required webhookSecret`);
    }
  }
}

export class StatePersistence {
  private readonly writeMutex = new Mutex();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger
  ) {}

  async load(): Promise<OrchestratorState> {
    try {
      // Ensure directory exists
      if (!existsSync(dirname(this.filePath))) {
        await mkdir(dirname(this.filePath), { recursive: true });
      }

      // File doesn't exist yet - return empty state
      if (!existsSync(this.filePath)) {
        return this.emptyState();
      }

      const content = await readFile(this.filePath, 'utf-8');
      const state = JSON.parse(content) as unknown;
      assertPersistedTaskCallbackOwnership(state);
      return state;
    } catch (error) {
      if (error instanceof SyntaxError) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${this.filePath}.corrupted.${timestamp}`;
        await rename(this.filePath, backupPath);
        this.logger.warn({ backupPath }, 'State file corrupted - backed up and starting fresh');
        return this.emptyState();
      }
      throw error;
    }
  }

  async save(state: OrchestratorState): Promise<void> {
    await this.saveAtomic(state);
  }

  async modify(fn: (state: OrchestratorState) => void | Promise<void>): Promise<void> {
    await this.writeMutex.runExclusive(async () => {
      const state = await this.load();
      await fn(state);
      await this.save(state);
    });
  }

  async saveAtomic(state: OrchestratorState): Promise<void> {
    // Ensure directory exists
    await mkdir(dirname(this.filePath), { recursive: true });

    // Write to temp file
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');

    // Atomic rename (POSIX guarantees atomicity)
    await rename(tempPath, this.filePath);
  }

  /**
   * Strict, read-only view used by drain evidence. It never creates a
   * directory, renames a corrupt file, or substitutes an empty queue for an
   * unreadable state. A missing file is always unknown: process-local history
   * cannot prove that a callback queue was never persisted and then lost.
   */
  async getPendingWebhookCountForDrain(): Promise<number | null> {
    if (!existsSync(this.filePath)) {
      return null;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        Object.keys(parsed).sort().join(',') !== 'githubToken,pendingWebhooks,tasks' ||
        !('tasks' in parsed) ||
        typeof parsed.tasks !== 'object' ||
        parsed.tasks === null ||
        Array.isArray(parsed.tasks) ||
        !('githubToken' in parsed) ||
        (parsed.githubToken !== null &&
          (typeof parsed.githubToken !== 'object' || Array.isArray(parsed.githubToken))) ||
        !('pendingWebhooks' in parsed) ||
        !Array.isArray(parsed.pendingWebhooks)
      ) {
        return null;
      }
      return parsed.pendingWebhooks.length;
    } catch (error) {
      this.logger.warn({ error }, 'Unable to read state for drain evidence');
      return null;
    }
  }

  async detectOrphanWorktrees(repository: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: repository,
      });

      const lines = stdout.split('\n').filter((line) => line.length > 0);
      const worktreePaths = new Set<string>();

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const path = line.slice('worktree '.length);
          worktreePaths.add(path);
        }
      }

      // Load current state to compare
      const state = await this.load();
      const activePaths = new Set(Object.values(state.tasks).map((task) => task.worktreePath));

      // Find orphans (worktrees not in state)
      const orphans: string[] = [];
      for (const path of worktreePaths) {
        if (!activePaths.has(path)) {
          orphans.push(path);
        }
      }

      return orphans;
    } catch (error) {
      this.logger.error({ error }, 'Failed to detect orphan worktrees');
      return [];
    }
  }

  private emptyState(): OrchestratorState {
    return {
      tasks: {},
      githubToken: null,
      pendingWebhooks: [],
    };
  }
}
