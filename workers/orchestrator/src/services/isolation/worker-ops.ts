import type Docker from 'dockerode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Logger } from '@intexuraos/common-core';
import type { ContainerStatsSnapshot, ResourceUsage } from './types.js';
import type { WorkerEntry } from './worker-lifecycle.js';

export async function getWorkerLogs(
  taskId: string,
  worker: WorkerEntry | undefined,
  docker: Docker,
  logger: Logger
): Promise<string> {
  if (worker === undefined) return '';
  try {
    const logs = await docker
      .getContainer(worker.containerId)
      .logs({ stdout: true, stderr: true, timestamps: true });
    const containerLogs = logs.toString('utf-8');
    return worker.attemptLogBuffer === ''
      ? containerLogs
      : `${containerLogs}\n${worker.attemptLogBuffer}`;
  } catch (error) {
    logger.warn({ taskId, error }, 'Failed to retrieve container logs');
    return worker.attemptLogBuffer;
  }
}

export async function streamLogs(
  taskId: string,
  worker: WorkerEntry | undefined,
  docker: Docker,
  onChunk: (chunk: string) => void
): Promise<void> {
  if (worker === undefined) throw new Error(`Worker ${taskId} not found`);
  const logStream = await docker
    .getContainer(worker.containerId)
    .logs({ follow: true, stdout: true, stderr: true, timestamps: true });
  logStream.on('data', (chunk: Buffer) => {
    onChunk(chunk.toString('utf-8'));
  });
}

export async function waitForCompletion(
  taskId: string,
  worker: WorkerEntry | undefined,
  docker: Docker,
  timeoutMs: number,
  logger: Logger,
  destroyWorker: (taskId: string, forceKill: boolean) => Promise<void>
): Promise<number> {
  if (worker === undefined) return -1;
  const container = docker.getContainer(worker.containerId);
  return await new Promise((resolve) => {
    let timeoutFired = false;
    const timeout = setTimeout(() => {
      timeoutFired = true;
      logger.warn({ taskId }, 'Worker timeout, force killing');
      worker.handle.status = 'timeout';
      resolve(-1);
      void destroyWorker(taskId, true).catch((err: unknown) => {
        logger.error({ taskId, error: err }, 'Failed to destroy timed-out worker');
      });
    }, timeoutMs);

    container
      .wait()
      .then((data) => {
        clearTimeout(timeout);
        if (!timeoutFired) resolve(data.StatusCode);
      })
      .catch((err: unknown) => {
        clearTimeout(timeout);
        if (!timeoutFired) {
          logger.error({ taskId, error: err }, 'Wait error');
          resolve(-1);
        }
      });
  });
}

export async function getResourceUsage(
  taskId: string,
  worker: WorkerEntry | undefined,
  docker: Docker
): Promise<ResourceUsage> {
  if (worker === undefined) throw new Error(`Worker ${taskId} not found`);
  const stats = await docker.getContainer(worker.containerId).stats({ stream: false });
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuPercent =
    systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;
  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryUsedMB: Math.round(stats.memory_stats.usage / 1024 / 1024),
    memoryLimitMB: Math.round(stats.memory_stats.limit / 1024 / 1024),
  };
}

export async function copyOut(
  taskId: string,
  worker: WorkerEntry | undefined,
  docker: Docker,
  srcPath: string,
  destPath: string
): Promise<void> {
  /* v8 ignore start -- ts-type: Map.get() returns T | undefined; unit test cannot reach this branch because copyOut is only invoked from handleInactivityRestart where the worker !== undefined invariant always holds @preserve */
  if (worker === undefined) throw new Error(`Worker ${taskId} not found`);
  /* v8 ignore stop @preserve */
  const container = docker.getContainer(worker.containerId);
  const [tarStream] = await Promise.all([
    container.getArchive({ path: srcPath }),
    fs.promises.mkdir(destPath, { recursive: true }),
  ]);
  const tarPath = path.join(destPath, `${path.basename(srcPath)}.tar`);
  await pipeline(tarStream, fs.createWriteStream(tarPath));
}

export interface DestroyWorkerInput {
  taskId: string;
  forceKill: boolean;
  worker: WorkerEntry | undefined;
  workers: Map<string, WorkerEntry>;
  docker: Docker;
  container: {
    isAlreadyStoppedError(err: unknown): boolean;
  };
  volume: { removeTaskSecretsDirectory(taskId: string): Promise<void> };
  keepContainersAlive: boolean;
  logger: Logger;
}

export async function destroyWorker(input: DestroyWorkerInput): Promise<void> {
  const {
    taskId,
    forceKill,
    worker,
    workers,
    docker,
    container,
    volume,
    keepContainersAlive,
    logger,
  } = input;
  if (worker === undefined) {
    logger.warn({ taskId }, 'Worker not found for destroy');
    return;
  }
  logger.info({ taskId, forceKill }, 'Stopping worker container');
  if (worker.logStream !== undefined && 'destroy' in worker.logStream) {
    (worker.logStream as NodeJS.ReadableStream & { destroy(): void }).destroy();
  }
  try {
    const c = docker.getContainer(worker.containerId);
    try {
      if (forceKill) {
        await c.kill({ signal: 'SIGKILL' });
      } else {
        await c.stop({ t: 10 });
      }
    } catch (err: unknown) {
      if (container.isAlreadyStoppedError(err)) {
        logger.debug({ taskId }, 'Container already stopped');
      } else {
        logger.error({ taskId, error: err }, 'Failed to stop/kill container');
      }
    }
    if (!keepContainersAlive) {
      try {
        await c.remove({ force: true });
      } catch (err: unknown) {
        logger.error({ taskId, error: err }, 'Failed to remove container');
      }
    }
    await volume.removeTaskSecretsDirectory(taskId);
  } finally {
    workers.delete(taskId);
  }
  logger.info({ taskId }, 'Worker container stopped');
}

export interface IntervalController {
  start: (cb: () => void, intervalMs: number) => NodeJS.Timeout;
  stop: (id: NodeJS.Timeout) => void;
}

export function startPeriodicCleanup(
  keepContainersAlive: boolean,
  cleanupIntervalId: NodeJS.Timeout | null,
  intervalMs: number,
  maxAgeMs: number,
  logger: Logger,
  run: () => void
): NodeJS.Timeout | null {
  if (keepContainersAlive) {
    logger.info(
      { keepContainersAlive: true },
      'Periodic container cleanup disabled because keepContainersAlive is enabled'
    );
    return cleanupIntervalId;
  }
  if (cleanupIntervalId !== null) return cleanupIntervalId;
  logger.info({ intervalMs, maxAgeMs }, 'Starting periodic container cleanup');
  return setInterval(run, intervalMs);
}

export function stopPeriodicCleanup(
  cleanupIntervalId: NodeJS.Timeout | null,
  logger: Logger
): NodeJS.Timeout | null {
  if (cleanupIntervalId === null) return null;
  clearInterval(cleanupIntervalId);
  logger.info({ message: 'Stopped periodic container cleanup' });
  return null;
}

export async function preserveWorker(
  taskId: string,
  worker: WorkerEntry | undefined,
  workers: Map<string, WorkerEntry>,
  preservedWorkers: Map<string, { containerId: string; taskId: string; preservedAt: string }>,
  volume: { clearTaskSecretsContents(taskId: string): Promise<void> },
  logger: Logger
): Promise<boolean> {
  if (worker === undefined) {
    logger.warn(
      { taskId },
      'preserveWorker called for unknown worker — container may already be destroyed'
    );
    return false;
  }
  preservedWorkers.set(taskId, {
    containerId: worker.containerId,
    taskId,
    preservedAt: new Date().toISOString(),
  });
  workers.delete(taskId);
  await volume.clearTaskSecretsContents(taskId);
  logger.info({ taskId, containerId: worker.containerId }, 'Worker preserved for debugging');
  return true;
}

export async function statsSnapshot(
  worker: WorkerEntry | undefined,
  docker: Docker
): Promise<ContainerStatsSnapshot | null> {
  /* v8 ignore start -- ts-type: Map.get() returns T | undefined; unit test cannot reach this branch because statsSnapshot is only invoked from handleInactivityRestart where the worker !== undefined invariant always holds @preserve */
  if (worker === undefined) return null;
  /* v8 ignore stop @preserve */
  const stats = await docker.getContainer(worker.containerId).stats({ stream: false });
  return {
    cpuTotalUsage: stats.cpu_stats.cpu_usage.total_usage,
    memoryUsage: stats.memory_stats.usage,
    /* v8 ignore start -- ts-type: nullish coalescing on optional dockerode field required by strict TS @preserve */
    pidsCurrent: stats.pids_stats?.current ?? 0,
    /* v8 ignore stop @preserve */
  };
}
