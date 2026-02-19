# Claude Worker - Technical Debt

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Security Hardening  | 3     | Medium   |
| Operational Gaps    | 2     | Low      |
| Architecture Debt   | 3     | Low      |

Last updated: 2026-02-19

## Security Hardening

### 1. Root filesystem remains writable

**Severity:** Medium
**Location:** `Dockerfile` (no `ReadonlyRootfs`)
**Context:** Claude Code writes to `/home/claude/.claude/` for settings and session state, and Alpine needs `/etc/passwd` writable. The tmpfs on `/home/claude` does not cover all write targets.
**Mitigation in place:** Non-root user (UID 1001), all capabilities dropped, `no-new-privileges` security option.
**Ideal fix:** Identify all write paths, create targeted tmpfs mounts for each, and enable `ReadonlyRootfs: true`.

### 2. Host iptables rules are manual

**Severity:** Medium
**Location:** `scripts/setup-worker-network.sh` (documented in comments, not automated)
**Context:** Network isolation of cloud metadata server (`169.254.169.254`) and private IP ranges depends on iptables rules applied manually on the production GCE host. The network setup script only creates the Docker network; it does not apply iptables rules.
**Impact:** On a fresh production host, metadata server access is possible until iptables rules are applied.
**Ideal fix:** Automate iptables rule application in the VM provisioning script or as a systemd unit.

### 3. NET_RAW capability retained

**Severity:** Low
**Location:** `DockerProvider.createWorker()` in `docker-provider.ts`
**Context:** NET_RAW is added back after dropping all capabilities to support network diagnostics (ping, traceroute). This capability can theoretically be used for packet crafting.
**Mitigation in place:** Isolated Docker network, non-root user.
**Ideal fix:** Evaluate whether Claude actually uses ping/traceroute in practice. If not, remove NET_RAW.

## Operational Gaps

### 4. No health check endpoint or signal

**Severity:** Low
**Context:** The orchestrator relies on Docker container state (`inspect`) and the readiness marker to determine worker health. There is no application-level heartbeat inside the container during Claude execution.
**Impact:** A hung Claude process that keeps the container "running" and produces no output can only be detected by the per-attempt timeout mechanism.
**Ideal fix:** Have Claude (or the entrypoint) write a periodic heartbeat file to `/tmp/` that the orchestrator can check via `docker exec test -f`.

### 5. Token refresh watcher does not propagate to Claude process

**Severity:** Low
**Location:** `entrypoint.sh` (background watcher loop)
**Context:** The background loop polls `/secrets/github-token` every 60 seconds and exports `GITHUB_TOKEN` in the watcher subshell. This export does not propagate to the Claude process or to `run-attempt` invocations. Token delivery to `gh` CLI relies on the git credential helper (`!f() { echo "password=${GITHUB_TOKEN}"; }; f`) being re-evaluated at each `gh` invocation.
**Impact:** In managed mode, if the token expires between attempts, the new token from the file is not picked up by the credential helper (which reads `GITHUB_TOKEN` from the environment). The `setup_github_token` function is called again at each `run-attempt`, but it reads from the file directly, so the credential helper is reconfigured correctly.
**Ideal fix:** Verify the credential helper reconfiguration in `run_claude_attempt → setup_github_token` correctly picks up the refreshed token from `/secrets/github-token` on each attempt. If not, rewrite the watcher to update the credential helper config file instead.

## Architecture Debt

### 6. Dockerfile installs tools based on historical command analysis

**Severity:** Low
**Location:** `Dockerfile` (comment block lines 4-11)
**Context:** The toolchain selection is based on a one-time analysis of 1,935 commands across 6 worktrees. As Claude's tool usage evolves, the installed toolchain may drift from actual needs, growing the image size unnecessarily or missing newly needed tools.
**Ideal fix:** Implement periodic command usage auditing and update the Dockerfile accordingly.

### 7. No image versioning strategy

**Severity:** Low
**Location:** `scripts/build-worker-image.sh`
**Context:** The default tag is `latest`. The build script accepts a custom tag argument but there is no automated versioning tied to git tags, CI, or release process.
**Impact:** Rolling back to a previous worker image version requires knowing the exact tag that was pushed.
**Ideal fix:** Tag images with git SHA or semantic version during CI builds.

### 8. pnpm store is ephemeral on every container

**Severity:** Low
**Location:** `entrypoint.sh` (`pnpm config set store-dir /home/claude/pnpm-store`)
**Context:** The pnpm content-addressable store is placed on the `/home/claude` tmpfs, meaning every container cold-installs all dependencies. For a monorepo with many packages, this adds significant startup time.
**Impact:** Each managed-mode container startup performs a full `pnpm install`, even if the lockfile hasn't changed.
**Ideal fix:** Mount a shared host-side pnpm store volume at a path outside `/home/claude` so the cache persists across containers. Requires ensuring the store path is not writable by other containers simultaneously (pnpm store is safe for concurrent reads, but writes need locking).

## Future Plans

### Planned Features

- **Read-only root filesystem** - Investigate all write paths and create targeted mounts to enable `ReadonlyRootfs: true`
- **Image size optimization** - Multi-stage build to reduce final image size by excluding build-time-only dependencies
- **Seccomp profile** - Add a custom seccomp profile to restrict system calls beyond capability dropping

### Proposed Enhancements

1. Automated iptables provisioning as part of VM setup
2. Container health check mechanism for faster hung-process detection
3. Automated image versioning in CI pipeline
4. Periodic toolchain usage audit to keep the image lean
5. Shared host-side pnpm store volume to avoid cold-install overhead

## Resolved Issues

### INT-430: Container Isolation (2026-02-03)

Implemented the full Docker-based isolation architecture, replacing the previous uncontained execution model. Added Dockerfile, entrypoint, test image, E2E tests, and orchestrator DockerProvider integration.

### INT-491: Interactive Mode Migration → Superseded by Managed Mode (2026-02-08, revised 2026-02-12)

Initially migrated from `--print` mode to interactive mode with Docker attach stdin. This was subsequently superseded by the managed execution mode (`CLAUDE_MANAGED_MODE=1`), which reverts to `--print` mode but via file-based prompts (`/secrets/system-prompt.txt`, `/secrets/user-prompt.txt`) invoked through `docker exec /entrypoint.sh run-attempt`. The managed mode approach avoids the complexity of stdin stream management and Docker attach ordering while enabling container reuse across multiple attempts.

### MCP Server Permission Errors (2026-02-19)

Pre-installed MCP server packages (`@upstash/context7-mcp`, `@sentry/mcp-server`, `@playwright/mcp`) globally via `npm install -g` in the Dockerfile. On Alpine, `npx -y <package>` downloads to a temp directory with `noexec` permissions, causing "Permission denied" at MCP startup. Global installation puts binaries in `/usr/local/bin` with proper execute permissions; `npx` finds the global install and skips the download.

### Playwright Browser Download Failure (2026-02-19)

Added system Chromium (`apk add chromium`) to the Dockerfile and set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` + `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser`. Previously, `@playwright/mcp` attempted to download Chromium at runtime into a noexec-restricted directory, failing silently.
