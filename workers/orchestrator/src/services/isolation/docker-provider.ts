import Docker from 'dockerode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@intexuraos/common-core';
import type { IsolationProvider, WorkerConfig, WorkerHandle, ResourceUsage } from './types.js';
import type { AnthropicOAuthManager } from './anthropic-oauth.js';

export interface DockerProviderConfig {
  imageName: string;
  networkName: string;
  maxConcurrent: number;
  memoryLimitBytes: number;
  cpuCount: number;
  timeoutMs: number;
  secretsBasePath: string;
  gcpSaKeyPath: string;
  keepContainersAlive: boolean;
  managedAttemptsMode: boolean;
}

const DEFAULT_CONFIG: DockerProviderConfig = {
  imageName:
    'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest',
  networkName: 'claude-worker-net',
  maxConcurrent: 4,
  memoryLimitBytes: 8 * 1024 * 1024 * 1024,
  cpuCount: 4,
  timeoutMs: 2 * 60 * 60 * 1000,
  secretsBasePath: '/tmp/claude-secrets',
  gcpSaKeyPath: '',
  keepContainersAlive: false,
  managedAttemptsMode: true,
};

interface WorkerEntry {
  containerId: string;
  handle: WorkerHandle;
  taskSecretsPath: string;
  taskSessionPath: string;
  attemptRunning: boolean;
  attemptLogBuffer: string;
  logStream?: NodeJS.ReadableStream;
}

export const PNPM_STORE_DIR_NAME = 'pnpm-store';
const CLAUDE_SESSION_DIR_PREFIX = 'claude-session';

export class DockerProvider implements IsolationProvider {
  private readonly docker: Docker;
  private readonly config: DockerProviderConfig;
  private readonly logger: Logger;
  private readonly workers: Map<string, WorkerEntry>;
  private anthropicOAuth?: AnthropicOAuthManager | undefined;

  constructor(config: Partial<DockerProviderConfig>, logger: Logger) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.workers = new Map();
  }

  setAnthropicOAuth(manager: AnthropicOAuthManager): void {
    this.anthropicOAuth = manager;
  }

  /**
   * Clean up orphaned worker containers from previous orchestrator runs.
   * Should be called on startup to prevent name collisions.
   */
  async cleanupOrphanedContainers(): Promise<void> {
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { name: ['claude-worker-'] },
      });

      for (const containerInfo of containers) {
        const createdAt = containerInfo.Created * 1000;
        const ageMs = now - createdAt;

        if (ageMs < MAX_AGE_MS) {
          this.logger.debug(
            { name: containerInfo.Names[0], ageHours: Math.round(ageMs / 3_600_000) },
            'Skipping recent container'
          );
          continue;
        }

        const container = this.docker.getContainer(containerInfo.Id);
        this.logger.info(
          {
            containerId: containerInfo.Id,
            name: containerInfo.Names[0],
            ageHours: Math.round(ageMs / 3_600_000),
          },
          'Cleaning up old container'
        );

        try {
          if (containerInfo.State === 'running') {
            await container.stop({ t: 5 });
          }
          await container.remove({ force: true });
        } catch (err: unknown) {
          this.logger.error(
            {
              containerId: containerInfo.Id,
              name: containerInfo.Names[0],
              error: err,
            },
            'Failed to remove old container'
          );
        }
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to list containers for cleanup');
    }
  }

  async createWorker(config: WorkerConfig): Promise<WorkerHandle> {
    const { taskId, worktreePath, systemPrompt, prompt, secrets, workerType } = config;

    const existingWorker = this.workers.get(taskId);
    if (existingWorker !== undefined) {
      /* v8 ignore start -- test-infra: orchestrator only re-enters createWorker with continueSession=true for existing workers @preserve */
      if (config.continueSession !== true) {
        throw new Error(`Worker already exists for task ${taskId}`);
      }
      /* v8 ignore stop @preserve */

      await this.writePromptFiles(existingWorker.taskSecretsPath, systemPrompt, prompt);
      void this.runAttemptInContainer(taskId, config);
      return existingWorker.handle;
    }

    if (this.workers.size >= this.config.maxConcurrent) {
      throw new Error(`Max concurrent workers (${String(this.config.maxConcurrent)}) reached`);
    }

    const gitPath = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitPath)) {
      throw new Error(`Invalid worktree: ${worktreePath} (no .git directory)`);
    }

    // Detect main git directory for worktree support
    // Worktrees have a .git file (not directory) containing: "gitdir: /main/repo/.git/worktrees/name"
    /* v8 ignore start -- test-infra: worktree detection requires real filesystem, tests mock fs.statSync @preserve */
    let mainGitDir: string | null = null;
    const gitStat = fs.statSync(gitPath);
    if (gitStat.isFile()) {
      const gitFileContent = fs.readFileSync(gitPath, 'utf-8').trim();
      const gitdirMatch = /^gitdir:\s*(.+)$/.exec(gitFileContent);
      if (gitdirMatch?.[1] !== undefined) {
        const worktreeGitDir = gitdirMatch[1];
        const worktreesIndex = worktreeGitDir.lastIndexOf('/.git/worktrees/');
        if (worktreesIndex !== -1) {
          mainGitDir = worktreeGitDir.substring(0, worktreesIndex + '/.git'.length);
        }
      }
    }
    /* v8 ignore stop @preserve */

    const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
    const taskSessionPath = path.join(
      this.config.secretsBasePath,
      `${CLAUDE_SESSION_DIR_PREFIX}-${taskId}`
    );
    await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(taskSessionPath, { recursive: true, mode: 0o700 });
    await this.writePromptFiles(taskSecretsPath, systemPrompt, prompt);

    /* v8 ignore start -- test-infra: anthropicOAuth not injected in unit tests @preserve */
    if (this.anthropicOAuth !== undefined) {
      await this.anthropicOAuth.writeTaskCredentials(taskSessionPath);
    }
    /* v8 ignore stop @preserve */

    /* v8 ignore start -- test-infra: branch for copying optional GCP credentials file @preserve */
    if (config.gcpSaKeyPath && fs.existsSync(config.gcpSaKeyPath)) {
      await fs.promises.copyFile(config.gcpSaKeyPath, path.join(taskSecretsPath, 'gcp-sa.json'));
    }
    /* v8 ignore stop @preserve */

    const workerTypeConfig = (await import('./types.js')).WORKER_TYPES[workerType];
    const apiKey = secrets[workerTypeConfig.apiKeyEnvVar];

    /* v8 ignore start -- test-infra: tests always provide mock API keys @preserve */
    if (apiKey === '') {
      throw new Error(
        `Worker type '${workerType}' requires ${workerTypeConfig.apiKeyEnvVar} but it is not configured`
      );
    }

    const KEY_FORMAT: Record<string, string> = {
      ANTHROPIC_API_KEY: 'sk-ant-',
    };
    const expectedPrefix = KEY_FORMAT[workerTypeConfig.apiKeyEnvVar];
    if (expectedPrefix !== undefined && !apiKey.startsWith(expectedPrefix)) {
      this.logger.error(
        {
          taskId,
          workerType,
          envVar: workerTypeConfig.apiKeyEnvVar,
          keyPrefix: apiKey.slice(0, 6) + '...',
        },
        `API key does not match expected format (expected ${expectedPrefix}*) — task will likely fail with 401`
      );
    }
    /* v8 ignore stop @preserve */

    /* v8 ignore start -- test-infra: worker type configuration varies by test @preserve */
    const env = [
      `TASK_ID=${taskId}`,
      `ANTHROPIC_API_KEY=${apiKey}`,
      `ANTHROPIC_BASE_URL=${workerTypeConfig.apiBaseUrl}`,
      `LINEAR_API_KEY=${secrets.LINEAR_API_KEY}`,
      `SENTRY_AUTH_TOKEN=${secrets.SENTRY_AUTH_TOKEN}`,
      `GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json`,
      'CLAUDE_PROJECT_DIR=/repo',
      'CLAUDE_WORKER_MODE=1',
      `CLAUDE_MANAGED_MODE=${this.config.managedAttemptsMode ? '1' : '0'}`,
      `CLAUDE_CONTINUE=${config.continueSession === true ? '1' : '0'}`,
    ];

    if (workerTypeConfig.model !== undefined) {
      env.push(`ANTHROPIC_MODEL=${workerTypeConfig.model}`);
    }
    /* v8 ignore stop @preserve */

    /* v8 ignore start -- ts-type: ternary for API key length check, short keys only in tests @preserve */
    const keySuffix = apiKey.length > 4 ? '...' + apiKey.slice(-4) : '****';
    /* v8 ignore stop @preserve */
    this.logger.info(
      { taskId, worktreePath, workerType, apiKey: keySuffix, baseUrl: workerTypeConfig.apiBaseUrl },
      'Creating worker container'
    );

    const pnpmStorePath = path.join(path.dirname(this.config.secretsBasePath), PNPM_STORE_DIR_NAME);
    fs.mkdirSync(pnpmStorePath, { recursive: true });

    /* v8 ignore start -- test-infra: image pull requires Docker daemon with registry access @preserve */
    try {
      const pullOpts: Record<string, unknown> = { platform: 'linux/amd64' };
      if (this.config.gcpSaKeyPath !== '' && fs.existsSync(this.config.gcpSaKeyPath)) {
        const saKey = fs.readFileSync(this.config.gcpSaKeyPath, 'utf-8');
        const registry = this.config.imageName.split('/')[0] ?? '';
        pullOpts['authconfig'] = {
          username: '_json_key',
          password: saKey,
          serveraddress: `https://${registry}`,
        };
      }
      const pullStream = await this.docker.pull(this.config.imageName, pullOpts);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(pullStream, (err: Error | null) => {
          if (err !== null) reject(err);
          else resolve();
        });
      });
      this.logger.debug({ taskId, image: this.config.imageName }, 'Image pulled');
    } catch (err: unknown) {
      this.logger.warn({ taskId, error: err }, 'Image pull failed — using cached image');
    }
    /* v8 ignore stop @preserve */

    const container = await this.docker.createContainer({
      Image: this.config.imageName,
      name: `claude-worker-${taskId}`,
      Env: env,
      WorkingDir: '/repo',
      User: '1001:1001',
      Tty: false,
      HostConfig: {
        Binds: [
          `${worktreePath}:/repo:rw`,
          `${taskSecretsPath}:/secrets:ro`,
          `${pnpmStorePath}:/home/claude/pnpm-store:rw`,
          `${taskSessionPath}:/home/claude/.claude:rw`,
          /* v8 ignore start -- test-infra: worktree mount only set when mainGitDir detected @preserve */
          ...(mainGitDir !== null ? [`${mainGitDir}:${mainGitDir}:rw`] : []),
          /* v8 ignore stop @preserve */
        ],
        Memory: this.config.memoryLimitBytes,
        NanoCpus: this.config.cpuCount * 1e9,
        NetworkMode: this.config.networkName,
        ReadonlyRootfs: false,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=2g',
          '/home/claude': 'rw,noexec,nosuid,size=500m,uid=1001,gid=1001',
          // Shadows the Mac host's node_modules (bind-mounted via /repo), giving the
          // container an empty writable dir for Linux-native pnpm install.
          '/repo/node_modules': 'rw,exec,nosuid,size=4g,uid=1001,gid=1001',
        },
        CapDrop: ['ALL'],
        // NET_RAW: Required for network diagnostics (ping, traceroute) which Claude
        // uses to verify connectivity. Without it, Claude's network-test commands fail.
        CapAdd: ['NET_RAW'],
        SecurityOpt: ['no-new-privileges'],
        AutoRemove: false,
      },
    });

    await container.start();

    // Capture logs via container.logs() (replaces attach stream)
    /* v8 ignore start -- test-infra: log stream setup tested via mock, requires running container @preserve */
    let logStream: NodeJS.ReadableStream | undefined;
    if (config.onLog !== undefined) {
      logStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });
      logStream.on('data', (chunk: Buffer) => {
        config.onLog?.(chunk.toString('utf-8'));
      });
    }
    /* v8 ignore stop @preserve */

    const handle: WorkerHandle = {
      taskId,
      containerId: container.id,
      status: 'running',
      startedAt: new Date(),
    };

    this.workers.set(taskId, {
      containerId: container.id,
      handle,
      taskSecretsPath,
      taskSessionPath,
      attemptRunning: false,
      attemptLogBuffer: '',
      /* v8 ignore start -- test-infra: logStream only set when onLog callback provided in running container @preserve */
      ...(logStream !== undefined ? { logStream } : {}),
      /* v8 ignore stop @preserve */
    });

    /* v8 ignore start -- test-infra: managedAttemptsMode is always enabled in production and tests @preserve */
    if (this.config.managedAttemptsMode) {
      void this.runAttemptInContainer(taskId, config);
    } else {
      // In legacy mode, Claude exits naturally with the container process.
      container
        .wait()
        .then(async (data) => {
          const worker = this.workers.get(taskId);
          if (worker !== undefined) {
            worker.handle.status = data.StatusCode === 0 ? 'completed' : 'failed';
          }
          config.onComplete?.(data.StatusCode);
        })
        .catch((err: unknown) => {
          this.logger.error({ taskId, error: err }, 'Container wait error');
        });
    }
    /* v8 ignore stop @preserve */

    this.logger.info({ taskId, containerId: container.id }, 'Worker container started');

    return handle;
  }

  async destroyWorker(taskId: string, forceKill = false): Promise<void> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      this.logger.warn({ taskId }, 'Worker not found for destroy');
      return;
    }

    this.logger.info({ taskId, forceKill }, 'Stopping worker container');

    /* v8 ignore start -- test-infra: logStream only set when onLog callback provided in production @preserve */
    if (worker.logStream !== undefined && 'destroy' in worker.logStream) {
      (worker.logStream as NodeJS.ReadableStream & { destroy(): void }).destroy();
    }
    /* v8 ignore stop @preserve */

    try {
      const container = this.docker.getContainer(worker.containerId);

      try {
        if (forceKill) {
          await container.kill({ signal: 'SIGKILL' });
        } else {
          await container.stop({ t: 10 });
        }
      } catch (err: unknown) {
        const isAlreadyStopped =
          err instanceof Error &&
          (err.message.includes('No such container') ||
            err.message.includes('is not running') ||
            err.message.includes('already stopped'));

        if (isAlreadyStopped) {
          this.logger.debug({ taskId }, 'Container already stopped');
        } else {
          this.logger.error({ taskId, error: err }, 'Failed to stop/kill container');
        }
      }

      if (!this.config.keepContainersAlive) {
        try {
          await container.remove({ force: true });
        } catch (err: unknown) {
          this.logger.error({ taskId, error: err }, 'Failed to remove container');
        }
      }

      const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
      try {
        await fs.promises.rm(taskSecretsPath, { recursive: true, force: true });
      } catch (err: unknown) {
        this.logger.error(
          { taskId, error: err, path: taskSecretsPath },
          'Failed to remove task secrets directory'
        );
      }
    } finally {
      this.workers.delete(taskId);
    }

    this.logger.info({ taskId }, 'Worker container stopped');
  }

  async isWorkerRunning(taskId: string): Promise<boolean> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      return false;
    }

    try {
      const container = this.docker.getContainer(worker.containerId);
      const info = await container.inspect();
      return info.State.Running;
    } catch {
      return false;
    }
  }

  /* v8 ignore start -- test-infra: Docker log stream behavior and fallback paths require daemon-level integration tests @preserve */
  async getWorkerLogs(taskId: string): Promise<string> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      return '';
    }

    try {
      const container = this.docker.getContainer(worker.containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        timestamps: true,
      });
      const containerLogs = logs.toString('utf-8');
      /* v8 ignore start -- test-infra: branch depends on whether exec-stream buffering captured attempt logs @preserve */
      if (worker.attemptLogBuffer === '') {
        return containerLogs;
      }
      /* v8 ignore stop @preserve */
      return `${containerLogs}\n${worker.attemptLogBuffer}`;
    } catch {
      return worker.attemptLogBuffer;
    }
  }
  /* v8 ignore stop @preserve */

  async streamLogs(taskId: string, onChunk: (chunk: string) => void): Promise<void> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      throw new Error(`Worker ${taskId} not found`);
    }

    const container = this.docker.getContainer(worker.containerId);
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
    });

    logStream.on('data', (chunk: Buffer) => {
      onChunk(chunk.toString('utf-8'));
    });
  }

  async waitForCompletion(taskId: string, timeoutMs: number): Promise<number> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      return -1;
    }

    const container = this.docker.getContainer(worker.containerId);

    /* v8 ignore start -- async-timing: setTimeout/clearTimeout race condition handling, hard to trigger in tests @preserve */
    return await new Promise((resolve) => {
      let timeoutFired = false;

      const timeout = setTimeout(() => {
        timeoutFired = true;
        this.logger.warn({ taskId }, 'Worker timeout, force killing');
        worker.handle.status = 'timeout';

        resolve(-1);
        void this.destroyWorker(taskId, true).catch((err: unknown) => {
          this.logger.error({ taskId, error: err }, 'Failed to destroy timed-out worker');
        });
      }, timeoutMs);

      container
        .wait()
        .then((data) => {
          clearTimeout(timeout);
          if (!timeoutFired) {
            resolve(data.StatusCode);
          }
        })
        .catch((err: unknown) => {
          clearTimeout(timeout);
          if (!timeoutFired) {
            this.logger.error({ taskId, error: err }, 'Wait error');
            resolve(-1);
          }
        });
    });
    /* v8 ignore stop @preserve */
  }

  async getResourceUsage(taskId: string): Promise<ResourceUsage> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      throw new Error(`Worker ${taskId} not found`);
    }

    /* v8 ignore start -- test-infra: stats API returns complex nested objects, CPU calc branches not easily covered @preserve */
    const container = this.docker.getContainer(worker.containerId);
    const stats = await container.stats({ stream: false });

    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuPercent =
      systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;
    /* v8 ignore stop @preserve */

    return {
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memoryUsedMB: Math.round(stats.memory_stats.usage / 1024 / 1024),
      memoryLimitMB: Math.round(stats.memory_stats.limit / 1024 / 1024),
    };
  }

  async listWorkers(): Promise<WorkerHandle[]> {
    return Array.from(this.workers.values()).map((w) => w.handle);
  }

  async cleanupTaskSession(taskId: string): Promise<void> {
    const taskSessionPath = path.join(
      this.config.secretsBasePath,
      `${CLAUDE_SESSION_DIR_PREFIX}-${taskId}`
    );
    try {
      await fs.promises.rm(taskSessionPath, { recursive: true, force: true });
    } catch (err: unknown) {
      this.logger.error(
        { taskId, error: err, path: taskSessionPath },
        'Failed to remove task session directory'
      );
    }
  }

  /* v8 ignore start -- test-infra: prompt file writes are covered indirectly by integration tests with real mounted secrets @preserve */
  private async writePromptFiles(
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
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- test-infra: Docker exec lifecycle and race handling require daemon-level integration tests @preserve */
  private async runAttemptInContainer(taskId: string, config: WorkerConfig): Promise<void> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      this.logger.error({ taskId }, 'Cannot start attempt: worker not found');
      config.onComplete?.(1);
      return;
    }

    if (worker.attemptRunning) {
      this.logger.error({ taskId }, 'Cannot start attempt: previous attempt still running');
      config.onComplete?.(1);
      return;
    }

    worker.attemptRunning = true;

    try {
      const container = this.docker.getContainer(worker.containerId);
      const execInstance = await container.exec({
        Cmd: ['/entrypoint.sh', 'run-attempt'],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        WorkingDir: '/repo',
        User: '1001:1001',
        Env: [`CLAUDE_CONTINUE=${config.continueSession === true ? '1' : '0'}`],
      });

      const execStream = await execInstance.start({ hijack: false, stdin: false });
      execStream.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        worker.attemptLogBuffer += text;
        config.onLog?.(text);
      });

      const exitCode = await this.waitForExecCompletion(taskId, execInstance, execStream);
      worker.handle.status = exitCode === 0 ? 'completed' : 'failed';
      config.onComplete?.(exitCode);
    } catch (error) {
      this.logger.error({ taskId, error }, 'Failed to execute Claude attempt');
      worker.handle.status = 'failed';
      config.onComplete?.(1);
    } finally {
      worker.attemptRunning = false;
    }
  }
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- upstream: Docker exec stream/inspect error paths depend on daemon/runtime behavior @preserve */
  private async waitForExecCompletion(
    taskId: string,
    execInstance: Docker.Exec,
    execStream: NodeJS.ReadableStream
  ): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const resolveOnce = (): void => {
        resolve();
      };
      execStream.on('end', resolveOnce);
      execStream.on('close', resolveOnce);
      execStream.on('error', (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    try {
      const info = await execInstance.inspect();
      return typeof info.ExitCode === 'number' ? info.ExitCode : 1;
    } catch (error) {
      this.logger.warn({ taskId, error }, 'Failed to inspect exec completion state');
      return 1;
    }
  }
  /* v8 ignore stop @preserve */
}
