import Docker from 'dockerode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@intexuraos/common-core';
import type {
  IsolationProvider,
  WorkerConfig,
  WorkerHandle,
  ResourceUsage,
  TTYStreams,
} from './types.js';

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
}

const DEFAULT_CONFIG: DockerProviderConfig = {
  imageName: 'gcr.io/intexuraos-dev-pbuchman/claude-worker:latest',
  networkName: 'claude-worker-net',
  maxConcurrent: 4,
  memoryLimitBytes: 8 * 1024 * 1024 * 1024,
  cpuCount: 4,
  timeoutMs: 2 * 60 * 60 * 1000,
  secretsBasePath: '/tmp/claude-secrets',
  gcpSaKeyPath: '',
  keepContainersAlive: false,
};

interface WorkerEntry {
  containerId: string;
  handle: WorkerHandle;
  attachStream?: NodeJS.ReadWriteStream;
}

export const PNPM_STORE_VOLUME = 'claude-pnpm-store';

export class DockerProvider implements IsolationProvider {
  private readonly docker: Docker;
  private readonly config: DockerProviderConfig;
  private readonly logger: Logger;
  private readonly workers: Map<string, WorkerEntry>;

  constructor(config: Partial<DockerProviderConfig>, logger: Logger) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.workers = new Map();
  }

  /* v8 ignore start -- test-infra: volume creation requires Docker daemon @preserve */
  private async ensureVolume(name: string): Promise<void> {
    try {
      const volume = this.docker.getVolume(name);
      await volume.inspect();
    } catch {
      await this.docker.createVolume({ Name: name });
      this.logger.info({ volume: name }, 'Created Docker volume');
    }
  }
  /* v8 ignore stop @preserve */

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
          { containerId: containerInfo.Id, name: containerInfo.Names[0], ageHours: Math.round(ageMs / 3_600_000) },
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
    const { taskId, worktreePath, systemPrompt, secrets, workerType } = config;

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
        // Extract the main .git directory from the worktree gitdir path
        // Format: /path/to/repo/.git/worktrees/worktree-name
        const worktreeGitDir = gitdirMatch[1];
        const worktreesIndex = worktreeGitDir.lastIndexOf('/.git/worktrees/');
        if (worktreesIndex !== -1) {
          mainGitDir = worktreeGitDir.substring(0, worktreesIndex + '/.git'.length);
        }
      }
    }
    /* v8 ignore stop @preserve */

    const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
    await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });

    /* v8 ignore start -- test-infra: branch for copying optional GCP credentials file @preserve */
    if (config.gcpSaKeyPath && fs.existsSync(config.gcpSaKeyPath)) {
      await fs.promises.copyFile(config.gcpSaKeyPath, path.join(taskSecretsPath, 'gcp-sa.json'));
    }
    /* v8 ignore stop @preserve */

    const workerTypeConfig = (await import('./types.js')).WORKER_TYPES[workerType];
    const apiKey = secrets[workerTypeConfig.apiKeyEnvVar];

    /* v8 ignore start -- test-infra: tests always provide mock API keys @preserve */
    // Fail early if the required API key for this worker type is not configured
    if (apiKey === '') {
      throw new Error(
        `Worker type '${workerType}' requires ${workerTypeConfig.apiKeyEnvVar} but it is not configured`
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
      'PNPM_STORE_DIR=/home/claude/pnpm-store',
      // Exit 10s after idle - Claude exits automatically when no input arrives
      'CLAUDE_CODE_EXIT_AFTER_STOP_DELAY=10000',
    ];

    if (workerTypeConfig.model !== undefined) {
      env.push(`ANTHROPIC_MODEL=${workerTypeConfig.model}`);
    }
    /* v8 ignore stop @preserve */

    this.logger.info({ taskId, worktreePath, workerType }, 'Creating worker container');

    /* v8 ignore start -- test-infra: volume creation requires Docker daemon @preserve */
    await this.ensureVolume(PNPM_STORE_VOLUME);
    /* v8 ignore stop @preserve */

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
        this.docker.modem.followProgress(
          pullStream,
          (err: Error | null) => {
            if (err !== null) reject(err);
            else resolve();
          }
        );
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
      OpenStdin: true,
      Tty: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        Binds: [
          `${worktreePath}:/repo:rw`,
          `${taskSecretsPath}:/secrets:ro`,
          // Shared named volume for pnpm's content-addressable store (safe for concurrent access).
          `${PNPM_STORE_VOLUME}:/home/claude/pnpm-store:rw`,
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

    // CRITICAL: attach() MUST be called before start() to capture all container output.
    // If attach is called after start, the stream misses output emitted during startup.
    const attachStream = (await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    })) as unknown as NodeJS.ReadWriteStream;

    await container.start();

    // Set up log listener BEFORE writing prompt to avoid race condition
    /* v8 ignore start -- test-infra: optional onLog callback tested via test mock @preserve */
    if (config.onLog !== undefined) {
      attachStream.on('data', (chunk: Buffer) => {
        config.onLog?.(chunk.toString('utf-8'));
      });
    }
    /* v8 ignore stop @preserve */

    await this.waitForContainerReady(attachStream as unknown as NodeJS.ReadWriteStream, taskId, container.id);
    this.logger.debug({ taskId }, 'Container ready — sending system prompt');
    await this.writePromptToTTY(attachStream, systemPrompt, taskId);

    const handle: WorkerHandle = {
      taskId,
      containerId: container.id,
      status: 'running',
      startedAt: new Date(),
    };

    this.workers.set(taskId, {
      containerId: container.id,
      handle,
      attachStream,
    });

    /* v8 ignore start -- test-infra: promise handlers run after test completes @preserve */
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
    /* v8 ignore stop @preserve */

    this.monitorForResponseCompletion(attachStream, taskId, container.id);

    this.logger.info({ taskId, containerId: container.id }, 'Worker container started');

    return handle;
  }

  /* v8 ignore start -- test-infra: overridden in TestableDockerProvider, real handshake requires running container with TTY @preserve */
  protected async waitForContainerReady(
    attachStream: NodeJS.ReadWriteStream,
    taskId: string,
    containerId?: string
  ): Promise<void> {
    const TOTAL_TIMEOUT_MS = 180_000;
    const SENTINEL_POLL_MS = 2_000;
    const READY_MARKER = 'bypass permissions on';
    const SENTINEL_PATH = '/tmp/claude-ready';

    // Phase 1: Poll for entrypoint sentinel (waits for pnpm install to finish)
    if (containerId !== undefined) {
      const startTime = Date.now();
      while (Date.now() - startTime < TOTAL_TIMEOUT_MS) {
        try {
          const container = this.docker.getContainer(containerId);
          const exec = await container.exec({
            Cmd: ['sh', '-c', `[ -f ${SENTINEL_PATH} ] && echo READY || echo WAIT`],
            AttachStdout: true,
            Tty: true,
          });
          const stream = await exec.start({ Tty: true });
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          await new Promise<void>((resolve) => stream.on('end', resolve));
          const output = Buffer.concat(chunks).toString('utf-8');

          if (output.includes('READY')) {
            this.logger.info({ taskId }, 'Entrypoint ready sentinel detected');
            break;
          }
        } catch {
          // Container not ready for exec yet
        }
        await new Promise((resolve) => setTimeout(resolve, SENTINEL_POLL_MS));
      }
    }

    // Phase 2: Send API key approval and wait for TUI ready marker
    const POST_SENTINEL_WAIT_MS = 5_000;
    await new Promise<void>((resolve) => {
      let done = false;

      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(hardTimeout);
        attachStream.removeListener('data', onData);
        resolve();
      };

      const hardTimeout = setTimeout(() => {
        this.logger.warn({ taskId }, 'TUI ready timeout — proceeding anyway');
        finish();
      }, 30_000);

      const onData = (chunk: Buffer): void => {
        if (!done) {
          const text = chunk.toString('utf-8');
          if (text.includes(READY_MARKER)) {
            this.logger.info({ taskId }, 'TUI ready marker detected');
            finish();
          }
        }
      };

      attachStream.on('data', onData);

      setTimeout(() => {
        if (done) return;
        this.logger.debug({ taskId }, 'Sending API key approval');
        attachStream.write('\x1b[A');
        setTimeout(() => {
          if (!done) attachStream.write('\r');
        }, 500);
      }, POST_SENTINEL_WAIT_MS);
    });
  }
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- test-infra: overridden in TestableDockerProvider, TTY paste-then-submit requires real terminal @preserve */
  protected async writePromptToTTY(
    attachStream: NodeJS.ReadWriteStream,
    prompt: string,
    taskId: string
  ): Promise<void> {
    const SETTLE_MS = 1_000;
    const TIMEOUT_MS = 10_000;

    attachStream.write(prompt + '\n');
    this.logger.info(
      { taskId, promptLength: prompt.length },
      'Prompt written — waiting for TUI to settle before submit'
    );

    await new Promise<void>((resolve) => {
      let settleTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (): void => {
        clearTimeout(hardTimeout);
        if (settleTimer) clearTimeout(settleTimer);
        attachStream.removeListener('data', onData);
        attachStream.write('\r');
        resolve();
      };

      const hardTimeout = setTimeout(() => {
        this.logger.warn({ taskId }, 'Prompt settle timeout — submitting anyway');
        finish();
      }, TIMEOUT_MS);

      const resetSettle = (): void => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, SETTLE_MS);
      };

      const onData = (): void => {
        resetSettle();
      };

      attachStream.on('data', onData);
      resetSettle();
    });
  }
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- test-infra: overridden in TestableDockerProvider, requires real container lifecycle @preserve */
  protected monitorForResponseCompletion(
    _attachStream: NodeJS.ReadWriteStream,
    taskId: string,
    containerId: string
  ): void {
    const POLL_INTERVAL_MS = 5_000;
    const INITIAL_DELAY_MS = 30_000;
    const SENTINEL_PATH = '/repo/.claude/hooks/validation-passed';

    const poll = async (interval: ReturnType<typeof setInterval>): Promise<void> => {
      try {
        const container = this.docker.getContainer(containerId);
        const exec = await container.exec({
          Cmd: ['sh', '-c', `[ -f ${SENTINEL_PATH} ] && echo DONE || echo WAIT`],
          AttachStdout: true,
          Tty: true,
        });
        const stream = await exec.start({ Tty: true });
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) => stream.on('end', resolve));
        const output = Buffer.concat(chunks).toString('utf-8');

        if (output.includes('DONE')) {
          clearInterval(interval);
          if (this.config.keepContainersAlive) {
            this.logger.info({ taskId }, 'Stop hooks completed — keeping container alive (debug mode)');
          } else {
            this.logger.info({ taskId }, 'Stop hooks completed — stopping container');
            await container.stop({ t: 5 }).catch((_err: unknown) => {
              // Container may already be stopped
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          { taskId, error },
          'Poll error in monitorForResponseCompletion — stopping monitoring'
        );
        clearInterval(interval);
      }
    };

    // Delay polling to avoid detecting sentinel before response completes.
    // Simple tasks complete in ~15s; 30s delay ensures we don't stop during prompt processing.
    setTimeout(() => {
      const interval = setInterval(() => {
        void poll(interval);
      }, POLL_INTERVAL_MS);
      void poll(interval);
    }, INITIAL_DELAY_MS);
  }
  /* v8 ignore stop @preserve */

  async destroyWorker(taskId: string, forceKill = false): Promise<void> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      this.logger.warn({ taskId }, 'Worker not found for destroy');
      return;
    }

    this.logger.info({ taskId, forceKill }, 'Stopping worker container');

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
            err.message.includes('already stopped') ||
            err.message.includes('is not running'));

        if (isAlreadyStopped) {
          this.logger.debug({ taskId }, 'Container already stopped');
        } else {
          this.logger.error({ taskId, error: err }, 'Failed to stop/kill container');
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
      return logs.toString('utf-8');
    } catch {
      return '';
    }
  }

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

        // Resolve immediately, then cleanup asynchronously
        resolve(-1);
        void this.destroyWorker(taskId, true).catch((err: unknown) => {
          this.logger.error({ taskId, error: err }, 'Failed to destroy timed-out worker');
        });
      }, timeoutMs);

      container
        .wait()
        .then((data) => {
          clearTimeout(timeout);
          // Don't resolve if timeout already fired (race condition)
          if (!timeoutFired) {
            resolve(data.StatusCode);
          }
        })
        .catch((err: unknown) => {
          clearTimeout(timeout);
          // Don't resolve if timeout already fired (race condition)
          if (!timeoutFired) {
            this.logger.error({ taskId, error: err }, 'Wait error');
            resolve(-1);
          }
        });
    });
    /* v8 ignore stop @preserve */
  }

  async sendInput(taskId: string, input: string): Promise<void> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      throw new Error(`Worker ${taskId} not found`);
    }

    /* v8 ignore start -- test-infra: defensive check - attachStream always set when worker created @preserve */
    if (worker.attachStream === undefined) {
      throw new Error(`Worker ${taskId} has no attached stream`);
    }
    /* v8 ignore stop @preserve */

    this.logger.debug({ taskId, inputLength: input.length }, 'Sending input to worker');
    await this.writePromptToTTY(worker.attachStream, input, taskId);
  }

  async attachTTY(taskId: string): Promise<TTYStreams> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      throw new Error(`Worker ${taskId} not found`);
    }

    const container = this.docker.getContainer(worker.containerId);

    const exec = await container.exec({
      Cmd: ['/bin/bash'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });

    const stream = (await exec.start({
      hijack: true,
      stdin: true,
      Tty: true,
    })) as unknown as NodeJS.ReadWriteStream;

    return {
      stdin: stream,
      stdout: stream,
      stderr: stream,
      /* v8 ignore start -- test-infra: callback for detaching TTY, not invoked in unit tests @preserve */
      detach: () => stream.end(),
      /* v8 ignore stop @preserve */
    };
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
}
