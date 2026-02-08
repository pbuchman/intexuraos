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
    prompt: string;
    systemPrompt: string;
    workerType: 'opus' | 'auto' | 'glm';
    secrets: {
      ANTHROPIC_API_KEY: string;
      LINEAR_API_KEY: string;
      SENTRY_AUTH_TOKEN: string;
      ZAI_API_KEY: string;
    };
    gcpSaKeyPath: string;
    githubAppKeyPath: string;
    onLog?: (chunk: string) => void;
    onComplete?: (exitCode: number) => void;
  }): Promise<{
    taskId: string;
    containerId: string;
    status: 'running';
    startedAt: Date;
  }>;

  destroyWorker(taskId: string, forceKill?: boolean): Promise<void>;

  sendInput(taskId: string, input: string): Promise<void>;

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

  listWorkers(): Promise<Array<{
    taskId: string;
    containerId: string;
    status: 'starting' | 'running' | 'completed' | 'failed' | 'timeout';
    startedAt: Date;
  }>>;
}
```

### Worker Types

```typescript
type WorkerType = 'opus' | 'auto' | 'glm';

const WORKER_TYPES: Record<WorkerType, {
  apiBaseUrl: string;
  apiKeyEnvVar: 'ANTHROPIC_API_KEY' | 'ZAI_API_KEY';
  model?: string;
}> = {
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

1. The orchestrator MUST call `attach()` BEFORE `start()` on the Docker container. Reversing this order causes missed startup output and hung ready-detection.
2. The worker MUST run as non-root user UID 1001. The entrypoint exits with error code 1 if it detects UID 0.
3. Secrets mount MUST be read-only (`:ro`). The test stub verifies this and exits with error if `/secrets` is writable.
4. The maximum state transition for a worker is: `starting` -> `running` -> `completed` | `failed` | `timeout`. There is no restart mechanism; create a new worker instead.
5. After sending the system prompt via stdin, the orchestrator MUST NOT send additional input until Claude has processed the prompt (wait for output activity).
6. The `waitForCompletion` method resolves with `-1` on timeout and automatically triggers `destroyWorker` with force kill.
7. Concurrent workers are limited to `maxConcurrent` (default 4). Exceeding this limit throws an error; the caller must wait for an existing worker to finish.
8. GitHub token refresh is handled by the orchestrator's `TokenRefresher`, not by the container itself. The token file at `/secrets/github-token` is updated externally.

---

## Container Mount Contract

```typescript
interface ContainerMounts {
  '/repo': {
    source: string;     // Host worktree path
    mode: 'rw';         // Read-write for git operations
    required: true;     // Container fails without it
    content: 'git-repo'; // Must contain .git dir or file
  };
  '/secrets': {
    source: string;     // Host per-task secrets path
    mode: 'ro';         // Read-only (enforced)
    required: true;
    files: {
      'gcp-sa.json': 'optional';    // GCP service account key
      'github-token': 'optional';   // Refreshed GitHub token
    };
  };
  '/tmp': {
    type: 'tmpfs';
    size: '2g';
    options: 'rw,noexec,nosuid';
  };
  '/home/claude': {
    type: 'tmpfs';
    size: '500m';
    options: 'rw,noexec,nosuid,uid=1001,gid=1001';
  };
}
```

---

## Usage Patterns (Few-Shot)

**Orchestrator: Start a new coding task**

```typescript
const handle = await provider.createWorker({
  taskId: 'INT-500-implement-feature',
  worktreePath: '/home/user/.claude-orchestrator/worktrees/INT-500',
  prompt: 'Implement the user profile page',
  systemPrompt: 'You are a senior developer. Implement the following task:\n\nImplement the user profile page',
  workerType: 'auto',
  secrets: {
    ANTHROPIC_API_KEY: 'sk-ant-...',
    LINEAR_API_KEY: 'lin_api_...',
    SENTRY_AUTH_TOKEN: 'sntrys_...',
    ZAI_API_KEY: '',
  },
  gcpSaKeyPath: '/home/user/gcp-sa.json',
  githubAppKeyPath: '/home/user/github-app.pem',
  onLog: (chunk) => logForwarder.forward(taskId, chunk),
  onComplete: (exitCode) => handleTaskCompletion(taskId, exitCode),
});
```

**Orchestrator: Send follow-up instruction**

```typescript
await provider.sendInput('INT-500-implement-feature', 'Now run the tests and fix any failures');
```

**Orchestrator: Monitor resource usage**

```typescript
const usage = await provider.getResourceUsage('INT-500-implement-feature');
// { cpuPercent: 45.2, memoryUsedMB: 2048, memoryLimitMB: 8192 }
```

**Orchestrator: Wait for task with timeout**

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
