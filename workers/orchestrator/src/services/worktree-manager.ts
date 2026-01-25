import { mkdir, readFile, writeFile, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface WorktreeManagerConfig {
  repositoryPath: string;
  worktreeBasePath: string;
  mcpConfigTemplatePath: string;
}

export class WorktreeManager {
  constructor(private readonly config: WorktreeManagerConfig) {}

  async createWorktree(taskId: string, baseBranch: string): Promise<string> {
    const worktreePath = join(this.config.worktreeBasePath, taskId);

    // Check if worktree already exists
    if (await this.worktreeExists(taskId)) {
      throw new Error(`Worktree for task ${taskId} already exists at ${worktreePath}`);
    }

    try {
      // Ensure base directory exists
      await mkdir(this.config.worktreeBasePath, { recursive: true });

      // Create worktree
      const { stderr } = await execAsync(
        `git worktree add "${worktreePath}" origin/${baseBranch}`,
        {
          cwd: this.config.repositoryPath,
        }
      );

      // git worktree add outputs to stderr even on success
      if (stderr && !stderr.includes('Preparing worktree')) {
        throw new Error(`Failed to create worktree: ${stderr}`);
      }

      // Copy MCP config template if provided
      if (this.config.mcpConfigTemplatePath && existsSync(this.config.mcpConfigTemplatePath)) {
        await this.copyMcpConfig(worktreePath);
      }

      // Install dependencies with timeout
      await this.installDependencies(worktreePath);

      return worktreePath;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create worktree: ${message}`);
    }
  }

  async removeWorktree(taskId: string): Promise<void> {
    const worktreePath = join(this.config.worktreeBasePath, taskId);

    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree for task ${taskId} does not exist at ${worktreePath}`);
    }

    try {
      // Remove worktree using git worktree remove
      const { stderr } = await execAsync(`git worktree remove "${worktreePath}" --force`, {
        cwd: this.config.repositoryPath,
      });

      if (stderr) {
        throw new Error(`Failed to remove worktree: ${stderr}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to remove worktree: ${message}`);
    }
  }

  async listWorktrees(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: this.config.repositoryPath,
      });

      const lines = stdout.split('\n').filter((line) => line.length > 0);
      const worktreePaths: string[] = [];

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          const path = line.slice('worktree '.length);
          // Only return worktrees under our base path
          if (path.startsWith(this.config.worktreeBasePath)) {
            worktreePaths.push(path);
          }
        }
      }

      return worktreePaths;
    } catch (_error) {
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async worktreeExists(taskId: string): Promise<boolean> {
    const worktreePath = join(this.config.worktreeBasePath, taskId);
    return existsSync(worktreePath);
  }

  private async copyMcpConfig(worktreePath: string): Promise<void> {
    const targetPath = join(worktreePath, '.mcp.json');

    try {
      // Read template
      const template = await readFile(this.config.mcpConfigTemplatePath, 'utf-8');

      // Substitute environment variables
      const config = template
        .replace(/\{\{LINEAR_API_KEY\}\}/g, process.env['LINEAR_API_KEY'] ?? '')
        .replace(/\{\{SENTRY_AUTH_TOKEN\}\}/g, process.env['SENTRY_AUTH_TOKEN'] ?? '');

      // Ensure target directory exists
      await mkdir(dirname(targetPath), { recursive: true });

      // Write to temp file first for atomicity
      const tempPath = `${targetPath}.tmp`;
      await writeFile(tempPath, config, 'utf-8');

      // Atomic rename
      await (await import('node:fs/promises')).rename(tempPath, targetPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to copy MCP config: ${message}`);
    }
  }

  private async installDependencies(worktreePath: string): Promise<void> {
    const timeoutMs = 5 * 60 * 1000; // 5 minutes

    try {
      // Check if pnpm-lock.yaml exists
      const lockPath = join(worktreePath, 'pnpm-lock.yaml');
      try {
        await access(lockPath, constants.F_OK);
      } catch {
        // No lock file, skip install
        return;
      }

      // Run pnpm install with timeout
      await execAsync(`pnpm install --frozen-lockfile`, {
        cwd: worktreePath,
        timeout: timeoutMs,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to install dependencies: ${message}`);
    }
  }
}
