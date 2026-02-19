# claude-worker -- Agent Interface

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
interface ClaudeWorkerLifecycle {
  createWorker(config: {
    taskId: string;
    worktreePath: string;
    workerType: 'opus' | 'auto' | 'glm';
    managedMode: boolean; // true = CLAUDE_MANAGED_MODE=1
    secrets: {
      ANTHROPIC_API_KEY: string;
      LINEAR_API_KEY: string;
      SENTRY_AUTH_TOKEN: string;
      ZAI_API_KEY: string;
    };
    gcpSaKeyPath: string;
    githubTokenPath: string;
    gitUserName?: string;
    gitUserEmail?: string;
    onLog?: (chunk: string) => void;
    onComplete?: (exitCode: number) => void;
  }): Promise<{
    taskId: string;
    containerId: string;
    status: 'starting' | 'running';
    startedAt: Date;
  }>;

  waitForReady(taskId: string, timeoutMs: number): Promise<void>;
  // Polls for /tmp/worker-ready marker via docker exec

  runAttempt(config: {
    taskId: string;
    systemPromptPath: string; // Written to secrets dir as system-prompt.txt
    userPromptPath: string;   // Written to secrets dir as user-prompt.txt
    continueSession?: boolean; // true = CLAUDE_CONTINUE=1
  }): Promise<number>;
  // Returns Claude exit code

  destroyWorker(taskId: string, forceKill?: boolean): Promise<void>;

  sendInput(taskId: string, input: string): Promise<void>;
  // Legacy: writes to attach stream stdin. Not used in managed mode.

  waitForCompletion(taskId: string, timeoutMs: number): Promise<number>;
  // Returns: 0 = success, -1 = timeout, other = failure

  isWorkerRunning(taskId: string): Promise<boolean>;

  getWorkerLogs(taskId: string): Promise<string>;

  streamLogs(taskId: string, onChunk: (chunk: string) => void): Promise<void>;

  getResourceUsage(taskId: string): Promise<{
    cpuPercent: number;
    memoryUsedMB: number;
    memoryLimitMB: number;
  }>;

  attachTTY(taskId: string): Promise<{
    stdin: NodeJS.WritableStream;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    detach: () => void;
  }>;

  listWorkers(): Promise<
    Array<{
      taskId: string;
      containerId: string;
      status: 'starting' | 'running' | 'completed' | 'failed' | 'timeout';
      startedAt: Date;
    }>
  >;
}
```

### Worker Types

```typescript
type WorkerType = 'opus' | 'auto' | 'glm';

const WORKER_TYPES: Record<
  WorkerType,
  {
    apiBaseUrl: string;
    apiKeyEnvVar: 'ANTHROPIC_API_KEY' | 'ZAI_API_KEY';
    model?: string;
  }
> = {
  opus: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    model: 'claude-opus-4-5-20251101',
  },
  auto: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  glm: {
    apiBaseUrl: 'https://api.z.ai/api/anthropic',
    apiKeyEnvVar: 'ZAI_API_KEY',
  },
};
```

---

## Critical Rules and Constraints

1. The orchestrator MUST call `waitForReady()` before calling `runAttempt()`. The `run-attempt` handler exits with error if `/tmp/worker-ready` is not present.
2. The worker MUST run as non-root user UID 1001. The entrypoint exits with error code 1 if it detects UID 0.
3. Secrets mount MUST be read-only (`:ro`). The test stub verifies this and exits with error if `/secrets` is writable.
4. The maximum state transition for a worker is: `starting` -> `running` -> `completed` | `failed` | `timeout`. There is no restart mechanism; create a new worker instead.
5. `runAttempt()` MUST write `system-prompt.txt` and `user-prompt.txt` to the secrets directory (on the host) BEFORE calling `docker exec run-attempt`. The container reads these files; they are not passed via stdin or environment variables.
6. The `waitForCompletion` method resolves with `-1` on timeout and automatically triggers `destroyWorker` with force kill.
7. Concurrent workers are limited to `maxConcurrent` (default 4). Exceeding this limit throws an error; the caller must wait for an existing worker to finish.
8. GitHub token refresh is handled by the orchestrator's `TokenRefresher`, not by the container itself. The token file at `/secrets/github-token` is updated externally; the entrypoint re-reads it at each `run-attempt` invocation.
9. In managed mode (`CLAUDE_MANAGED_MODE=1`), the container does NOT exit after completing an attempt. The orchestrator must call `destroyWorker` explicitly when the task is done.

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
    source: string; // Host per-task secrets path
    mode: 'ro'; // Read-only (enforced)
    required: true;
    files: {
      'gcp-sa.json': 'optional'; // GCP service account key
      'github-token': 'optional'; // Refreshed GitHub token
      'system-prompt.txt': 'required-for-run-attempt'; // Claude system prompt
      'user-prompt.txt': 'required-for-run-attempt'; // Claude user prompt (piped to stdin)
    };
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
    options: 'rw,noexec,nosuid,uid=1001,gid=1001';
    contents: 'pnpm-store, .claude config, gcloud credentials';
  };
}
```

---

## Usage Patterns (Few-Shot)

**Orchestrator: Start a new coding task in managed mode**

```typescript
// 1. Create and start the container
const handle = await provider.createWorker({
  taskId: 'INT-500-implement-feature',
  worktreePath: '/home/user/.claude-orchestrator/worktrees/INT-500',
  workerType: 'auto',
  managedMode: true,
  secrets: {
    ANTHROPIC_API_KEY: 'sk-ant-...',
    LINEAR_API_KEY: 'lin_api_...',
    SENTRY_AUTH_TOKEN: 'sntrys_...',
    ZAI_API_KEY: '',
  },
  gcpSaKeyPath: '/home/user/.claude-orchestrator/secrets/INT-500/gcp-sa.json',
  githubTokenPath: '/home/user/.claude-orchestrator/secrets/INT-500/github-token',
  gitUserName: 'Intex',
  gitUserEmail: 'intex@intexuraos.cloud',
  onLog: (chunk) => logForwarder.forward('INT-500', chunk),
});

// 2. Wait for setup to complete (pnpm install, GCP auth, etc.)
await provider.waitForReady('INT-500-implement-feature', 120_000);

// 3. Write prompt files to host secrets dir, then trigger an attempt
fs.writeFileSync('/secrets/INT-500/system-prompt.txt', systemPrompt);
fs.writeFileSync('/secrets/INT-500/user-prompt.txt', userPrompt);
const exitCode = await provider.runAttempt({
  taskId: 'INT-500-implement-feature',
  systemPromptPath: '/secrets/INT-500/system-prompt.txt',
  userPromptPath: '/secrets/INT-500/user-prompt.txt',
});

// 4. Resume if needed
if (exitCode !== 0) {
  fs.writeFileSync('/secrets/INT-500/user-prompt.txt', resumePrompt);
  const resumeCode = await provider.runAttempt({
    taskId: 'INT-500-implement-feature',
    systemPromptPath: '/secrets/INT-500/system-prompt.txt',
    userPromptPath: '/secrets/INT-500/user-prompt.txt',
    continueSession: true,
  });
}

// 5. Clean up
await provider.destroyWorker('INT-500-implement-feature');
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
