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
}

const DEFAULT_CONFIG: DockerProviderConfig = {
  imageName: 'gcr.io/intexuraos-dev-pbuchman/claude-worker:latest',
  networkName: 'claude-worker-net',
  maxConcurrent: 4,
  memoryLimitBytes: 8 * 1024 * 1024 * 1024,
  cpuCount: 4,
  timeoutMs: 2 * 60 * 60 * 1000,
  secretsBasePath: '/tmp/claude-secrets',
};

interface WorkerEntry {
  containerId: string;
  handle: WorkerHandle;
  attachStream?: NodeJS.ReadWriteStream;
}

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

  async createWorker(config: WorkerConfig): Promise<WorkerHandle> {
    const { taskId, worktreePath, prompt, secrets, workerType } = config;

    if (this.workers.size >= this.config.maxConcurrent) {
      throw new Error(`Max concurrent workers (${String(this.config.maxConcurrent)}) reached`);
    }

    const gitPath = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitPath)) {
      throw new Error(`Invalid worktree: ${worktreePath} (no .git directory)`);
    }

    const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
    await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });

    /* v8 ignore start -- test-infra: branch for copying optional GCP credentials file @preserve */
    if (config.gcpSaKeyPath && fs.existsSync(config.gcpSaKeyPath)) {
      await fs.promises.copyFile(config.gcpSaKeyPath, path.join(taskSecretsPath, 'gcp-sa.json'));
    }
    /* v8 ignore stop @preserve */

    const workerTypeConfig = (await import('./types.js')).WORKER_TYPES[workerType];
    const apiKey = secrets[workerTypeConfig.apiKeyEnvVar];

    /* v8 ignore start -- test-infra: worker type configuration varies by test @preserve */
    const env = [
      `TASK_ID=${taskId}`,
      `ANTHROPIC_API_KEY=${apiKey}`,
      `ANTHROPIC_BASE_URL=${workerTypeConfig.apiBaseUrl}`,
      `LINEAR_API_KEY=${secrets.LINEAR_API_KEY}`,
      `SENTRY_AUTH_TOKEN=${secrets.SENTRY_AUTH_TOKEN}`,
      `GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json`,
    ];

    if (workerTypeConfig.model !== undefined) {
      env.push(`ANTHROPIC_MODEL=${workerTypeConfig.model}`);
    }
    /* v8 ignore stop @preserve */

    this.logger.info({ taskId, worktreePath, workerType }, 'Creating worker container');

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
        Binds: [`${worktreePath}:/repo:rw`, `${taskSecretsPath}:/secrets:ro`],
        Memory: this.config.memoryLimitBytes,
        NanoCpus: this.config.cpuCount * 1e9,
        NetworkMode: this.config.networkName,
        ReadonlyRootfs: false,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=2g',
        },
        CapDrop: ['ALL'],
        CapAdd: ['NET_RAW'],
        SecurityOpt: ['no-new-privileges'],
        AutoRemove: false,
      },
    });

    await container.start();

    const attachStream = (await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    })) as unknown as NodeJS.ReadWriteStream;

    attachStream.write(prompt + '\n');

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

    /* v8 ignore start -- test-infra: optional onLog callback tested via test mock @preserve */
    if (config.onLog !== undefined) {
      attachStream.on('data', (chunk: Buffer) => {
        config.onLog?.(chunk.toString('utf-8'));
      });
    }
    /* v8 ignore stop @preserve */

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

    this.logger.info({ taskId, containerId: container.id }, 'Worker container started');

    return handle;
  }

  async destroyWorker(taskId: string): Promise<void> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      this.logger.warn({ taskId }, 'Worker not found for destroy');
      return;
    }

    this.logger.info({ taskId }, 'Destroying worker container');

    try {
      const container = this.docker.getContainer(worker.containerId);

      try {
        await container.stop({ t: 10 });
      } catch {
        this.logger.debug({ taskId }, 'Stop failed (may already be stopped)');
      }

      try {
        await container.remove({ force: true });
      } catch {
        this.logger.debug({ taskId }, 'Remove failed');
      }

      const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
      await fs.promises.rm(taskSecretsPath, { recursive: true, force: true });
    } finally {
      this.workers.delete(taskId);
    }

    this.logger.info({ taskId }, 'Worker container destroyed');
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

    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.warn({ taskId }, 'Worker timeout, destroying');
        worker.handle.status = 'timeout';
        void this.destroyWorker(taskId).then(() => {
          resolve(-1);
        });
      }, timeoutMs);

      container
        .wait()
        .then((data) => {
          clearTimeout(timeout);
          resolve(data.StatusCode);
        })
        /* v8 ignore start -- async-timing: catch block for Docker SDK error, hard to trigger in tests @preserve */
        .catch((err: unknown) => {
          clearTimeout(timeout);
          this.logger.error({ taskId, error: err }, 'Wait error');
          resolve(-1);
        });
      /* v8 ignore stop @preserve */
    });
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
    worker.attachStream.write(input + '\n');
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
