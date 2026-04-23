import type Docker from 'dockerode';
import * as fs from 'node:fs';
import type { Logger } from '@intexuraos/common-core';
import type { DockerContainer } from './docker-container.js';
import type { DockerVolume } from './docker-volume.js';
import type { WorkerEntry, PreservedWorkerEntry } from './worker-entry-types.js';

export interface RunCleanupCycleInput {
  docker: Docker;
  container: DockerContainer;
  volume: DockerVolume;
  workers: Map<string, WorkerEntry>;
  preservedWorkers: Map<string, PreservedWorkerEntry>;
  keepContainersAlive: boolean;
  preservedMaxAgeMs: number;
  logger: Logger;
}

export async function runCleanupCycle(input: RunCleanupCycleInput): Promise<void> {
  const {
    docker,
    container,
    volume,
    workers,
    preservedWorkers,
    keepContainersAlive,
    preservedMaxAgeMs,
    logger,
  } = input;
  if (keepContainersAlive) return;

  const now = Date.now();

  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { name: ['code-worker-'] },
    });

    const containerMap = new Map<
      string,
      { containerId: string; state: string; createdAtMs: number }
    >();

    for (const c of containers) {
      /* v8 ignore start -- ts-type: nullish coalescing on array access required by noUncheckedIndexedAccess @preserve */
      const taskId = container.extractTaskIdFromContainerName(c.Names[0] ?? '');
      /* v8 ignore stop @preserve */
      if (taskId === null) {
        logger.warn({ containerId: c.Id }, 'Container has no recognizable name, skipping');
        continue;
      }
      containerMap.set(taskId, {
        containerId: c.Id,
        state: c.State,
        createdAtMs: c.Created * 1000,
      });
    }

    for (const [taskId, preserved] of Array.from(preservedWorkers.entries())) {
      const preservedAtMs = Date.parse(preserved.preservedAt);
      const isStale = Number.isNaN(preservedAtMs) || now - preservedAtMs > preservedMaxAgeMs;
      if (!isStale) continue;

      const containerInfo = containerMap.get(taskId);
      preservedWorkers.delete(taskId);

      if (containerInfo === undefined) {
        await volume.removeTaskSecretsDirectory(taskId);
        logger.info(
          { taskId, containerId: preserved.containerId },
          'Removed stale preserved worker metadata'
        );
        continue;
      }
      await removeDetachedContainer({
        taskId,
        containerId: containerInfo.containerId,
        state: containerInfo.state,
        docker,
        container,
        volume,
        preservedWorkers,
        logger,
      });
      containerMap.delete(taskId);
    }

    for (const [taskId, containerInfo] of containerMap) {
      if (workers.has(taskId) || preservedWorkers.has(taskId)) continue;
      if (now - containerInfo.createdAtMs <= preservedMaxAgeMs) continue;
      await removeDetachedContainer({
        taskId,
        containerId: containerInfo.containerId,
        state: containerInfo.state,
        docker,
        container,
        volume,
        preservedWorkers,
        logger,
      });
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to clean up stale worker containers');
  }

  await volume.cleanupOrphanedRuntimeState(
    (taskId) => workers.has(taskId) || preservedWorkers.has(taskId)
  );
}

export interface RemoveDetachedInput {
  taskId: string;
  containerId: string;
  state: string;
  docker: Docker;
  container: DockerContainer;
  volume: DockerVolume;
  preservedWorkers: Map<string, PreservedWorkerEntry>;
  logger: Logger;
}

export async function removeDetachedContainer(input: RemoveDetachedInput): Promise<void> {
  const { taskId, containerId, state, docker, container, volume, preservedWorkers, logger } = input;
  const shouldStopFirst = ['running', 'created', 'paused', 'restarting'].includes(state);
  const c = docker.getContainer(containerId);
  if (shouldStopFirst) {
    try {
      await c.stop({ t: 5 });
    } catch (err: unknown) {
      if (!container.isAlreadyStoppedError(err)) {
        logger.warn({ taskId, containerId, error: err }, 'Failed to stop stale container');
      }
    }
  }
  try {
    await c.remove({ force: true });
  } catch (err: unknown) {
    logger.warn({ taskId, containerId, error: err }, 'Failed to remove stale container');
  }
  preservedWorkers.delete(taskId);
  await volume.removeTaskSecretsDirectory(taskId);
  logger.info({ taskId, containerId, state }, 'Removed stale worker container');
}

export interface HealthCheckInput {
  docker: Docker;
  dockerPingTimeoutMs: number;
  minDiskSpaceBytes: number;
  prevDockerHealthy: boolean;
  prevDiskHealthy: boolean;
  logger: Logger;
  pingWithTimeout: (p: Promise<unknown>, ms: number, msg: string) => Promise<unknown>;
}

export async function performHealthCheck(
  input: HealthCheckInput
): Promise<{ docker: boolean; disk: boolean }> {
  const {
    docker,
    dockerPingTimeoutMs,
    minDiskSpaceBytes,
    prevDockerHealthy,
    prevDiskHealthy,
    logger,
    pingWithTimeout,
  } = input;

  let dockerHealthy: boolean;
  let diskHealthy: boolean;

  try {
    await pingWithTimeout(docker.ping(), dockerPingTimeoutMs, 'Docker ping timeout');
    dockerHealthy = true;
  } catch {
    dockerHealthy = false;
  }

  try {
    const stats = await fs.promises.statfs('/');
    diskHealthy = stats.bavail * stats.bsize >= minDiskSpaceBytes;
  } catch {
    diskHealthy = false;
  }

  const minDiskSpaceGb = minDiskSpaceBytes / (1024 * 1024 * 1024);
  if (prevDockerHealthy && !dockerHealthy) {
    logger.warn(
      { component: 'health-monitor' },
      'Docker daemon became unhealthy — ping failed or timed out'
    );
  }
  if (!prevDockerHealthy && dockerHealthy) {
    logger.info({ component: 'health-monitor' }, 'Docker daemon is healthy again');
  }
  if (prevDiskHealthy && !diskHealthy) {
    logger.warn(
      { component: 'health-monitor' },
      `Disk space critically low — below ${String(minDiskSpaceGb)}GB available`
    );
  }
  if (!prevDiskHealthy && diskHealthy) {
    logger.info({ component: 'health-monitor' }, 'Disk space is healthy again');
  }

  return { docker: dockerHealthy, disk: diskHealthy };
}
