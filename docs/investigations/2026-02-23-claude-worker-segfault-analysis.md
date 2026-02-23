# Claude Worker Segfault Analysis

**Date:** 2026-02-23
**Reporter:** Automated investigation
**Status:** Root cause narrowed to 2 candidates; needs isolation test
**Severity:** Intermittent — affects ~40% of Claude worker run-attempts on macOS

## Original Error

```
04:51:25.129 /entrypoint.sh: line 37: 6119 Segmentation fault
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$system_prompt" \
        --continue \
        < /secrets/user-prompt.txt
```

**Container:** `claude-worker-task_43998cb0-4a38-4f9a-a38e-adaedb05e585`
**Container ID:** `9c6081188b38`
**Image:** `europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker@sha256:fcbe0418f521...`

## Environment

### Host (where Docker runs)

| Property      | Value                          |
|---------------|--------------------------------|
| Machine       | macOS (Apple Silicon ARM)      |
| `uname -s`    | Darwin                         |
| `uname -m`    | arm64                          |
| Docker        | Docker Desktop for Mac         |
| Emulation     | Rosetta 2 (x86_64 containers) |

### Container (where Claude runs)

| Property       | Value                                           |
|----------------|--------------------------------------------------|
| Base image     | `node:22-alpine`                                 |
| Platform       | `linux/amd64` (forced in docker-provider.ts:772) |
| Architecture   | x86_64 (emulated via Rosetta 2)                  |
| libc           | musl 1.2.x                                       |
| Node.js        | v22.22.0                                         |
| Claude CLI     | **2.1.47**                                        |
| Claude binary  | ELF 64-bit LSB, x86-64, interpreter /lib/ld-musl-x86_64.so.1 |

### Key Observation: Ubuntu (home-dev) Never Crashes

The identical container image runs without segfaults on the Ubuntu x86_64 server
(`uname -n` = `home-dev`). The only difference: native x86_64 execution vs Rosetta 2
emulation on macOS ARM.

## How to Reproduce

### Prerequisites

1. Apple Silicon Mac (M1/M2/M3/M4) with Docker Desktop
2. The production Claude worker Docker image (Alpine, linux/amd64)
3. Shared credentials at `~/.claude-orchestrator/claude-creds/.credentials.json`
4. GCP SA key at `~/.config/gcloud/sa-key.json`
5. The IntexuraOS monorepo checked out

### Steps

1. **Container creation** (mirrors `docker-provider.ts` `createWorker`):

```bash
HOST_UID=$(id -u)
HOST_GID=$(id -g)
REPO=/path/to/intexuraos
SECRETS=/tmp/claude-test-secrets
SHARED_CREDS=~/.claude-orchestrator/claude-creds

mkdir -p "$SECRETS"
cp ~/.config/gcloud/sa-key.json "$SECRETS/gcp-sa.json"

# System prompt (triggers MCP/plugin loading)
cat > "$SECRETS/system-prompt.txt" << 'EOF'
You are a code assistant. You have access to tools including Bash, Read, Write, Glob, and Grep.
Use these tools to complete tasks. Be concise.
EOF

# User prompt (triggers parallel tool calls → concurrent API requests)
cat > "$SECRETS/user-prompt.txt" << 'EOF'
Run 3 commands in parallel: list the files in /repo with ls, check the git status, and read the package.json file. Do all 3 at once.
EOF

docker create \
    --name claude-worker-segfault-repro \
    --env "TASK_ID=segfault-repro" \
    --env "GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json" \
    --env "CLAUDE_PROJECT_DIR=/repo" \
    --env "CLAUDE_WORKER_MODE=1" \
    --env "CLAUDE_MANAGED_MODE=1" \
    --env "CLAUDE_CONTINUE=0" \
    --env "GIT_USER_NAME=Test" \
    --env "GIT_USER_EMAIL=test@test.local" \
    --env "LINEAR_API_KEY=" \
    --env "SENTRY_AUTH_TOKEN=" \
    --user "${HOST_UID}:${HOST_GID}" \
    --workdir /repo \
    --network claude-worker-net \
    --cap-drop ALL \
    --cap-add NET_RAW \
    --security-opt no-new-privileges \
    --tmpfs "/tmp:rw,noexec,nosuid,size=2g" \
    --tmpfs "/home/claude:rw,noexec,nosuid,size=500m,uid=${HOST_UID},gid=${HOST_GID}" \
    --tmpfs "/repo/node_modules:rw,exec,nosuid,size=4g,uid=${HOST_UID},gid=${HOST_GID}" \
    -v "${REPO}:/repo:rw" \
    -v "${SECRETS}:/secrets:ro" \
    -v "/tmp/claude-poc-pnpm-store:/home/claude/pnpm-store:rw" \
    -v "${SHARED_CREDS}:/home/claude/.claude:rw" \
    <PRODUCTION_IMAGE>
```

2. **Start container and wait for readiness:**

```bash
docker start claude-worker-segfault-repro

# Poll for readiness marker (entrypoint creates /tmp/worker-ready after pnpm install)
while ! docker exec claude-worker-segfault-repro test -f /tmp/worker-ready 2>/dev/null; do
    sleep 2
done
```

3. **Execute run-attempt** (mirrors orchestrator's `runAttemptInContainer`):

```bash
docker exec \
    --env "CLAUDE_CONTINUE=0" \
    --user "${HOST_UID}:${HOST_GID}" \
    --workdir / \
    claude-worker-segfault-repro \
    /entrypoint.sh run-attempt
```

4. **Check result:**
   - Exit code 139 or 11 = segfault
   - Inspect debug log: `docker exec claude-worker-segfault-repro tail -30 /home/claude/.claude/debug/latest`

### Reproduction Rate

On Apple Silicon Mac with production image (Alpine amd64, Claude 2.1.47):
- ~40% of run-attempts segfault (2 out of 5 in original investigation)
- Segfault is more likely with `--continue` (resuming sessions with pending parallel operations)
- Never observed on native x86_64 (Ubuntu home-dev server)

## Debug Log Crash Signature

The debug log from every crashing session ends with the same pattern:

```
[timestamp] [DEBUG] Ripgrep first use test: FAILED (mode=builtin, path=/usr/local/bin/claude)
[timestamp] [DEBUG] [API:request] Creating client, ANTHROPIC_CUSTOM_HEADERS present: false, has Authorization header: false
[timestamp] [DEBUG] [API:auth] OAuth token check starting
[timestamp] [DEBUG] [API:request] Creating client, ANTHROPIC_CUSTOM_HEADERS present: false, has Authorization header: false
[timestamp] [DEBUG] [API:auth] OAuth token check starting
... (60-79 pairs of these, all within ~16ms) ...
[timestamp] [DEBUG] [API:auth] OAuth token check complete
[timestamp] [DEBUG] [API:auth] OAuth token check complete
... (some complete, then SIGSEGV — log ends abruptly) ...
```

**Key metrics from crashing sessions:**

| Session ID | Time (UTC) | Debug Lines | OAuth Checks | Crash Point |
|------------|-----------|-------------|-------------|-------------|
| `835d5139` | 03:51     | 324         | 79 pairs    | Mid-OAuth burst |
| `867f25c1` | 03:45     | 324         | 79 pairs    | Mid-OAuth burst |
| `2dcf6d23` | 03:48     | 160         | 0 pairs     | Immediately after ripgrep test |

**Key metrics from successful sessions (same container):**

| Session ID | Time (UTC) | Debug Lines | OAuth Checks | Outcome |
|------------|-----------|-------------|-------------|---------|
| `35e3b4ed` | 03:49     | 2400+       | 67 pairs    | Completed |
| `8e03685c` | 03:43     | 890         | ~30 pairs   | Completed |

## POC Test Results

### Test Matrix

Three POC variants tested against the same prompt, same bind mounts, same network:

| Variant | Base Image | Platform | libc | Claude Version | Emulation |
|---------|-----------|----------|------|---------------|-----------|
| **Baseline** | node:22-alpine | linux/amd64 | musl x86_64 | **2.1.47** | Rosetta 2 |
| **Debian-slim** | node:22-slim | linux/amd64 | **glibc 2.36** | **2.1.50** | Rosetta 2 |
| **ARM64 Alpine** | node:22-alpine | **linux/arm64** | musl aarch64 | **2.1.50** | **Native** |

### Results

| Metric | Baseline | Debian-slim | ARM64 Alpine |
|--------|----------|-------------|--------------|
| **Segfault** | NO (this run) | NO | NO |
| **OAuth checks** | **62** | **8** | **6** |
| **Total debug lines** | 723 | 624 | 592 |
| **Execution time** | ~15s | 53s | 31s |
| **Image size** | ~800MB | 906MB | 3.35GB |
| **Ripgrep builtin** | FAILED | FAILED | FAILED |

### Critical Observation: OAuth Check Count

The baseline creates **8-10x more OAuth checks** than the other variants for the
identical prompt. Even when it doesn't crash, this is pathological behavior.

## Confounding Variables

### ⚠️ UNRESOLVED: Claude CLI Version Difference

| Variable | Baseline | POC Debian | POC ARM64 |
|----------|----------|------------|-----------|
| Claude CLI | **2.1.47** | **2.1.50** | **2.1.50** |

The production image has Claude CLI 2.1.47 baked in. Both POC images were built
fresh and got 2.1.50 from the installer. **It is possible that the fix is in
2.1.50, not in the OS/architecture change.**

The 62 vs 6-8 OAuth check difference could be a bug in 2.1.47's OAuth token
caching that was fixed in 2.1.50. Without testing 2.1.50 on Alpine amd64, we
cannot conclusively attribute the fix to either:
- (a) the libc change (musl → glibc), or
- (b) the platform change (Rosetta → native), or
- (c) the Claude CLI version upgrade (2.1.47 → 2.1.50)

### Isolation Test Needed

To resolve this, build an Alpine amd64 image with Claude CLI 2.1.50:

```dockerfile
FROM node:22-alpine
# ... same as production Dockerfile ...
# But with Claude CLI 2.1.50 instead of 2.1.47
```

If this variant shows 6-8 OAuth checks and no segfaults, the root cause is the
Claude CLI version, not the platform.

## Other Findings

### Ripgrep Builtin Always Fails

Every session across all variants shows:
```
Ripgrep first use test: FAILED (mode=builtin, path=/usr/local/bin/claude)
```

The Claude CLI bundles a native ripgrep binary that it tries to extract and execute.
This fails on all tested platforms (Alpine musl, Debian glibc, ARM64 musl). The
failure is caught and logged — Claude falls back to system ripgrep if available.

**Impact:** Non-fatal. System `rg` (installed via apk/apt) is used instead.

### ToolSearch Optimistic Mode Variation

Crashing sessions showed `mode=tst-auto` while one non-crashing session showed
`mode=standard`. The `tst-auto` mode enables more aggressive tool searching which
may increase parallel API requests.

### Plugin Loading: superpowers Missing

Every session logs:
```
Plugin superpowers@superpowers-marketplace not found in any marketplace, skipping
```

This is expected — the superpowers plugin isn't available in the container's
marketplace configuration. Non-fatal.

### MCP Server Warnings

- `context7`: Uses default CLIENT_IP_ENCRYPTION_KEY (harmless)
- `sentry`: Missing OPENAI_API_KEY/ANTHROPIC_API_KEY for AI search tools (expected)
- `playwright`: On Alpine, npx re-downloads the package despite global install

## Files Created During Investigation

| File | Purpose |
|------|---------|
| `workers/claude-worker/Dockerfile.poc-debian` | Debian-slim POC Dockerfile |
| `workers/claude-worker/Dockerfile.poc-arm64` | ARM64 Alpine POC Dockerfile |
| `workers/claude-worker/poc-test.sh` | Automated test harness |
| `docs/investigations/2026-02-23-claude-worker-segfault-analysis.md` | This file |

## Docker Images Created

| Image | Platform | Size |
|-------|----------|------|
| `claude-worker-poc-debian:latest` | linux/amd64 | 906MB |
| `claude-worker-poc-arm64:latest` | linux/arm64 | 3.35GB |

## Recommended Next Steps

### Immediate: Isolation Test (determines root cause)

Build Alpine amd64 with Claude CLI 2.1.50 and test:

```bash
# Modify production Dockerfile to force 2.1.50 (or just rebuild — installer gets latest)
docker build --platform linux/amd64 -f workers/claude-worker/Dockerfile \
    -t claude-worker-version-test:latest .

# Run same POC test
bash workers/claude-worker/poc-test.sh baseline  # (after pointing to new image)
```

**If OAuth checks drop to 6-8:** Root cause is Claude CLI 2.1.47 bug → just rebuild image.
**If OAuth checks stay at 60+:** Root cause is Alpine/musl + Rosetta → switch base image.

### If Version Is the Fix

1. Rebuild production image (gets latest Claude CLI)
2. Push to Artifact Registry
3. Done — no Dockerfile changes needed

### If Platform Is the Fix

**Option A: Multi-arch build** (recommended for long term)
- Build both `linux/amd64` and `linux/arm64` manifests
- Docker Desktop automatically picks the right one
- Production (Ubuntu x86) gets amd64, local dev (macOS ARM) gets arm64

**Option B: Switch to Debian-slim**
- Single-arch, works everywhere under Rosetta
- 906MB image (vs ~800MB Alpine) — minimal size increase
- Better native library compatibility

**Option C: ARM64 only for local**
- Orchestrator detects host arch and selects platform
- Change `docker-provider.ts:772` from hardcoded `linux/amd64` to dynamic

## Appendix: Exact Env Vars in Production Container

```
TASK_ID=task_43998cb0-4a38-4f9a-a38e-adaedb05e585
LINEAR_API_KEY=<redacted>
SENTRY_AUTH_TOKEN=<redacted>
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json
CLAUDE_PROJECT_DIR=/repo
CLAUDE_WORKER_MODE=1
CLAUDE_MANAGED_MODE=1
CLAUDE_CONTINUE=0
GIT_USER_NAME=<configured>
GIT_USER_EMAIL=<configured>
PATH=/opt/google-cloud-sdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
NODE_VERSION=22.22.0
HOME=/home/claude
NODE_ENV=production
COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

Note: No `ANTHROPIC_API_KEY` — authentication uses shared credentials file
(`.credentials.json` bind-mounted to `/home/claude/.claude/`).

## Appendix: Bind Mounts in Production Container

```
/Users/p.buchman/claude-workers/worktrees/<task_id>:/repo:rw
/Users/p.buchman/.claude-orchestrator/secrets/<task_id>:/secrets:ro
/Users/p.buchman/.claude-orchestrator/pnpm-store:/home/claude/pnpm-store:rw
/Users/p.buchman/.claude-orchestrator/claude-creds:/home/claude/.claude:rw
/Users/p.buchman/claude-orchestrator/intexuraos/.git:<same-path>:rw  (worktree support)
```

## Appendix: tmpfs Configuration

```
/tmp:                rw,noexec,nosuid,size=2g
/home/claude:        rw,noexec,nosuid,size=500m,uid=<host>,gid=<host>
/repo/node_modules:  rw,exec,nosuid,size=4g,uid=<host>,gid=<host>
```

## Appendix: Security Configuration

```
CapDrop: ALL
CapAdd:  NET_RAW
SecurityOpt: no-new-privileges
ReadonlyRootfs: false
AutoRemove: false
NetworkMode: claude-worker-net
```
