import type Docker from 'dockerode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@intexuraos/common-core';
import type { WorkerRuntime } from '../runtime/types.js';
import type { WorkerConfig, WorkerHandle, WorkerType } from './types.js';
import { WORKER_TYPES } from './types.js';
import type { DockerContainer } from './docker-container.js';
import type { DockerVolume } from './docker-volume.js';
import type { DockerNetwork } from './docker-network.js';
import type { DockerRegistry } from './docker-registry.js';
import { getHostUserInfo } from './docker-volume.js';

const LIFECYCLE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FORENSICS_SECCOMP_PROFILE_FILENAME = 'code-worker-forensics-seccomp.json';

export interface WorkerEntry {
  containerId: string;
  handle: WorkerHandle;
  runtime: WorkerRuntime;
  taskSecretsPath: string;
  taskRuntimeHomePath: string;
  attemptRunning: boolean;
  attemptLogBuffer: string;
  taskForensicsPath?: string;
  logStream?: NodeJS.ReadableStream;
}

export interface PreservedWorkerEntry {
  containerId: string;
  taskId: string;
  preservedAt: string;
}

export interface LifecycleProviderConfig {
  imageName: string;
  managedAttemptsMode: boolean;
  workerReadyTimeoutMs?: number;
  maxConcurrent: number;
  sharedCredsPath?: string;
  sharedCodexAuthPath?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  forensicsMode: boolean;
}

export interface BuildWorkerEnvInput {
  taskId: string;
  runtime: WorkerRuntime;
  workerType: WorkerType;
  config: WorkerConfig;
  providerConfig: LifecycleProviderConfig;
}

export interface BuildWorkerEnvResult {
  env: string[];
  useSharedCreds: boolean;
  useSharedCodexAuth: boolean;
  keySuffix: string;
}

export function buildWorkerEnv(input: BuildWorkerEnvInput): BuildWorkerEnvResult {
  const { taskId, runtime, workerType, config, providerConfig } = input;
  const workerTypeConfig = WORKER_TYPES[workerType];
  const apiKey =
    workerTypeConfig.apiKeyEnvVar === undefined
      ? ''
      : config.secrets[workerTypeConfig.apiKeyEnvVar];

  const useSharedCreds =
    runtime === 'claude' &&
    providerConfig.sharedCredsPath !== undefined &&
    workerTypeConfig.apiKeyEnvVar === 'ANTHROPIC_API_KEY';
  const useSharedCodexAuth =
    runtime === 'codex' && providerConfig.sharedCodexAuthPath !== undefined;
  const requiredApiKeyEnvVar = workerTypeConfig.apiKeyEnvVar;

  if (runtime === 'claude') {
    if (requiredApiKeyEnvVar === undefined) {
      throw new Error(`Worker type '${workerType}' is missing API key configuration`);
    }
    if (apiKey === '') {
      throw new Error(
        `Worker type '${workerType}' requires ${requiredApiKeyEnvVar} but it is not configured`
      );
    }
  }

  if (runtime === 'codex' && !useSharedCodexAuth) {
    throw new Error('Codex runtime requires sharedCodexAuthPath but it is not configured');
  }

  const env = [
    `TASK_ID=${taskId}`,
    `LINEAR_API_KEY=${config.secrets.LINEAR_API_KEY}`,
    `SENTRY_AUTH_TOKEN=${config.secrets.SENTRY_AUTH_TOKEN}`,
    `GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json`,
    `WORKER_RUNTIME=${runtime}`,
    'CODE_WORKER_MODE=1',
    `WORKER_MANAGED_MODE=${providerConfig.managedAttemptsMode ? '1' : '0'}`,
    `WORKER_CONTINUE=${config.continueSession === true ? '1' : '0'}`,
  ];

  if (runtime === 'claude') {
    env.push('CLAUDE_PROJECT_DIR=/repo');
    if (!useSharedCreds) {
      env.push(`ANTHROPIC_API_KEY=${apiKey}`, `ANTHROPIC_BASE_URL=${workerTypeConfig.apiBaseUrl}`);
    }
    if (workerTypeConfig.model !== undefined) {
      env.push(`ANTHROPIC_MODEL=${workerTypeConfig.model}`);
    }
    if (workerTypeConfig.effort !== undefined) {
      env.push(`CLAUDE_CODE_EFFORT_LEVEL=${workerTypeConfig.effort}`);
    }
    if (workerTypeConfig.disableExperimentalBetas === true) {
      env.push('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1');
    }
  } else {
    env.push('CODEX_HOME=/home/claude/.codex');
    env.push('CODEX_SQLITE_HOME=/home/claude/.codex');
    if (workerTypeConfig.effort !== undefined) {
      env.push(`CODEX_REASONING_EFFORT=${workerTypeConfig.effort}`);
    }
  }

  if (providerConfig.gitUserName !== undefined) {
    env.push(`GIT_USER_NAME=${providerConfig.gitUserName}`);
  }
  if (providerConfig.gitUserEmail !== undefined) {
    env.push(`GIT_USER_EMAIL=${providerConfig.gitUserEmail}`);
  }
  if (providerConfig.forensicsMode) {
    env.push('WORKER_FORENSICS=1');
    env.push('WORKER_FORENSICS_DIR=/var/crash');
  }

  const keySuffix =
    runtime === 'codex'
      ? 'shared-auth (auth.json)'
      : useSharedCreds
        ? 'shared-creds (.credentials.json)'
        : apiKey.length > 4
          ? '...' + apiKey.slice(-4)
          : '****';

  return { env, useSharedCreds, useSharedCodexAuth, keySuffix };
}

export function resolveForensicsSeccompProfilePath(logger: Logger): string | null {
  const candidates = [
    path.resolve(LIFECYCLE_DIR, '../../../seccomp', FORENSICS_SECCOMP_PROFILE_FILENAME),
    path.resolve(process.cwd(), 'workers/orchestrator/seccomp', FORENSICS_SECCOMP_PROFILE_FILENAME),
    path.resolve(process.cwd(), 'seccomp', FORENSICS_SECCOMP_PROFILE_FILENAME),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  logger.warn(
    { candidates },
    'Forensics seccomp profile not found; ptrace tools may fail under default seccomp'
  );
  return null;
}

export function resolveForensicsSeccompSecurityOpt(logger: Logger): string | null {
  const profilePath = resolveForensicsSeccompProfilePath(logger);
  if (profilePath === null) {
    return null;
  }
  try {
    const profileJson: unknown = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    return `seccomp=${JSON.stringify(profileJson)}`;
  } catch (error) {
    logger.warn(
      { profilePath, error },
      'Forensics seccomp profile is invalid; using Docker default seccomp'
    );
    return null;
  }
}

export function detectMainGitDir(worktreePath: string): string | null {
  const gitPath = path.join(worktreePath, '.git');
  if (!fs.existsSync(gitPath)) {
    throw new Error(`Invalid worktree: ${worktreePath} (no .git directory)`);
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
}

export async function attachToExistingContainer(input: AttachExistingInput): Promise<WorkerHandle> {
  const { taskId, runtime, config, containerId, volume, workers } = input;
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

  workers.set(taskId, {
    containerId,
    handle,
    runtime,
    taskSecretsPath,
    taskRuntimeHomePath,
    attemptRunning: false,
    attemptLogBuffer: '',
    ...(taskForensicsPath !== null ? { taskForensicsPath } : {}),
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
  volume: DockerVolume;
  network: DockerNetwork;
  logger: Logger;
}

export interface CreateContainerSpecResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spec: any;
  useSharedCreds: boolean;
  useSharedCodexAuth: boolean;
  keySuffix: string;
}

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

  const pnpmStorePath = volume.getPnpmStorePath();
  fs.mkdirSync(pnpmStorePath, { recursive: true });
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

  const spec = {
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

interface RemoveDetachedInput {
  taskId: string;
  containerId: string;
  state: string;
  docker: Docker;
  container: DockerContainer;
  volume: DockerVolume;
  preservedWorkers: Map<string, PreservedWorkerEntry>;
  logger: Logger;
}

async function removeDetachedContainer(input: RemoveDetachedInput): Promise<void> {
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
      throw new Error(`Worker already exists for task ${taskId}`);
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
    throw new Error(`Max concurrent workers (${String(providerConfig.maxConcurrent)}) reached`);
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

    const { spec, keySuffix } = buildCreateContainerSpec({
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
      volume,
      network,
      logger,
    });

    logger.info(
      {},
      `Creating worker container: taskId=${taskId} workerType=${workerType} runtime=${runtime} image=${resolvedImage} apiKey=${keySuffix} baseUrl=${WORKER_TYPES[workerType].apiBaseUrl} worktreePath=${worktreePath}`
    );

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

    workers.set(taskId, {
      containerId: dockerContainer.id,
      handle,
      runtime,
      taskSecretsPath,
      taskRuntimeHomePath,
      attemptRunning: false,
      attemptLogBuffer: '',
      ...(taskForensicsPath !== null ? { taskForensicsPath } : {}),
      ...(logStream !== undefined ? { logStream } : {}),
    });

    if (providerConfig.managedAttemptsMode) {
      runAttempt(taskId, config);
    } else {
      dockerContainer
        .wait()
        .then(async (data) => {
          const worker = workers.get(taskId);
          /* v8 ignore start -- ts-type: Map.get() null check after container lifecycle @preserve */
          if (worker !== undefined) {
            worker.handle.status = data.StatusCode === 0 ? 'completed' : 'failed';
          }
          /* v8 ignore stop @preserve */
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
