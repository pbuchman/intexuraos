# code-worker — Agent Interface

> Machine-readable interface definition for AI agents and the orchestrator interacting with code-worker containers.

---

## Identity

| Field    | Value                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| **Name** | code-worker                                                                     |
| **Role** | Isolated Docker container for Claude Code and Codex sessions                    |
| **Goal** | Execute AI coding tasks in sandboxed environments with enforced security limits |

---

## Capabilities

### Lifecycle Operations (via DockerProvider)

```typescript
interface WorkerSecrets {
  ANTHROPIC_API_KEY: string;
  LINEAR_API_KEY: string;
  ERROR_HUB_HOST: string;
  MINIMAX_API_KEY: string;
  DASHSCOPE_API_KEY: string;
  OPENROUTER_API_KEY: string;
}

interface WorkerConfig {
  taskId: string;
  worktreePath: string;
  prompt: string;
  systemPrompt: string;
  workerType:
    | 'auto'
    | 'opus'
    | 'sonnet'
    | 'minimax'
    | 'glm'
    | 'qwen'
    | 'kimi'
    | 'codex'
    | 'codex-xhigh'
    | 'openrouter-free';
  runtimeOverride?: 'claude' | 'codex';
  runtimeSessionId?: string; // CLAUDE_SESSION_ID or CODEX_THREAD_ID — required when continueSession is true
  secrets: WorkerSecrets;
  gcpSaKeyPath: string;
  githubAppKeyPath: string;
  resolvedImage?: string;
  continueSession?: boolean;
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
  createWorker(config: WorkerConfig): Promise<WorkerHandle>;
  destroyWorker(taskId: string): Promise<void>;
  isWorkerRunning(taskId: string): Promise<boolean>;
  getWorkerLogs(taskId: string): Promise<string>;
  streamLogs(taskId: string, onChunk: (chunk: string) => void): Promise<void>;
  waitForCompletion(taskId: string, timeoutMs: number): Promise<number>;
  getResourceUsage(taskId: string): Promise<{
    cpuPercent: number;
    memoryUsedMB: number;
    memoryLimitMB: number;
  }>;
  listWorkers(): Promise<WorkerHandle[]>;
  cleanupTaskSession?(taskId: string): Promise<void>;
  preserveWorker?(taskId: string): Promise<void>;
  listPreservedWorkers?(): Promise<
    Array<{
      containerId: string;
      taskId: string;
      preservedAt: string;
    }>
  >;
  isResumeAvailable?(taskId: string): Promise<boolean>;
  listWorkerContainers?(): Promise<
    Array<{
      containerId: string;
      taskId: string;
      state: string;
    }>
  >;
  pullImage?(taskId: string, onProgress?: (message: string) => void): Promise<string>;
  getImageInfo?(): {
    configuredRef: string;
    lastResolvedDigest: string | null;
    pullPolicy: string;
    managedAttemptsMode: boolean;
  };
  isHealthy?(): boolean;
  getHealthDetails?(): { docker: boolean; disk: boolean };
}
```

### Worker Types

```typescript
type WorkerType =
  | 'auto'
  | 'opus'
  | 'sonnet'
  | 'minimax'
  | 'glm'
  | 'qwen'
  | 'kimi'
  | 'codex'
  | 'codex-xhigh'
  | 'openrouter-free';

type WorkerRuntime = 'claude' | 'codex';

interface WorkerTypeConfig {
  runtime: WorkerRuntime;
  apiBaseUrl: string;
  apiKeyEnvVar?: 'ANTHROPIC_API_KEY' | 'MINIMAX_API_KEY' | 'DASHSCOPE_API_KEY' | 'OPENROUTER_API_KEY';
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh';
  disableExperimentalBetas?: boolean;
}
```

`codex` and `codex-xhigh` use the Codex runtime with shared Codex auth. `codex-xhigh` sets `CODEX_REASONING_EFFORT=xhigh`. All other types use the Claude runtime with Anthropic-compatible API routing.

---

## Critical Rules and Constraints

1. `createWorker()` is the only entry point. It pulls the image, creates the container, waits for `/tmp/worker-ready`, and fires the first `run-attempt` via `docker exec`. The caller does not need to manage prompt file paths or readiness polling.
2. The worker runs as the host user (dynamic UID from `os.userInfo().uid`), not a fixed UID 1001. This ensures bind-mounted files are accessible without permission errors.
3. Secrets mount MUST be read-only (`:ro`). The test stub verifies this and exits with error if `/secrets` is writable.
4. The maximum state transition for a worker is: `starting` -> `running` -> `completed` | `failed` | `timeout`. There is no restart mechanism; call `createWorker` with `continueSession: true` to resume.
5. `createWorker()` writes `system-prompt.txt` and `user-prompt.txt` to the per-task secrets directory automatically. The container reads these files — they are not passed via stdin or environment variables.
6. The `waitForCompletion` method resolves with `-1` on timeout and automatically triggers `destroyWorker` with force kill.
7. Concurrent workers are limited to `maxConcurrent` (default 4). Exceeding this limit throws an error; the caller must wait for an existing worker to finish.
8. GitHub token refresh is handled by the orchestrator's `TokenRefresher`, which updates `/secrets/github-token` every 30 minutes via bind mount. The git credential helper and `gh` CLI wrapper re-read the file on each invocation. The `GITHUB_TOKEN` env var is a point-in-time snapshot and is not the authoritative source.
9. In managed mode (`WORKER_MANAGED_MODE=1`), the container does NOT exit after completing an attempt. The orchestrator must call `destroyWorker` explicitly when the task is done.
10. When `continueSession: true` is passed to `createWorker`, it restores a preserved container (via `preservedWorkers` map) or reconnects to an orphaned container by name (`code-worker-{taskId}`).
11. The container syncs environment variables from GCP Secret Manager at startup via `scripts/sync-secrets.sh`. The orchestrator does not need to pre-sync secrets.
12. Crash forensics are enabled by setting `WORKER_FORENSICS=1`. The forensics directory must be bind-mounted if the orchestrator needs to access artifacts after container destruction.
13. **Both runtimes require session IDs for resume.** When `WORKER_CONTINUE=1` is set, Claude requires `CLAUDE_SESSION_ID` and Codex requires `CODEX_THREAD_ID`. Without the respective ID, the entrypoint exits with an error. Claude uses `--resume <sessionId>` (not `--continue`, which silently creates fresh sessions in `--print` mode).
14. **Runtime selection is via `WORKER_RUNTIME`.** The entrypoint dispatches to `run_claude_attempt()` or `run_codex_attempt()` based on this env var. Default is `claude`.

---

## Container Mount Contract

```typescript
interface ContainerMounts {
  '/repo': {
    source: string;
    mode: 'rw';
    required: true;
    content: 'git-repo';
  };
  '/secrets': {
    source: string;
    mode: 'ro';
    required: true;
    files: {
      'gcp-sa.json': 'optional';
      'github-token': 'optional';
      'system-prompt.txt': 'required-for-run-attempt';
      'user-prompt.txt': 'required-for-run-attempt';
    };
  };
  '/home/claude/pnpm-store': {
    source: string;
    mode: 'rw';
    type: 'bind';
  };
  '/home/claude/.claude': {
    source: string;
    mode: 'rw';
    type: 'bind';
  };
  '/home/claude/.codex': {
    source: string;
    mode: 'rw';
    type: 'bind';
  };
  '/tmp': {
    type: 'tmpfs';
    size: '2g';
    options: 'rw,noexec,nosuid';
    runtimeFiles: {
      'worker-ready': 'written by entrypoint after setup';
    };
  };
  '/home/claude': {
    type: 'tmpfs';
    size: '500m';
    options: 'rw,noexec,nosuid,uid={HOST_UID},gid={HOST_GID}';
  };
  '/repo/node_modules': {
    type: 'tmpfs';
    size: '4g';
    options: 'rw,exec,nosuid,uid={HOST_UID},gid={HOST_GID}';
  };
}
```

---

## Usage Patterns (Few-Shot)

**Orchestrator: Start a new coding task with Claude runtime**

```typescript
const handle = await provider.createWorker({
  taskId: 'INT-500-implement-feature',
  worktreePath: '/home/user/.code-orchestrator/worktrees/INT-500',
  workerType: 'auto',
  systemPrompt: 'You are a coding agent working on IntexuraOS...',
  prompt: 'Implement the feature described in INT-500.',
  secrets: {
    ANTHROPIC_API_KEY: 'sk-ant-...',
    LINEAR_API_KEY: 'lin_api_...',
    ERROR_HUB_HOST: 'home-dev.tailnet.example:8443',
    MINIMAX_API_KEY: '',
    DASHSCOPE_API_KEY: '',
    OPENROUTER_API_KEY: '',
  },
  gcpSaKeyPath: '/home/user/.config/gcloud/sa-key.json',
  githubAppKeyPath: '/home/user/.code-orchestrator/secrets/INT-500/github-token',
  onLog: (chunk) => logForwarder.forward('INT-500', chunk),
  onComplete: (exitCode) => console.log('Attempt done:', exitCode),
});
```

**Orchestrator: Start a Codex task with high reasoning effort**

```typescript
const handle = await provider.createWorker({
  taskId: 'INT-600-complex-refactor',
  worktreePath: '/home/user/.code-orchestrator/worktrees/INT-600',
  workerType: 'codex-xhigh',
  systemPrompt: 'You are a coding agent...',
  prompt: 'Refactor the authentication module.',
  secrets: { /* ... */ },
  gcpSaKeyPath: '...',
  githubAppKeyPath: '...',
  onLog: (chunk) => logForwarder.forward('INT-600', chunk),
});
```

**Orchestrator: Resume a failed attempt**

```typescript
if (shouldResume) {
  await provider.createWorker({
    taskId: 'INT-500-implement-feature',
    // ... same config ...
    prompt: 'The previous attempt did not push a PR. Please push and open one.',
    continueSession: true,
  });
}
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

**Orchestrator: Clean up**

```typescript
await provider.destroyWorker('INT-500-implement-feature');
await provider.cleanupTaskSession?.('INT-500-implement-feature');
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

None. Code Worker does not publish Pub/Sub events. Communication is via container exit codes and log output streamed to the orchestrator.

---

## Dependencies

| Dependency                        | Why Needed                     | Failure Behavior                               |
| --------------------------------- | ------------------------------ | ---------------------------------------------- |
| Docker Engine                     | Container runtime              | Cannot start worker                            |
| Anthropic API                     | Claude runtime access          | Claude runtime exits with error                |
| OpenAI API                        | Codex runtime access           | Codex runtime exits with error                 |
| GitHub (public)                   | Push commits, create PRs       | Git operations fail                            |
| npm registry                      | pnpm install                   | Dependency install fails (non-fatal for retry) |
| GCP Secret Manager                | Environment variable sync      | Falls back to existing .envrc                  |
| Artifact Registry                 | Image pull                     | Uses cached local image                        |
