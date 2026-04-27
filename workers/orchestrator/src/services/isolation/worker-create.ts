import type Docker from 'dockerode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IntexuraOSError, type Logger } from '@intexuraos/common-core';
import type { WorkerRuntime } from '../runtime/types.js';
import type { WorkerConfig, WorkerHandle, WorkerType } from './types.js';
import { WORKER_TYPES } from './types.js';
import type { DockerContainer } from './docker-container.js';
import type { DockerVolume } from './docker-volume.js';
import type { DockerNetwork } from './docker-network.js';
import type { DockerRegistry } from './docker-registry.js';
import { getHostUserInfo } from './docker-volume.js';
import type {
  WorkerEntry,
  PreservedWorkerEntry,
  LifecycleProviderConfig,
} from './worker-entry-types.js';
import { buildWorkerEnv, resolveForensicsSeccompSecurityOpt } from './worker-env.js';
import { auditLockfile, snapshotLockfile } from './lockfile-guard.js';

export function detectMainGitDir(worktreePath: string): string | null {
  const gitPath = path.join(worktreePath, '.git');
  if (!fs.existsSync(gitPath)) {
    throw new IntexuraOSError(
      'INVALID_REQUEST',
      `Invalid worktree: ${worktreePath} (no .git directory)`
    );
  }
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
  return mainGitDir;
}

export interface RunAttemptInput {
  taskId: string;
  config: WorkerConfig;
  workers: Map<string, WorkerEntry>;
  docker: Docker;
  container: DockerContainer;
  logger: Logger;
}

export async function runAttemptInContainer(input: RunAttemptInput): Promise<void> {
  const { taskId, config, workers, docker, container, logger } = input;
  const worker = workers.get(taskId);
  if (worker === undefined) {
    logger.error({ taskId }, 'Cannot start attempt: worker not found');
    config.onComplete?.(1);
    return;
  }

  if (worker.attemptRunning) {
    logger.error({ taskId }, 'Cannot start attempt: previous attempt still running');
    config.onComplete?.(1);
    return;
  }

  worker.attemptRunning = true;

  try {
    const dockerContainer = docker.getContainer(worker.containerId);
    const attemptId = Date.now();
    const attemptDirName = `attempt-${String(attemptId)}`;
    const hostAttemptForensicsPath =
      worker.taskForensicsPath !== undefined
        ? path.join(worker.taskForensicsPath, attemptDirName)
        : undefined;
    const containerAttemptForensicsPath =
      hostAttemptForensicsPath !== undefined ? `/var/crash/${attemptDirName}` : undefined;
    const persistentAttemptLogPath =
      hostAttemptForensicsPath !== undefined
        ? path.join(hostAttemptForensicsPath, 'exec-stream.log')
        : undefined;

    if (hostAttemptForensicsPath !== undefined) {
      await fs.promises.mkdir(hostAttemptForensicsPath, { recursive: true });
      await fs.promises.writeFile(
        path.join(hostAttemptForensicsPath, 'attempt-start.json'),
        JSON.stringify(
          {
            taskId,
            startedAt: new Date().toISOString(),
            continueSession: config.continueSession === true,
            containerId: worker.containerId,
          },
          null,
          2
        ),
        'utf-8'
      );
    }

    const execInstance = await dockerContainer.exec({
      Cmd: ['/entrypoint.sh', 'run-attempt'],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: '/',
      User: getHostUserInfo().userString,
      Env: [
        `WORKER_CONTINUE=${config.continueSession === true ? '1' : '0'}`,
        `WORKER_RUNTIME=${worker.runtime}`,
        ...(worker.runtime === 'codex' && config.runtimeSessionId !== undefined
          ? [`CODEX_THREAD_ID=${config.runtimeSessionId}`]
          : []),
        ...(worker.runtime === 'claude' &&
        config.continueSession === true &&
        config.runtimeSessionId !== undefined
          ? [`CLAUDE_SESSION_ID=${config.runtimeSessionId}`]
          : []),
      ],
    });

    const execStream = await execInstance.start({ hijack: false, stdin: false });
    execStream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      worker.attemptLogBuffer += text;
      if (persistentAttemptLogPath !== undefined) {
        try {
          fs.appendFileSync(persistentAttemptLogPath, text, 'utf-8');
        } catch (error) {
          logger.warn({ taskId, error }, 'Failed to persist attempt exec stream chunk');
        }
      }
      config.onLog?.(text);
    });

    const exitCode = await container.waitForExecCompletion(taskId, execInstance, execStream);
    if (hostAttemptForensicsPath !== undefined) {
      await fs.promises.writeFile(
        path.join(hostAttemptForensicsPath, 'exec-exit-code.txt'),
        String(exitCode),
        'utf-8'
      );
    }
    if (
      exitCode === 139 &&
      hostAttemptForensicsPath !== undefined &&
      containerAttemptForensicsPath !== undefined
    ) {
      await container.captureSegfaultForensics(
        taskId,
        dockerContainer,
        execInstance,
        hostAttemptForensicsPath,
        containerAttemptForensicsPath,
        getHostUserInfo().userString
      );
    }
    worker.handle.status = exitCode === 0 ? 'completed' : 'failed';
    config.onComplete?.(exitCode);
  } catch (error) {
    logger.error({ taskId, error }, 'Failed to execute Claude attempt');
    worker.handle.status = 'failed';
    config.onComplete?.(1);
  } finally {
    // INT-1524: detect LLM-tampered lockfile during the attempt.
    if (worker.worktreePath !== undefined && worker.lockfileSha256 !== undefined) {
      const currentSha = snapshotLockfile(worker.worktreePath);
      if (currentSha !== null && currentSha !== worker.lockfileSha256) {
        logger.warn(
          {
            event: 'lockfile-drift',
            taskId,
            before: worker.lockfileSha256,
            after: currentSha,
          },
          'pnpm-lock.yaml changed during attempt — review before merging'
        );
        if (worker.taskForensicsPath !== undefined) {
          try {
            await fs.promises.writeFile(
              path.join(worker.taskForensicsPath, 'lockfile-drift.txt'),
              `before=${worker.lockfileSha256}\nafter=${currentSha}\n`,
              'utf-8'
            );
          } catch {
            // best-effort; never throw from teardown
          }
        }
      }
    }
    worker.attemptRunning = false;
  }
}

export interface AttachExistingInput {
  taskId: string;
  runtime: WorkerRuntime;
  config: WorkerConfig;
  containerId: string;
  volume: DockerVolume;
  workers: Map<string, WorkerEntry>;
  logger: Logger;
}

export async function attachToExistingContainer(input: AttachExistingInput): Promise<WorkerHandle> {
  const { taskId, runtime, config, containerId, volume, workers, logger } = input;
  const taskSecretsPath = volume.getTaskSecretsPath(taskId);
  const taskRuntimeHomePath = volume.getTaskRuntimeHomePath(taskId, runtime);

  volume.assertResumeRuntimeStateAvailable(runtime, true, taskRuntimeHomePath);
  await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });
  await fs.promises.mkdir(taskRuntimeHomePath, { recursive: true, mode: 0o700 });
  await volume.writePromptFiles(taskSecretsPath, config.systemPrompt, config.prompt);

  if (config.gcpSaKeyPath && fs.existsSync(config.gcpSaKeyPath)) {
    await fs.promises.copyFile(config.gcpSaKeyPath, path.join(taskSecretsPath, 'gcp-sa.json'));
  }

  const handle: WorkerHandle = {
    taskId,
    containerId,
    status: 'running',
    startedAt: new Date(),
  };
  const taskForensicsPath = volume.ensureTaskForensicsPath(taskId);
  // INT-1524: snapshot pnpm-lock.yaml so resumed workers also get drift detection.
  const lockfileSha256 = snapshotLockfile(config.worktreePath);
  // INT-1524: warn-level integrity audit — non-fatal; see auditLockfile docs.
  auditLockfile(config.worktreePath, taskId, logger);

  workers.set(taskId, {
    containerId,
    handle,
    runtime,
    taskSecretsPath,
    taskRuntimeHomePath,
    attemptRunning: false,
    attemptLogBuffer: '',
    worktreePath: config.worktreePath,
    ...(taskForensicsPath !== null ? { taskForensicsPath } : {}),
    ...(lockfileSha256 !== null ? { lockfileSha256 } : {}),
  });

  return handle;
}

export interface CreateContainerSpecInput {
  taskId: string;
  runtime: WorkerRuntime;
  worktreePath: string;
  workerType: WorkerType;
  config: WorkerConfig;
  providerConfig: LifecycleProviderConfig;
  taskSecretsPath: string;
  taskRuntimeHomePath: string;
  taskForensicsPath: string | null;
  mainGitDir: string | null;
  resolvedImage: string;
  pnpmStorePath: string;
  volume: DockerVolume;
  network: DockerNetwork;
  logger: Logger;
}

export interface CreateContainerSpecResult {
  spec: Docker.ContainerCreateOptions;
  useSharedCreds: boolean;
  useSharedCodexAuth: boolean;
  keySuffix: string;
}

/**
 * Pure function: builds the Docker container spec for a worker. Callers are
 * responsible for creating any host-side directories (e.g. the pnpm store)
 * referenced in the returned binds before invoking docker.createContainer —
 * this keeps side effects explicit and preserves log ordering (see
 * createWorkerOrchestration).
 */
export function buildCreateContainerSpec(
  input: CreateContainerSpecInput
): CreateContainerSpecResult {
  const {
    taskId,
    runtime,
    workerType,
    config,
    providerConfig,
    taskSecretsPath,
    taskRuntimeHomePath,
    taskForensicsPath,
    mainGitDir,
    resolvedImage,
    pnpmStorePath,
    worktreePath,
    volume,
    network,
    logger,
  } = input;

  const { env, useSharedCreds, useSharedCodexAuth, keySuffix } = buildWorkerEnv({
    taskId,
    runtime,
    workerType,
    config,
    providerConfig,
  });

  const capAdd = providerConfig.forensicsMode ? ['NET_RAW', 'SYS_PTRACE'] : ['NET_RAW'];
  const forensicsSeccompSecurityOpt = providerConfig.forensicsMode
    ? resolveForensicsSeccompSecurityOpt(logger)
    : null;
  const securityOpt = providerConfig.forensicsMode
    ? [
        'no-new-privileges',
        ...(forensicsSeccompSecurityOpt !== null ? [forensicsSeccompSecurityOpt] : []),
      ]
    : ['no-new-privileges'];
  const ulimits = providerConfig.forensicsMode ? [{ Name: 'core', Soft: -1, Hard: -1 }] : undefined;

  const binds = volume.buildBinds({
    worktreePath,
    taskSecretsPath,
    pnpmStorePath,
    taskRuntimeHomePath,
    containerRuntimeHome: volume.getContainerRuntimeHome(runtime),
    mainGitDir,
    useSharedCreds,
    useSharedCodexAuth,
    taskForensicsPath,
  });

  const spec: Docker.ContainerCreateOptions = {
    Image: resolvedImage,
    name: `code-worker-${taskId}`,
    Env: env,
    WorkingDir: '/repo',
    User: getHostUserInfo().userString,
    Tty: false,
    HostConfig: {
      Binds: binds,
      NetworkMode: network.getNetworkMode(),
      ReadonlyRootfs: false,
      Tmpfs: volume.buildTmpfs(),
      CapDrop: ['ALL'],
      CapAdd: capAdd,
      SecurityOpt: securityOpt,
      ...(ulimits !== undefined ? { Ulimits: ulimits } : {}),
      AutoRemove: false,
    },
  };

  return { spec, useSharedCreds, useSharedCodexAuth, keySuffix };
}

export interface ResumeInput {
  taskId: string;
  runtime: WorkerRuntime;
  config: WorkerConfig;
  docker: Docker;
  container: DockerContainer;
  volume: DockerVolume;
  workers: Map<string, WorkerEntry>;
  preservedWorkers: Map<string, PreservedWorkerEntry>;
  logger: Logger;
  runAttempt: (taskId: string, config: WorkerConfig) => void;
}

export async function resumeFromPreserved(input: ResumeInput): Promise<WorkerHandle | null> {
  const {
    taskId,
    runtime,
    config,
    docker,
    container,
    volume,
    workers,
    preservedWorkers,
    logger,
    runAttempt,
  } = input;
  const preserved = preservedWorkers.get(taskId);
  if (preserved === undefined) return null;

  if (await container.isContainerRunning(preserved.containerId)) {
    preservedWorkers.delete(taskId);
    const handle = await attachToExistingContainer({
      taskId,
      runtime,
      config,
      containerId: preserved.containerId,
      volume,
      workers,
      logger,
    });
    logger.info(
      { taskId, containerId: preserved.containerId },
      'Restored preserved container for resume'
    );
    runAttempt(taskId, config);
    return handle;
  }

  preservedWorkers.delete(taskId);
  try {
    await docker.getContainer(preserved.containerId).remove({ force: true });
  } catch {
    // Best-effort removal
  }
  logger.warn(
    { taskId, containerId: preserved.containerId },
    'Preserved container is stopped or gone, falling through to new container creation'
  );
  return null;
}

export async function resumeFromOrphan(input: ResumeInput): Promise<WorkerHandle | null> {
  const { taskId, runtime, config, docker, volume, workers, logger, runAttempt } = input;
  try {
    const orphanContainer = docker.getContainer(`code-worker-${taskId}`);
    const orphanInfo = await orphanContainer.inspect();

    if (orphanInfo.State.Running) {
      const handle = await attachToExistingContainer({
        taskId,
        runtime,
        config,
        containerId: orphanInfo.Id,
        volume,
        workers,
        logger,
      });
      logger.info(
        { taskId, containerId: orphanInfo.Id },
        'Reusing orphaned container for resume after restart'
      );
      runAttempt(taskId, config);
      return handle;
    }

    logger.info({ taskId }, 'Removing stopped orphan container');
    await orphanContainer.remove({ force: true });
  } catch {
    // Container doesn't exist
  }
  return null;
}

export interface CreateWorkerOrchInput {
  config: WorkerConfig;
  providerConfig: LifecycleProviderConfig;
  docker: Docker;
  container: DockerContainer;
  volume: DockerVolume;
  network: DockerNetwork;
  registry: DockerRegistry;
  workers: Map<string, WorkerEntry>;
  preservedWorkers: Map<string, PreservedWorkerEntry>;
  logger: Logger;
  resolveRuntime: () => WorkerRuntime;
  runAttempt: (taskId: string, config: WorkerConfig) => void;
}

export async function createWorkerOrchestration(
  input: CreateWorkerOrchInput
): Promise<WorkerHandle> {
  const {
    config,
    providerConfig,
    docker,
    container,
    volume,
    network,
    registry,
    workers,
    preservedWorkers,
    logger,
    resolveRuntime,
    runAttempt,
  } = input;
  const { taskId, worktreePath, systemPrompt, prompt, workerType } = config;
  const runtime = resolveRuntime();

  const existingWorker = workers.get(taskId);
  if (existingWorker !== undefined) {
    if (config.continueSession !== true) {
      throw new IntexuraOSError('CONFLICT', `Worker already exists for task ${taskId}`);
    }
    await volume.writePromptFiles(existingWorker.taskSecretsPath, systemPrompt, prompt);
    volume.ensureTaskForensicsPath(taskId);
    runAttempt(taskId, config);
    return existingWorker.handle;
  }

  if (config.continueSession === true) {
    const resumeInput: ResumeInput = {
      taskId,
      runtime,
      config,
      docker,
      container,
      volume,
      workers,
      preservedWorkers,
      logger,
      runAttempt,
    };
    const preservedHandle = await resumeFromPreserved(resumeInput);
    if (preservedHandle !== null) return preservedHandle;
    const orphanHandle = await resumeFromOrphan(resumeInput);
    if (orphanHandle !== null) return orphanHandle;
  }

  if (workers.size >= providerConfig.maxConcurrent) {
    throw new IntexuraOSError(
      'QUEUE_FULL',
      `Max concurrent workers (${String(providerConfig.maxConcurrent)}) reached`
    );
  }

  const mainGitDir = detectMainGitDir(worktreePath);

  const taskSecretsPath = volume.getTaskSecretsPath(taskId);
  const taskRuntimeHomePath = volume.getTaskRuntimeHomePath(taskId, runtime);
  volume.assertResumeRuntimeStateAvailable(
    runtime,
    config.continueSession === true,
    taskRuntimeHomePath
  );
  await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });
  await fs.promises.mkdir(taskRuntimeHomePath, { recursive: true, mode: 0o700 });
  await volume.writePromptFiles(taskSecretsPath, systemPrompt, prompt);

  let dockerContainer: Docker.Container | undefined;
  try {
    if (config.gcpSaKeyPath && fs.existsSync(config.gcpSaKeyPath)) {
      await fs.promises.copyFile(config.gcpSaKeyPath, path.join(taskSecretsPath, 'gcp-sa.json'));
    }

    const taskForensicsPath = volume.ensureTaskForensicsPath(taskId);
    const requestedImage = providerConfig.imageName;
    const resolvedImage =
      config.resolvedImage ?? (await registry.pullAndResolveImage(taskId, requestedImage));
    logger.info({ taskId }, 'Container creation started');

    // Precompute the env so we know the keySuffix for the log line below.
    const { keySuffix } = buildWorkerEnv({
      taskId,
      runtime,
      workerType,
      config,
      providerConfig,
    });

    logger.info(
      {},
      `Creating worker container: taskId=${taskId} workerType=${workerType} runtime=${runtime} image=${resolvedImage} apiKey=${keySuffix} baseUrl=${WORKER_TYPES[workerType].apiBaseUrl} worktreePath=${worktreePath}`
    );

    // Create any host-side directories referenced by the container spec
    // AFTER the "Creating worker container" log to preserve historical
    // ordering: log → mkdir → spec → createContainer.
    const pnpmStorePath = volume.getPnpmStorePath();
    fs.mkdirSync(pnpmStorePath, { recursive: true });

    const { spec } = buildCreateContainerSpec({
      taskId,
      runtime,
      worktreePath,
      workerType,
      config,
      providerConfig,
      taskSecretsPath,
      taskRuntimeHomePath,
      taskForensicsPath,
      mainGitDir,
      resolvedImage,
      pnpmStorePath,
      volume,
      network,
      logger,
    });

    dockerContainer = await container.createContainer(spec);
    await container.startContainer(dockerContainer);
    logger.info({ taskId, containerId: dockerContainer.id }, 'Container creation finished');

    if (providerConfig.managedAttemptsMode) {
      await container.assertManagedEntrypointSupport(
        taskId,
        dockerContainer,
        getHostUserInfo().userString
      );
      await container.waitForWorkerReady(
        taskId,
        dockerContainer,
        providerConfig.workerReadyTimeoutMs ?? 600_000
      );
    }

    let logStream: NodeJS.ReadableStream | undefined;
    if (config.onLog !== undefined && !providerConfig.managedAttemptsMode) {
      logStream = await dockerContainer.logs({ follow: true, stdout: true, stderr: true });
      logStream.on('data', (chunk: Buffer) => {
        config.onLog?.(chunk.toString('utf-8'));
      });
    }

    const handle: WorkerHandle = {
      taskId,
      containerId: dockerContainer.id,
      status: 'running',
      startedAt: new Date(),
    };

    const lockfileSha256 = snapshotLockfile(worktreePath);
    // INT-1524: warn-level integrity audit — non-fatal by design; see auditLockfile docs.
    auditLockfile(worktreePath, taskId, logger);
    workers.set(taskId, {
      containerId: dockerContainer.id,
      handle,
      runtime,
      taskSecretsPath,
      taskRuntimeHomePath,
      attemptRunning: false,
      attemptLogBuffer: '',
      worktreePath,
      ...(taskForensicsPath !== null ? { taskForensicsPath } : {}),
      ...(logStream !== undefined ? { logStream } : {}),
      ...(lockfileSha256 !== null ? { lockfileSha256 } : {}),
    });

    if (providerConfig.managedAttemptsMode) {
      runAttempt(taskId, config);
    } else {
      dockerContainer
        .wait()
        .then((data) => {
          // Re-lookup the worker: if it was destroyed (removed from `workers`) or
          // preserved before `wait()` resolved, the handle may have been updated
          // to a terminal status like 'timeout' and must not be overwritten here.
          const worker = workers.get(taskId);
          if (worker !== undefined) {
            worker.handle.status = data.StatusCode === 0 ? 'completed' : 'failed';
          }
          config.onComplete?.(data.StatusCode);
        })
        .catch((err: unknown) => {
          logger.error({ taskId, error: err }, 'Container wait error');
        });
    }

    logger.info({}, `Worker container started: taskId=${taskId} containerId=${dockerContainer.id}`);
    return handle;
  } catch (error) {
    await fs.promises.rm(taskSecretsPath, { recursive: true, force: true }).catch((e: unknown) => {
      logger.warn({ taskId, error: e }, 'Cleanup: failed to remove task secrets');
    });
    await fs.promises
      .rm(taskRuntimeHomePath, { recursive: true, force: true })
      .catch((e: unknown) => {
        logger.warn({ taskId, error: e }, 'Cleanup: failed to remove task session');
      });
    if (dockerContainer !== undefined) {
      await dockerContainer.remove({ force: true }).catch((e: unknown) => {
        logger.warn({ taskId, error: e }, 'Cleanup: failed to remove container');
      });
    }
    throw error;
  }
}
