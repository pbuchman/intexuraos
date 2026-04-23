import Docker from 'dockerode';
import type { Logger } from '@intexuraos/common-core';
import type { WorkerRuntime } from '../runtime/types.js';
import { withTimeout } from '../../with-timeout.js';
import type {
  ContainerStatsSnapshot,
  DiscoveredContainer,
  IsolationProvider,
  WorkerConfig,
  WorkerHandle,
  ResourceUsage,
} from './types.js';
import { WORKER_TYPES } from './types.js';
import { DockerRegistry } from './docker-registry.js';
import { DockerNetwork } from './docker-network.js';
import { DockerVolume, PNPM_STORE_DIR_NAME, getHostUserInfo } from './docker-volume.js';
import { DockerContainer } from './docker-container.js';
import {
  createWorkerOrchestration,
  runAttemptInContainer,
  runCleanupCycle as runLifecycleCleanup,
  performHealthCheck,
  resolveForensicsSeccompProfilePath,
  resolveForensicsSeccompSecurityOpt,
  type WorkerEntry,
  type PreservedWorkerEntry,
  type LifecycleProviderConfig,
} from './worker-lifecycle.js';
import * as workerOps from './worker-ops.js';
import {
  DEFAULT_DOCKER_PROVIDER_CONFIG,
  PERIODIC_CLEANUP_INTERVAL_MS,
  HEALTH_CHECK_INTERVAL_MS,
  DOCKER_PING_TIMEOUT_MS,
  MIN_DISK_SPACE_BYTES,
  PRESERVED_MAX_AGE_MS,
  type DockerProviderConfig,
} from './docker-provider-config.js';

export { PNPM_STORE_DIR_NAME };
export type { DockerProviderConfig };

export class DockerProvider implements IsolationProvider {
  private docker: Docker;
  private readonly config: DockerProviderConfig;
  private readonly logger: Logger;
  private readonly workers: Map<string, WorkerEntry>;
  private readonly preservedWorkers = new Map<string, PreservedWorkerEntry>();
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private dockerHealthy = true;
  private diskHealthy = true;
  private healthMonitorIntervalId: NodeJS.Timeout | null = null;

  private readonly registry: DockerRegistry;
  private readonly network: DockerNetwork;
  private readonly volume: DockerVolume;
  private readonly container: DockerContainer;

  constructor(config: Partial<DockerProviderConfig>, logger: Logger) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = { ...DEFAULT_DOCKER_PROVIDER_CONFIG, ...config };
    this.logger = logger;
    this.workers = new Map();

    const getDocker = (): Docker => this.docker;
    this.registry = new DockerRegistry(getDocker, logger, {
      imageName: this.config.imageName,
      imagePullPolicy: this.config.imagePullPolicy,
      gcpSaKeyPath: this.config.gcpSaKeyPath,
    });
    this.network = new DockerNetwork(getDocker, logger, { networkName: this.config.networkName });
    this.volume = new DockerVolume(getDocker, logger, this.config);
    this.container = new DockerContainer(getDocker, logger);
  }

  async assertDockerAvailable(): Promise<void> {
    await this.docker.listContainers({ all: false, limit: 1 });
  }

  // Thin delegations preserved for backward-compat with tests that access
  // private methods via (provider as any). Declared protected so `noUnusedLocals`
  // accepts them even though the facade itself does not call them.
  protected resolveForensicsSeccompProfilePath = (): string | null =>
    resolveForensicsSeccompProfilePath(this.logger);
  protected resolveForensicsSeccompSecurityOpt = (): string | null =>
    resolveForensicsSeccompSecurityOpt(this.logger);
  protected runExecAndCapture = (
    taskId: string,
    execInstance: Docker.Exec
  ): Promise<{ exitCode: number; output: string }> =>
    this.container.runExecAndCapture(taskId, execInstance);
  protected captureSegfaultForensics = (
    taskId: string,
    container: Docker.Container,
    execInstance: Docker.Exec,
    hostAttemptForensicsPath: string,
    containerAttemptForensicsPath: string
  ): Promise<void> =>
    this.container.captureSegfaultForensics(
      taskId,
      container,
      execInstance,
      hostAttemptForensicsPath,
      containerAttemptForensicsPath,
      getHostUserInfo().userString
    );
  protected runAttemptInContainer = (taskId: string, config: WorkerConfig): Promise<void> =>
    this.runAttempt(taskId, config);
  protected waitForExecCompletion = (
    taskId: string,
    execInstance: Docker.Exec,
    execStream: NodeJS.ReadableStream
  ): Promise<number> => this.container.waitForExecCompletion(taskId, execInstance, execStream);

  private getLifecycleConfig(): LifecycleProviderConfig {
    return { ...this.config } as unknown as LifecycleProviderConfig;
  }

  async listWorkerContainers(): Promise<DiscoveredContainer[]> {
    return await this.container.listDiscoveredContainers('code-worker-');
  }

  async createWorker(config: WorkerConfig): Promise<WorkerHandle> {
    return await createWorkerOrchestration({
      config,
      providerConfig: this.getLifecycleConfig(),
      docker: this.docker,
      container: this.container,
      volume: this.volume,
      network: this.network,
      registry: this.registry,
      workers: this.workers,
      preservedWorkers: this.preservedWorkers,
      logger: this.logger,
      resolveRuntime: (): WorkerRuntime =>
        config.runtimeOverride ?? WORKER_TYPES[config.workerType].runtime,
      runAttempt: (taskId, cfg): void => {
        void this.runAttempt(taskId, cfg);
      },
    });
  }

  private async runAttempt(taskId: string, config: WorkerConfig): Promise<void> {
    await runAttemptInContainer({
      taskId,
      config,
      workers: this.workers,
      docker: this.docker,
      container: this.container,
      logger: this.logger,
    });
  }

  async destroyWorker(taskId: string, forceKill = false): Promise<void> {
    await workerOps.destroyWorker({
      taskId,
      forceKill,
      worker: this.workers.get(taskId),
      workers: this.workers,
      docker: this.docker,
      container: this.container,
      volume: this.volume,
      keepContainersAlive: this.config.keepContainersAlive,
      logger: this.logger,
    });
  }

  async isWorkerRunning(taskId: string): Promise<boolean> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) return false;
    return await this.container.isContainerRunning(worker.containerId);
  }

  async isResumeAvailable(taskId: string): Promise<boolean> {
    const preserved = this.preservedWorkers.get(taskId);
    const containerId = preserved?.containerId ?? this.workers.get(taskId)?.containerId;

    if (containerId !== undefined) {
      if (await this.container.isContainerRunning(containerId)) return true;
      if (preserved !== undefined) this.preservedWorkers.delete(taskId);
      return false;
    }

    return await this.container.isContainerRunning(`code-worker-${taskId}`);
  }

  getWorkerLogs = (taskId: string): Promise<string> =>
    workerOps.getWorkerLogs(taskId, this.workers.get(taskId), this.docker, this.logger);
  streamLogs = (taskId: string, onChunk: (chunk: string) => void): Promise<void> =>
    workerOps.streamLogs(taskId, this.workers.get(taskId), this.docker, onChunk);
  waitForCompletion = (taskId: string, timeoutMs: number): Promise<number> =>
    workerOps.waitForCompletion(
      taskId,
      this.workers.get(taskId),
      this.docker,
      timeoutMs,
      this.logger,
      (tid, forceKill) => this.destroyWorker(tid, forceKill)
    );
  getResourceUsage = (taskId: string): Promise<ResourceUsage> =>
    workerOps.getResourceUsage(taskId, this.workers.get(taskId), this.docker);
  copyOut = (taskId: string, srcPath: string, destPath: string): Promise<void> =>
    workerOps.copyOut(taskId, this.workers.get(taskId), this.docker, srcPath, destPath);
  statsSnapshot = (taskId: string): Promise<ContainerStatsSnapshot | null> =>
    workerOps.statsSnapshot(this.workers.get(taskId), this.docker);
  listWorkers = async (): Promise<WorkerHandle[]> =>
    Array.from(this.workers.values()).map((w) => w.handle);
  cleanupTaskSession = (taskId: string): Promise<void> => this.volume.cleanupTaskSession(taskId);
  preserveWorker = (taskId: string): Promise<boolean> =>
    workerOps.preserveWorker(
      taskId,
      this.workers.get(taskId),
      this.workers,
      this.preservedWorkers,
      this.volume,
      this.logger
    );
  listPreservedWorkers = async (): Promise<
    { containerId: string; taskId: string; preservedAt: string }[]
  > => Array.from(this.preservedWorkers.values());

  async runCleanupCycle(): Promise<void> {
    await runLifecycleCleanup({
      docker: this.docker,
      container: this.container,
      volume: this.volume,
      workers: this.workers,
      preservedWorkers: this.preservedWorkers,
      keepContainersAlive: this.config.keepContainersAlive,
      preservedMaxAgeMs: PRESERVED_MAX_AGE_MS,
      logger: this.logger,
    });
  }

  startPeriodicCleanup(): void {
    this.cleanupIntervalId = workerOps.startPeriodicCleanup(
      this.config.keepContainersAlive,
      this.cleanupIntervalId,
      PERIODIC_CLEANUP_INTERVAL_MS,
      PRESERVED_MAX_AGE_MS,
      this.logger,
      () => void this.runCleanupCycle()
    );
  }

  stopPeriodicCleanup(): void {
    this.cleanupIntervalId = workerOps.stopPeriodicCleanup(this.cleanupIntervalId, this.logger);
  }

  async checkHealth(): Promise<{ docker: boolean; disk: boolean }> {
    const r = await performHealthCheck({
      docker: this.docker,
      dockerPingTimeoutMs: DOCKER_PING_TIMEOUT_MS,
      minDiskSpaceBytes: MIN_DISK_SPACE_BYTES,
      prevDockerHealthy: this.dockerHealthy,
      prevDiskHealthy: this.diskHealthy,
      logger: this.logger,
      pingWithTimeout: withTimeout as unknown as (
        p: Promise<unknown>,
        ms: number,
        msg: string
      ) => Promise<unknown>,
    });
    this.dockerHealthy = r.docker;
    this.diskHealthy = r.disk;
    return r;
  }

  startHealthMonitor(): void {
    if (this.healthMonitorIntervalId !== null) return;
    this.healthMonitorIntervalId = setInterval(() => {
      void this.checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stopHealthMonitor(): void {
    if (this.healthMonitorIntervalId === null) return;
    clearInterval(this.healthMonitorIntervalId);
    this.healthMonitorIntervalId = null;
  }

  isHealthy = (): boolean => this.dockerHealthy && this.diskHealthy;
  getHealthDetails = (): { docker: boolean; disk: boolean } => ({
    docker: this.dockerHealthy,
    disk: this.diskHealthy,
  });
  pullImage = (taskId: string, onProgress?: (message: string) => void): Promise<string> =>
    this.registry.pullAndResolveImage(taskId, this.config.imageName, onProgress);
  getImageInfo = (): {
    configuredRef: string;
    lastResolvedDigest: string | null;
    pullPolicy: string;
    managedAttemptsMode: boolean;
  } => this.registry.getImageInfo(this.config.managedAttemptsMode);
}
