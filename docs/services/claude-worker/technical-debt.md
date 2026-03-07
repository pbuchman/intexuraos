# Claude Worker - Technical Debt

**Last Updated:** 2026-03-07
**Analysis Run:** [2026-03-07 entry](../../documentation-runs.md)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Security Hardening  | 3     | Medium   |
| Operational Gaps    | 1     | Low      |
| Architecture Debt   | 2     | Low      |
| **Total**           | **6** | --       |

---

## Future Plans

### Planned Features

- **Read-only root filesystem** -- Investigate all write paths and create targeted mounts to enable `ReadonlyRootfs: true`
- **Image size optimization** -- Multi-stage build to reduce final image size by excluding build-time-only dependencies
- **Seccomp profile** -- Add a custom seccomp profile to restrict system calls beyond capability dropping
- **Image versioning** -- Tag images with git SHA or semantic version in CI; currently tagged as `:latest`
- **Plugin auto-update** -- Mechanism to refresh pre-installed Claude Code plugins when new versions are released

### Proposed Enhancements

1. Automated iptables provisioning as part of VM setup
2. Container health check mechanism for faster hung-process detection
3. Automated image versioning in CI pipeline
4. Periodic toolchain usage audit to keep the image lean

---

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

---

## Operational Gaps

### 4. No health check endpoint or signal

**Severity:** Low
**Context:** The orchestrator relies on Docker container state (`inspect`) and the readiness marker to determine worker health. There is no application-level heartbeat inside the container during Claude execution.
**Impact:** A hung Claude process that keeps the container "running" and produces no output can only be detected by the per-attempt timeout mechanism.
**Ideal fix:** Have Claude (or the entrypoint) write a periodic heartbeat file to `/tmp/` that the orchestrator can check via `docker exec test -f`.

---

## Architecture Debt

### 5. Dockerfile installs tools based on historical command analysis

**Severity:** Low
**Location:** `Dockerfile` (comment block lines 4-11)
**Context:** The toolchain selection is based on a one-time analysis of 1,935 commands across 6 worktrees. As Claude's tool usage evolves, the installed toolchain may drift from actual needs, growing the image size unnecessarily or missing newly needed tools.
**Ideal fix:** Implement periodic command usage auditing and update the Dockerfile accordingly.

### 6. No image versioning strategy

**Severity:** Low
**Location:** `scripts/build-worker-image.sh`, `cloudbuild.yaml`
**Context:** The default tag is `latest`. The build script accepts a custom tag argument and the daily Cloud Build rebuild always pushes `:latest`. There is no automated versioning tied to git tags or release process.
**Impact:** Rolling back to a previous worker image version requires knowing the exact digest that was pushed. The `DockerProvider` does resolve and log the digest after pulling, but there is no human-friendly version label.
**Ideal fix:** Tag images with git SHA or semantic version during CI builds.

---

## Test Coverage Gaps

No test coverage gaps. The worker is tested via E2E tests in the orchestrator workspace using the test image (`Dockerfile.test`) with the Claude stub (`test-fixtures/claude-stub.sh`).

---

## TypeScript Issues

Not applicable. The claude-worker is entirely shell scripts and Dockerfiles -- no TypeScript code.

---

## TODOs / FIXMEs

No TODO, FIXME, or HACK comments found in the worker codebase.

---

## SRP Violations

| File             | Lines | Issue                                                              | Suggestion                                                    |
| ---------------- | ----- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `entrypoint.sh`  | 396   | Handles startup, auth, secret sync, dep install, and Claude exec   | Consider splitting into modular scripts (setup.sh, run.sh)    |

---

## Resolved Issues

### INT-430: Container Isolation (2026-02-03)

Implemented the full Docker-based isolation architecture, replacing the previous uncontained execution model. Added Dockerfile, entrypoint, test image, E2E tests, and orchestrator DockerProvider integration.

### INT-491: Interactive Mode Migration then Superseded by Managed Mode (2026-02-08, revised 2026-02-12)

Initially migrated from `--print` mode to interactive mode with Docker attach stdin. This was subsequently superseded by the managed execution mode (`CLAUDE_MANAGED_MODE=1`), which reverts to `--print` mode but via file-based prompts (`/secrets/system-prompt.txt`, `/secrets/user-prompt.txt`) invoked through `docker exec /entrypoint.sh run-attempt`. The managed mode approach avoids the complexity of stdin stream management and Docker attach ordering while enabling container reuse across multiple attempts.

### MCP Server Permission Errors (2026-02-19)

Pre-installed MCP server packages (`@upstash/context7-mcp`, `@sentry/mcp-server`, `@playwright/mcp`) globally via `npm install -g` in the Dockerfile. On Alpine, `npx -y <package>` downloads to a temp directory with `noexec` permissions, causing "Permission denied" at MCP startup. Global installation puts binaries in `/usr/local/bin` with proper execute permissions; `npx` finds the global install and skips the download.

### Persistent pnpm Store via Host Mount (2026-02-19)

The `DockerProvider` now creates a shared `pnpm-store` directory on the host (alongside `secretsBasePath`) and bind-mounts it at `/home/claude/pnpm-store:rw`. Store contents survive container teardown and are shared across all workers started by the same orchestrator instance, eliminating cold-install overhead for lockfile-unchanged runs.

### Playwright Browser Download Failure (2026-02-19)

Added system Chromium (`apk add chromium`) to the Dockerfile and set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` + `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser`. Previously, `@playwright/mcp` attempted to download Chromium at runtime into a noexec-restricted directory, failing silently.

### Claude Code Plugin Pre-installation (2026-02-25)

Pre-installed Claude Code plugins at build time into `/opt/claude-plugins/.claude/plugins/` with path rewriting at runtime. Previously, plugins had to be installed at container start, adding latency and requiring internet access.

### Multi-arch Image Build (2026-02-26)

Switched from single-arch to multi-arch build (`linux/amd64,linux/arm64`) using Docker BuildKit. The same image tag now runs natively on x86_64 (production GCE host) and Apple Silicon (local development) without Rosetta.

### Crash Forensics Mode (2026-02-26)

Added `CLAUDE_FORENSICS=1` mode that captures core dumps, GDB backtraces, debug logs, and session state when Claude CLI crashes (exit code 139). Installed `gdb`, `strace`, and `file` utilities in the production image.

### Secret Sync Moved to Container (2026-03-03)

Moved GCP Secret Manager sync from the orchestrator to the container entrypoint. The container now runs `scripts/sync-secrets.sh` during startup, writes `/repo/.envrc`, and loads it via `source` and `direnv allow`. Added `direnv` to the installed toolchain. Previously, secrets had to be synced and mounted by the orchestrator before container start.

### INT-684: Token Refresh Propagation Fix (2026-03-06)

Removed the broken background token watcher (subshell `export` never propagated to parent/child processes). Rewrote the git credential helper to read `/secrets/github-token` directly on each git operation instead of expanding `${GITHUB_TOKEN}` from the environment. Added a `gh` CLI wrapper at `/usr/local/bin/gh` that re-reads the token file before each invocation. Token freshness is now fully file-based -- no background polling needed.

---

## Related

- [Features](features.md) -- User-facing documentation
- [Technical](technical.md) -- Developer reference
- [Documentation Run Log](../../documentation-runs.md)
