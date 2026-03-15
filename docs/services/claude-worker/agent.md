# claude-worker — Agent Interface

> Machine-readable interface definition for AI agents and the orchestrator interacting with claude-worker containers.

---

## Identity

| Field    | Value                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| **Name** | claude-worker                                                                   |
| **Role** | Isolated Docker Container for Claude Code Sessions                              |
| **Goal** | Execute AI coding tasks in sandboxed environments with enforced security limits |

---

## Capabilities

### Lifecycle Operations (via DockerProvider)

```typescript
interface WorkerSecrets {
  ANTHROPIC_API_KEY: string;
  LINEAR_API_KEY: string;
  SENTRY_AUTH_TOKEN: string;
  MINIMAX_API_KEY: string;
  DASHSCOPE_API_KEY: string;
}

interface WorkerConfig {
  taskId: string;
  worktreePath: string;
  prompt: string; // User prompt content (written to secrets/user-prompt.txt)
  systemPrompt: string; // System prompt content (written to secrets/system-prompt.txt)
  workerType: 'auto' | 'opus' | 'sonnet' | 'minimax' | 'glm' | 'qwen' | 'kimi';
  secrets: WorkerSecrets;
  gcpSaKeyPath: string;
  githubAppKeyPath: string;
  continueSession?: boolean; // true = CLAUDE_CONTINUE=1 + restore preserved container
  onLog?: (chunk: string) => void;
  onComplete?: (exitCode: number) => void;
}

interface WorkerHandle {
  taskId: string;
  containerId: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'timeout';
  startedAt: Date;
}

interface IsolationProvider {
  // Create and start container. Writes prompt files, pulls image, waits for
  // /tmp/worker-ready, then fires the first run-attempt via docker exec.
  createWorker(config: WorkerConfig): Promise<WorkerHandle>;

  destroyWorker(taskId: string, forceKill?: boolean): Promise<void>;

  isWorkerRunning(taskId: string): Promise<boolean>;

  getWorkerLogs(taskId: string): Promise<string>;

  streamLogs(taskId: string, onChunk: (chunk: string) => void): Promise<void>;

  // Returns: 0 = success, -1 = timeout, other = failure
  waitForCompletion(taskId: string, timeoutMs: number): Promise<number>;

  getResourceUsage(taskId: string): Promise<{
    cpuPercent: number;
    memoryUsedMB: number;
    memoryLimitMB: number;
  }>;

  listWorkers(): Promise<WorkerHandle[]>;

  // Remove per-task Claude session directory from host
  cleanupTaskSession?(taskId: string): Promise<void>;

  // Park container in preserved map (keeps alive, clears secrets)
  preserveWorker?(taskId: string): Promise<void>;

  listPreservedWorkers?(): Promise<
    Array<{
      containerId: string;
      taskId: string;
      preservedAt: string;
    }>
  >;

  getImageInfo?(): {
    configuredRef: string;
    lastResolvedDigest: string | null;
    pullPolicy: string;
    managedAttemptsMode: boolean;
  };
}
```

### Worker Types

```typescript
type WorkerType = 'auto' | 'opus' | 'sonnet' | 'minimax' | 'glm' | 'qwen' | 'kimi';

const WORKER_TYPES: Record<
  WorkerType,
  {
    apiBaseUrl: string;
    apiKeyEnvVar: 'ANTHROPIC_API_KEY' | 'MINIMAX_API_KEY' | 'DASHSCOPE_API_KEY';
    model?: string;
  }
> = {
  auto: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  opus: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    model: 'opus',
  },
  sonnet: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    model: 'sonnet',
  },
  minimax: {
    apiBaseUrl: 'https://api.minimax.io/anthropic',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    model: 'MiniMax-M2.5',
  },
  glm: {
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'glm-5',
  },
  qwen: {
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'qwen3.5-plus',
  },
  kimi: {
    apiBaseUrl: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    model: 'kimi-k2.5',
  },
};
```

---

## Critical Rules and Constraints

1. `createWorker()` is the only entry point. It pulls the image, creates the container, waits for `/tmp/worker-ready`, and fires the first `run-attempt` via `docker exec`. The caller does not need to manage prompt file paths or readiness polling.
2. The worker runs as the host user (dynamic UID from `os.userInfo().uid`), not a fixed UID 1001. This ensures bind-mounted files are accessible without permission errors.
3. Secrets mount MUST be read-only (`:ro`). The test stub verifies this and exits with error if `/secrets` is writable.
4. The maximum state transition for a worker is: `starting` -> `running` -> `completed` | `failed` | `timeout`. There is no restart mechanism; call `createWorker` with `continueSession: true` to resume.
5. `createWorker()` writes `system-prompt.txt` and `user-prompt.txt` to the per-task secrets directory automatically. The container reads these files — they are not passed via stdin or environment variables.
6. The `waitForCompletion` method resolves with `-1` on timeout and automatically triggers `destroyWorker` with force kill.
7. Concurrent workers are limited to `maxConcurrent` (default 4). Exceeding this limit throws an error; the caller must wait for an existing worker to finish.
8. GitHub token refresh is handled by the orchestrator's `TokenRefresher`, which updates `/secrets/github-token` every 30 minutes via bind mount. Within a single attempt, tokens are refreshed via file reads — the git credential helper reads the file directly on each git operation (`$(cat /secrets/github-token)` in gitconfig), and the `gh` CLI uses a wrapper at `/usr/local/bin/gh` that re-reads the file before each invocation. The `GITHUB_TOKEN` env var is a point-in-time snapshot set at attempt start and may go stale; it is not the authoritative source.
9. In managed mode (`CLAUDE_MANAGED_MODE=1`), the container does NOT exit after completing an attempt. The orchestrator must call `destroyWorker` explicitly when the task is done.
10. When `continueSession: true` is passed to `createWorker`, it restores a preserved container (via `preservedWorkers` map) or reconnects to an orphaned container by name (`claude-worker-{taskId}`). This handles orchestrator restarts without losing in-flight containers.
11. The container syncs environment variables from GCP Secret Manager at startup via `scripts/sync-secrets.sh`. These are loaded into the shell environment via `.envrc` and `direnv`. The orchestrator does not need to pre-sync secrets.
12. Crash forensics are enabled by setting `CLAUDE_FORENSICS=1`. The forensics directory must be bind-mounted if the orchestrator needs to access artifacts after container destruction.

---

## Container Mount Contract

```typescript
interface ContainerMounts {
  '/repo': {
    source: string; // Host worktree path
    mode: 'rw'; // Read-write for git operations
    required: true; // Container fails without it
    content: 'git-repo'; // Must contain .git dir or file
  };
  '/secrets': {
    source: string; // Host per-task secrets path (secretsBasePath/{taskId})
    mode: 'ro'; // Read-only (enforced)
    required: true;
    files: {
      'gcp-sa.json': 'optional'; // GCP service account key
      'github-token': 'optional'; // Refreshed GitHub token
      'system-prompt.txt': 'required-for-run-attempt'; // Claude system prompt
      'user-prompt.txt': 'required-for-run-attempt'; // Claude user prompt (piped to stdin)
    };
  };
  '/home/claude/pnpm-store': {
    source: string; // Host shared pnpm store (secretsBasePath/../pnpm-store)
    mode: 'rw'; // Read-write -- shared across containers
    type: 'bind'; // Persists across container restarts
  };
  '/home/claude/.claude': {
    source: string; // Host per-task session (secretsBasePath/claude-session-{taskId})
    // OR sharedCredsPath when shared credentials are configured
    mode: 'rw';
    type: 'bind'; // Session history persists for --continue resumption
  };
  '/tmp': {
    type: 'tmpfs';
    size: '2g';
    options: 'rw,noexec,nosuid';
    runtimeFiles: {
      'worker-ready': 'written by entrypoint after setup'; // Readiness signal
    };
  };
  '/home/claude': {
    type: 'tmpfs';
    size: '500m';
    options: 'rw,noexec,nosuid,uid={HOST_UID},gid={HOST_GID}';
    // pnpm-store and .claude bind mounts overlay this tmpfs
  };
  '/repo/node_modules': {
    type: 'tmpfs';
    size: '4g';
    options: 'rw,exec,nosuid,uid={HOST_UID},gid={HOST_GID}';
    // Shadows Mac host node_modules; gives container empty writable dir for Linux-native pnpm install
  };
}
```

---

## Usage Patterns (Few-Shot)

**Orchestrator: Start a new coding task in managed mode**

```typescript
// 1. Create container, wait for ready, and fire first attempt -- all in one call.
//    createWorker writes prompt content to secrets dir, then calls docker exec run-attempt.
const handle = await provider.createWorker({
  taskId: 'INT-500-implement-feature',
  worktreePath: '/home/user/.claude-orchestrator/worktrees/INT-500',
  workerType: 'auto',
  systemPrompt: 'You are a coding agent working on IntexuraOS...',
  prompt: 'Implement the feature described in INT-500.',
  secrets: {
    ANTHROPIC_API_KEY: 'sk-ant-...',
    LINEAR_API_KEY: 'lin_api_...',
    SENTRY_AUTH_TOKEN: 'sntrys_...',
  },
  gcpSaKeyPath: '/home/user/.config/gcloud/sa-key.json',
  githubAppKeyPath: '/home/user/.claude-orchestrator/secrets/INT-500/github-token',
  onLog: (chunk) => logForwarder.forward('INT-500', chunk),
  onComplete: (exitCode) => console.log('Attempt done:', exitCode),
});

// 2. Resume if needed -- createWorker with continueSession=true re-uses the existing container
if (shouldResume) {
  await provider.createWorker({
    taskId: 'INT-500-implement-feature',
    // ... same config ...
    prompt: 'The previous attempt did not push a PR. Please push and open one.',
    continueSession: true,
  });
}

// 3. Clean up
await provider.destroyWorker('INT-500-implement-feature');
await provider.cleanupTaskSession?.('INT-500-implement-feature');
```

**Orchestrator: Monitor resource usage**

```typescript
const usage = await provider.getResourceUsage('INT-500-implement-feature');
// { cpuPercent: 45.2, memoryUsedMB: 2048, memoryLimitMB: 8192 }
```

**Orchestrator: Wait for attempt with timeout**

```typescript
const exitCode = await provider.waitForCompletion('INT-500-implement-feature', 2 * 60 * 60 * 1000);
if (exitCode === 0) {
  // Task completed successfully
} else if (exitCode === -1) {
  // Timeout - container was force-killed
} else {
  // Task failed with non-zero exit code
}
```

---

## Error Handling

| Exit Code | Meaning                | Recovery Action                                     |
| --------- | ---------------------- | --------------------------------------------------- |
| 0         | Success                | Task completed — check for PR                       |
| 1         | General failure        | Retry with continueSession=true                     |
| 139       | Segfault (SIGSEGV)     | Check forensics dir; retry with fresh container     |
| -1        | Timeout (orchestrator) | Container force-killed; retry with different prompt |

---

## Events Published

None. Claude Worker does not publish Pub/Sub events. Communication is via container exit codes and log output.

---

## Dependencies

| Dependency           | Why Needed                 | Failure Behavior                               |
| -------------------- | -------------------------- | ---------------------------------------------- |
| Docker Engine        | Container runtime          | Cannot start worker                            |
| Anthropic API        | Claude CLI model access    | Claude exits with error                        |
| GitHub (public)      | Push commits, create PRs   | Git operations fail                            |
| npm registry         | pnpm install               | Dependency install fails (non-fatal for retry) |
| GCP Secret Manager   | Environment variable sync  | Falls back to existing .envrc                  |
| Artifact Registry    | Image pull                 | Uses cached local image                        |
