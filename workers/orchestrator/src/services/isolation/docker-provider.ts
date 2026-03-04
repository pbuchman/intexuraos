import Docker from 'dockerode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@intexuraos/common-core';
import type {
  DiscoveredContainer,
  IsolationProvider,
  WorkerConfig,
  WorkerHandle,
  ResourceUsage,
} from './types.js';

export interface DockerProviderConfig {
  imageName: string;
  imagePullPolicy: 'always' | 'if-not-present';
  networkName: string;
  maxConcurrent: number;
  timeoutMs: number;
  secretsBasePath: string;
  gcpSaKeyPath: string;
  keepContainersAlive: boolean;
  managedAttemptsMode: boolean;
  workerReadyTimeoutMs?: number;
  sharedCredsPath?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  forensicsMode: boolean;
  forensicsBasePath: string;
}

const DEFAULT_CONFIG: DockerProviderConfig = {
  imageName:
    'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest',
  imagePullPolicy: 'always',
  networkName: 'claude-worker-net',
  maxConcurrent: 4,
  timeoutMs: 2 * 60 * 60 * 1000,
  secretsBasePath: '/tmp/claude-secrets',
  gcpSaKeyPath: '',
  keepContainersAlive: false,
  managedAttemptsMode: true,
  forensicsMode: false,
  forensicsBasePath: '/tmp/claude-worker-forensics',
};

interface WorkerEntry {
  containerId: string;
  handle: WorkerHandle;
  taskSecretsPath: string;
  taskSessionPath: string;
  attemptRunning: boolean;
  attemptLogBuffer: string;
  taskForensicsPath?: string;
  logStream?: NodeJS.ReadableStream;
}

interface PreservedWorkerEntry {
  containerId: string;
  taskId: string;
  preservedAt: string;
}

export const PNPM_STORE_DIR_NAME = 'pnpm-store';
const CLAUDE_SESSION_DIR_PREFIX = 'claude-session';

// Container must run as the host user so bind-mounted files (worktrees, secrets,
// pnpm store) are accessible without permission hacks.
const HOST_UID = os.userInfo().uid;
const HOST_GID = os.userInfo().gid;
const HOST_USER_STRING = `${String(HOST_UID)}:${String(HOST_GID)}`;
const DOCKER_PROVIDER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FORENSICS_SECCOMP_PROFILE_FILENAME = 'claude-worker-forensics-seccomp.json';
const EXEC_INSPECT_POLL_INTERVAL_MS = 5_000;

export class DockerProvider implements IsolationProvider {
  private readonly docker: Docker;
  private readonly config: DockerProviderConfig;
  private readonly logger: Logger;
  private readonly workers: Map<string, WorkerEntry>;
  private readonly preservedWorkers = new Map<string, PreservedWorkerEntry>();
  private lastResolvedDigest: string | null = null;

  constructor(config: Partial<DockerProviderConfig>, logger: Logger) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.workers = new Map();
  }

  private getTaskForensicsPath(taskId: string): string | null {
    if (!this.config.forensicsMode) {
      return null;
    }
    return path.join(this.config.forensicsBasePath, taskId);
  }

  private ensureTaskForensicsPath(taskId: string): string | null {
    const taskForensicsPath = this.getTaskForensicsPath(taskId);
    if (taskForensicsPath === null) {
      return null;
    }
    fs.mkdirSync(taskForensicsPath, { recursive: true });
    return taskForensicsPath;
  }

  private resolveForensicsSeccompProfilePath(): string | null {
    const candidates = [
      path.resolve(DOCKER_PROVIDER_DIR, '../../../seccomp', FORENSICS_SECCOMP_PROFILE_FILENAME),
      path.resolve(
        process.cwd(),
        'workers/orchestrator/seccomp',
        FORENSICS_SECCOMP_PROFILE_FILENAME
      ),
      path.resolve(process.cwd(), 'seccomp', FORENSICS_SECCOMP_PROFILE_FILENAME),
    ];

    for (const candidate of candidates) {
      /* v8 ignore start -- test-infra: profile path resolution branches vary by cwd/runtime packaging @preserve */
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      /* v8 ignore stop @preserve */
    }

    this.logger.warn(
      { candidates },
      'Forensics seccomp profile not found; ptrace tools may fail under default seccomp'
    );
    return null;
  }

  private resolveForensicsSeccompSecurityOpt(): string | null {
    const profilePath = this.resolveForensicsSeccompProfilePath();
    /* v8 ignore start -- test-infra: profile may be absent in runtime packaging variants, fallback intentionally uses default seccomp @preserve */
    if (profilePath === null) {
      return null;
    }
    /* v8 ignore stop @preserve */

    try {
      const profileRaw = fs.readFileSync(profilePath, 'utf-8');
      const profileJson: unknown = JSON.parse(profileRaw);
      return `seccomp=${JSON.stringify(profileJson)}`;
      /* v8 ignore start -- test-infra: invalid/missing seccomp profile requires filesystem fault injection @preserve */
    } catch (error) {
      this.logger.warn(
        { profilePath, error },
        'Forensics seccomp profile is invalid; using Docker default seccomp'
      );
      return null;
    }
    /* v8 ignore stop @preserve */
  }

  private async writeJsonArtifact(filePath: string, value: unknown): Promise<void> {
    await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
  }

  private async runExecAndCapture(
    taskId: string,
    execInstance: Docker.Exec
  ): Promise<{ exitCode: number; output: string }> {
    const execStream = await execInstance.start({ hijack: false, stdin: false });
    let output = '';

    /* v8 ignore start -- test-infra: exec stream event ordering/close paths depend on Docker daemon stream behavior @preserve */
    await new Promise<void>((resolve, reject) => {
      execStream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf-8');
      });
      execStream.on('end', resolve);
      execStream.on('close', resolve);
      execStream.on('error', (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      execStream.resume();
    });
    /* v8 ignore stop @preserve */

    /* v8 ignore start -- test-infra: exec inspect ExitCode edge cases depend on Docker daemon responses @preserve */
    try {
      const info = await execInstance.inspect();
      return { exitCode: typeof info.ExitCode === 'number' ? info.ExitCode : 1, output };
    } catch (error) {
      this.logger.warn({ taskId, error }, 'Failed to inspect exec completion state');
      return { exitCode: 1, output };
    }
    /* v8 ignore stop @preserve */
  }

  private async captureSegfaultForensics(
    taskId: string,
    container: Docker.Container,
    execInstance: Docker.Exec,
    hostAttemptForensicsPath: string,
    containerAttemptForensicsPath: string
  ): Promise<void> {
    try {
      await fs.promises.mkdir(hostAttemptForensicsPath, { recursive: true });

      await this.writeJsonArtifact(
        path.join(hostAttemptForensicsPath, 'orchestrator-segfault.json'),
        {
          taskId,
          capturedAt: new Date().toISOString(),
          containerAttemptForensicsPath,
        }
      );

      /* v8 ignore start -- test-infra: exec inspect failure branches require Docker daemon error injection @preserve */
      try {
        const execInfo = await execInstance.inspect();
        await this.writeJsonArtifact(
          path.join(hostAttemptForensicsPath, 'exec-inspect.json'),
          execInfo
        );
      } catch (error) {
        await fs.promises.writeFile(
          path.join(hostAttemptForensicsPath, 'exec-inspect.error.txt'),
          error instanceof Error ? (error.stack ?? error.message) : String(error),
          'utf-8'
        );
      }
      /* v8 ignore stop @preserve */

      /* v8 ignore start -- test-infra: container inspect failure branches require Docker daemon error injection @preserve */
      try {
        const containerInfo = await container.inspect();
        await this.writeJsonArtifact(
          path.join(hostAttemptForensicsPath, 'container-inspect.json'),
          containerInfo
        );
      } catch (error) {
        await fs.promises.writeFile(
          path.join(hostAttemptForensicsPath, 'container-inspect.error.txt'),
          error instanceof Error ? (error.stack ?? error.message) : String(error),
          'utf-8'
        );
      }
      /* v8 ignore stop @preserve */

      const snapshotCommand = [
        'set -eu',
        `OUT=${JSON.stringify(containerAttemptForensicsPath)}`,
        'mkdir -p "$OUT/container-snapshot"',
        '{',
        '  echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
        `  echo "task_id=${taskId}"`,
        '  echo "uid=$(id -u 2>/dev/null || true)"',
        '  echo "gid=$(id -g 2>/dev/null || true)"',
        '  echo "uname=$(uname -a 2>/dev/null || true)"',
        '  echo "whoami=$(whoami 2>/dev/null || true)"',
        '  echo',
        '  echo "[ulimit]"',
        '  (ulimit -a 2>/dev/null || true)',
        '  echo',
        '  echo "[core settings]"',
        '  (cat /proc/sys/kernel/core_pattern 2>/dev/null || true)',
        '  (cat /proc/sys/kernel/dmesg_restrict 2>/dev/null || true)',
        '  echo',
        '  echo "[claude]"',
        '  (claude --version 2>/dev/null || true)',
        '  (file /usr/local/bin/claude 2>/dev/null || true)',
        '} > "$OUT/container-snapshot/runtime-summary.txt" 2>&1 || true',
        'cp -a /tmp/claude-cmd-timing "$OUT/container-snapshot/claude-cmd-timing" 2>/dev/null || true',
        'cp -a /home/claude/.claude/debug "$OUT/container-snapshot/claude-debug" 2>/dev/null || true',
        'cp -a /home/claude/.claude/projects/-repo "$OUT/container-snapshot/claude-projects-repo" 2>/dev/null || true',
        'cp -a /home/claude/.claude/shell-snapshots "$OUT/container-snapshot/shell-snapshots" 2>/dev/null || true',
        'cp -a /home/claude/.claude.json "$OUT/container-snapshot/.claude.json" 2>/dev/null || true',
        'find /repo /var/crash -maxdepth 3 -type f -name "core*" > "$OUT/container-snapshot/core-files.txt" 2>/dev/null || true',
        'for core in /repo/core* /var/crash/core*; do [ -f "$core" ] || continue; cp -a "$core" "$OUT/container-snapshot/" 2>/dev/null || true; done',
        'if command -v gdb >/dev/null 2>&1; then for core in "$OUT"/container-snapshot/core*; do [ -f "$core" ] || continue; gdb -batch -ex "set pagination off" -ex "thread apply all bt full" /usr/local/bin/claude "$core" > "$OUT/container-snapshot/$(basename "$core").gdb.txt" 2>&1 || true; done; fi',
        'if command -v strace >/dev/null 2>&1; then strace -V > "$OUT/container-snapshot/strace-version.txt" 2>&1 || true; fi',
      ].join('; ');

      const snapshotExec = await container.exec({
        Cmd: ['sh', '-lc', snapshotCommand],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        WorkingDir: '/',
        User: HOST_USER_STRING,
      });
      const snapshotResult = await this.runExecAndCapture(taskId, snapshotExec);
      await fs.promises.writeFile(
        path.join(hostAttemptForensicsPath, 'snapshot-exec.output.txt'),
        snapshotResult.output,
        'utf-8'
      );
      await fs.promises.writeFile(
        path.join(hostAttemptForensicsPath, 'snapshot-exec.exit-code.txt'),
        String(snapshotResult.exitCode),
        'utf-8'
      );
    } catch (error) {
      this.logger.error({ taskId, error }, 'Failed to capture segfault forensics');
    }
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

  /**
   * Discover all worker containers currently known to Docker.
   * Used during startup to find containers from previous orchestrator runs.
   * Returns empty array (does not throw) if Docker is unreachable.
   */
  async listWorkerContainers(): Promise<DiscoveredContainer[]> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { name: ['claude-worker-'] },
      });

      return containers
        .map((c) => {
          const rawName = c.Names[0] ?? '';
          const taskId = rawName.replace(/^\/claude-worker-/, '');
          if (taskId === '') {
            this.logger.warn({ containerId: c.Id }, 'Container has no recognizable name, skipping');
            return null;
          }
          return { containerId: c.Id, taskId, state: c.State };
        })
        .filter((c): c is DiscoveredContainer => c !== null);
    } catch (error) {
      this.logger.warn({ error }, 'Failed to list worker containers for discovery');
      return [];
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
      this.ensureTaskForensicsPath(taskId);
      void this.runAttemptInContainer(taskId, config);
      return existingWorker.handle;
    }

    // Restore preserved container for resume (container still alive but removed from workers Map)
    if (config.continueSession === true) {
      const preserved = this.preservedWorkers.get(taskId);
      if (preserved !== undefined) {
        this.preservedWorkers.delete(taskId);

        const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
        const taskSessionPath = path.join(
          this.config.secretsBasePath,
          `${CLAUDE_SESSION_DIR_PREFIX}-${taskId}`
        );

        // Recreate secrets dir (deleted during preservation) and write new prompt files
        await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });
        await this.writePromptFiles(taskSecretsPath, systemPrompt, prompt);

        /* v8 ignore start -- test-infra: branch for copying optional GCP credentials file @preserve */
        if (config.gcpSaKeyPath && fs.existsSync(config.gcpSaKeyPath)) {
          await fs.promises.copyFile(
            config.gcpSaKeyPath,
            path.join(taskSecretsPath, 'gcp-sa.json')
          );
        }
        /* v8 ignore stop @preserve */

        /* v8 ignore start -- test-infra: forensics+preserved-resume path requires daemon stateful integration setup @preserve */
        const handle: WorkerHandle = {
          taskId,
          containerId: preserved.containerId,
          status: 'running',
          startedAt: new Date(),
        };
        const taskForensicsPath = this.ensureTaskForensicsPath(taskId);

        this.workers.set(taskId, {
          containerId: preserved.containerId,
          handle,
          taskSecretsPath,
          taskSessionPath,
          attemptRunning: false,
          attemptLogBuffer: '',
          ...(taskForensicsPath !== null ? { taskForensicsPath } : {}),
        });

        this.logger.info(
          { taskId, containerId: preserved.containerId },
          'Restored preserved container for resume'
        );

        void this.runAttemptInContainer(taskId, config);
        return handle;
        /* v8 ignore stop @preserve */
      }
    }

    // Detect orphaned container from previous orchestrator run (e.g., tsx watch restart)
    // In-memory Maps are lost on restart, but Docker containers survive
    if (config.continueSession === true) {
      try {
        const orphanContainer = this.docker.getContainer(`claude-worker-${taskId}`);
        const orphanInfo = await orphanContainer.inspect();

        if (orphanInfo.State.Running) {
          const containerId = orphanInfo.Id;

          const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
          const taskSessionPath = path.join(
            this.config.secretsBasePath,
            `${CLAUDE_SESSION_DIR_PREFIX}-${taskId}`
          );

          await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });
          await this.writePromptFiles(taskSecretsPath, systemPrompt, prompt);

          /* v8 ignore start -- test-infra: branch for copying optional GCP credentials file @preserve */
          if (config.gcpSaKeyPath && fs.existsSync(config.gcpSaKeyPath)) {
            await fs.promises.copyFile(
              config.gcpSaKeyPath,
              path.join(taskSecretsPath, 'gcp-sa.json')
            );
          }
          /* v8 ignore stop @preserve */

          /* v8 ignore start -- test-infra: forensics+orphan-resume path requires daemon restart/orphan integration setup @preserve */
          const handle: WorkerHandle = {
            taskId,
            containerId,
            status: 'running',
            startedAt: new Date(),
          };
          const taskForensicsPath = this.ensureTaskForensicsPath(taskId);

          this.workers.set(taskId, {
            containerId,
            handle,
            taskSecretsPath,
            taskSessionPath,
            attemptRunning: false,
            attemptLogBuffer: '',
            ...(taskForensicsPath !== null ? { taskForensicsPath } : {}),
          });

          this.logger.info(
            { taskId, containerId },
            'Reusing orphaned container for resume after restart'
          );

          void this.runAttemptInContainer(taskId, config);
          return handle;
          /* v8 ignore stop @preserve */
        }

        // Container exists but stopped — remove it so fresh creation doesn't get 409 conflict
        this.logger.info({ taskId }, 'Removing stopped orphan container');
        await orphanContainer.remove({ force: true });
      } catch {
        // Container doesn't exist — proceed with normal creation
      }
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

    let container: Docker.Container | undefined;
    try {
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

      /* v8 ignore stop @preserve */

      // When shared credentials are configured for opus/auto workers, Claude CLI reads
      // credentials from the mounted .credentials.json file. No ANTHROPIC_API_KEY needed.
      const useSharedCreds =
        this.config.sharedCredsPath !== undefined &&
        workerTypeConfig.apiKeyEnvVar === 'ANTHROPIC_API_KEY';

      /* v8 ignore start -- test-infra: worker type configuration varies by test @preserve */
      const env = [
        `TASK_ID=${taskId}`,
        ...(useSharedCreds
          ? []
          : [`ANTHROPIC_API_KEY=${apiKey}`, `ANTHROPIC_BASE_URL=${workerTypeConfig.apiBaseUrl}`]),
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

      if (this.config.gitUserName !== undefined) {
        env.push(`GIT_USER_NAME=${this.config.gitUserName}`);
      }
      if (this.config.gitUserEmail !== undefined) {
        env.push(`GIT_USER_EMAIL=${this.config.gitUserEmail}`);
      }
      if (this.config.forensicsMode) {
        env.push('CLAUDE_FORENSICS=1');
        env.push('CLAUDE_FORENSICS_DIR=/var/crash');
      }
      /* v8 ignore stop @preserve */

      /* v8 ignore start -- ts-type: ternary for API key length check, short keys only in tests @preserve */
      const keySuffix = useSharedCreds
        ? 'shared-creds (.credentials.json)'
        : apiKey.length > 4
          ? '...' + apiKey.slice(-4)
          : '****';
      /* v8 ignore stop @preserve */
      const taskForensicsPath = this.ensureTaskForensicsPath(taskId);
      const requestedImage = this.config.imageName;
      const resolvedImage = await this.pullAndResolveImage(taskId, requestedImage);
      this.logger.info({ taskId }, 'Container creation started');
      this.logger.info(
        {},
        `Creating worker container: taskId=${taskId} workerType=${workerType} image=${resolvedImage} apiKey=${keySuffix} baseUrl=${workerTypeConfig.apiBaseUrl} worktreePath=${worktreePath}`
      );

      /* v8 ignore start -- test-infra: forensics security-opt/profile fallback branches depend on runtime filesystem packaging @preserve */
      const pnpmStorePath = path.join(
        path.dirname(this.config.secretsBasePath),
        PNPM_STORE_DIR_NAME
      );
      fs.mkdirSync(pnpmStorePath, { recursive: true });
      const capAdd = this.config.forensicsMode ? ['NET_RAW', 'SYS_PTRACE'] : ['NET_RAW'];
      const forensicsSeccompSecurityOpt = this.config.forensicsMode
        ? this.resolveForensicsSeccompSecurityOpt()
        : null;
      const securityOpt = this.config.forensicsMode
        ? [
            'no-new-privileges',
            ...(forensicsSeccompSecurityOpt !== null ? [forensicsSeccompSecurityOpt] : []),
          ]
        : ['no-new-privileges'];
      const ulimits = this.config.forensicsMode
        ? [{ Name: 'core', Soft: -1, Hard: -1 }]
        : undefined;
      /* v8 ignore stop @preserve */

      container = await this.docker.createContainer({
        Image: resolvedImage,
        name: `claude-worker-${taskId}`,
        Env: env,
        WorkingDir: '/repo',
        User: HOST_USER_STRING,
        Tty: false,
        HostConfig: {
          Binds: [
            `${worktreePath}:/repo:rw`,
            `${taskSecretsPath}:/secrets:ro`,
            `${pnpmStorePath}:/home/claude/pnpm-store:rw`,
            `${taskSessionPath}:/home/claude/.claude:rw`,
            ...(useSharedCreds && this.config.sharedCredsPath !== undefined
              ? [`${this.config.sharedCredsPath}/.credentials.json:/home/claude/.claude/.credentials.json:rw`]
              : []),
            /* v8 ignore start -- test-infra: worktree mount only set when mainGitDir detected @preserve */
            ...(mainGitDir !== null ? [`${mainGitDir}:${mainGitDir}:rw`] : []),
            /* v8 ignore stop @preserve */
            ...(taskForensicsPath !== null ? [`${taskForensicsPath}:/var/crash:rw`] : []),
          ],
          NetworkMode: this.config.networkName,
          ReadonlyRootfs: false,
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=2g',
            '/home/claude': `rw,noexec,nosuid,size=500m,uid=${String(HOST_UID)},gid=${String(HOST_GID)}`,
            // Shadows the Mac host's node_modules (bind-mounted via /repo), giving the
            // container an empty writable dir for Linux-native pnpm install.
            '/repo/node_modules': `rw,exec,nosuid,size=4g,uid=${String(HOST_UID)},gid=${String(HOST_GID)}`,
          },
          CapDrop: ['ALL'],
          // NET_RAW: Required for network diagnostics (ping, traceroute) which Claude
          // uses to verify connectivity. Without it, Claude's network-test commands fail.
          CapAdd: capAdd,
          SecurityOpt: securityOpt,
          ...(ulimits !== undefined ? { Ulimits: ulimits } : {}),
          AutoRemove: false,
        },
      });

      await container.start();
      this.logger.info({ taskId, containerId: container.id }, 'Container creation finished');

      if (this.config.managedAttemptsMode) {
        await this.assertManagedEntrypointSupport(taskId, container);
        await this.waitForWorkerReady(taskId, container);
      }

      // Capture logs via container.logs() (replaces attach stream)
      /* v8 ignore start -- test-infra: log stream setup tested via mock, requires running container @preserve */
      let logStream: NodeJS.ReadableStream | undefined;
      if (config.onLog !== undefined && !this.config.managedAttemptsMode) {
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
        ...(taskForensicsPath !== null ? { taskForensicsPath } : {}),
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

      this.logger.info(
        {},
        `Worker container started: taskId=${taskId} containerId=${container.id}`
      );

      return handle;
    } catch (error) {
      await fs.promises.rm(taskSecretsPath, { recursive: true, force: true }).catch(
        /* v8 ignore start -- test-infra: cleanup error handling for edge cases @preserve */
        (e: unknown) => {
          this.logger.warn({ taskId, error: e }, 'Cleanup: failed to remove task secrets');
        }
        /* v8 ignore stop @preserve */
      );
      await fs.promises.rm(taskSessionPath, { recursive: true, force: true }).catch(
        /* v8 ignore start -- test-infra: cleanup error handling for edge cases @preserve */
        (e: unknown) => {
          this.logger.warn({ taskId, error: e }, 'Cleanup: failed to remove task session');
        }
        /* v8 ignore stop @preserve */
      );
      if (container !== undefined) {
        await container.remove({ force: true }).catch(
          /* v8 ignore start -- test-infra: cleanup error handling for edge cases @preserve */
          (e: unknown) => {
            this.logger.warn({ taskId, error: e }, 'Cleanup: failed to remove container');
          }
          /* v8 ignore stop @preserve */
        );
      }
      throw error;
    }
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
    } catch (error) {
      this.logger.warn({ taskId, error }, 'Failed to retrieve container logs');
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

  async preserveWorker(taskId: string): Promise<void> {
    const worker = this.workers.get(taskId);
    if (worker === undefined) {
      return;
    }

    this.preservedWorkers.set(taskId, {
      containerId: worker.containerId,
      taskId,
      preservedAt: new Date().toISOString(),
    });
    this.workers.delete(taskId);

    // Clear sensitive files but keep the directory — rm -rf would invalidate
    // the container's bind mount (Linux bind mounts follow inodes, not paths).
    const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
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

    this.logger.info({ taskId, containerId: worker.containerId }, 'Worker preserved for debugging');
  }

  async listPreservedWorkers(): Promise<
    { containerId: string; taskId: string; preservedAt: string }[]
  > {
    return Array.from(this.preservedWorkers.values());
  }

  getImageInfo(): {
    configuredRef: string;
    lastResolvedDigest: string | null;
    pullPolicy: string;
    managedAttemptsMode: boolean;
  } {
    return {
      configuredRef: this.config.imageName,
      lastResolvedDigest: this.lastResolvedDigest,
      pullPolicy: this.config.imagePullPolicy,
      managedAttemptsMode: this.config.managedAttemptsMode,
    };
  }

  private async pullAndResolveImage(taskId: string, imageName: string): Promise<string> {
    if (this.config.imagePullPolicy !== 'always') {
      return imageName;
    }

    const pullOpts: Record<string, unknown> = {};
    if (this.config.gcpSaKeyPath !== '' && fs.existsSync(this.config.gcpSaKeyPath)) {
      const saKey = fs.readFileSync(this.config.gcpSaKeyPath, 'utf-8');
      const registry = imageName.split('/')[0] ?? '';
      pullOpts['authconfig'] = {
        username: '_json_key',
        password: saKey,
        serveraddress: `https://${registry}`,
      };
    }

    const pullStart = Date.now();
    try {
      const pullStream = await this.docker.pull(imageName, pullOpts);
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(pullStream, (err: Error | null) => {
          if (err !== null) reject(err);
          else resolve();
        });
      });
    } catch (error) {
      throw new Error(
        `Failed to pull worker image ${imageName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const pullDurationMs = Date.now() - pullStart;

    try {
      const imageInfo = await this.docker.getImage(imageName).inspect();
      const repoDigests = Array.isArray(imageInfo.RepoDigests) ? imageInfo.RepoDigests : [];
      const resolvedImage = repoDigests.find((digest) =>
        digest.startsWith(imageName.split(':')[0] ?? '')
      );
      const finalImage = resolvedImage ?? repoDigests[0] ?? imageName;
      this.lastResolvedDigest = finalImage;
      this.logger.info(
        { taskId, pullDurationMs },
        `Worker image pulled: requested=${imageName} resolved=${finalImage}`
      );
      if (imageName.includes(':latest')) {
        this.logger.warn(
          { taskId, imageName },
          'Worker image uses mutable tag :latest — consider pinning to digest for reproducibility'
        );
      }
      return finalImage;
    } catch (error) {
      this.logger.warn(
        { taskId, error },
        'Failed to inspect pulled image digest; using configured image reference'
      );
      return imageName;
    }
  }

  /* v8 ignore start -- test-infra: readiness polling requires running container with entrypoint @preserve */
  private async waitForWorkerReady(taskId: string, container: Docker.Container): Promise<void> {
    const timeoutMs = this.config.workerReadyTimeoutMs ?? 600_000;
    const pollIntervalMs = 2_000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const execInstance = await container.exec({
        Cmd: ['test', '-f', '/tmp/worker-ready'],
        AttachStdout: true,
        AttachStderr: false,
        WorkingDir: '/',
      });
      const execStream = await execInstance.start({ hijack: false, stdin: false });
      await new Promise<void>((resolve) => {
        execStream.on('end', resolve);
        execStream.on('close', resolve);
        execStream.resume();
      });
      const info = await execInstance.inspect();
      if (info.ExitCode === 0) {
        this.logger.info(
          { taskId, elapsedMs: Date.now() - startTime },
          'Worker readiness confirmed'
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Worker readiness timeout after ${String(timeoutMs)}ms for task ${taskId}`);
  }
  /* v8 ignore stop @preserve */

  private async assertManagedEntrypointSupport(
    taskId: string,
    container: Docker.Container
  ): Promise<void> {
    const execInstance = await container.exec({
      Cmd: ['sh', '-lc', 'grep -q "run-attempt" /entrypoint.sh'],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: '/',
      User: HOST_USER_STRING,
    });

    const execStream = await execInstance.start({ hijack: false, stdin: false });
    const exitCode = await this.waitForExecCompletion(taskId, execInstance, execStream);
    if (exitCode !== 0) {
      throw new Error(
        'Worker image is incompatible: missing managed-attempt run-attempt entrypoint support'
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
        await this.writeJsonArtifact(path.join(hostAttemptForensicsPath, 'attempt-start.json'), {
          taskId,
          startedAt: new Date().toISOString(),
          continueSession: config.continueSession === true,
          containerId: worker.containerId,
        });
      }

      const execInstance = await container.exec({
        Cmd: ['/entrypoint.sh', 'run-attempt'],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        WorkingDir: '/',
        User: HOST_USER_STRING,
        Env: [`CLAUDE_CONTINUE=${config.continueSession === true ? '1' : '0'}`],
      });

      const execStream = await execInstance.start({ hijack: false, stdin: false });
      execStream.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        worker.attemptLogBuffer += text;
        if (persistentAttemptLogPath !== undefined) {
          try {
            fs.appendFileSync(persistentAttemptLogPath, text, 'utf-8');
          } catch (error) {
            this.logger.warn({ taskId, error }, 'Failed to persist attempt exec stream chunk');
          }
        }
        config.onLog?.(text);
      });

      const exitCode = await this.waitForExecCompletion(taskId, execInstance, execStream);
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
        await this.captureSegfaultForensics(
          taskId,
          container,
          execInstance,
          hostAttemptForensicsPath,
          containerAttemptForensicsPath
        );
      }
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
    return await new Promise<number>((resolve) => {
      let resolved = false;

      const resolveWith = (exitCode: number): void => {
        if (resolved) return;
        resolved = true;
        clearInterval(pollTimer);
        resolve(exitCode);
      };

      // Primary path: stream closes naturally
      const onStreamEnd = (): void => {
        execInstance
          .inspect()
          .then((info) => {
            resolveWith(typeof info.ExitCode === 'number' ? info.ExitCode : 1);
          })
          .catch(() => {
            resolveWith(1);
          });
      };
      execStream.on('end', onStreamEnd);
      execStream.on('close', onStreamEnd);
      execStream.on('error', () => {
        resolveWith(1);
      });
      execStream.resume();

      // Fallback: poll exec inspect for orphaned-fd cases
      const pollTimer = setInterval(() => {
        execInstance
          .inspect()
          .then((info) => {
            if (!info.Running) {
              this.logger.info(
                { taskId },
                'Exec process exited but stream still open — resolving via inspect fallback'
              );
              resolveWith(typeof info.ExitCode === 'number' ? info.ExitCode : 1);
            }
          })
          .catch(() => {
            // Inspect failed — exec may have been removed; treat as exit
            resolveWith(1);
          });
      }, EXEC_INSPECT_POLL_INTERVAL_MS);
    });
  }
  /* v8 ignore stop @preserve */
}
