# Claude Worker

The Docker-based isolation container that runs Claude Code sessions in sandboxed environments with enforced resource limits, read-only secrets, and network restrictions.

## The Problem

Running AI coding agents directly on host machines creates serious security and operational risks:

1. **Unrestricted filesystem access** - An agent process can read any file on the host, including other tasks' code and system credentials
2. **No resource boundaries** - A runaway agent can consume all CPU and memory, starving other tasks
3. **Secret exposure** - Host environment variables and credential files are accessible to every process
4. **Cross-task contamination** - Multiple concurrent agent tasks share the same filesystem namespace
5. **No network controls** - Agents can reach internal services, cloud metadata servers, and exfiltrate data to arbitrary endpoints

## How It Helps

Claude Worker wraps each Claude Code session in a purpose-built Docker container with defense-in-depth isolation:

1. **Filesystem sandboxing** - Each worker sees only its assigned git worktree at `/repo` and a read-only `/secrets` mount
2. **Resource enforcement** - Kernel-level CPU (4 cores) and memory (8 GB) limits prevent resource exhaustion
3. **Least-privilege execution** - Runs as non-root user `claude` (UID 1001) with all Linux capabilities dropped
4. **Secret partitioning** - Each task receives its own secrets directory; credentials are never shared between tasks
5. **Network isolation** - Dedicated Docker network blocks access to cloud metadata servers and private IP ranges while allowing public internet
6. **Ephemeral home directory** - `/home/claude` is a tmpfs mount that disappears when the container stops, leaving no persistent traces

## Use Cases

### Automated Code Tasks via Orchestrator

**User Goal:** Run an AI agent to implement a Linear ticket on a dedicated git branch

**How it works:**

1. The orchestrator receives a task assignment from the code-agent service
2. It creates a git worktree for the task's branch and prepares a per-task secrets directory
3. A claude-worker container starts with the worktree mounted at `/repo` and secrets at `/secrets`
4. The entrypoint authenticates GCP, loads the GitHub token, and launches Claude in interactive mode
5. The orchestrator sends the system prompt via Docker attach stdin
6. Claude executes the task within the sandboxed environment
7. On completion or timeout, the orchestrator destroys the container and cleans up secrets

### Multi-Model Worker Types

**User Goal:** Use different AI providers depending on task requirements

Claude Worker supports three worker types through the orchestrator:

- **opus** - Uses Claude Opus 4.5 via Anthropic API (for high-quality tasks)
- **auto** - Uses Anthropic API with automatic model selection
- **glm** - Uses GLM via ZAI API (alternative provider)

### E2E Testing with Stub Image

**User Goal:** Verify container isolation behavior without making real API calls

The `Dockerfile.test` builds a lightweight test image that replaces the real Claude CLI with a bash stub script. This stub supports commands like `file-test`, `network-test`, and `resource-test` for verifying filesystem permissions, network restrictions, and resource limits in CI.

## Key Benefits

**Zero-trust execution** - Every container starts with all capabilities dropped and a non-root user. The security posture assumes the agent code is untrusted.

**Automatic credential rotation** - GitHub tokens are refreshed every 30 minutes by the orchestrator's TokenRefresher and written to the container's `/secrets/github-token` file. The entrypoint watches for token changes in the background.

**Pre-baked developer toolchain** - The image includes git, pnpm, ripgrep, fd, bat, jq, terraform, gcloud CLI, and GitHub CLI, matching the tools used across 1,935 analyzed commands from real development sessions.

**Onboarding-free startup** - Claude configuration defaults are baked into the image at `/opt/claude-defaults/` and copied into the tmpfs home directory at startup, skipping the interactive onboarding flow.

## Limitations

**No Docker-in-Docker** - The Docker socket is not mounted inside worker containers. Tasks requiring Docker commands (building images, running containers) cannot execute inside the worker.

**Root filesystem is writable** - Due to Claude Code writing to `/home/claude/.claude/` and Alpine needing `/etc/passwd` writes, the root filesystem cannot be set to read-only. Mitigation comes from non-root user, dropped capabilities, and tmpfs mounts.

**No persistent state** - The `/home/claude` tmpfs mount means all session state, caches, and MCP server data are lost when the container stops. Each task starts from a clean slate.

**Host iptables required for full network isolation** - On production GCE VMs, iptables rules must be applied at the host level to block metadata server and private IP access. On macOS with Docker Desktop, network isolation relies on the VM layer.
