import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { OrchestratorState } from '../types/index.js';
import type { Logger } from '@intexuraos/common-core';

const execAsync = promisify(exec);

export class StatePersistence {
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
      const state = JSON.parse(content) as OrchestratorState;
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

  async saveAtomic(state: OrchestratorState): Promise<void> {
    // Ensure directory exists
    await mkdir(dirname(this.filePath), { recursive: true });

    // Write to temp file
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');

    // Atomic rename (POSIX guarantees atomicity)
    await rename(tempPath, this.filePath);
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
