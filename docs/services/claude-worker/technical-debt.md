# Claude Worker - Technical Debt

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Security Hardening  | 3     | Medium   |
| Operational Gaps    | 2     | Low      |
| Architecture Debt   | 2     | Low      |

Last updated: 2026-02-08

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
**Context:** The orchestrator relies on Docker container state (`inspect`) and attach stream activity to determine worker health. There is no application-level health check inside the container.
**Impact:** A hung Claude process that keeps the container "running" but produces no output can only be detected by the timeout mechanism (up to 2 hours).
**Ideal fix:** Add a lightweight health signal (heartbeat file in `/tmp/` written periodically) that the orchestrator can check via `docker exec`.

### 5. Token refresh watcher is shell-based polling

**Severity:** Low
**Location:** `entrypoint.sh` (lines 91-102)
**Context:** The background loop polls `/secrets/github-token` every 60 seconds using `cat` and string comparison. The `export GITHUB_TOKEN` only affects the subshell where the watcher runs, not the main Claude process.
**Impact:** The token refresh in the entrypoint subshell does not actually propagate to the Claude CLI process. Token propagation relies on Claude reading the file directly (via `gh` CLI which reads `GITHUB_TOKEN` or the token file).
**Ideal fix:** Clarify the token delivery mechanism. If Claude/gh reads the file directly, the watcher is unnecessary. If env var propagation is needed, a different mechanism (writing to a shared file that Claude reads) should be used.

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

## Resolved Issues

### INT-430: Container Isolation (2026-02-03)

Implemented the full Docker-based isolation architecture, replacing the previous uncontained execution model. Added Dockerfile, entrypoint, test image, E2E tests, and orchestrator DockerProvider integration.

### INT-491: Interactive Mode Migration (2026-02-08)

Migrated from `--print` mode (one-shot prompt execution) to interactive mode with Docker attach stdin. Added API key prompt handling for the interactive startup flow.
