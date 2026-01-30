# Claude Worker Complete Isolation Plan

**Version:** 1.0
**Created:** 2026-01-30
**Target Audience:** AI Agents (LLMs) executing this plan

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Security Requirements](#2-security-requirements)
3. [Architecture Options Analysis](#3-architecture-options-analysis)
4. [Recommended Architecture](#4-recommended-architecture)
5. [Implementation Specification](#5-implementation-specification)
6. [Test Cases](#6-test-cases)
7. [Deployment Checklist](#7-deployment-checklist)

---

## 1. Executive Summary

### 1.1 The Problem

Claude workers currently execute with these security gaps:

| Gap | Current State | Risk |
|-----|---------------|------|
| Filesystem access | CWD-locked but no kernel enforcement | Process can `cd ..` or use absolute paths |
| Network access | Unrestricted | Claude can curl external APIs, exfiltrate data |
| Host secrets | Available via env vars and ~/.aws | Credential theft possible |
| Other worktrees | Same filesystem namespace | Task A can read Task B's code |
| System utilities | Full access to /usr/bin/* | Privilege escalation vectors |

### 1.2 The Goal

```
╔════════════════════════════════════════════════════════════════════════════╗
║ RULE: Claude processes MUST NOT access ANY data outside their repository   ║
║ This includes: host filesystem, other containers, network (except allowed) ║
╚════════════════════════════════════════════════════════════════════════════╝
```

### 1.3 Success Criteria

A Claude worker is considered "isolated" when ALL of these are true:

1. **Filesystem:** Cannot read/write outside `/repo` (mounted worktree)
2. **Network:** Full internet access ALLOWED (required for web search, docs, npm). Only block: metadata server, localhost, internal IPs
3. **Processes:** Cannot see or signal other containers/processes
4. **Secrets:** Cannot access host secrets, only explicitly mounted ones
5. **Resources:** Cannot exceed CPU/memory limits (prevents DoS)

---

## 2. Security Requirements

### 2.1 Mandatory Isolation Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HOST MACHINE                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    ORCHESTRATOR (trusted)                            │   │
│  │  - Manages container lifecycle                                       │   │
│  │  - Holds GitHub App private key                                      │   │
│  │  - Makes webhook callbacks                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                           │                                                 │
│                           │ Creates + destroys                              │
│                           ▼                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              ISOLATION BOUNDARY (Docker/VM)                          │   │
│  │  ┌───────────────────────────────────────────────────────────────┐  │   │
│  │  │                   CLAUDE WORKER (untrusted)                    │  │   │
│  │  │                                                                │  │   │
│  │  │   Mounted:                                                     │  │   │
│  │  │   - /repo (git worktree, read-write)                          │  │   │
│  │  │   - /tmp (ephemeral, size-limited)                            │  │   │
│  │  │                                                                │  │   │
│  │  │   Network:                                                     │  │   │
│  │  │   - FULL INTERNET ACCESS (required for web search, docs, npm) │  │   │
│  │  │   - BLOCKED: 169.254.169.254 (cloud metadata)                 │  │   │
│  │  │   - BLOCKED: localhost, 127.0.0.1, internal IPs               │  │   │
│  │  │                                                                │  │   │
│  │  │   Resources:                                                   │  │   │
│  │  │   - CPU: 2 cores max                                          │  │   │
│  │  │   - Memory: 8GB max                                            │  │   │
│  │  │   - Disk: 10GB max                                             │  │   │
│  │  │   - Time: 2 hours max                                          │  │   │
│  │  └───────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Forbidden Access List

Claude workers MUST NOT be able to:

| Category | Forbidden Access | Why Forbidden |
|----------|------------------|---------------|
| Filesystem | `/home/*` (host home) | Contains SSH keys, credentials |
| Filesystem | `~/.aws`, `~/.gcloud` | Cloud credentials |
| Filesystem | `~/.claude-orchestrator` | GitHub App key, state |
| Filesystem | Other worktrees | Task isolation |
| Filesystem | `/etc/passwd`, `/etc/shadow` | System credentials |
| Network | Internal services (localhost:*, 127.0.0.1) | Firestore, other apps |
| Network | Metadata server (169.254.169.254) | Cloud instance credentials |
| Network | Private IP ranges (10.x, 172.16-31.x, 192.168.x) | Internal infrastructure |
| Process | Host processes | Privilege escalation |
| Process | Other containers | Container escape |

### 2.3 Allowed Access List

Claude workers MAY access:

| Category | Allowed Access | Why Allowed |
|----------|----------------|-------------|
| Filesystem | `/repo` (mounted worktree) | The task workspace |
| Filesystem | `/tmp` (container-local) | Temporary files |
| Network | **Full public internet** | Web search, documentation, npm, APIs |
| Network | `github.com` | Git operations, gh CLI |
| Network | `api.anthropic.com` | Claude API calls |
| Network | `api.linear.app` | Linear issue management |
| Network | `sentry.io` | Error reporting |
| Network | `registry.npmjs.org` | Package installation |
| Network | Any public website | Research, documentation, Stack Overflow |
| Environment | `LINEAR_API_KEY` | Mounted secret |
| Environment | `SENTRY_AUTH_TOKEN` | Mounted secret |
| Environment | `GITHUB_TOKEN` | Mounted secret (scoped) |

**Why full internet access?** Claude Code needs to:
- Search the web for documentation and solutions
- Read Stack Overflow, GitHub issues, blog posts
- Install npm/pnpm packages
- Access various APIs (Linear, Sentry, GitHub, etc.)
- Fetch web pages via WebFetch tool

Blocking arbitrary internet would cripple Claude's core functionality.

---

## 3. Architecture Options Analysis

### 3.1 Option A: Orchestrator INSIDE Container with Claude Workers

```
┌─────────────────────────────────────────────────────────────────┐
│                      Host Machine                                │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              Orchestrator Container                        │ │
│  │  ┌─────────────────┐  ┌─────────────────┐                 │ │
│  │  │ Claude Worker 1 │  │ Claude Worker 2 │  (sibling)      │ │
│  │  └─────────────────┘  └─────────────────┘                 │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**
- Orchestrator runs in Docker container
- Spawns Claude workers as sibling containers via Docker socket mount
- OR uses Docker-in-Docker (DinD)

**Pros:**
| Advantage | Explanation |
|-----------|-------------|
| Complete isolation | Orchestrator also sandboxed |
| Consistent environment | Same on Mac, Linux, VM |
| Easy deployment | Single docker-compose up |
| No host dependencies | Everything in container |

**Cons:**
| Disadvantage | Explanation |
|--------------|-------------|
| Docker socket security | Mounting `/var/run/docker.sock` = root on host |
| DinD complexity | Nested Docker is fragile, slow |
| Tmux challenges | PTY allocation in containers is problematic |
| Debugging difficulty | Cannot easily attach to worker |
| Volume mount complexity | Worktrees need careful path mapping |

**Security Rating:** ⚠️ MEDIUM - Docker socket mount undermines isolation

---

### 3.2 Option B: Orchestrator OUTSIDE, Claude Workers in Containers

```
┌─────────────────────────────────────────────────────────────────┐
│                      Host Machine                                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Orchestrator (native process)               │   │
│  │              - Manages Docker API                        │   │
│  │              - Creates/destroys worker containers        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                      │
│         docker run       │                                      │
│                          ▼                                      │
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │ Claude Worker 1 │  │ Claude Worker 2 │  (isolated)          │
│  │ (container)     │  │ (container)     │                      │
│  └─────────────────┘  └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**
- Orchestrator runs natively on host (macOS, Linux, VM)
- Uses Docker SDK to create isolated worker containers
- Mounts only specific worktree into each container
- No Docker socket in worker containers

**Pros:**
| Advantage | Explanation |
|-----------|-------------|
| Strong isolation | Workers cannot escape container |
| Simple orchestrator | No tmux-in-docker issues |
| Easy debugging | Can attach to containers |
| Mature tooling | Docker SDK well-documented |
| VM compatible | Same pattern works in VMs |

**Cons:**
| Disadvantage | Explanation |
|--------------|-------------|
| Host exposure | Orchestrator runs on host |
| Docker dependency | Host must have Docker installed |
| Image management | Need to build/push worker image |
| Resource overhead | Each container has overhead |

**Security Rating:** ✅ HIGH - Strong isolation boundary

---

### 3.3 Option C: VM-Based Isolation (Full Virtual Machines)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Host/Cloud                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Orchestrator                                │   │
│  │              - Manages VM lifecycle                      │   │
│  │              - Creates/destroys worker VMs               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                      │
│         GCE API          │                                      │
│                          ▼                                      │
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │ Claude Worker 1 │  │ Claude Worker 2 │                      │
│  │ (GCE VM)        │  │ (GCE VM)        │                      │
│  └─────────────────┘  └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**
- Orchestrator creates GCE VMs via API
- Each VM runs single Claude task
- VM destroyed after task completion
- SSH-based communication

**Pros:**
| Advantage | Explanation |
|-----------|-------------|
| Maximum isolation | Full hardware virtualization |
| No container escapes | VM boundary is strong |
| Cloud-native | Works with GCP, AWS |
| Snapshot capability | Can restore VM state |

**Cons:**
| Disadvantage | Explanation |
|--------------|-------------|
| Slow startup | 30-60 seconds VM boot |
| Higher cost | Per-minute billing |
| Complex networking | VPC, firewall rules |
| Resource waste | Full OS per task |
| Cold start latency | No container caching |

**Security Rating:** ✅✅ HIGHEST - Hardware-level isolation

---

### 3.4 Option D: Hybrid (Containers locally, VMs in production)

```
Development:
┌───────────────────────────────────┐
│ macOS (Option B - Docker)         │
│ Orchestrator → Docker containers  │
└───────────────────────────────────┘

Production:
┌───────────────────────────────────┐
│ GCP (Option C - VMs)              │
│ Orchestrator → GCE instances      │
└───────────────────────────────────┘
```

**Implementation:**
- Abstract "isolation provider" interface
- Docker implementation for local dev
- GCE implementation for production
- Same API, different backends

**Pros:**
| Advantage | Explanation |
|-----------|-------------|
| Best of both | Fast local, secure prod |
| Cost efficiency | Docker free locally |
| Flexibility | Choose per environment |
| Easy testing | Local iteration fast |

**Cons:**
| Disadvantage | Explanation |
|--------------|-------------|
| Two implementations | More code to maintain |
| Behavior differences | Container ≠ VM |
| Testing gap | Local tests miss VM issues |

**Security Rating:** ✅ HIGH (varies by environment)

---

### 3.5 Recommendation Matrix

| Criterion | Option A (Orchestrator in Docker) | Option B (Workers in Docker) | Option C (VMs) | Option D (Hybrid) |
|-----------|-----------------------------------|------------------------------|----------------|-------------------|
| Security | ⚠️ Medium | ✅ High | ✅✅ Highest | ✅ High |
| Local dev speed | ⚠️ Slow | ✅ Fast | ❌ Very slow | ✅ Fast |
| Production ready | ⚠️ Complex | ✅ Yes | ✅ Yes | ✅ Yes |
| VM compatibility | ❌ No | ✅ Yes | ✅ Native | ✅ Native |
| Complexity | ⚠️ High | ✅ Low | ⚠️ Medium | ⚠️ Medium |
| Cost | ✅ Low | ✅ Low | ⚠️ High | ✅ Medium |

**RECOMMENDED: Option D (Hybrid) with Option B for local, Option C for production**

---

## 4. Recommended Architecture

### 4.1 High-Level Design

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR (trusted zone)                          │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                       IsolationProvider Interface                     │ │
│  │                                                                       │ │
│  │  interface IsolationProvider {                                        │ │
│  │    createWorker(taskId: string, config: WorkerConfig): Promise<Worker>│ │
│  │    destroyWorker(taskId: string): Promise<void>                       │ │
│  │    getWorkerLogs(taskId: string): AsyncIterable<string>               │ │
│  │    isWorkerRunning(taskId: string): Promise<boolean>                  │ │
│  │    sendInput(taskId: string, input: string): Promise<void>            │ │
│  │  }                                                                    │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                          │                                                 │
│           ┌──────────────┼──────────────┐                                 │
│           ▼              ▼              ▼                                 │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                │
│  │ DockerProvider │ │   VMProvider   │ │  LocalProvider │                │
│  │ (containers)   │ │  (GCE VMs)     │ │ (tmux - debug) │                │
│  └────────────────┘ └────────────────┘ └────────────────┘                │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Component Specifications

#### 4.2.1 Worker Container Image

**Dockerfile: `workers/claude-worker/Dockerfile`**

```dockerfile
# Base image with security hardening
FROM node:22-alpine AS base

# Install only required tools
RUN apk add --no-cache \
    git \
    openssh-client \
    curl \
    bash \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -S claude && adduser -S claude -G claude

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Set secure defaults
ENV HOME=/home/claude
ENV NODE_ENV=production

# Security: Remove unnecessary binaries
RUN rm -f /usr/bin/wget /usr/bin/nc /usr/bin/ncat

# Switch to non-root user
USER claude
WORKDIR /repo

# Entry point
COPY --chown=claude:claude entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

**entrypoint.sh:**

```bash
#!/bin/bash
set -euo pipefail

# Verify we're not root
if [ "$(id -u)" = "0" ]; then
    echo "ERROR: Running as root is forbidden" >&2
    exit 1
fi

# Verify /repo is mounted
if [ ! -d "/repo/.git" ]; then
    echo "ERROR: /repo must be mounted with a git repository" >&2
    exit 1
fi

# Verify we can't escape
if [ -d "/home" ] && [ "$(ls -A /home 2>/dev/null | grep -v claude)" ]; then
    echo "ERROR: Other home directories accessible" >&2
    exit 1
fi

cd /repo

# Read prompt from stdin or file
if [ -f "/task/prompt.txt" ]; then
    PROMPT=$(cat /task/prompt.txt)
else
    PROMPT="$1"
fi

# Execute Claude with security flags
exec claude \
    --system-prompt "$(cat /task/system-prompt.txt 2>/dev/null || echo '')" \
    --print \
    --dangerously-skip-permissions \
    <<< "$PROMPT"
```

#### 4.2.2 Docker Provider

**File: `workers/orchestrator/src/services/isolation/docker-provider.ts`**

```typescript
interface DockerProviderConfig {
  imageName: string;           // e.g., "gcr.io/intexuraos/claude-worker:latest"
  networkName: string;         // e.g., "claude-worker-network"
  memoryLimit: string;         // e.g., "8g"
  cpuLimit: number;            // e.g., 2
  timeoutSeconds: number;      // e.g., 7200 (2 hours)
}

interface WorkerConfig {
  taskId: string;
  worktreePath: string;        // Host path to git worktree
  prompt: string;
  systemPrompt: string;
  secrets: {
    GITHUB_TOKEN: string;
    LINEAR_API_KEY?: string;
    SENTRY_AUTH_TOKEN?: string;
  };
  allowedHosts: string[];      // e.g., ["github.com", "api.linear.app"]
}
```

**Key Methods:**

```typescript
async createWorker(taskId: string, config: WorkerConfig): Promise<Worker> {
  // 1. Validate worktree exists and is git repo
  // 2. Create container with:
  //    - Volume: worktreePath:/repo:rw
  //    - Volume: /tmp/task-{taskId}:/task:ro (prompts)
  //    - Network: restricted (only allowed hosts)
  //    - User: non-root (1000:1000)
  //    - Memory limit: 8GB
  //    - CPU limit: 2 cores
  //    - Read-only root filesystem (except /tmp, /repo)
  //    - No privileged mode
  //    - No capabilities
  //    - seccomp profile: default
  // 3. Write prompt files to /tmp/task-{taskId}
  // 4. Start container
  // 5. Return handle
}
```

#### 4.2.3 Network Isolation

**Philosophy: Allow by default, block dangerous destinations**

Claude Code requires full internet access for:
- Web search (documentation, Stack Overflow, tutorials)
- Package installation (npm, pnpm)
- API access (GitHub, Linear, Sentry, Anthropic)
- WebFetch tool (reading any URL)

**Network Configuration:**

```yaml
# docker-compose.worker-network.yaml
version: '3.8'

networks:
  claude-worker-network:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.enable_ip_masquerade: 'true'
    ipam:
      config:
        - subnet: 172.28.0.0/16
```

**Blocked destinations (iptables rules at container creation):**

```bash
# Block cloud metadata server (credential theft prevention)
# This is CRITICAL - metadata server exposes instance credentials
iptables -A OUTPUT -d 169.254.169.254 -j DROP

# Block localhost (prevent access to host services)
iptables -A OUTPUT -d 127.0.0.0/8 -j DROP

# Block private IP ranges (prevent access to internal infrastructure)
iptables -A OUTPUT -d 10.0.0.0/8 -j DROP
iptables -A OUTPUT -d 172.16.0.0/12 -j DROP
iptables -A OUTPUT -d 192.168.0.0/16 -j DROP

# Block link-local addresses
iptables -A OUTPUT -d 169.254.0.0/16 -j DROP

# ALLOW everything else (public internet)
iptables -A OUTPUT -j ACCEPT
```

**Why this approach:**

| Blocked | Reason |
|---------|--------|
| `169.254.169.254` | Cloud metadata server - exposes instance credentials, IAM tokens |
| `127.0.0.0/8` | Localhost - prevents access to host Firestore, other services |
| `10.0.0.0/8` | Private IPs - prevents lateral movement in VPC |
| `172.16.0.0/12` | Private IPs - Docker's default range, other containers |
| `192.168.0.0/16` | Private IPs - home/office networks |
| `169.254.0.0/16` | Link-local - various cloud provider metadata endpoints |

**Monitoring (not blocking):**

For security visibility without breaking functionality:
- Log all outbound connections to unusual ports
- Alert on large data transfers (>100MB in 1 minute)
- Track unique domains accessed per task

#### 4.2.4 VM Provider (Production)

**File: `workers/orchestrator/src/services/isolation/vm-provider.ts`**

```typescript
interface VMProviderConfig {
  projectId: string;           // GCP project
  zone: string;                // e.g., "us-central1-a"
  machineType: string;         // e.g., "e2-standard-2"
  sourceImage: string;         // Pre-built VM image with Claude
  networkName: string;         // VPC network
  serviceAccount: string;      // Minimal permissions SA
  timeoutSeconds: number;
}

interface VMConfig extends WorkerConfig {
  // Same as WorkerConfig but for VMs
}
```

**VM Image Requirements:**
- Ubuntu 22.04 LTS base
- Node.js 22 installed
- Claude CLI installed
- Git and SSH client
- cloud-init for startup script injection
- No default SSH keys
- Firewall: egress to allowed hosts only

### 4.3 Security Controls Matrix

| Control | Docker Implementation | VM Implementation |
|---------|----------------------|-------------------|
| Filesystem isolation | Read-only root + volume mounts | Full disk isolation |
| Network isolation | Docker network + iptables | VPC firewall rules |
| User isolation | Non-root user (UID 1000) | Non-root user |
| Resource limits | cgroups (memory, CPU) | Instance type limits |
| Secrets | Environment variables | Instance metadata |
| Logging | Docker logs API | Serial port + cloud logging |
| Timeout | Container kill after 2h | Instance preemptible timeout |
| Cleanup | docker rm -f | Instance delete |

---

## 5. Implementation Specification

### 5.1 Phase 1: Docker Provider (Local Development)

#### 5.1.1 Files to Create

| File | Purpose |
|------|---------|
| `workers/claude-worker/Dockerfile` | Worker container image |
| `workers/claude-worker/entrypoint.sh` | Container entry script |
| `workers/orchestrator/src/services/isolation/types.ts` | Interface definitions |
| `workers/orchestrator/src/services/isolation/docker-provider.ts` | Docker implementation |
| `workers/orchestrator/src/services/isolation/index.ts` | Provider factory |
| `docker/docker-compose.worker-network.yaml` | Network definition |
| `scripts/build-worker-image.sh` | Image build script |

#### 5.1.2 Files to Modify

| File | Changes |
|------|---------|
| `workers/orchestrator/src/services/task-dispatcher.ts` | Replace tmux with IsolationProvider |
| `workers/orchestrator/src/services/tmux-manager.ts` | Deprecate, keep for fallback |
| `workers/orchestrator/src/main.ts` | Add provider initialization |
| `workers/orchestrator/package.json` | Add dockerode dependency |

#### 5.1.3 Implementation Steps

**Step 1: Create IsolationProvider Interface**

```typescript
// workers/orchestrator/src/services/isolation/types.ts

export interface WorkerHandle {
  taskId: string;
  containerId?: string;
  vmId?: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'killed';
}

export interface WorkerConfig {
  taskId: string;
  worktreePath: string;
  prompt: string;
  systemPrompt: string;
  secrets: Record<string, string>;
  allowedHosts: string[];
  timeoutMs: number;
  onLog?: (chunk: string) => void;
  onComplete?: (exitCode: number) => void;
}

export interface IsolationProvider {
  /**
   * Create and start an isolated worker
   * @returns Handle to the worker
   */
  createWorker(config: WorkerConfig): Promise<WorkerHandle>;

  /**
   * Forcefully terminate a worker
   */
  destroyWorker(taskId: string): Promise<void>;

  /**
   * Check if worker is still running
   */
  isWorkerRunning(taskId: string): Promise<boolean>;

  /**
   * Get worker logs (for debugging)
   */
  getWorkerLogs(taskId: string): Promise<string>;

  /**
   * Wait for worker to complete
   * @returns Exit code
   */
  waitForCompletion(taskId: string, timeoutMs: number): Promise<number>;
}
```

**Step 2: Implement Docker Provider**

```typescript
// workers/orchestrator/src/services/isolation/docker-provider.ts

import Docker from 'dockerode';
import { IsolationProvider, WorkerConfig, WorkerHandle } from './types.js';

export class DockerProvider implements IsolationProvider {
  private docker: Docker;
  private workers: Map<string, { containerId: string; handle: WorkerHandle }>;
  private config: {
    imageName: string;
    memoryLimit: number;  // bytes
    cpuLimit: number;     // CPU shares
    networkMode: string;
  };

  constructor(config: DockerProviderConfig) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.workers = new Map();
    this.config = {
      imageName: config.imageName ?? 'gcr.io/intexuraos/claude-worker:latest',
      memoryLimit: 8 * 1024 * 1024 * 1024,  // 8GB
      cpuLimit: 2,
      networkMode: config.networkMode ?? 'claude-worker-network',
    };
  }

  async createWorker(config: WorkerConfig): Promise<WorkerHandle> {
    const { taskId, worktreePath, prompt, systemPrompt, secrets, allowedHosts } = config;

    // Validate worktree exists
    if (!fs.existsSync(path.join(worktreePath, '.git'))) {
      throw new Error(`Invalid worktree: ${worktreePath}`);
    }

    // Create temp directory for task files
    const taskDir = `/tmp/claude-task-${taskId}`;
    await fs.promises.mkdir(taskDir, { recursive: true });
    await fs.promises.writeFile(path.join(taskDir, 'prompt.txt'), prompt);
    await fs.promises.writeFile(path.join(taskDir, 'system-prompt.txt'), systemPrompt);

    // Build environment variables
    const env = [
      `TASK_ID=${taskId}`,
      ...Object.entries(secrets).map(([k, v]) => `${k}=${v}`),
    ];

    // Create container
    const container = await this.docker.createContainer({
      Image: this.config.imageName,
      name: `claude-worker-${taskId}`,
      Env: env,
      WorkingDir: '/repo',
      User: '1000:1000',  // Non-root
      HostConfig: {
        Binds: [
          `${worktreePath}:/repo:rw`,      // Worktree (read-write)
          `${taskDir}:/task:ro`,           // Task files (read-only)
        ],
        Memory: this.config.memoryLimit,
        NanoCpus: this.config.cpuLimit * 1e9,
        NetworkMode: this.config.networkMode,
        ReadonlyRootfs: true,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=1g',
        },
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        AutoRemove: false,  // Keep for log retrieval
      },
    });

    // Start container
    await container.start();

    const handle: WorkerHandle = {
      taskId,
      containerId: container.id,
      status: 'running',
    };

    this.workers.set(taskId, { containerId: container.id, handle });

    // Set up log streaming if callback provided
    if (config.onLog) {
      const logStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });
      logStream.on('data', (chunk: Buffer) => {
        config.onLog!(chunk.toString('utf-8'));
      });
    }

    // Set up completion handler
    container.wait().then(async (data) => {
      handle.status = data.StatusCode === 0 ? 'completed' : 'failed';
      if (config.onComplete) {
        config.onComplete(data.StatusCode);
      }
    });

    return handle;
  }

  async destroyWorker(taskId: string): Promise<void> {
    const worker = this.workers.get(taskId);
    if (!worker) return;

    try {
      const container = this.docker.getContainer(worker.containerId);
      await container.stop({ t: 10 });  // 10 second grace period
    } catch (e) {
      // Container might already be stopped
    }

    try {
      const container = this.docker.getContainer(worker.containerId);
      await container.remove({ force: true });
    } catch (e) {
      // Container might already be removed
    }

    this.workers.delete(taskId);
  }

  async isWorkerRunning(taskId: string): Promise<boolean> {
    const worker = this.workers.get(taskId);
    if (!worker) return false;

    try {
      const container = this.docker.getContainer(worker.containerId);
      const info = await container.inspect();
      return info.State.Running;
    } catch (e) {
      return false;
    }
  }

  async getWorkerLogs(taskId: string): Promise<string> {
    const worker = this.workers.get(taskId);
    if (!worker) return '';

    try {
      const container = this.docker.getContainer(worker.containerId);
      const logs = await container.logs({ stdout: true, stderr: true });
      return logs.toString('utf-8');
    } catch (e) {
      return '';
    }
  }

  async waitForCompletion(taskId: string, timeoutMs: number): Promise<number> {
    const worker = this.workers.get(taskId);
    if (!worker) return -1;

    const container = this.docker.getContainer(worker.containerId);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.destroyWorker(taskId).then(() => resolve(-1));
      }, timeoutMs);

      container.wait().then((data) => {
        clearTimeout(timeout);
        resolve(data.StatusCode);
      }).catch(reject);
    });
  }
}
```

**Step 3: Create Worker Image**

```bash
#!/bin/bash
# scripts/build-worker-image.sh

set -euo pipefail

IMAGE_NAME="${1:-gcr.io/intexuraos/claude-worker}"
IMAGE_TAG="${2:-latest}"

echo "Building Claude worker image..."
docker build \
  -t "${IMAGE_NAME}:${IMAGE_TAG}" \
  -f workers/claude-worker/Dockerfile \
  workers/claude-worker/

echo "Built: ${IMAGE_NAME}:${IMAGE_TAG}"

# Optionally push
if [ "${PUSH:-false}" = "true" ]; then
  echo "Pushing to registry..."
  docker push "${IMAGE_NAME}:${IMAGE_TAG}"
fi
```

**Step 4: Update Task Dispatcher**

```typescript
// workers/orchestrator/src/services/task-dispatcher.ts
// Add at top of file

import { IsolationProvider, DockerProvider, LocalProvider } from './isolation/index.js';

// Replace tmux-based execution with:
async function executeTask(task: Task, provider: IsolationProvider): Promise<void> {
  const config: WorkerConfig = {
    taskId: task.taskId,
    worktreePath: task.worktreePath,
    prompt: task.prompt,
    systemPrompt: buildSystemPrompt(task),
    secrets: {
      GITHUB_TOKEN: await getGitHubToken(),
      LINEAR_API_KEY: process.env.LINEAR_API_KEY ?? '',
      SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN ?? '',
    },
    allowedHosts: ['github.com', 'api.anthropic.com', 'api.linear.app', 'sentry.io'],
    timeoutMs: 2 * 60 * 60 * 1000,  // 2 hours
    onLog: (chunk) => logForwarder.append(task.taskId, chunk),
    onComplete: (exitCode) => handleTaskCompletion(task, exitCode),
  };

  const handle = await provider.createWorker(config);
  task.workerHandle = handle;

  // Wait for completion or timeout
  const exitCode = await provider.waitForCompletion(task.taskId, config.timeoutMs);

  if (exitCode !== 0) {
    task.status = 'failed';
  }
}
```

### 5.2 Phase 2: VM Provider (Production)

#### 5.2.1 Files to Create

| File | Purpose |
|------|---------|
| `workers/orchestrator/src/services/isolation/vm-provider.ts` | GCE VM implementation |
| `terraform/modules/claude-worker-vm/main.tf` | VM Terraform module |
| `packer/claude-worker-vm.pkr.hcl` | VM image builder |

#### 5.2.2 VM Provider Implementation

```typescript
// workers/orchestrator/src/services/isolation/vm-provider.ts

import { Compute } from '@google-cloud/compute';
import { IsolationProvider, WorkerConfig, WorkerHandle } from './types.js';

export class VMProvider implements IsolationProvider {
  private compute: Compute;
  private workers: Map<string, { vmName: string; zone: string; handle: WorkerHandle }>;
  private config: {
    projectId: string;
    zone: string;
    machineType: string;
    sourceImage: string;
    serviceAccount: string;
    network: string;
    subnetwork: string;
  };

  constructor(config: VMProviderConfig) {
    this.compute = new Compute({ projectId: config.projectId });
    this.workers = new Map();
    this.config = config;
  }

  async createWorker(config: WorkerConfig): Promise<WorkerHandle> {
    const { taskId, worktreePath, prompt, systemPrompt, secrets } = config;

    const vmName = `claude-worker-${taskId.slice(0, 20)}`;
    const zone = this.compute.zone(this.config.zone);

    // Create startup script
    const startupScript = this.buildStartupScript(config);

    // Create VM
    const [vm, operation] = await zone.createVM(vmName, {
      machineType: this.config.machineType,
      disks: [{
        boot: true,
        autoDelete: true,
        initializeParams: {
          sourceImage: this.config.sourceImage,
          diskSizeGb: 50,
        },
      }],
      networkInterfaces: [{
        network: this.config.network,
        subnetwork: this.config.subnetwork,
        accessConfigs: [],  // No external IP
      }],
      serviceAccounts: [{
        email: this.config.serviceAccount,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      }],
      metadata: {
        items: [
          { key: 'startup-script', value: startupScript },
          { key: 'task-id', value: taskId },
        ],
      },
      scheduling: {
        preemptible: true,  // Auto-kill after 24h max
      },
      labels: {
        'claude-worker': 'true',
        'task-id': taskId,
      },
    });

    await operation.promise();

    const handle: WorkerHandle = {
      taskId,
      vmId: vmName,
      status: 'starting',
    };

    this.workers.set(taskId, { vmName, zone: this.config.zone, handle });

    // Monitor startup via serial port
    this.monitorVMStartup(taskId, vm, config.onLog, config.onComplete);

    return handle;
  }

  private buildStartupScript(config: WorkerConfig): string {
    return `#!/bin/bash
set -euo pipefail

# Log to serial port for monitoring
exec > >(tee /dev/ttyS0) 2>&1

echo "=== Claude Worker Starting ==="
echo "Task ID: ${config.taskId}"

# Clone repository to worktree
git clone --depth=1 --branch=${config.baseBranch ?? 'development'} \
  https://\${GITHUB_TOKEN}@github.com/intexuraos/intexuraos.git /repo

cd /repo

# Write prompts
cat > /tmp/prompt.txt << 'PROMPT_EOF'
${config.prompt}
PROMPT_EOF

cat > /tmp/system-prompt.txt << 'SYSTEM_EOF'
${config.systemPrompt}
SYSTEM_EOF

# Export secrets
export GITHUB_TOKEN='${config.secrets.GITHUB_TOKEN}'
export LINEAR_API_KEY='${config.secrets.LINEAR_API_KEY ?? ''}'
export SENTRY_AUTH_TOKEN='${config.secrets.SENTRY_AUTH_TOKEN ?? ''}'

# Run Claude
sudo -u claude claude \
  --system-prompt "\$(cat /tmp/system-prompt.txt)" \
  --print \
  --dangerously-skip-permissions \
  < /tmp/prompt.txt

# Signal completion
echo "=== Claude Worker Completed ==="
curl -X POST http://metadata.google.internal/computeMetadata/v1/instance/attributes/completion-status \
  -H "Metadata-Flavor: Google" \
  -d "completed"
`;
  }

  async destroyWorker(taskId: string): Promise<void> {
    const worker = this.workers.get(taskId);
    if (!worker) return;

    const zone = this.compute.zone(worker.zone);
    const vm = zone.vm(worker.vmName);

    try {
      const [operation] = await vm.delete();
      await operation.promise();
    } catch (e) {
      // VM might already be deleted
    }

    this.workers.delete(taskId);
  }

  async isWorkerRunning(taskId: string): Promise<boolean> {
    const worker = this.workers.get(taskId);
    if (!worker) return false;

    const zone = this.compute.zone(worker.zone);
    const vm = zone.vm(worker.vmName);

    try {
      const [metadata] = await vm.getMetadata();
      return metadata.status === 'RUNNING';
    } catch (e) {
      return false;
    }
  }

  async getWorkerLogs(taskId: string): Promise<string> {
    const worker = this.workers.get(taskId);
    if (!worker) return '';

    const zone = this.compute.zone(worker.zone);
    const vm = zone.vm(worker.vmName);

    try {
      const [output] = await vm.getSerialPortOutput();
      return output;
    } catch (e) {
      return '';
    }
  }

  async waitForCompletion(taskId: string, timeoutMs: number): Promise<number> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const running = await this.isWorkerRunning(taskId);
      if (!running) {
        // Check completion status from metadata
        const worker = this.workers.get(taskId);
        if (worker) {
          const zone = this.compute.zone(worker.zone);
          const vm = zone.vm(worker.vmName);
          try {
            const [metadata] = await vm.getMetadata();
            const completionStatus = metadata.metadata?.items?.find(
              (i: any) => i.key === 'completion-status'
            )?.value;
            return completionStatus === 'completed' ? 0 : 1;
          } catch (e) {
            return 1;
          }
        }
        return 1;
      }
      await sleep(5000);  // Poll every 5 seconds
    }

    // Timeout - kill VM
    await this.destroyWorker(taskId);
    return -1;
  }
}
```

### 5.3 Provider Factory

```typescript
// workers/orchestrator/src/services/isolation/index.ts

import { IsolationProvider } from './types.js';
import { DockerProvider } from './docker-provider.js';
import { VMProvider } from './vm-provider.js';
import { LocalProvider } from './local-provider.js';

export type ProviderType = 'docker' | 'vm' | 'local';

export function createIsolationProvider(type: ProviderType): IsolationProvider {
  switch (type) {
    case 'docker':
      return new DockerProvider({
        imageName: process.env.CLAUDE_WORKER_IMAGE ?? 'gcr.io/intexuraos/claude-worker:latest',
        networkMode: process.env.CLAUDE_WORKER_NETWORK ?? 'claude-worker-network',
      });

    case 'vm':
      return new VMProvider({
        projectId: process.env.PROJECT_ID!,
        zone: process.env.GCE_ZONE ?? 'us-central1-a',
        machineType: process.env.GCE_MACHINE_TYPE ?? 'e2-standard-2',
        sourceImage: process.env.CLAUDE_WORKER_VM_IMAGE!,
        serviceAccount: process.env.CLAUDE_WORKER_SA!,
        network: process.env.VPC_NETWORK ?? 'default',
        subnetwork: process.env.VPC_SUBNETWORK ?? 'default',
      });

    case 'local':
      // Fallback to tmux-based (no isolation) for debugging
      return new LocalProvider();

    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

export { IsolationProvider, WorkerConfig, WorkerHandle } from './types.js';
export { DockerProvider } from './docker-provider.js';
export { VMProvider } from './vm-provider.js';
export { LocalProvider } from './local-provider.js';
```

---

## 6. Test Cases

### 6.1 Unit Tests

#### 6.1.1 Docker Provider Tests

```typescript
// workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DockerProvider } from '../docker-provider.js';

describe('DockerProvider', () => {
  let provider: DockerProvider;
  let mockDocker: any;

  beforeEach(() => {
    mockDocker = {
      createContainer: vi.fn(),
      getContainer: vi.fn(),
    };
    provider = new DockerProvider({ /* config */ });
    // @ts-expect-error - inject mock
    provider.docker = mockDocker;
  });

  describe('createWorker', () => {
    it('MUST create container with non-root user', async () => {
      mockDocker.createContainer.mockResolvedValue({
        id: 'container-123',
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue({ on: vi.fn() }),
      });

      await provider.createWorker({
        taskId: 'task-1',
        worktreePath: '/tmp/test-worktree',
        prompt: 'Test prompt',
        systemPrompt: 'System prompt',
        secrets: {},
        allowedHosts: [],
        timeoutMs: 60000,
      });

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          User: '1000:1000',
        })
      );
    });

    it('MUST mount worktree as /repo', async () => {
      mockDocker.createContainer.mockResolvedValue({
        id: 'container-123',
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue({ on: vi.fn() }),
      });

      await provider.createWorker({
        taskId: 'task-1',
        worktreePath: '/host/path/worktree',
        prompt: 'Test',
        systemPrompt: '',
        secrets: {},
        allowedHosts: [],
        timeoutMs: 60000,
      });

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Binds: expect.arrayContaining([
              '/host/path/worktree:/repo:rw',
            ]),
          }),
        })
      );
    });

    it('MUST set memory limit', async () => {
      mockDocker.createContainer.mockResolvedValue({
        id: 'container-123',
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue({ on: vi.fn() }),
      });

      await provider.createWorker({
        taskId: 'task-1',
        worktreePath: '/tmp/worktree',
        prompt: 'Test',
        systemPrompt: '',
        secrets: {},
        allowedHosts: [],
        timeoutMs: 60000,
      });

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Memory: 8 * 1024 * 1024 * 1024,  // 8GB
          }),
        })
      );
    });

    it('MUST enable read-only root filesystem', async () => {
      mockDocker.createContainer.mockResolvedValue({
        id: 'container-123',
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue({ on: vi.fn() }),
      });

      await provider.createWorker({
        taskId: 'task-1',
        worktreePath: '/tmp/worktree',
        prompt: 'Test',
        systemPrompt: '',
        secrets: {},
        allowedHosts: [],
        timeoutMs: 60000,
      });

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            ReadonlyRootfs: true,
          }),
        })
      );
    });

    it('MUST drop all capabilities', async () => {
      mockDocker.createContainer.mockResolvedValue({
        id: 'container-123',
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        logs: vi.fn().mockResolvedValue({ on: vi.fn() }),
      });

      await provider.createWorker({
        taskId: 'task-1',
        worktreePath: '/tmp/worktree',
        prompt: 'Test',
        systemPrompt: '',
        secrets: {},
        allowedHosts: [],
        timeoutMs: 60000,
      });

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            CapDrop: ['ALL'],
          }),
        })
      );
    });

    it('MUST reject invalid worktree path', async () => {
      await expect(provider.createWorker({
        taskId: 'task-1',
        worktreePath: '/nonexistent/path',
        prompt: 'Test',
        systemPrompt: '',
        secrets: {},
        allowedHosts: [],
        timeoutMs: 60000,
      })).rejects.toThrow('Invalid worktree');
    });
  });

  describe('destroyWorker', () => {
    it('MUST stop container with grace period', async () => {
      const mockContainer = {
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDocker.getContainer.mockReturnValue(mockContainer);

      // Register a worker first
      provider['workers'].set('task-1', {
        containerId: 'container-123',
        handle: { taskId: 'task-1', containerId: 'container-123', status: 'running' },
      });

      await provider.destroyWorker('task-1');

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 10 });
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    it('MUST handle already-stopped container', async () => {
      const mockContainer = {
        stop: vi.fn().mockRejectedValue(new Error('already stopped')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDocker.getContainer.mockReturnValue(mockContainer);

      provider['workers'].set('task-1', {
        containerId: 'container-123',
        handle: { taskId: 'task-1', containerId: 'container-123', status: 'running' },
      });

      // Should not throw
      await provider.destroyWorker('task-1');
      expect(mockContainer.remove).toHaveBeenCalled();
    });
  });
});
```

#### 6.1.2 Isolation Verification Tests

```typescript
// workers/orchestrator/src/services/isolation/__tests__/isolation-verification.test.ts

import { describe, it, expect } from 'vitest';

/**
 * SECURITY TEST SUITE
 *
 * These tests verify that isolation boundaries are enforced.
 * They MUST all pass before any release.
 */
describe('Isolation Verification', () => {
  describe('Filesystem Isolation', () => {
    it('MUST NOT allow access to host home directory', async () => {
      // This test runs inside a container and verifies isolation
      const testScript = `
        #!/bin/bash
        # Attempt to read host home directory
        if [ -r "/host-home" ]; then
          echo "FAIL: /host-home is readable"
          exit 1
        fi
        if [ -r "/root" ]; then
          echo "FAIL: /root is readable"
          exit 1
        fi
        echo "PASS: host directories not accessible"
      `;
      // Execute in container and verify output
    });

    it('MUST NOT allow access to host .aws credentials', async () => {
      const testScript = `
        #!/bin/bash
        if [ -r "/home/*/.aws" ] || [ -r "/root/.aws" ]; then
          echo "FAIL: AWS credentials accessible"
          exit 1
        fi
        echo "PASS: AWS credentials not accessible"
      `;
    });

    it('MUST NOT allow access to host .gcloud credentials', async () => {
      const testScript = `
        #!/bin/bash
        if [ -r "/home/*/.config/gcloud" ] || [ -r "/root/.config/gcloud" ]; then
          echo "FAIL: GCloud credentials accessible"
          exit 1
        fi
        echo "PASS: GCloud credentials not accessible"
      `;
    });

    it('MUST NOT allow access to other worktrees', async () => {
      const testScript = `
        #!/bin/bash
        # Try to list parent of /repo
        if ls /repo/../ 2>/dev/null | grep -v "$(basename /repo)"; then
          echo "FAIL: Other worktrees accessible"
          exit 1
        fi
        echo "PASS: Other worktrees not accessible"
      `;
    });

    it('MUST allow read-write access to /repo', async () => {
      const testScript = `
        #!/bin/bash
        touch /repo/test-file.txt
        if [ ! -f /repo/test-file.txt ]; then
          echo "FAIL: Cannot write to /repo"
          exit 1
        fi
        rm /repo/test-file.txt
        echo "PASS: /repo is writable"
      `;
    });

    it('MUST allow read-write access to /tmp', async () => {
      const testScript = `
        #!/bin/bash
        touch /tmp/test-file.txt
        if [ ! -f /tmp/test-file.txt ]; then
          echo "FAIL: Cannot write to /tmp"
          exit 1
        fi
        rm /tmp/test-file.txt
        echo "PASS: /tmp is writable"
      `;
    });

    it('MUST NOT allow writing outside /repo and /tmp', async () => {
      const testScript = `
        #!/bin/bash
        # Try various write locations
        for dir in /etc /var /usr /opt /home; do
          if touch "$dir/test-file" 2>/dev/null; then
            echo "FAIL: Can write to $dir"
            rm "$dir/test-file" 2>/dev/null
            exit 1
          fi
        done
        echo "PASS: Cannot write outside allowed directories"
      `;
    });
  });

  describe('Network Isolation', () => {
    it('MUST allow access to github.com', async () => {
      const testScript = `
        #!/bin/bash
        if ! curl -s --max-time 5 https://github.com > /dev/null; then
          echo "FAIL: Cannot reach github.com"
          exit 1
        fi
        echo "PASS: github.com accessible"
      `;
    });

    it('MUST allow access to api.anthropic.com', async () => {
      const testScript = `
        #!/bin/bash
        if ! curl -s --max-time 5 https://api.anthropic.com > /dev/null; then
          echo "FAIL: Cannot reach api.anthropic.com"
          exit 1
        fi
        echo "PASS: api.anthropic.com accessible"
      `;
    });

    it('MUST allow access to public internet (for web search)', async () => {
      const testScript = `
        #!/bin/bash
        # Claude needs to search the web, read docs, etc.
        if ! curl -s --max-time 5 https://stackoverflow.com > /dev/null; then
          echo "FAIL: Cannot reach stackoverflow.com"
          exit 1
        fi
        if ! curl -s --max-time 5 https://npmjs.com > /dev/null; then
          echo "FAIL: Cannot reach npmjs.com"
          exit 1
        fi
        echo "PASS: Public internet accessible"
      `;
    });

    it('MUST NOT allow access to metadata server', async () => {
      const testScript = `
        #!/bin/bash
        if curl -s --max-time 2 http://169.254.169.254/ > /dev/null 2>&1; then
          echo "FAIL: Metadata server accessible"
          exit 1
        fi
        echo "PASS: Metadata server blocked"
      `;
    });

    it('MUST NOT allow access to localhost services', async () => {
      const testScript = `
        #!/bin/bash
        for port in 8080 8100 8101 8102 8103; do
          if curl -s --max-time 1 http://localhost:$port > /dev/null 2>&1; then
            echo "FAIL: localhost:$port accessible"
            exit 1
          fi
          if curl -s --max-time 1 http://127.0.0.1:$port > /dev/null 2>&1; then
            echo "FAIL: 127.0.0.1:$port accessible"
            exit 1
          fi
        done
        echo "PASS: localhost services blocked"
      `;
    });

    it('MUST NOT allow access to private IP ranges', async () => {
      const testScript = `
        #!/bin/bash
        # Test common private IPs (these should fail/timeout)
        for ip in "10.0.0.1" "172.16.0.1" "192.168.1.1"; do
          if curl -s --max-time 1 http://$ip > /dev/null 2>&1; then
            echo "FAIL: Private IP $ip accessible"
            exit 1
          fi
        done
        echo "PASS: Private IP ranges blocked"
      `;
    });
  });

  describe('Process Isolation', () => {
    it('MUST run as non-root user', async () => {
      const testScript = `
        #!/bin/bash
        if [ "$(id -u)" = "0" ]; then
          echo "FAIL: Running as root"
          exit 1
        fi
        echo "PASS: Running as non-root (uid=$(id -u))"
      `;
    });

    it('MUST NOT see host processes', async () => {
      const testScript = `
        #!/bin/bash
        # In isolated container, should only see own processes
        process_count=$(ps aux | wc -l)
        if [ "$process_count" -gt 10 ]; then
          echo "FAIL: Too many processes visible ($process_count)"
          exit 1
        fi
        echo "PASS: Limited process visibility"
      `;
    });

    it('MUST NOT have any capabilities', async () => {
      const testScript = `
        #!/bin/bash
        caps=$(cat /proc/1/status | grep Cap)
        if echo "$caps" | grep -v "0000000000000000"; then
          echo "FAIL: Has capabilities"
          exit 1
        fi
        echo "PASS: No capabilities"
      `;
    });
  });

  describe('Resource Limits', () => {
    it('MUST enforce memory limit', async () => {
      const testScript = `
        #!/bin/bash
        # Read cgroup memory limit
        limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
        # Should be around 8GB (8589934592 bytes)
        if [ "$limit" -gt 10000000000 ]; then
          echo "FAIL: Memory limit too high ($limit)"
          exit 1
        fi
        echo "PASS: Memory limit enforced ($limit bytes)"
      `;
    });

    it('MUST enforce CPU limit', async () => {
      const testScript = `
        #!/bin/bash
        # Check CPU quota
        quota=$(cat /sys/fs/cgroup/cpu.max 2>/dev/null | cut -d' ' -f1)
        period=$(cat /sys/fs/cgroup/cpu.max 2>/dev/null | cut -d' ' -f2)
        # Should limit to ~2 CPUs
        if [ -n "$quota" ] && [ "$quota" != "max" ]; then
          cpus=$((quota / period))
          if [ "$cpus" -gt 3 ]; then
            echo "FAIL: CPU limit too high ($cpus)"
            exit 1
          fi
        fi
        echo "PASS: CPU limit enforced"
      `;
    });
  });

  describe('Secrets Handling', () => {
    it('MUST have LINEAR_API_KEY available', async () => {
      const testScript = `
        #!/bin/bash
        if [ -z "$LINEAR_API_KEY" ]; then
          echo "FAIL: LINEAR_API_KEY not set"
          exit 1
        fi
        echo "PASS: LINEAR_API_KEY available"
      `;
    });

    it('MUST NOT have host environment variables', async () => {
      const testScript = `
        #!/bin/bash
        # These should NOT be available in container
        for var in HOME USER PATH SHELL; do
          if [ "\${!var}" = "$(cat /etc/environment 2>/dev/null | grep $var | cut -d= -f2)" ]; then
            echo "FAIL: Host $var leaked"
            exit 1
          fi
        done
        echo "PASS: Host env vars not leaked"
      `;
    });

    it('MUST NOT persist secrets to disk', async () => {
      const testScript = `
        #!/bin/bash
        # Check that secrets aren't written to files
        if grep -r "lin_api_" /repo 2>/dev/null; then
          echo "FAIL: Secrets found in /repo"
          exit 1
        fi
        echo "PASS: Secrets not persisted"
      `;
    });
  });
});
```

### 6.2 Integration Tests

#### 6.2.1 End-to-End Container Test

```typescript
// workers/orchestrator/src/services/isolation/__tests__/e2e-container.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DockerProvider } from '../docker-provider.js';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('E2E: Docker Container Isolation', () => {
  let provider: DockerProvider;
  let testWorktree: string;

  beforeAll(async () => {
    // Build test image
    await execAsync('docker build -t claude-worker-test -f workers/claude-worker/Dockerfile workers/claude-worker/');

    // Create test worktree
    testWorktree = '/tmp/e2e-test-worktree';
    await fs.promises.mkdir(testWorktree, { recursive: true });
    await execAsync(`git init ${testWorktree}`);
    await fs.promises.writeFile(path.join(testWorktree, 'test.txt'), 'test content');
    await execAsync(`cd ${testWorktree} && git add . && git commit -m "init"`);

    provider = new DockerProvider({
      imageName: 'claude-worker-test',
      networkMode: 'none',  // Full network isolation for tests
    });
  });

  afterAll(async () => {
    // Cleanup
    await fs.promises.rm(testWorktree, { recursive: true, force: true });
  });

  it('MUST complete simple task successfully', async () => {
    const handle = await provider.createWorker({
      taskId: 'e2e-test-1',
      worktreePath: testWorktree,
      prompt: 'echo "Hello from container" && exit 0',
      systemPrompt: '',
      secrets: {},
      allowedHosts: [],
      timeoutMs: 30000,
    });

    const exitCode = await provider.waitForCompletion('e2e-test-1', 30000);
    expect(exitCode).toBe(0);

    const logs = await provider.getWorkerLogs('e2e-test-1');
    expect(logs).toContain('Hello from container');

    await provider.destroyWorker('e2e-test-1');
  });

  it('MUST kill container on timeout', async () => {
    const handle = await provider.createWorker({
      taskId: 'e2e-test-2',
      worktreePath: testWorktree,
      prompt: 'sleep 3600',  // Sleep for 1 hour
      systemPrompt: '',
      secrets: {},
      allowedHosts: [],
      timeoutMs: 5000,  // 5 second timeout
    });

    const exitCode = await provider.waitForCompletion('e2e-test-2', 5000);
    expect(exitCode).toBe(-1);  // Timeout

    const running = await provider.isWorkerRunning('e2e-test-2');
    expect(running).toBe(false);

    await provider.destroyWorker('e2e-test-2');
  });

  it('MUST prevent filesystem escape', async () => {
    const escapeTestScript = `
      cd /repo
      # Try to escape to parent
      cat /etc/passwd > /dev/null 2>&1 && echo "ESCAPE_SUCCESS" || echo "ESCAPE_BLOCKED"
      cat /root/.bashrc > /dev/null 2>&1 && echo "ROOT_ACCESS" || echo "ROOT_BLOCKED"
    `;

    const handle = await provider.createWorker({
      taskId: 'e2e-test-3',
      worktreePath: testWorktree,
      prompt: escapeTestScript,
      systemPrompt: '',
      secrets: {},
      allowedHosts: [],
      timeoutMs: 30000,
    });

    await provider.waitForCompletion('e2e-test-3', 30000);

    const logs = await provider.getWorkerLogs('e2e-test-3');
    expect(logs).not.toContain('ESCAPE_SUCCESS');
    expect(logs).not.toContain('ROOT_ACCESS');
    expect(logs).toContain('ESCAPE_BLOCKED');
    expect(logs).toContain('ROOT_BLOCKED');

    await provider.destroyWorker('e2e-test-3');
  });

  it('MUST allow public internet but block metadata server', async () => {
    const networkTestScript = `
      # Public internet should work
      curl -s --max-time 5 https://google.com > /dev/null 2>&1 && echo "PUBLIC_INTERNET_OK" || echo "PUBLIC_INTERNET_BLOCKED"
      # Metadata server should be blocked
      curl -s --max-time 2 http://169.254.169.254/ > /dev/null 2>&1 && echo "METADATA_ACCESSIBLE" || echo "METADATA_BLOCKED"
      # Localhost should be blocked
      curl -s --max-time 1 http://127.0.0.1:8080/ > /dev/null 2>&1 && echo "LOCALHOST_ACCESSIBLE" || echo "LOCALHOST_BLOCKED"
    `;

    const handle = await provider.createWorker({
      taskId: 'e2e-test-4',
      worktreePath: testWorktree,
      prompt: networkTestScript,
      systemPrompt: '',
      secrets: {},
      allowedHosts: [],
      timeoutMs: 30000,
    });

    await provider.waitForCompletion('e2e-test-4', 30000);

    const logs = await provider.getWorkerLogs('e2e-test-4');
    // Public internet MUST work (for web search, docs, npm)
    expect(logs).toContain('PUBLIC_INTERNET_OK');
    // Metadata and localhost MUST be blocked
    expect(logs).toContain('METADATA_BLOCKED');
    expect(logs).toContain('LOCALHOST_BLOCKED');
    expect(logs).not.toContain('METADATA_ACCESSIBLE');
    expect(logs).not.toContain('LOCALHOST_ACCESSIBLE');

    await provider.destroyWorker('e2e-test-4');
  });

  it('MUST enforce memory limits', async () => {
    const memoryTestScript = `
      # Try to allocate more than limit (8GB)
      # This should be killed by OOM
      node -e "const arr = []; while(true) arr.push(new Array(1e7).fill('x'));"
    `;

    const handle = await provider.createWorker({
      taskId: 'e2e-test-5',
      worktreePath: testWorktree,
      prompt: memoryTestScript,
      systemPrompt: '',
      secrets: {},
      allowedHosts: [],
      timeoutMs: 60000,
    });

    const exitCode = await provider.waitForCompletion('e2e-test-5', 60000);
    // Should exit with non-zero (OOM killed)
    expect(exitCode).not.toBe(0);

    await provider.destroyWorker('e2e-test-5');
  });

  it('MUST run as non-root user', async () => {
    const userTestScript = `
      id
      whoami
    `;

    const handle = await provider.createWorker({
      taskId: 'e2e-test-6',
      worktreePath: testWorktree,
      prompt: userTestScript,
      systemPrompt: '',
      secrets: {},
      allowedHosts: [],
      timeoutMs: 30000,
    });

    await provider.waitForCompletion('e2e-test-6', 30000);

    const logs = await provider.getWorkerLogs('e2e-test-6');
    expect(logs).toContain('uid=1000');
    expect(logs).not.toContain('uid=0');
    expect(logs).toContain('claude');
    expect(logs).not.toContain('root');

    await provider.destroyWorker('e2e-test-6');
  });
});
```

### 6.3 Manual Test Cases

These tests MUST be performed manually before production deployment.

#### 6.3.1 Security Penetration Tests

| Test ID | Test Name | Steps | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| SEC-001 | Host file read | 1. Start worker container<br>2. Run: `cat /etc/shadow`<br>3. Observe output | Permission denied or file not found | |
| SEC-002 | Host process list | 1. Start worker container<br>2. Run: `ps aux \| wc -l`<br>3. Observe count | Less than 10 processes visible | |
| SEC-003 | Docker socket access | 1. Start worker container<br>2. Run: `ls -la /var/run/docker.sock`<br>3. Observe output | File not found | |
| SEC-004 | Sudo escalation | 1. Start worker container<br>2. Run: `sudo whoami`<br>3. Observe output | sudo not found or permission denied | |
| SEC-005 | Capability check | 1. Start worker container<br>2. Run: `capsh --print`<br>3. Observe output | Current: = (empty) | |
| SEC-006 | Public internet access | 1. Start worker container<br>2. Run: `curl -s https://stackoverflow.com`<br>3. Observe output | Success (200 OK) - internet must work | |
| SEC-007 | Metadata theft | 1. Start worker container<br>2. Run: `curl http://169.254.169.254/latest/meta-data/`<br>3. Observe output | Connection refused | |
| SEC-008 | Container escape | 1. Start worker container<br>2. Run: `nsenter --target 1 --mount --uts --ipc --net --pid`<br>3. Observe output | Permission denied | |
| SEC-009 | Worktree isolation | 1. Start two workers (task-A, task-B)<br>2. In task-A, try: `cat /worktrees/task-B/secret.txt`<br>3. Observe output | File not found or permission denied | |
| SEC-010 | Private IP blocked | 1. Start worker container<br>2. Run: `curl -s http://10.0.0.1:8080`<br>3. Observe output | Connection refused (private IPs blocked) | |

#### 6.3.2 Functional Tests

| Test ID | Test Name | Steps | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| FUN-001 | Git operations | 1. Start worker<br>2. Run: `git status && git log -1`<br>3. Observe output | Shows worktree status and commit | |
| FUN-002 | GitHub CLI | 1. Start worker with GITHUB_TOKEN<br>2. Run: `gh auth status`<br>3. Observe output | Authenticated as expected user | |
| FUN-003 | File creation | 1. Start worker<br>2. Run: `echo "test" > /repo/newfile.txt`<br>3. Check host worktree | File exists with content | |
| FUN-004 | Branch creation | 1. Start worker<br>2. Run: `git checkout -b test-branch`<br>3. Check host worktree | Branch exists | |
| FUN-005 | Commit creation | 1. Start worker<br>2. Run: `touch /repo/x && git add x && git commit -m "test"`<br>3. Check host worktree | Commit exists | |
| FUN-006 | Log capture | 1. Start worker with log callback<br>2. Run: `echo "logged line"`<br>3. Check callback received | "logged line" in logs | |
| FUN-007 | Timeout kill | 1. Start worker with 10s timeout<br>2. Run: `sleep 60`<br>3. Wait 15 seconds | Worker killed, status=timeout | |
| FUN-008 | Graceful stop | 1. Start worker running: `trap 'echo SIGTERM' TERM; sleep 60`<br>2. Call destroyWorker()<br>3. Check logs | "SIGTERM" in logs | |
| FUN-009 | Exit code capture | 1. Start worker<br>2. Run: `exit 42`<br>3. Check exitCode | exitCode = 42 | |
| FUN-010 | Large output | 1. Start worker<br>2. Run: `seq 1 100000`<br>3. Check logs | All 100000 lines captured | |

#### 6.3.3 Performance Tests

| Test ID | Test Name | Steps | Expected Result | Pass/Fail |
|---------|-----------|-------|-----------------|-----------|
| PERF-001 | Container startup | 1. Measure time from createWorker() to first log | < 5 seconds | |
| PERF-002 | Container cleanup | 1. Measure time for destroyWorker() | < 3 seconds | |
| PERF-003 | Concurrent workers | 1. Start 5 workers simultaneously<br>2. Check all start successfully | All 5 running within 30s | |
| PERF-004 | Memory under limit | 1. Run worker allocating 7GB<br>2. Check completion | Completes successfully | |
| PERF-005 | Log throughput | 1. Run worker generating 1MB/s logs<br>2. Check log capture rate | Logs captured without loss | |

---

## 7. Deployment Checklist

### 7.1 Pre-Deployment Checklist

| # | Item | Verified |
|---|------|----------|
| 1 | Worker Docker image built and pushed to registry | ☐ |
| 2 | All unit tests passing | ☐ |
| 3 | All integration tests passing | ☐ |
| 4 | All SEC-* manual tests passing | ☐ |
| 5 | All FUN-* manual tests passing | ☐ |
| 6 | All PERF-* tests within acceptable limits | ☐ |
| 7 | Network isolation rules verified | ☐ |
| 8 | Resource limits verified (cgroups) | ☐ |
| 9 | Documentation updated | ☐ |
| 10 | Rollback plan documented | ☐ |

### 7.2 Rollback Plan

If issues arise after deployment:

1. **Immediate rollback:**
   ```bash
   # Switch provider to 'local' (tmux-based, no isolation)
   export ISOLATION_PROVIDER=local
   pm2 restart orchestrator
   ```

2. **Investigate:**
   - Check orchestrator logs: `pm2 logs orchestrator`
   - Check Docker daemon: `journalctl -u docker`
   - Check container logs: `docker logs claude-worker-{taskId}`

3. **Fix forward:**
   - Deploy fix to worker image
   - Rebuild: `./scripts/build-worker-image.sh && PUSH=true ./scripts/build-worker-image.sh`
   - Restart: `pm2 restart orchestrator`

### 7.3 Monitoring Alerts

Configure these alerts:

| Alert | Condition | Action |
|-------|-----------|--------|
| Container OOM killed | Exit code 137 | Investigate memory leak |
| Container timeout | > 5 timeouts/hour | Check for stuck tasks |
| Network egress blocked | > 100 blocks/hour | Potential exfiltration attempt |
| Security policy violation | Any SELinux/AppArmor deny | Investigate escape attempt |
| Worker startup failure | > 3 failures/hour | Check Docker daemon |

---

## Appendix A: Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ISOLATION_PROVIDER` | No | `docker` | Provider type: `docker`, `vm`, `local` |
| `CLAUDE_WORKER_IMAGE` | No | `gcr.io/intexuraos/claude-worker:latest` | Worker container image |
| `CLAUDE_WORKER_NETWORK` | No | `claude-worker-network` | Docker network name |
| `WORKER_MEMORY_LIMIT` | No | `8g` | Container memory limit |
| `WORKER_CPU_LIMIT` | No | `2` | Container CPU limit |
| `WORKER_TIMEOUT_SECONDS` | No | `7200` | Task timeout (2 hours) |

### VM Provider Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PROJECT_ID` | Yes | - | GCP project ID |
| `GCE_ZONE` | No | `us-central1-a` | GCE zone |
| `GCE_MACHINE_TYPE` | No | `e2-standard-2` | VM machine type |
| `CLAUDE_WORKER_VM_IMAGE` | Yes | - | VM image path |
| `CLAUDE_WORKER_SA` | Yes | - | Service account email |
| `VPC_NETWORK` | No | `default` | VPC network |
| `VPC_SUBNETWORK` | No | `default` | VPC subnetwork |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Worktree** | Isolated git working directory for a single task |
| **Isolation Provider** | Abstract interface for running isolated workers |
| **Docker Provider** | Isolation using Docker containers |
| **VM Provider** | Isolation using GCE virtual machines |
| **Local Provider** | No isolation (tmux-based, for debugging only) |
| **Egress** | Outbound network traffic from worker |
| **Ingress** | Inbound network traffic to worker |
| **cgroups** | Linux kernel feature for resource limits |
| **seccomp** | Linux kernel feature for syscall filtering |
| **OOM** | Out of memory (kernel kills process) |

---

**END OF DOCUMENT**
