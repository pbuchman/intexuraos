import type Docker from 'dockerode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { IntexuraOSError, type Logger } from '@intexuraos/common-core';
import type { WorkerRuntime } from '../runtime/types.js';

export const PNPM_STORE_DIR_NAME = 'pnpm-store';
export const CLAUDE_SESSION_DIR_PREFIX = 'claude-session';
export const CODEX_STATE_DIR_PREFIX = 'codex-state';
export const RUNTIME_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface DockerVolumeConfig {
  secretsBasePath: string;
  forensicsMode: boolean;
  forensicsBasePath: string;
  sharedCredsPath?: string;
  sharedCodexAuthPath?: string;
}

// Container must run as the host user so bind-mounted files (worktrees, secrets,
// pnpm store) are accessible without permission hacks.
// Lazily evaluated (not at module load) to avoid crashing in Docker environments
// without /etc/passwd. Cached after first call: the UID/GID never changes within
// a process lifetime, so repeated syscalls would be wasteful.
let _hostUserInfo: { uid: number; gid: number; userString: string } | null = null;
export function getHostUserInfo(): { uid: number; gid: number; userString: string } {
  if (_hostUserInfo === null) {
    const info = os.userInfo();
    _hostUserInfo = {
      uid: info.uid,
      gid: info.gid,
      userString: `${String(info.uid)}:${String(info.gid)}`,
    };
  }
  return _hostUserInfo;
}

export interface BuildBindsOpts {
  worktreePath: string;
  taskSecretsPath: string;
  pnpmStorePath: string;
  taskRuntimeHomePath: string;
  containerRuntimeHome: string;
  mainGitDir: string | null;
  useSharedCreds: boolean;
  useSharedCodexAuth: boolean;
  taskForensicsPath: string | null;
}

/**
 * Volume + host-path management for worker containers.
 * Extracted from DockerProvider for separation of concerns.
 */
export class DockerVolume {
  constructor(
    private readonly getDocker: () => Docker,
    private readonly logger: Logger,
    private readonly config: DockerVolumeConfig
  ) {}

  /**
   * Create a named Docker volume. NEW method — not yet used by DockerProvider
   * but exposed for future feature parity with Docker volume-based storage.
   */
  async createVolume(
    name: string,
    opts: { labels?: Record<string, string>; driver?: string } = {}
  ): Promise<{ name: string; mountPoint: string }> {
    const docker = this.getDocker();
    const response = await docker.createVolume({
      Name: name,
      Driver: opts.driver ?? 'local',
      ...(opts.labels !== undefined ? { Labels: opts.labels } : {}),
    });
    // Dockerode's createVolume response shape varies by version; be defensive.
    const mountPoint =
      (response as { Mountpoint?: string }).Mountpoint ?? `/var/lib/docker/volumes/${name}/_data`;
    return { name, mountPoint };
  }

  async removeVolume(name: string, opts: { force?: boolean } = {}): Promise<void> {
    const docker = this.getDocker();
    await docker.getVolume(name).remove({ force: opts.force ?? false });
  }

  getTaskSecretsPath(taskId: string): string {
    return path.join(this.config.secretsBasePath, taskId);
  }

  getTaskRuntimeHomePath(taskId: string, runtime: WorkerRuntime): string {
    const dirPrefix = runtime === 'codex' ? CODEX_STATE_DIR_PREFIX : CLAUDE_SESSION_DIR_PREFIX;
    return path.join(this.config.secretsBasePath, `${dirPrefix}-${taskId}`);
  }

  getContainerRuntimeHome(runtime: WorkerRuntime): '/home/claude/.claude' | '/home/claude/.codex' {
    return runtime === 'codex' ? '/home/claude/.codex' : '/home/claude/.claude';
  }

  getTaskForensicsPath(taskId: string): string | null {
    if (!this.config.forensicsMode) {
      return null;
    }
    return path.join(this.config.forensicsBasePath, taskId);
  }

  ensureTaskForensicsPath(taskId: string): string | null {
    const taskForensicsPath = this.getTaskForensicsPath(taskId);
    if (taskForensicsPath === null) {
      return null;
    }
    fs.mkdirSync(taskForensicsPath, { recursive: true });
    return taskForensicsPath;
  }

  getPnpmStorePath(): string {
    return path.join(path.dirname(this.config.secretsBasePath), PNPM_STORE_DIR_NAME);
  }

  assertResumeRuntimeStateAvailable(
    runtime: WorkerRuntime,
    continueSession: boolean,
    taskRuntimeHomePath: string
  ): void {
    if (runtime !== 'codex' || !continueSession) {
      return;
    }

    if (!fs.existsSync(taskRuntimeHomePath)) {
      throw new IntexuraOSError(
        'PRECONDITION_FAILED',
        `Codex resume requires existing task-local state at ${taskRuntimeHomePath}`
      );
    }
  }

  async writePromptFiles(
    taskSecretsPath: string,
    systemPrompt: string,
    prompt: string
  ): Promise<void> {
    await fs.promises.writeFile(
      path.join(taskSecretsPath, 'system-prompt.txt'),
      systemPrompt,
      'utf-8'
    );
    await fs.promises.writeFile(path.join(taskSecretsPath, 'user-prompt.txt'), prompt, 'utf-8');
  }

  async removeTaskSecretsDirectory(taskId: string): Promise<void> {
    const taskSecretsPath = this.getTaskSecretsPath(taskId);
    try {
      await fs.promises.rm(taskSecretsPath, { recursive: true, force: true });
    } catch (err: unknown) {
      this.logger.error(
        { taskId, error: err, path: taskSecretsPath },
        'Failed to remove task secrets directory'
      );
    }
  }

  async clearTaskSecretsContents(taskId: string): Promise<void> {
    // Clear sensitive files but keep the directory — rm -rf would invalidate
    // the container's bind mount (Linux bind mounts follow inodes, not paths).
    const taskSecretsPath = this.getTaskSecretsPath(taskId);
    try {
      const entries = await fs.promises.readdir(taskSecretsPath);
      await Promise.all(
        entries.map((entry) =>
          fs.promises.rm(path.join(taskSecretsPath, entry), { recursive: true, force: true })
        )
      );
    } catch (err: unknown) {
      this.logger.error(
        { taskId, error: err, path: taskSecretsPath },
        'Failed to clear task secrets during preservation'
      );
    }
  }

  async cleanupTaskSession(taskId: string): Promise<void> {
    const taskRuntimeHomePaths = [
      this.getTaskRuntimeHomePath(taskId, 'claude'),
      this.getTaskRuntimeHomePath(taskId, 'codex'),
    ];

    for (const taskRuntimeHomePath of taskRuntimeHomePaths) {
      try {
        await fs.promises.rm(taskRuntimeHomePath, { recursive: true, force: true });
      } catch (err: unknown) {
        this.logger.error(
          { taskId, error: err, path: taskRuntimeHomePath },
          'Failed to remove task runtime directory'
        );
      }
    }
  }

  async cleanupOrphanedRuntimeState(isPreserved: (taskId: string) => boolean): Promise<void> {
    const prefixes = [CLAUDE_SESSION_DIR_PREFIX, CODEX_STATE_DIR_PREFIX];
    const now = Date.now();

    let entries: string[];
    try {
      entries = await fs.promises.readdir(this.config.secretsBasePath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const matchedPrefix = prefixes.find((p) => entry.startsWith(`${p}-`));
      if (matchedPrefix === undefined) {
        continue;
      }

      const taskId = entry.slice(matchedPrefix.length + 1);
      if (isPreserved(taskId)) {
        continue;
      }

      const fullPath = path.join(this.config.secretsBasePath, entry);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (now - stat.mtimeMs <= RUNTIME_STATE_MAX_AGE_MS) {
          continue;
        }
        await fs.promises.rm(fullPath, { recursive: true, force: true });
        this.logger.info({ taskId, path: fullPath }, 'Removed orphaned runtime state directory');
      } catch (err: unknown) {
        this.logger.warn(
          { taskId, path: fullPath, error: err },
          'Failed to clean up orphaned runtime state directory'
        );
      }
    }
  }

  async createTaskDirectories(
    taskId: string,
    runtime: WorkerRuntime
  ): Promise<{ taskSecretsPath: string; taskRuntimeHomePath: string }> {
    const taskSecretsPath = this.getTaskSecretsPath(taskId);
    const taskRuntimeHomePath = this.getTaskRuntimeHomePath(taskId, runtime);
    await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(taskRuntimeHomePath, { recursive: true, mode: 0o700 });
    return { taskSecretsPath, taskRuntimeHomePath };
  }

  buildBinds(opts: BuildBindsOpts): string[] {
    const {
      worktreePath,
      taskSecretsPath,
      pnpmStorePath,
      taskRuntimeHomePath,
      containerRuntimeHome,
      mainGitDir,
      useSharedCreds,
      useSharedCodexAuth,
      taskForensicsPath,
    } = opts;

    return [
      `${worktreePath}:/repo:rw`,
      `${taskSecretsPath}:/secrets:ro`,
      `${pnpmStorePath}:/home/claude/pnpm-store:rw`,
      `${taskRuntimeHomePath}:${containerRuntimeHome}:rw`,
      ...(useSharedCreds && this.config.sharedCredsPath !== undefined
        ? [
            `${this.config.sharedCredsPath}/.credentials.json:/home/claude/.claude/.credentials.json:rw`,
          ]
        : []),
      ...(useSharedCodexAuth && this.config.sharedCodexAuthPath !== undefined
        ? [`${this.config.sharedCodexAuthPath}/auth.json:/home/claude/.codex/auth.json:rw`]
        : []),
      ...(mainGitDir !== null ? [`${mainGitDir}:${mainGitDir}:rw`] : []),
      ...(taskForensicsPath !== null ? [`${taskForensicsPath}:/var/crash:rw`] : []),
    ];
  }

  buildTmpfs(): Record<string, string> {
    const user = getHostUserInfo();
    return {
      '/tmp': 'rw,noexec,nosuid,size=2g',
      '/home/claude': `rw,noexec,nosuid,size=500m,uid=${String(user.uid)},gid=${String(user.gid)}`,
      // Shadows the Mac host's node_modules (bind-mounted via /repo), giving the
      // container an empty writable dir for Linux-native pnpm install.
      '/repo/node_modules': `rw,exec,nosuid,size=4g,uid=${String(user.uid)},gid=${String(user.gid)}`,
    };
  }
}
