# Claude Worker Container Isolation - Implementation Plan

**Issue:** INT-430
**Created:** 2026-02-03
**Status:** Ready for Implementation

---

## Design Decisions (Locked)

All decisions below are FINAL. No guessing during implementation.

### Container Configuration

| Setting           | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| Docker SDK        | `dockerode` npm package                               |
| Base image        | `node:22-alpine`                                      |
| Claude install    | `curl -fsSL https://claude.ai/install.sh \| bash`     |
| Image registry    | `gcr.io/intexuraos-dev-pbuchman/claude-worker:latest` |
| Working directory | `/repo`                                               |
| User              | `claude` (UID 1000, non-root)                         |
| Max concurrent    | 4 containers per orchestrator                         |
| CPU limit         | 4 cores                                               |
| Memory limit      | 8GB                                                   |
| Timeout           | 2 hours                                               |
| Docker socket     | NOT mounted (no DinD)                                 |
| Root filesystem   | Read-only                                             |
| Capabilities      | ALL dropped                                           |

### Claude Execution

| Setting            | Value                                                          |
| ------------------ | -------------------------------------------------------------- |
| Mode               | Interactive (NO `--print` flag)                                |
| Entrypoint         | Direct `claude` invocation                                     |
| Input method       | Docker attach (persistent stdin connection)                    |
| Signal for waiting | None - use idle detection (no output for 10s = likely waiting) |

### Paths

| Path                               | Purpose                               |
| ---------------------------------- | ------------------------------------- |
| `~/.intexuraos/worktrees/{taskId}` | Host path for git worktrees           |
| `/repo`                            | Container mount point for worktree    |
| `/secrets`                         | Container mount point for credentials |
| `/secrets/github-token`            | Refreshed GitHub token file           |
| `/secrets/gcp-sa.json`             | GCP service account key               |
| `/tmp`                             | Container tmpfs (ephemeral)           |

### Secrets

| Secret              | Source            | Delivery                        | Refresh           |
| ------------------- | ----------------- | ------------------------------- | ----------------- |
| `ANTHROPIC_API_KEY` | Orchestrator env  | Container env var               | None (long-lived) |
| `GITHUB_TOKEN`      | GitHub App mint   | File at `/secrets/github-token` | Every 30 min      |
| `LINEAR_API_KEY`    | Orchestrator env  | Container env var               | None (long-lived) |
| `SENTRY_AUTH_TOKEN` | Orchestrator env  | Container env var               | None (long-lived) |
| `ZAI_API_KEY`       | Orchestrator env  | Container env var               | None (long-lived) |
| GCP SA              | Orchestrator file | File at `/secrets/gcp-sa.json`  | None (key file)   |

### Network Isolation

**Allowed:**

- Full public internet (required for web search, npm, APIs)

**Blocked (via iptables in entrypoint):**

- `169.254.169.254` - Cloud metadata server
- `127.0.0.0/8` - Localhost
- `10.0.0.0/8` - Private IPs
- `172.16.0.0/12` - Private IPs (Docker range)
- `192.168.0.0/16` - Private IPs
- `169.254.0.0/16` - Link-local

### Error Handling

| Scenario                   | Action                                    |
| -------------------------- | ----------------------------------------- |
| Container fails to start   | Mark task as `failed`, no retry           |
| Container crashes mid-task | Mark task as `failed`, no retry           |
| Timeout exceeded           | Kill container, mark task as `timeout`    |
| Network error              | Depends on operation, generally fail task |

### Worker Service Account (MVP)

Using existing SA for MVP (risk accepted):

- **Email:** `claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com`
- **Key file:** `~/personal/gcloud-claude-code-dev.json`
- **Future:** INT-492 for dedicated worker SA with minimal permissions

### Worker Type Configuration

Worker types (opus, auto, glm) are configuration presets. Each type configures Claude with specific API endpoints and keys.

```typescript
// workers/orchestrator/src/services/isolation/worker-types.ts

export type WorkerType = 'opus' | 'auto' | 'glm';

export interface WorkerTypeConfig {
  apiBaseUrl: string;
  apiKeyEnvVar: 'ANTHROPIC_API_KEY' | 'ZAI_API_KEY';
  model?: string; // Optional model override
}

export const WORKER_TYPES: Record<WorkerType, WorkerTypeConfig> = {
  opus: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    model: 'claude-opus-4-5-20251101',
  },
  auto: {
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    // No model override - uses Claude Code default
  },
  glm: {
    apiBaseUrl: 'https://api.z.ai/api/anthropic',
    apiKeyEnvVar: 'ZAI_API_KEY',
    // GLM proxy handles model selection
  },
};
```

**Container environment from worker type:**

| Worker Type | `ANTHROPIC_BASE_URL`             | `ANTHROPIC_API_KEY` source |
| ----------- | -------------------------------- | -------------------------- |
| `opus`      | `https://api.anthropic.com`      | `ANTHROPIC_API_KEY` env    |
| `auto`      | `https://api.anthropic.com`      | `ANTHROPIC_API_KEY` env    |
| `glm`       | `https://api.z.ai/api/anthropic` | `ZAI_API_KEY` env          |

---

## Orchestrator Changes

### Components That Stay (Unchanged)

| File                           | Purpose                              |
| ------------------------------ | ------------------------------------ |
| `main.ts`                      | HTTP server, routes, background jobs |
| `routes/*.ts`                  | All API routes                       |
| `services/worktree-manager.ts` | Git worktree creation/cleanup        |
| `services/github-service.ts`   | GitHub App token minting             |
| `services/log-manager.ts`      | Log streaming to Firestore           |
| `lib/logger.ts`                | Pino logger setup                    |

### Components That Change

| File                          | Change                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `start.ts`                    | Wire `DockerProvider` instead of `TmuxManager`                                        |
| `services/task-dispatcher.ts` | Use `IsolationProvider.createWorker()` instead of `TmuxManager.startSession()`        |
| `services/task-monitor.ts`    | Use `IsolationProvider.isWorkerRunning()` instead of `TmuxManager.isSessionRunning()` |

### New Components

| File                                    | Purpose                       |
| --------------------------------------- | ----------------------------- |
| `services/isolation/types.ts`           | `IsolationProvider` interface |
| `services/isolation/docker-provider.ts` | Docker implementation         |
| `services/isolation/token-refresher.ts` | GitHub token refresh logic    |
| `services/isolation/worker-types.ts`    | Worker type configurations    |
| `services/isolation/index.ts`           | Factory and exports           |

### Deprecated (Kept for Fallback)

| File                       | Reason                         |
| -------------------------- | ------------------------------ |
| `services/tmux-manager.ts` | Fallback if Docker unavailable |

---

## Deployment

### Cloud Deployment (GCE VM)

Cloud Run does NOT support Docker socket access. Orchestrator must run on GCE VM with Docker installed.

**VM Configuration:**

| Setting      | Value                              |
| ------------ | ---------------------------------- |
| Machine type | `e2-standard-4` (4 vCPU, 16GB RAM) |
| Zone         | `us-central1-a`                    |
| Boot disk    | Ubuntu 22.04 LTS, 50GB SSD         |
| Docker       | Installed via apt                  |
| Startup      | Systemd service for orchestrator   |

**Terraform resources:**

```hcl
# terraform/modules/orchestrator-vm/main.tf

resource "google_compute_instance" "orchestrator" {
  name         = "orchestrator-${var.environment}"
  machine_type = "e2-standard-4"
  zone         = "us-central1-a"

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 50
    }
  }

  network_interface {
    network = "default"
    access_config {}  # Public IP for webhook access
  }

  metadata_startup_script = file("${path.module}/startup.sh")

  service_account {
    email  = google_service_account.orchestrator.email
    scopes = ["cloud-platform"]
  }

  tags = ["orchestrator", "http-server", "https-server"]
}
```

**Startup script installs:**

- Docker (apt)
- Node.js 22 (nvm)
- PM2 (process manager)
- Claude worker image (pulled from GCR)

### Local Development

```bash
# Start orchestrator locally
cd workers/orchestrator
pnpm start

# Or with PM2 (ecosystem.config.cjs)
pnpm dev
```

**Prerequisites:**

- Docker Desktop running
- Worker image built: `./scripts/build-worker-image.sh`
- Worker network created: `./scripts/setup-worker-network.sh`
- Environment variables set (see `.env.example`)

---

## IsolationProvider Interface

```typescript
// workers/orchestrator/src/services/isolation/types.ts

export interface WorkerConfig {
  taskId: string;
  worktreePath: string; // Host path to git worktree
  prompt: string; // Initial prompt for Claude
  systemPrompt: string; // System prompt
  secrets: {
    ANTHROPIC_API_KEY: string;
    LINEAR_API_KEY: string;
    SENTRY_AUTH_TOKEN: string;
    ZAI_API_KEY: string;
  };
  gcpSaKeyPath: string; // Host path to GCP SA JSON
  githubAppKeyPath: string; // Host path to GitHub App private key
  onLog?: (chunk: string) => void;
  onComplete?: (exitCode: number) => void;
}

export interface WorkerHandle {
  taskId: string;
  containerId: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'timeout';
  startedAt: Date;
}

export interface ResourceUsage {
  cpuPercent: number;
  memoryUsedMB: number;
  memoryLimitMB: number;
}

export interface IsolationProvider {
  /**
   * Create and start an isolated worker container.
   * - Creates container with security controls
   * - Mounts worktree at /repo
   * - Mounts secrets at /secrets
   * - Starts Claude in interactive mode
   */
  createWorker(config: WorkerConfig): Promise<WorkerHandle>;

  /**
   * Forcefully terminate a worker.
   * - Sends SIGTERM, waits 10s
   * - If still running, SIGKILL
   * - Removes container
   */
  destroyWorker(taskId: string): Promise<void>;

  /**
   * Check if worker container is still running.
   */
  isWorkerRunning(taskId: string): Promise<boolean>;

  /**
   * Get all logs from worker container.
   */
  getWorkerLogs(taskId: string): Promise<string>;

  /**
   * Stream logs from worker in real-time.
   */
  streamLogs(taskId: string, onChunk: (chunk: string) => void): Promise<void>;

  /**
   * Wait for worker to complete or timeout.
   * @returns Exit code (0 = success, -1 = timeout, other = failure)
   */
  waitForCompletion(taskId: string, timeoutMs: number): Promise<number>;

  /**
   * Send input to running Claude session.
   * Uses Docker attach to write to container stdin.
   */
  sendInput(taskId: string, input: string): Promise<void>;

  /**
   * Attach to container TTY for interactive debugging.
   * Returns streams for stdin/stdout/stderr.
   */
  attachTTY(taskId: string): Promise<{
    stdin: NodeJS.WritableStream;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    detach: () => void;
  }>;

  /**
   * Get current resource usage of worker container.
   */
  getResourceUsage(taskId: string): Promise<ResourceUsage>;

  /**
   * List all running worker containers.
   */
  listWorkers(): Promise<WorkerHandle[]>;
}
```

---

## File Structure

```
workers/
├── claude-worker/                    # Container image
│   ├── Dockerfile                    # Container definition
│   └── entrypoint.sh                 # Container entrypoint script
│
└── orchestrator/
    └── src/
        └── services/
            └── isolation/
                ├── types.ts              # Interface definitions
                ├── docker-provider.ts    # Docker implementation
                ├── index.ts              # Factory and exports
                ├── token-refresher.ts    # Token refresh logic
                └── __tests__/
                    ├── docker-provider.test.ts   # Unit tests
                    └── e2e-container.test.ts     # E2E tests

scripts/
└── build-worker-image.sh             # Build and push container image
```

---

## Implementation Steps

### Phase 1: Container Image (Day 1)

#### Step 1.1: Create Dockerfile

**File:** `workers/claude-worker/Dockerfile`

```dockerfile
FROM node:22-alpine

# Install required tools
# Based on command usage analysis (1,935 commands across 6 worktrees):
#   - git: 317 uses (16.4%)
#   - pnpm: 248 uses (12.8%) - CRITICAL for CI
#   - grep/rg: 160 uses (8.3%) - rg preferred per CLAUDE.md
#   - gh: 51 uses (2.6%) - PR creation
#   - jq: 101 uses - JSON processing
#   - bat: 0 uses but CLAUDE.md mandates it for CI analysis
RUN apk add --no-cache \
    git \
    openssh-client \
    curl \
    bash \
    iptables \
    jq \
    terraform \
    # Tools missing from original plan (identified via usage analysis):
    ripgrep \
    github-cli \
    bat \
    fd \
    && rm -rf /var/cache/apk/*

# Install pnpm (CRITICAL - 248 uses, can't run CI without it)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install gcloud CLI (369 uses - most used tool)
RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts --install-dir=/opt
ENV PATH="/opt/google-cloud-sdk/bin:${PATH}"

# Install Claude CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Create non-root user
RUN addgroup -S claude && adduser -S claude -u 1000

# Set up directories
RUN mkdir -p /repo /secrets /tmp && \
    chown -R claude:claude /repo /secrets /tmp

# Copy entrypoint
COPY --chown=claude:claude entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Security: Remove unnecessary tools
RUN rm -f /usr/bin/wget /usr/bin/nc 2>/dev/null || true

# Set environment
ENV HOME=/home/claude
ENV NODE_ENV=production
ENV GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json

# Switch to non-root user
USER claude
WORKDIR /repo

ENTRYPOINT ["/entrypoint.sh"]
```

#### Step 1.2: Create entrypoint.sh

**File:** `workers/claude-worker/entrypoint.sh`

```bash
#!/bin/bash
set -euo pipefail

# ==============================================================================
# Claude Worker Container Entrypoint
# ==============================================================================

echo "[entrypoint] Claude worker starting at $(date)"
echo "[entrypoint] Task ID: ${TASK_ID:-unknown}"

# ------------------------------------------------------------------------------
# Security: Verify non-root
# ------------------------------------------------------------------------------
if [ "$(id -u)" = "0" ]; then
    echo "[entrypoint] ERROR: Running as root is forbidden" >&2
    exit 1
fi
echo "[entrypoint] Running as user: $(whoami) (uid=$(id -u))"

# ------------------------------------------------------------------------------
# Security: Apply network restrictions (requires CAP_NET_ADMIN, done via --cap-add)
# Note: iptables rules are applied by orchestrator before container starts
# This is a fallback verification
# ------------------------------------------------------------------------------
verify_network_restrictions() {
    # These should fail if restrictions are working
    if curl -s --max-time 1 http://169.254.169.254/ >/dev/null 2>&1; then
        echo "[entrypoint] WARNING: Metadata server is accessible!" >&2
    fi
    if curl -s --max-time 1 http://127.0.0.1:8080/ >/dev/null 2>&1; then
        echo "[entrypoint] WARNING: Localhost is accessible!" >&2
    fi
}

# Verify in background (don't block startup)
verify_network_restrictions &

# ------------------------------------------------------------------------------
# Verify mounts
# ------------------------------------------------------------------------------
if [ ! -d "/repo/.git" ]; then
    echo "[entrypoint] ERROR: /repo must be a git repository" >&2
    exit 1
fi
echo "[entrypoint] Worktree verified: /repo"

if [ ! -f "/secrets/gcp-sa.json" ]; then
    echo "[entrypoint] WARNING: GCP SA not mounted at /secrets/gcp-sa.json"
fi

# ------------------------------------------------------------------------------
# Activate GCP credentials
# ------------------------------------------------------------------------------
if [ -f "/secrets/gcp-sa.json" ]; then
    echo "[entrypoint] Activating GCP service account..."
    gcloud auth activate-service-account --key-file=/secrets/gcp-sa.json 2>/dev/null || true
fi

# ------------------------------------------------------------------------------
# Set up GitHub token (refreshed by orchestrator)
# ------------------------------------------------------------------------------
setup_github_token() {
    if [ -f "/secrets/github-token" ]; then
        export GITHUB_TOKEN=$(cat /secrets/github-token)
        echo "[entrypoint] GitHub token loaded"
    else
        echo "[entrypoint] WARNING: GitHub token not found at /secrets/github-token"
    fi
}
setup_github_token

# Watch for token refresh in background
(
    while true; do
        sleep 60
        if [ -f "/secrets/github-token" ]; then
            NEW_TOKEN=$(cat /secrets/github-token)
            if [ "$NEW_TOKEN" != "${GITHUB_TOKEN:-}" ]; then
                export GITHUB_TOKEN="$NEW_TOKEN"
                echo "[entrypoint] GitHub token refreshed"
            fi
        fi
    done
) &

# ------------------------------------------------------------------------------
# Start Claude in interactive mode
# ------------------------------------------------------------------------------
echo "[entrypoint] Starting Claude..."
echo "[entrypoint] Working directory: $(pwd)"
echo "[entrypoint] Git branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"

# Execute Claude without --print (interactive mode)
# stdin/stdout connected directly for sendInput() to work
exec claude
```

#### Step 1.3: Create build script

**File:** `scripts/build-worker-image.sh`

```bash
#!/bin/bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
IMAGE_NAME="gcr.io/${PROJECT_ID}/claude-worker"
IMAGE_TAG="${1:-latest}"

echo "Building Claude worker image..."
echo "Image: ${IMAGE_NAME}:${IMAGE_TAG}"

# Build
docker build \
    -t "${IMAGE_NAME}:${IMAGE_TAG}" \
    -f workers/claude-worker/Dockerfile \
    workers/claude-worker/

echo "Build complete."

# Push if requested
if [ "${PUSH:-false}" = "true" ]; then
    echo "Pushing to GCR..."
    docker push "${IMAGE_NAME}:${IMAGE_TAG}"
    echo "Push complete."
fi

echo "Done: ${IMAGE_NAME}:${IMAGE_TAG}"
```

---

### Phase 2: IsolationProvider Interface (Day 1)

#### Step 2.1: Create types.ts

**File:** `workers/orchestrator/src/services/isolation/types.ts`

Full interface as defined above in the Interface section.

---

### Phase 3: DockerProvider Implementation (Day 2-3)

#### Step 3.1: Create docker-provider.ts

**File:** `workers/orchestrator/src/services/isolation/docker-provider.ts`

```typescript
import Docker from 'dockerode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@intexuraos/common-core';
import type { IsolationProvider, WorkerConfig, WorkerHandle, ResourceUsage } from './types.js';

export interface DockerProviderConfig {
  imageName: string;
  networkName: string;
  maxConcurrent: number;
  memoryLimitBytes: number;
  cpuCount: number;
  timeoutMs: number;
  secretsBasePath: string;
}

const DEFAULT_CONFIG: DockerProviderConfig = {
  imageName: 'gcr.io/intexuraos-dev-pbuchman/claude-worker:latest',
  networkName: 'claude-worker-net',
  maxConcurrent: 4,
  memoryLimitBytes: 8 * 1024 * 1024 * 1024, // 8GB
  cpuCount: 4,
  timeoutMs: 2 * 60 * 60 * 1000, // 2 hours
  secretsBasePath: '/tmp/claude-secrets',
};

export class DockerProvider implements IsolationProvider {
  private readonly docker: Docker;
  private readonly config: DockerProviderConfig;
  private readonly logger: Logger;
  private readonly workers: Map<
    string,
    {
      containerId: string;
      handle: WorkerHandle;
      attachStream?: NodeJS.ReadWriteStream;
    }
  >;

  constructor(config: Partial<DockerProviderConfig>, logger: Logger) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.workers = new Map();
  }

  async createWorker(config: WorkerConfig): Promise<WorkerHandle> {
    const { taskId, worktreePath, prompt, systemPrompt, secrets } = config;

    // Check concurrency limit
    if (this.workers.size >= this.config.maxConcurrent) {
      throw new Error(`Max concurrent workers (${this.config.maxConcurrent}) reached`);
    }

    // Validate worktree
    const gitPath = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitPath)) {
      throw new Error(`Invalid worktree: ${worktreePath} (no .git directory)`);
    }

    // Prepare secrets directory for this task
    const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
    await fs.promises.mkdir(taskSecretsPath, { recursive: true, mode: 0o700 });

    // Write initial GitHub token (will be refreshed)
    // Token minting happens in token-refresher.ts

    // Copy GCP SA key
    if (config.gcpSaKeyPath && fs.existsSync(config.gcpSaKeyPath)) {
      await fs.promises.copyFile(config.gcpSaKeyPath, path.join(taskSecretsPath, 'gcp-sa.json'));
    }

    // Build environment variables
    const env = [
      `TASK_ID=${taskId}`,
      `ANTHROPIC_API_KEY=${secrets.ANTHROPIC_API_KEY}`,
      `LINEAR_API_KEY=${secrets.LINEAR_API_KEY}`,
      `SENTRY_AUTH_TOKEN=${secrets.SENTRY_AUTH_TOKEN}`,
      `ZAI_API_KEY=${secrets.ZAI_API_KEY}`,
      `GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json`,
    ];

    // Create container
    this.logger.info({ taskId, worktreePath }, 'Creating worker container');

    const container = await this.docker.createContainer({
      Image: this.config.imageName,
      name: `claude-worker-${taskId}`,
      Env: env,
      WorkingDir: '/repo',
      User: '1000:1000',
      OpenStdin: true, // Required for sendInput()
      Tty: true, // Required for interactive mode
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        Binds: [`${worktreePath}:/repo:rw`, `${taskSecretsPath}:/secrets:ro`],
        Memory: this.config.memoryLimitBytes,
        NanoCpus: this.config.cpuCount * 1e9,
        NetworkMode: this.config.networkName,
        ReadonlyRootfs: true,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=2g',
          '/home/claude': 'rw,noexec,nosuid,size=100m',
        },
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        AutoRemove: false,
      },
    });

    // Start container
    await container.start();

    // Attach to stdin/stdout for sendInput()
    const attachStream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    });

    // Send initial prompt to Claude
    attachStream.write(prompt + '\n');

    const handle: WorkerHandle = {
      taskId,
      containerId: container.id,
      status: 'running',
      startedAt: new Date(),
    };

    this.workers.set(taskId, {
      containerId: container.id,
      handle,
      attachStream,
    });

    // Set up log streaming if callback provided
    if (config.onLog) {
      attachStream.on('data', (chunk: Buffer) => {
        config.onLog!(chunk.toString('utf-8'));
      });
    }

    // Set up completion handler
    container
      .wait()
      .then(async (data) => {
        const worker = this.workers.get(taskId);
        if (worker) {
          worker.handle.status = data.StatusCode === 0 ? 'completed' : 'failed';
        }
        if (config.onComplete) {
          config.onComplete(data.StatusCode);
        }
      })
      .catch((err) => {
        this.logger.error({ taskId, error: err }, 'Container wait error');
      });

    this.logger.info({ taskId, containerId: container.id }, 'Worker container started');

    return handle;
  }

  async destroyWorker(taskId: string): Promise<void> {
    const worker = this.workers.get(taskId);
    if (!worker) {
      this.logger.warn({ taskId }, 'Worker not found for destroy');
      return;
    }

    this.logger.info({ taskId }, 'Destroying worker container');

    try {
      const container = this.docker.getContainer(worker.containerId);

      // Try graceful stop first (10s timeout)
      try {
        await container.stop({ t: 10 });
      } catch (err) {
        // Container might already be stopped
        this.logger.debug({ taskId, error: err }, 'Stop failed (may already be stopped)');
      }

      // Force remove
      try {
        await container.remove({ force: true });
      } catch (err) {
        this.logger.debug({ taskId, error: err }, 'Remove failed');
      }

      // Clean up secrets
      const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
      await fs.promises.rm(taskSecretsPath, { recursive: true, force: true });
    } finally {
      this.workers.delete(taskId);
    }

    this.logger.info({ taskId }, 'Worker container destroyed');
  }

  async isWorkerRunning(taskId: string): Promise<boolean> {
    const worker = this.workers.get(taskId);
    if (!worker) return false;

    try {
      const container = this.docker.getContainer(worker.containerId);
      const info = await container.inspect();
      return info.State.Running;
    } catch {
      return false;
    }
  }

  async getWorkerLogs(taskId: string): Promise<string> {
    const worker = this.workers.get(taskId);
    if (!worker) return '';

    try {
      const container = this.docker.getContainer(worker.containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        timestamps: true,
      });
      return logs.toString('utf-8');
    } catch {
      return '';
    }
  }

  async streamLogs(taskId: string, onChunk: (chunk: string) => void): Promise<void> {
    const worker = this.workers.get(taskId);
    if (!worker) {
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
    if (!worker) return -1;

    const container = this.docker.getContainer(worker.containerId);

    return new Promise((resolve) => {
      const timeout = setTimeout(async () => {
        this.logger.warn({ taskId }, 'Worker timeout, destroying');
        worker.handle.status = 'timeout';
        await this.destroyWorker(taskId);
        resolve(-1);
      }, timeoutMs);

      container
        .wait()
        .then((data) => {
          clearTimeout(timeout);
          resolve(data.StatusCode);
        })
        .catch((err) => {
          clearTimeout(timeout);
          this.logger.error({ taskId, error: err }, 'Wait error');
          resolve(-1);
        });
    });
  }

  async sendInput(taskId: string, input: string): Promise<void> {
    const worker = this.workers.get(taskId);
    if (!worker) {
      throw new Error(`Worker ${taskId} not found`);
    }

    if (!worker.attachStream) {
      throw new Error(`Worker ${taskId} has no attached stream`);
    }

    this.logger.debug({ taskId, inputLength: input.length }, 'Sending input to worker');
    worker.attachStream.write(input + '\n');
  }

  async attachTTY(taskId: string): Promise<{
    stdin: NodeJS.WritableStream;
    stdout: NodeJS.ReadableStream;
    stderr: NodeJS.ReadableStream;
    detach: () => void;
  }> {
    const worker = this.workers.get(taskId);
    if (!worker) {
      throw new Error(`Worker ${taskId} not found`);
    }

    const container = this.docker.getContainer(worker.containerId);

    const exec = await container.exec({
      Cmd: ['/bin/bash'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });

    const stream = await exec.start({
      hijack: true,
      stdin: true,
      Tty: true,
    });

    return {
      stdin: stream,
      stdout: stream,
      stderr: stream,
      detach: () => stream.end(),
    };
  }

  async getResourceUsage(taskId: string): Promise<ResourceUsage> {
    const worker = this.workers.get(taskId);
    if (!worker) {
      throw new Error(`Worker ${taskId} not found`);
    }

    const container = this.docker.getContainer(worker.containerId);
    const stats = await container.stats({ stream: false });

    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;

    return {
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memoryUsedMB: Math.round(stats.memory_stats.usage / 1024 / 1024),
      memoryLimitMB: Math.round(stats.memory_stats.limit / 1024 / 1024),
    };
  }

  async listWorkers(): Promise<WorkerHandle[]> {
    return Array.from(this.workers.values()).map((w) => w.handle);
  }
}
```

---

### Phase 4: Token Refresher (Day 3)

#### Step 4.1: Create token-refresher.ts

**File:** `workers/orchestrator/src/services/isolation/token-refresher.ts`

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@intexuraos/common-core';

export interface TokenRefresherConfig {
  secretsBasePath: string;
  githubAppId: string;
  githubAppPrivateKeyPath: string;
  githubInstallationId: string;
  refreshIntervalMs: number;
}

export class TokenRefresher {
  private readonly config: TokenRefresherConfig;
  private readonly logger: Logger;
  private readonly activeTaskIds: Set<string>;
  private intervalHandle?: NodeJS.Timeout;

  constructor(config: TokenRefresherConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.activeTaskIds = new Set();
  }

  /**
   * Start refreshing tokens for a task.
   */
  async registerTask(taskId: string): Promise<void> {
    this.activeTaskIds.add(taskId);
    await this.refreshTokenForTask(taskId);

    // Start refresh loop if not running
    if (!this.intervalHandle) {
      this.intervalHandle = setInterval(
        () => this.refreshAllTokens(),
        this.config.refreshIntervalMs
      );
    }
  }

  /**
   * Stop refreshing tokens for a task.
   */
  unregisterTask(taskId: string): void {
    this.activeTaskIds.delete(taskId);

    // Stop refresh loop if no active tasks
    if (this.activeTaskIds.size === 0 && this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /**
   * Mint a new GitHub installation token.
   */
  private async mintGitHubToken(): Promise<string> {
    // Implementation uses GitHub App JWT + installation token exchange
    // See: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app

    const jwt = await this.createGitHubAppJWT();

    const response = await fetch(
      `https://api.github.com/app/installations/${this.config.githubInstallationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub token mint failed: ${response.status}`);
    }

    const data = await response.json();
    return data.token;
  }

  private async createGitHubAppJWT(): Promise<string> {
    const privateKey = await fs.promises.readFile(this.config.githubAppPrivateKeyPath, 'utf-8');

    // JWT creation with RS256
    // Using jsonwebtoken or jose library
    const { SignJWT } = await import('jose');
    const key = await import('crypto').then((c) => c.createPrivateKey(privateKey));

    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(this.config.githubAppId)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);

    return jwt;
  }

  private async refreshTokenForTask(taskId: string): Promise<void> {
    const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
    const tokenPath = path.join(taskSecretsPath, 'github-token');

    try {
      const token = await this.mintGitHubToken();
      await fs.promises.writeFile(tokenPath, token, { mode: 0o600 });
      this.logger.info({ taskId }, 'GitHub token refreshed');
    } catch (error) {
      this.logger.error({ taskId, error }, 'Failed to refresh GitHub token');
    }
  }

  private async refreshAllTokens(): Promise<void> {
    for (const taskId of this.activeTaskIds) {
      await this.refreshTokenForTask(taskId);
    }
  }
}
```

---

### Phase 5: Network Setup (Day 3)

#### Step 5.1: Create Docker network with isolation

```bash
#!/bin/bash
# scripts/setup-worker-network.sh

NETWORK_NAME="claude-worker-net"

# Create network if not exists
if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    echo "Creating Docker network: $NETWORK_NAME"
    docker network create \
        --driver bridge \
        --opt com.docker.network.bridge.enable_ip_masquerade=true \
        --subnet 172.28.0.0/16 \
        "$NETWORK_NAME"
fi

# Apply iptables rules for network isolation
# Block metadata server
sudo iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
# Block localhost from containers
sudo iptables -I DOCKER-USER -d 127.0.0.0/8 -j DROP
# Block private IP ranges
sudo iptables -I DOCKER-USER -d 10.0.0.0/8 -j DROP
sudo iptables -I DOCKER-USER -d 172.16.0.0/12 -j DROP
sudo iptables -I DOCKER-USER -d 192.168.0.0/16 -j DROP

echo "Network setup complete."
```

---

### Phase 6: Integration (Day 4)

#### Step 6.1: Update task-dispatcher.ts

Modify `workers/orchestrator/src/services/task-dispatcher.ts` to use IsolationProvider instead of TmuxManager.

#### Step 6.2: Create provider factory

**File:** `workers/orchestrator/src/services/isolation/index.ts`

```typescript
import type { Logger } from '@intexuraos/common-core';
import { DockerProvider, type DockerProviderConfig } from './docker-provider.js';
import type { IsolationProvider } from './types.js';

export type ProviderType = 'docker' | 'local';

export function createIsolationProvider(
  type: ProviderType,
  config: Partial<DockerProviderConfig>,
  logger: Logger
): IsolationProvider {
  switch (type) {
    case 'docker':
      return new DockerProvider(config, logger);
    case 'local':
      // Fallback to TmuxManager wrapper for local debugging
      throw new Error('Local provider not implemented - use docker');
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

export * from './types.js';
export * from './docker-provider.js';
export * from './token-refresher.js';
```

---

### Phase 7: Testing (Day 4-5)

#### Step 7.1: Unit tests

**File:** `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

**Test Cases (Unit - mocked Docker):**

| Test Case                                             | Description                                                |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `createWorker - starts container with correct config` | Verifies container config: image, mounts, env vars, limits |
| `createWorker - enforces concurrency limit`           | Rejects when max concurrent reached                        |
| `createWorker - validates worktree exists`            | Throws if worktree path invalid                            |
| `destroyWorker - stops and removes container`         | Graceful stop (10s) then force remove                      |
| `destroyWorker - handles already stopped`             | No error if container already stopped                      |
| `destroyWorker - cleans up secrets dir`               | Removes task secrets from filesystem                       |
| `isWorkerRunning - returns true when running`         | Container inspect shows Running: true                      |
| `isWorkerRunning - returns false when stopped`        | Container inspect shows Running: false                     |
| `isWorkerRunning - returns false when not found`      | No container with that ID                                  |
| `sendInput - writes to attach stream`                 | Input string written with newline                          |
| `sendInput - throws if no stream`                     | No attached stream for task                                |
| `waitForCompletion - returns exit code`               | Container exits with code                                  |
| `waitForCompletion - returns -1 on timeout`           | Kills container, returns -1                                |
| `getWorkerLogs - returns container logs`              | Logs from stdout/stderr                                    |
| `listWorkers - returns all handles`                   | Active workers in map                                      |

#### Step 7.2: E2E tests

**File:** `workers/orchestrator/src/services/isolation/__tests__/e2e-container.test.ts`

**E2E approach:** Use Docker-in-Docker in GitHub Actions. Mock Claude binary with a stub script that echoes input.

**Mock Claude stub:**

```bash
#!/bin/bash
# test-fixtures/claude-stub.sh
# Simulates Claude CLI for E2E testing

echo "[claude-stub] Started"
echo "[claude-stub] Working directory: $(pwd)"
echo "[claude-stub] Git branch: $(git branch --show-current 2>/dev/null || echo 'no-git')"

# Read and echo input (simulates interactive mode)
while IFS= read -r line; do
  echo "[claude-stub] Received: $line"

  # Simulate response to specific inputs
  case "$line" in
    "exit"|"quit")
      echo "[claude-stub] Exiting..."
      exit 0
      ;;
    "error")
      echo "[claude-stub] Simulating error..."
      exit 1
      ;;
    *)
      echo "[claude-stub] Acknowledged"
      ;;
  esac
done

echo "[claude-stub] stdin closed, exiting"
exit 0
```

**Test Cases (E2E - real Docker):**

| Test Case                        | Description                                    |
| -------------------------------- | ---------------------------------------------- |
| `container starts and runs stub` | Container starts, stub executes, logs captured |
| `worktree mounted at /repo`      | Stub can read files from mounted worktree      |
| `secrets mounted at /secrets`    | Stub can read github-token file                |
| `sendInput delivers message`     | Input appears in stub's received logs          |
| `network blocks metadata server` | `curl 169.254.169.254` fails/times out         |
| `network blocks localhost`       | `curl 127.0.0.1:8080` fails                    |
| `network allows public internet` | `curl https://api.github.com` succeeds         |
| `timeout kills container`        | Container killed after timeout, exit -1        |
| `resource limits enforced`       | Memory limit reflected in cgroup               |

**E2E Dockerfile (test-only):**

```dockerfile
# workers/claude-worker/Dockerfile.test
# Uses stub instead of real Claude for E2E tests

FROM node:22-alpine

# Match production image tools for accurate testing
RUN apk add --no-cache git bash curl iptables ripgrep github-cli bat fd jq

# pnpm for CI commands
RUN corepack enable && corepack prepare pnpm@latest --activate

RUN addgroup -S claude && adduser -S claude -G claude -u 1000
RUN mkdir -p /repo /secrets /tmp && chown -R claude:claude /repo /secrets /tmp

# Copy stub instead of installing real Claude
COPY test-fixtures/claude-stub.sh /usr/local/bin/claude
RUN chmod +x /usr/local/bin/claude

COPY --chown=claude:claude entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV HOME=/home/claude
USER claude
WORKDIR /repo

ENTRYPOINT ["/entrypoint.sh"]
```

---

## CI/CD Integration

### GitHub Actions workflow update

E2E isolation tests run **in parallel** with other CI jobs (not sequential).

```yaml
# .github/workflows/ci.yml

name: CI

on:
  push:
    branches: [main, development]
  pull_request:
    branches: [main, development]

jobs:
  # Existing jobs run in parallel
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  # NEW: E2E isolation tests run IN PARALLEL with above
  e2e-isolation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build test worker image
        run: |
          docker build \
            -t claude-worker:test \
            -f workers/claude-worker/Dockerfile.test \
            workers/claude-worker/

      - name: Create worker network
        run: |
          docker network create \
            --driver bridge \
            --subnet 172.28.0.0/16 \
            claude-worker-net

      - name: Run E2E isolation tests
        run: pnpm --filter orchestrator test:e2e
        env:
          WORKER_IMAGE: claude-worker:test
          WORKER_NETWORK: claude-worker-net
```

**Key points:**

- All jobs (`typecheck`, `lint`, `test`, `e2e-isolation`) run in parallel
- E2E tests use test image with Claude stub (no real Claude API calls)
- Docker network created in workflow (no privileged DinD needed)
- Standard GitHub-hosted runner has Docker installed

---

## Tool Usage Analysis (2026-02-03)

Analysis of 1,935 commands across 6 parallel worktrees (`intexuraos-1` through `intexuraos-6`).

### Top Tools by Usage

| Rank | Tool     | Count | %     | Notes                        |
| ---- | -------- | ----- | ----- | ---------------------------- |
| 1    | `gcloud` | 369   | 19.1% | Cloud/infra operations       |
| 2    | `git`    | 317   | 16.4% | VCS operations               |
| 3    | `pnpm`   | 248   | 12.8% | **CRITICAL** - builds/tests  |
| 4    | `grep`   | 127   | 6.6%  | Should prefer `rg`           |
| 5    | `ls`     | 103   | 5.3%  | Filesystem                   |
| 6    | `jq`     | 101   | 5.2%  | JSON processing              |
| 7    | `cat`    | 82    | 4.2%  | File reading                 |
| 8    | `find`   | 62    | 3.2%  | Should prefer `fd`           |
| 9    | `vitest` | 60    | 3.1%  | Testing                      |
| 10   | `gh`     | 51    | 2.6%  | GitHub CLI                   |
| 11   | `sleep`  | 51    | 2.6%  | **BAD** - polling loops      |
| 12   | `rg`     | 33    | 1.7%  | CLAUDE.md recommends this    |
| 13   | `bat`    | 0     | 0%    | **GAP** - CLAUDE.md mandates |

### Key Findings

1. **Missing from original Dockerfile:** `pnpm`, `gh`, `rg`, `bat`, `fd`
2. **Polling anti-pattern:** 51 `sleep` commands vs only 10 `--watch`/`--stream` uses
3. **`bat` never used:** Despite CLAUDE.md explicitly mandating it for CI analysis
4. **`grep` over `rg`:** 127 vs 33 uses, opposite of CLAUDE.md recommendation

### Polling Examples Found (Anti-pattern)

```bash
# These should use streaming alternatives
sleep 60 && gcloud compute ssh predev-xf70 --command="..."
sleep 90 && gcloud compute instances list --filter="name~predev"
sleep 180 && gcloud compute instances list --filter="name~predev"
```

### Related Issues

- **INT-493:** Enforce streaming/watch over sleep/polling for token efficiency
- **INT-494:** Enforce CLAUDE.md tool recommendations via hooks

---

## Rollback Plan

If issues arise after deployment:

1. **Immediate:** Set `ISOLATION_PROVIDER=local` in orchestrator env, restart
2. **Investigate:** Check orchestrator logs, docker logs, container state
3. **Fix forward:** Update worker image, rebuild, redeploy

---

## Acceptance Checklist

- [ ] Worker image builds successfully
- [ ] Container starts with correct security controls
- [ ] Worktree mounted at /repo (read-write)
- [ ] Secrets mounted at /secrets (read-only)
- [ ] Network: public internet works
- [ ] Network: metadata server blocked
- [ ] Network: localhost blocked
- [ ] sendInput() delivers messages to Claude
- [ ] attachTTY() allows interactive debugging
- [ ] Token refresh works (GitHub token updated every 30min)
- [ ] Logs stream in real-time
- [ ] Timeout kills container after 2h
- [ ] All unit tests pass
- [ ] All E2E tests pass
- [ ] `pnpm run ci:tracked` passes
- [ ] **Tools verified in image:** `pnpm`, `gh`, `rg`, `bat`, `fd`, `jq`, `gcloud`
