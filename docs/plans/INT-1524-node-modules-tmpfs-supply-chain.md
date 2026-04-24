# INT-1524 — Harden code-worker against pnpm supply-chain attacks via lockfile tampering

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear:** https://linear.app/pbuchman/issue/INT-1524/sec-reponode-modules-tmpfs-has-exec-permission-supply-chain-impact
**Severity:** Medium
**Parent audit:** INT-1472

**Goal:** Defang the supply-chain risk created by combining `exec` on `/repo/node_modules`
tmpfs with the LLM's ability to edit `pnpm-lock.yaml`. The `exec` permission cannot be
removed (pnpm's `.bin/` shims need it on Linux), so we close the attack path by
making `pnpm install` lifecycle scripts unrunnable, hardening lockfile-integrity
invariants, and detecting LLM-initiated lockfile tampering during an attempt.

**Architecture:**
1. Force `ignore-scripts=true` on every `pnpm install` invoked inside the worker
   container (bootstrap + LLM-initiated) via container env vars and a workspace-level
   `.npmrc` that the LLM cannot disable without it being detected.
2. Snapshot `pnpm-lock.yaml` (sha256) at worker bootstrap; compare against the
   final state at attempt teardown. Any drift is logged + included in forensics so
   reviewers can audit it before merge.
3. Reject pnpm-lock entries that bypass package-registry integrity (no `tarball:`,
   `git+`, `file:`, `link:`, or `http(s):` resolutions for non-workspace packages,
   and require `integrity:` digest on every package entry).

**Tech Stack:** TypeScript / Node 22, vitest, dockerode, bash entrypoint, pnpm 9.

---

## Context (read this first if you have no codebase context)

**The worker container at a glance** — `workers/code-worker/`:
- Built from `workers/code-worker/Dockerfile` (Alpine + pnpm + Claude/Codex CLIs).
- Started by `workers/orchestrator/` (TS service) which builds the docker run spec
  via `services/isolation/{docker-volume,worker-create,worker-env}.ts`.
- `entrypoint.sh` runs as user `claude` (uid 1001) with these mounts:
  - `/repo` ← worktree bind mount (writable, includes `.git` and `pnpm-lock.yaml`).
  - `/repo/node_modules` ← tmpfs `rw,exec,nosuid,size=4g` (`docker-volume.ts:284`).
    Shadowing the host's macOS-built `node_modules` with a Linux-native one is
    the reason this directory needs `exec` — pnpm-installed `.bin/` shims are
    POSIX scripts that have to be executable.
  - `/home/claude/pnpm-store` ← persistent host volume (pnpm CAS store).
  - `/tmp`, `/home/claude` ← tmpfs `noexec,nosuid`.
- Bootstrap install runs in `entrypoint.sh:520-525`:
  ```bash
  CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    pnpm install --frozen-lockfile --store-dir /home/claude/pnpm-store
  ```
  This currently does **not** pass `--ignore-scripts`. The LLM, after the worker
  is ready, can run `pnpm install` again with arbitrary flags or edit the
  lockfile and re-install.

**Attack chain we are closing:**
1. LLM (or a poisoned plan) modifies `pnpm-lock.yaml` to point a transitive
   dependency at a malicious tarball with a `postinstall` script.
2. LLM runs `pnpm install` (or any CLI that triggers pnpm hooks).
3. The malicious script executes from `/repo/node_modules`, which has `exec`.
4. The script can read `/secrets/*`, `/repo/.envrc`, `/secrets/github-token`,
   open outbound connections (no egress firewall on the worker network), or
   commit tampered code that the orchestrator subsequently merges.

**Why `ignore-scripts=true` is the right knob:**
pnpm executes lifecycle scripts (`preinstall`, `install`, `postinstall`,
`prepare`) by default. With `ignore-scripts=true` it copies files to
`node_modules/<pkg>` but never spawns a script. A malicious tarball still
ends up on disk, but the dropped binaries are never invoked unless the LLM
manually executes them — and we additionally rely on the existing layered
defenses (no-new-privileges, seccomp in forensics mode, scoped credentials).

**Why we cannot just drop `exec` on the tmpfs:**
pnpm's `.bin/` directory contains both POSIX shell wrappers and node-shebang
scripts. With `noexec`, even legitimate `pnpm test` / `pnpm vitest` /
`pnpm tsc` invocations break, because the launcher needs to `exec` the
`.bin/<tool>` shim. The README explicitly mentions 248 pnpm uses across CI;
`noexec` here is a non-starter.

---

## File Structure

**Modified files:**
- `workers/code-worker/entrypoint.sh` — add `--ignore-scripts` to bootstrap install,
  capture pre-attempt lockfile sha256, expose env to subsequent installs.
- `workers/code-worker/.npmrc` *(new file, baked into image)* — sets
  `ignore-scripts=true`, `frozen-lockfile=true`, `prefer-offline=true`,
  `auto-install-peers=true`. Copied to `/home/claude/.npmrc` by Dockerfile
  so it applies to LLM-initiated invocations regardless of cwd.
- `workers/code-worker/Dockerfile` — `COPY` the new `.npmrc` into both the
  image's `/etc/npmrc` and `/opt/claude-defaults/.npmrc`; entrypoint copies
  the latter into `/home/claude/.npmrc` after the tmpfs is mounted.
- `workers/orchestrator/src/services/isolation/worker-env.ts` —
  add `NPM_CONFIG_IGNORE_SCRIPTS=true` and
  `npm_config_ignore_scripts=true` to the container env list (belt-and-braces,
  works even if the LLM `rm`s `.npmrc`).
- `workers/orchestrator/src/services/isolation/lockfile-guard.ts` *(new)* —
  pure functions to (a) compute lockfile sha256, (b) parse a `pnpm-lock.yaml`
  YAML and assert that every package entry has an `integrity:` field whose
  prefix is `sha512-`, and (c) reject disallowed resolution schemes.
- `workers/orchestrator/src/services/isolation/__tests__/lockfile-guard.test.ts`
  *(new)* — vitest unit tests using fixture lockfiles in `__tests__/fixtures/`.
- `workers/orchestrator/src/services/isolation/__tests__/fixtures/lockfile/clean.yaml`
  *(new)* — minimally valid `pnpm-lock.yaml` for the green-path test.
- `workers/orchestrator/src/services/isolation/__tests__/fixtures/lockfile/missing-integrity.yaml`
  *(new)* — entry without `integrity` to drive the negative test.
- `workers/orchestrator/src/services/isolation/__tests__/fixtures/lockfile/tarball-resolution.yaml`
  *(new)* — entry with `tarball:` resolution to drive the second negative test.
- `workers/orchestrator/src/services/isolation/worker-create.ts` —
  call `LockfileGuard.snapshot(worktreePath)` before container start, store the
  digest on the `WorkerEntry`, write `lockfile-snapshot.txt` into the forensics
  dir if forensics mode is on.
- `workers/orchestrator/src/services/isolation/worker-create.ts` —
  in the attempt-cleanup path, call `LockfileGuard.compare(worktreePath, snapshot)`
  and emit a structured warn-level log + forensics file when a drift is detected.
- `workers/orchestrator/src/services/isolation/types.ts` — extend `WorkerEntry`
  with optional `lockfileSha256: string`.
- `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`
  — extend the `mounts pnpm store volume and node_modules tmpfs` test to also
  assert the new env vars.
- `workers/orchestrator/src/services/isolation/__tests__/docker-volume.test.ts`
  — add `buildTmpfs` test case asserting the tmpfs mode string is unchanged
  (regression guard so a future "fix" that removes `exec` is caught and reverted
  with a comment, since `noexec` breaks pnpm `.bin/` shims).

**No file is removed.** No public API changes outside the orchestrator package.

---

## Endpoint Changes

- **Modified:** none.
- **Created:** none.
- **Removed:** none.
- **Unchanged:** all worker HTTP endpoints. This change is purely internal to
  container provisioning and post-attempt teardown.

---

## Acceptance Criteria

1. A `postinstall` script in any package listed in `pnpm-lock.yaml` does **not**
   execute during the bootstrap install nor during any LLM-triggered
   `pnpm install` inside the worker container — verified by an integration test
   that adds a tripwire package whose `postinstall` writes to `/tmp/tripwire`
   and asserts the file does not exist after `pnpm install` runs.
2. The worker's container env contains `NPM_CONFIG_IGNORE_SCRIPTS=true`.
3. `/home/claude/.npmrc` exists at runtime and contains `ignore-scripts=true`.
4. `LockfileGuard.assertIntegrity(...)` rejects fixture lockfiles missing
   `integrity:` fields and fixture lockfiles with `tarball:` / `git+` / `file:`
   resolutions for non-workspace packages.
5. After an attempt completes, if `pnpm-lock.yaml` was modified by the LLM, the
   orchestrator emits a structured log entry (`event: 'lockfile-drift'`,
   `taskId`, `before`, `after`) and writes `lockfile-drift.txt` into the
   forensics directory when forensics mode is enabled.
6. `pnpm run verify:workspace:tracked orchestrator` passes.
7. `pnpm run ci:tracked` passes (full repo).

---

## Test Plan

- **Unit:** `lockfile-guard.test.ts` (3 fixture cases: clean / missing-integrity /
  bad-resolution), `worker-env.test.ts` (assert new env vars present),
  `docker-volume.test.ts` (regression on tmpfs mode string),
  `docker-provider.test.ts` (env+tmpfs assertion).
- **Integration:** Tripwire postinstall test — `workers/code-worker/__tests__/postinstall-tripwire.test.ts`
  (new, runs only when `RUN_DOCKER_E2E=1` so CI unaffected; verifies the dropped
  file is absent after install).
- **Manual smoke:** Build the image locally, dispatch a no-op task, confirm
  `[entrypoint] Lockfile sha256: <hex>` line appears in container logs and that
  `pnpm install` reports `Lifecycle scripts: skipped`.
- **Static check:** `grep -n "ignore-scripts" workers/code-worker/.npmrc` returns
  the line; `grep -n "NPM_CONFIG_IGNORE_SCRIPTS" workers/orchestrator/src/services/isolation/worker-env.ts`
  returns the env push.

---

## Task 1: Add `.npmrc` baked into the image and copied into runtime HOME

**Files:**
- Create: `workers/code-worker/.npmrc`
- Modify: `workers/code-worker/Dockerfile` (after line 116, near `COPY ... claude.json`)

- [ ] **Step 1: Write the `.npmrc` content**

```
# Forced security defaults for the code-worker container.
# These settings apply both to the bootstrap install in entrypoint.sh and to any
# subsequent `pnpm install` invoked by the LLM. Container env vars
# (NPM_CONFIG_IGNORE_SCRIPTS / npm_config_ignore_scripts) provide a redundant
# enforcement layer so that even if this file is deleted at runtime,
# lifecycle scripts still cannot execute.
ignore-scripts=true
frozen-lockfile=true
prefer-offline=true
# Without this, pnpm 9 errors out on workspaces with peer deps.
auto-install-peers=true
# Use the persistent shared store mounted by the orchestrator.
store-dir=/home/claude/pnpm-store
```

- [ ] **Step 2: Modify the Dockerfile to bake the `.npmrc` into image defaults**

After the `COPY --chown=claude:claude workers/code-worker/config-defaults/claude.json /opt/claude-defaults/.claude.json`
line (currently line 116), add:

```dockerfile
# Bake forced pnpm/npm defaults so lifecycle scripts cannot run from a tampered
# lockfile. Copied from /opt/claude-defaults to /home/claude at entrypoint time
# (because /home/claude is tmpfs-wiped on container start).
COPY --chown=claude:claude workers/code-worker/.npmrc /opt/claude-defaults/.npmrc
COPY --chown=claude:claude workers/code-worker/.npmrc /etc/npmrc
```

The `/etc/npmrc` copy ensures protection even if the LLM `rm`s `~/.npmrc`,
because pnpm reads `/etc/npmrc` as the global config.

- [ ] **Step 3: Verify the entrypoint already copies `/opt/claude-defaults` to `/home/claude`**

Read `workers/code-worker/entrypoint.sh` lines 408-411. The block:
```bash
if [ -d "/opt/claude-defaults" ]; then
    cp -r /opt/claude-defaults/. /home/claude/
    echo "[entrypoint] Claude config defaults restored"
fi
```
already runs at startup, so `/opt/claude-defaults/.npmrc` will land at
`/home/claude/.npmrc` automatically. No entrypoint change required for this task.

- [ ] **Step 4: Commit**

```bash
git add workers/code-worker/.npmrc workers/code-worker/Dockerfile
git commit -m "feat(code-worker): bake ignore-scripts .npmrc into container image (INT-1524)"
```

---

## Task 2: Force `--ignore-scripts` on the bootstrap pnpm install

**Files:**
- Modify: `workers/code-worker/entrypoint.sh:520-525`

- [ ] **Step 1: Update the bootstrap install command**

Replace:
```bash
if [ -f "/repo/pnpm-lock.yaml" ]; then
    echo "[entrypoint] Installing dependencies..."
    cd /repo
    CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --store-dir /home/claude/pnpm-store 2>&1
    echo "[entrypoint] Dependencies installed"
fi
```

With:
```bash
if [ -f "/repo/pnpm-lock.yaml" ]; then
    LOCKFILE_SHA="$(sha256sum /repo/pnpm-lock.yaml | awk '{print $1}')"
    echo "[entrypoint] Lockfile sha256: ${LOCKFILE_SHA}"
    if [ -n "${WORKER_FORENSICS_DIR:-}" ] && [ -d "${WORKER_FORENSICS_DIR}" ]; then
        printf '%s\n' "${LOCKFILE_SHA}" > "${WORKER_FORENSICS_DIR}/lockfile-sha256-bootstrap.txt" || true
    fi
    echo "[entrypoint] Installing dependencies (ignore-scripts=true)..."
    cd /repo
    CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
        pnpm install --frozen-lockfile --ignore-scripts \
        --store-dir /home/claude/pnpm-store 2>&1
    echo "[entrypoint] Dependencies installed"
fi
```

- [ ] **Step 2: Verify the bootstrap evidence header still works**

`grep -n 'BOOTSTRAP_' workers/code-worker/entrypoint.sh` — confirm the
`emit_bootstrap_evidence` function is unchanged so existing log parsers
keep working.

- [ ] **Step 3: Commit**

```bash
git add workers/code-worker/entrypoint.sh
git commit -m "feat(code-worker): pass --ignore-scripts on bootstrap pnpm install + capture lockfile sha (INT-1524)"
```

---

## Task 3: Add belt-and-braces env vars in the orchestrator container spec

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/worker-env.ts:59-68`
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

- [ ] **Step 1: Write the failing test (extend existing `mounts pnpm store volume and node_modules tmpfs`)**

In `docker-provider.test.ts`, immediately after the existing `expect(tmpfs[...])`
assertion in `mounts pnpm store volume and node_modules tmpfs` (around line 533),
append:

```ts
const envArr = createCall?.Env as string[];
expect(envArr).toContain('NPM_CONFIG_IGNORE_SCRIPTS=true');
expect(envArr).toContain('npm_config_ignore_scripts=true');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter orchestrator test -- docker-provider`
Expected: FAIL — env array does not contain `NPM_CONFIG_IGNORE_SCRIPTS=true`.

- [ ] **Step 3: Implement — add env vars in `buildWorkerEnv`**

In `worker-env.ts`, replace the initial env array (lines 59-68):

```ts
  const env = [
    `TASK_ID=${taskId}`,
    `LINEAR_API_KEY=${config.secrets.LINEAR_API_KEY}`,
    `SENTRY_AUTH_TOKEN=${config.secrets.SENTRY_AUTH_TOKEN}`,
    `GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json`,
    `WORKER_RUNTIME=${runtime}`,
    'CODE_WORKER_MODE=1',
    `WORKER_MANAGED_MODE=${providerConfig.managedAttemptsMode ? '1' : '0'}`,
    `WORKER_CONTINUE=${config.continueSession === true ? '1' : '0'}`,
    // Defense-in-depth supply-chain protection (INT-1524). pnpm + npm both
    // honor these; redundant with /etc/npmrc and ~/.npmrc but survives the
    // LLM deleting either file at runtime.
    'NPM_CONFIG_IGNORE_SCRIPTS=true',
    'npm_config_ignore_scripts=true',
  ];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter orchestrator test -- docker-provider`
Expected: PASS.

- [ ] **Step 5: Run full orchestrator test suite to catch regressions**

Run: `pnpm --filter orchestrator test`
Expected: PASS (no flakes; the env array is consumed in many other tests but
they all use `expect.arrayContaining` or `expect.toContain` patterns that
ignore extra entries).

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/isolation/worker-env.ts \
        workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts
git commit -m "feat(orchestrator): force NPM_CONFIG_IGNORE_SCRIPTS in worker env (INT-1524)"
```

---

## Task 4: Add a regression-guard test on the tmpfs mode string

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/__tests__/docker-volume.test.ts`

This task ensures a future engineer who tries to "fix the security issue" by
removing `exec` from the tmpfs gets a red test that explains why the flag
must stay (pnpm `.bin/` shims).

- [ ] **Step 1: Add the regression test at the end of the `DockerVolume` describe block**

After the `getPnpmStorePath is sibling of secretsBasePath` test (around line 152),
add:

```ts
  it('buildTmpfs keeps exec on /repo/node_modules — required by pnpm .bin shims (INT-1524)', () => {
    const volume = makeVolume(mockDocker);
    const tmpfs = volume.buildTmpfs();
    // /repo/node_modules MUST stay rw,exec because pnpm-installed .bin/ shims
    // are POSIX scripts. Switching to noexec breaks pnpm test/lint/build runs.
    // Defense-in-depth against malicious lifecycle scripts is provided by
    // ignore-scripts=true (see workers/code-worker/.npmrc and worker-env.ts).
    expect(tmpfs['/repo/node_modules']).toContain('exec');
    expect(tmpfs['/repo/node_modules']).not.toContain('noexec');
    expect(tmpfs['/tmp']).toContain('noexec');
    expect(tmpfs['/home/claude']).toContain('noexec');
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter orchestrator test -- docker-volume`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/services/isolation/__tests__/docker-volume.test.ts
git commit -m "test(orchestrator): regression guard on /repo/node_modules tmpfs flags (INT-1524)"
```

---

## Task 5: New `LockfileGuard` module — integrity assertion (TDD)

**Files:**
- Create: `workers/orchestrator/src/services/isolation/lockfile-guard.ts`
- Create: `workers/orchestrator/src/services/isolation/__tests__/lockfile-guard.test.ts`
- Create: `workers/orchestrator/src/services/isolation/__tests__/fixtures/lockfile/clean.yaml`
- Create: `workers/orchestrator/src/services/isolation/__tests__/fixtures/lockfile/missing-integrity.yaml`
- Create: `workers/orchestrator/src/services/isolation/__tests__/fixtures/lockfile/tarball-resolution.yaml`

- [ ] **Step 1: Write the three fixture lockfiles**

`__tests__/fixtures/lockfile/clean.yaml`:
```yaml
lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
packages:
  lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}
```

`__tests__/fixtures/lockfile/missing-integrity.yaml`:
```yaml
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
packages:
  lodash@4.17.21:
    resolution: {tarball: https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz}
```

`__tests__/fixtures/lockfile/tarball-resolution.yaml`:
```yaml
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      evil:
        specifier: ^1.0.0
        version: 1.0.0
packages:
  evil@1.0.0:
    resolution:
      tarball: https://attacker.example/evil-1.0.0.tgz
      integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
```

- [ ] **Step 2: Write the failing tests**

`__tests__/lockfile-guard.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeLockfileSha256,
  assertLockfileIntegrity,
  LockfileIntegrityError,
} from '../lockfile-guard.js';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'lockfile'
);

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf-8');
}

describe('LockfileGuard', () => {
  describe('computeLockfileSha256', () => {
    it('returns deterministic hex digest', () => {
      const a = computeLockfileSha256('hello');
      const b = computeLockfileSha256('hello');
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('detects content changes', () => {
      expect(computeLockfileSha256('hello')).not.toBe(computeLockfileSha256('hello!'));
    });
  });

  describe('assertLockfileIntegrity', () => {
    it('accepts a clean lockfile with sha512 integrity on every package', () => {
      expect(() => assertLockfileIntegrity(readFixture('clean.yaml'))).not.toThrow();
    });

    it('rejects packages without integrity field', () => {
      expect(() => assertLockfileIntegrity(readFixture('missing-integrity.yaml')))
        .toThrow(LockfileIntegrityError);
    });

    it('rejects non-registry tarball resolutions even with integrity', () => {
      expect(() => assertLockfileIntegrity(readFixture('tarball-resolution.yaml')))
        .toThrow(/disallowed resolution/i);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter orchestrator test -- lockfile-guard`
Expected: FAIL — `Cannot find module '../lockfile-guard.js'`.

- [ ] **Step 4: Implement `lockfile-guard.ts`**

```ts
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { parse as parseYaml } from 'yaml';

export class LockfileIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockfileIntegrityError';
  }
}

export function computeLockfileSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function snapshotLockfile(worktreePath: string): string | null {
  const lockfilePath = `${worktreePath}/pnpm-lock.yaml`;
  if (!fs.existsSync(lockfilePath)) {
    return null;
  }
  return computeLockfileSha256(fs.readFileSync(lockfilePath));
}

interface PnpmLock {
  packages?: Record<string, PnpmLockPackage>;
}

interface PnpmLockPackage {
  resolution?: Record<string, string> | string;
}

const ALLOWED_NON_INTEGRITY_KEYS = new Set(['integrity']);

export function assertLockfileIntegrity(yamlContent: string): void {
  const parsed = parseYaml(yamlContent) as PnpmLock | null;
  const packages = parsed?.packages ?? {};
  for (const [pkgKey, pkg] of Object.entries(packages)) {
    const resolution = pkg.resolution;
    if (resolution === undefined || typeof resolution !== 'object') {
      throw new LockfileIntegrityError(
        `package ${pkgKey} has no structured resolution block`
      );
    }
    if (typeof resolution.integrity !== 'string' || !resolution.integrity.startsWith('sha512-')) {
      throw new LockfileIntegrityError(
        `package ${pkgKey} missing sha512 integrity`
      );
    }
    for (const key of Object.keys(resolution)) {
      if (key === 'integrity' || key === 'tarball') continue;
      if (!ALLOWED_NON_INTEGRITY_KEYS.has(key)) {
        throw new LockfileIntegrityError(
          `package ${pkgKey} has disallowed resolution key '${key}'`
        );
      }
    }
    if (typeof resolution.tarball === 'string') {
      const url = resolution.tarball;
      // Allow only canonical npm registry tarballs.
      if (!/^https:\/\/registry\.npmjs\.org\//.test(url)) {
        throw new LockfileIntegrityError(
          `package ${pkgKey} has disallowed resolution: ${url}`
        );
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter orchestrator test -- lockfile-guard`
Expected: PASS — 5/5.

- [ ] **Step 6: Verify `yaml` is already a dependency**

`grep '"yaml"' workers/orchestrator/package.json` — confirm. If not present:
`pnpm --filter orchestrator add yaml` and re-run tests.

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/isolation/lockfile-guard.ts \
        workers/orchestrator/src/services/isolation/__tests__/lockfile-guard.test.ts \
        workers/orchestrator/src/services/isolation/__tests__/fixtures/lockfile/ \
        workers/orchestrator/package.json workers/orchestrator/pnpm-lock.yaml 2>/dev/null
git commit -m "feat(orchestrator): add LockfileGuard for pnpm-lock integrity checks (INT-1524)"
```

---

## Task 6: Wire `LockfileGuard.snapshot` into worker creation

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/worker-entry-types.ts` (add field)
- Modify: `workers/orchestrator/src/services/isolation/worker-create.ts` (call snapshot)
- Test: `workers/orchestrator/src/services/isolation/__tests__/worker-create.test.ts`
  (or extend `docker-provider.test.ts` if no dedicated test exists)

- [ ] **Step 1: Find the WorkerEntry type**

```bash
grep -n "lockfileSha256\|attemptRunning" workers/orchestrator/src/services/isolation/worker-entry-types.ts
```
Add an optional field `lockfileSha256?: string` next to `attemptRunning`.

- [ ] **Step 2: Write a failing test**

In `docker-provider.test.ts`, add a test:
```ts
    it('records lockfile sha256 snapshot at worker creation (INT-1524)', async () => {
      const config = createTestConfig();
      // The fake worktreePath in tests doesn't have a real lockfile, so
      // expect the entry to record either undefined or null without throwing.
      await provider.createWorker(config);
      const entry = (provider as unknown as { workers: Map<string, { lockfileSha256?: string }> })
        .workers.get(config.taskId);
      expect(entry).toBeDefined();
      // Property exists (type guarantee) — value may be undefined when fixture
      // lacks pnpm-lock.yaml, that's the documented behavior.
      expect('lockfileSha256' in (entry ?? {})).toBe(true);
    });
```

Run: `pnpm --filter orchestrator test -- docker-provider`
Expected: FAIL — `lockfileSha256` not in entry.

- [ ] **Step 3: Implement in `worker-create.ts`**

In the function that constructs and stores the `WorkerEntry` (search for
`workers.set(taskId, {`), import the snapshot helper:

```ts
import { snapshotLockfile } from './lockfile-guard.js';
```

and add to the entry object:

```ts
      lockfileSha256: snapshotLockfile(worktreePath) ?? undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter orchestrator test -- docker-provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/isolation/worker-entry-types.ts \
        workers/orchestrator/src/services/isolation/worker-create.ts \
        workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts
git commit -m "feat(orchestrator): snapshot pnpm-lock sha256 at worker creation (INT-1524)"
```

---

## Task 7: Detect lockfile drift at attempt teardown

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/worker-create.ts`
  (the attempt-cleanup / `runAttemptInContainer` finally block — search
  `attemptRunning = false`).
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`
  (add a unit test that drives `runAttemptInContainer` with a stubbed worktree
  whose lockfile changes between snapshot and teardown).

- [ ] **Step 1: Write the failing test**

Add a test using the existing fake-fs / fake-docker harness in
`docker-provider.test.ts`:

```ts
    it('logs lockfile-drift event when pnpm-lock.yaml changes during the attempt (INT-1524)', async () => {
      // Arrange: createWorker captures sha256 = X; we then mutate the lockfile
      // via the mocked fs before calling teardown.
      const config = createTestConfig();
      await provider.createWorker(config);
      (fs.readFileSync as unknown as Mock).mockReturnValueOnce(Buffer.from('TAMPERED'));
      // Act
      await provider.endAttempt(config.taskId);
      // Assert
      const drift = (mockLogger.warn as Mock).mock.calls.find(([payload]) =>
        (payload as { event?: string }).event === 'lockfile-drift'
      );
      expect(drift).toBeDefined();
    });
```

(Adapt the harness/method names to match what already exists; `endAttempt`
above is illustrative — use the actual public method, found via
`grep -n "attemptRunning = false" workers/orchestrator/src/services/isolation/`.)

Run: `pnpm --filter orchestrator test -- docker-provider`
Expected: FAIL — no `lockfile-drift` log emitted.

- [ ] **Step 2: Implement the comparison hook**

In `worker-create.ts`, in the function that finalizes an attempt
(around the existing `worker.attemptRunning = false` line), add:

```ts
    // INT-1524: detect LLM-tampered lockfile during the attempt.
    const previousSha = worker.lockfileSha256;
    const currentSha = snapshotLockfile(worker.worktreePath);
    if (previousSha !== undefined && currentSha !== null && previousSha !== currentSha) {
      logger.warn(
        {
          event: 'lockfile-drift',
          taskId,
          before: previousSha,
          after: currentSha,
        },
        'pnpm-lock.yaml changed during attempt — review before merging'
      );
      if (worker.taskForensicsPath !== undefined) {
        try {
          await fs.promises.writeFile(
            path.join(worker.taskForensicsPath, 'lockfile-drift.txt'),
            `before=${previousSha}\nafter=${currentSha}\n`,
            'utf-8'
          );
        } catch {
          // best-effort; never throw from teardown
        }
      }
    }
```

`worker.worktreePath` may need to be added to the entry. Search for
how `worktreePath` is referenced; if it's not on the entry, store it during
`createWorker` (one-line addition next to `lockfileSha256`).

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter orchestrator test -- docker-provider`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add workers/orchestrator/src/services/isolation/worker-create.ts \
        workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts
git commit -m "feat(orchestrator): emit lockfile-drift log + forensics file at attempt teardown (INT-1524)"
```

---

## Task 8: Full CI pass + workspace verification

**Files:** none (verification only).

- [ ] **Step 1: Run workspace-targeted tracked verification**

```bash
pnpm run verify:workspace:tracked orchestrator
```
Expected: PASS.

(Per memory [3] in INT-1524, do **not** add `--` before the workspace name.)

- [ ] **Step 2: Run repo-wide ci:tracked**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int-1524.txt
```
Expected: all phases green.

- [ ] **Step 3: If anything fails, fix and re-run**

`rg "error|FAIL" -C3 /tmp/ci-output-int-1524.txt` — investigate and resolve
each failure before proceeding. Do not commit until ci:tracked passes
end-to-end (per CLAUDE.md "Commit Gate").

- [ ] **Step 4: Final commit and PR**

```bash
gh pr create --base development --title "[INT-1524] Harden code-worker against pnpm supply-chain attacks" \
  --body "$(cat <<'EOF'
## Summary
- Forces `ignore-scripts=true` for every pnpm install in the worker (bootstrap + LLM-initiated) via `.npmrc`, `/etc/npmrc`, and container env vars.
- Adds `LockfileGuard` to detect `pnpm-lock.yaml` tampering during an attempt and emits a `lockfile-drift` log + forensics artifact.
- Adds regression-guard tests so a future "fix" that strips `exec` from the `/repo/node_modules` tmpfs (which would break pnpm `.bin/` shims) is caught.

Fixes INT-1524.

## Test plan
- [ ] `pnpm run verify:workspace:tracked orchestrator` green
- [ ] `pnpm run ci:tracked` green
- [ ] Manual: build code-worker image, dispatch no-op task, confirm `[entrypoint] Lockfile sha256:` line + `--ignore-scripts` on bootstrap install in container logs

EOF
)"
```

---

## Out of Scope (deferred, not blocking this plan)

- Removing `exec` from `/repo/node_modules`. Would require migrating away from
  pnpm `.bin/` shims (e.g., always invoking `node ./node_modules/<pkg>/bin/...`),
  which is impractical given 248 pnpm uses across CI. Tracked as a follow-up
  spike if a future audit finding requires deeper isolation.
- Egress firewall on the worker docker network. Tracked separately under the
  INT-1472 audit.
- Verifying every package in the lockfile against a public-key-pinned registry.
  pnpm's built-in `integrity:` (subresource integrity) already covers this for
  `registry.npmjs.org`; full pinning is a separate hardening effort.

---

## Self-Review Checklist (executed by author)

- [x] Spec coverage: all three fix-direction items (`ignore-scripts=true`,
      lockfile invariants, package pinning) are mapped to tasks
      (1-3 → ignore-scripts; 5 → invariants; 5 → registry-only resolutions).
- [x] No `TBD`/`TODO`/`implement later` placeholders.
- [x] Type names consistent: `LockfileIntegrityError`, `snapshotLockfile`,
      `assertLockfileIntegrity`, `computeLockfileSha256`, `lockfileSha256` all
      match across tasks 5-7.
- [x] Endpoint Changes section present (none — internal change only).
- [x] Each task ends with a commit; no task asks for >5-min steps.
