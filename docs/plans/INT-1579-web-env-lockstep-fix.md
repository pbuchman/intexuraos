# INT-1579 — Fix CI failure on `development → main` (web env-lockstep regex stale)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore green CI on PR [#1894](https://github.com/pbuchman/intexuraos/pull/1894) (development → main) by teaching the web env-var lockstep checker to read services from the new `apps/web/service-manifest.json` source-of-truth instead of from the now-removed `CLOUD_RUN_SERVICES=(...)` bash array in `apps/web/cloudbuild.yaml`.

**Architecture:** A prior refactor (plan `2026-04-24-int-1534-web-frontend-refactor`) replaced the inline `CLOUD_RUN_SERVICES=(...)` array in `apps/web/cloudbuild.yaml` with `mapfile -t CLOUD_RUN_SERVICES < <(jq -r '.services[] | "\(.name):\(.envSuffix)"' apps/web/service-manifest.json)`. The drift checker `scripts/ci/check-web-env-lockstep.cjs` still extracts from cloudbuild via `/CLOUD_RUN_SERVICES=\(([\s\S]*?)\)/` and now throws `Error: CLOUD_RUN_SERVICES array not found in cloudbuild.yaml`. The fix swaps the cloudbuild extractor for a manifest reader; `.github/workflows/deploy.yml` continues to carry inline arrays (the verifier `scripts/verify-web-service-manifest.mjs` documents the workflow-permission constraint as a separate follow-up) and the lockstep diff between cloudbuild-derived set and the two `deploy.yml` arrays remains the same.

**Tech Stack:** Node.js (CommonJS), Vitest, GitHub Actions, JSON manifest, bash.

---

## Endpoint Changes
- **Modified:** none.
- **Created:** none.
- **Removed:** none.
- **Unchanged:** all HTTP routes.

This is a CI-only fix; no application endpoints are touched.

## Evidence

- Failing job: `Tests (3/3)` of workflow `CI` on PR [#1894](https://github.com/pbuchman/intexuraos/pull/1894), run [25009096691](https://github.com/pbuchman/intexuraos/actions/runs/25009096691/job/73239826221).
- Failure excerpt (from the captured log):
  ```
  /home/runner/work/intexuraos/intexuraos/scripts/ci/check-web-env-lockstep.cjs:19
    if (!m) throw new Error('CLOUD_RUN_SERVICES array not found in cloudbuild.yaml');
            ^
  Error: CLOUD_RUN_SERVICES array not found in cloudbuild.yaml
      at extractFromCloudbuild (.../check-web-env-lockstep.cjs:19:17)
      at main (.../check-web-env-lockstep.cjs:48:22)
  ```
- The script is invoked by Vitest test `scripts/ci/__tests__/check-web-env-lockstep.test.ts` ("passes against the real repo files (regression guard)") which lives in shard 3/3 — that is why only `Tests (3/3)` reports failure while `Tests (1/3)` and `Tests (2/3)` succeed.
- Companion verifier `scripts/verify-web-service-manifest.mjs` already enforces that `apps/web/cloudbuild.yaml` MUST NOT contain `CLOUD_RUN_SERVICES=(`. So the lockstep regex can never match cloudbuild.yaml again — the contract has changed.

## Source of truth (post-fix)

| Source                           | Role                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/service-manifest.json` | Single source of truth for the `(name, envSuffix)` list.                                                                                                                                         |
| `apps/web/cloudbuild.yaml`       | Reads the list via `jq` (Cloud Build runtime).                                                                                                                                                   |
| `apps/web/src/config.ts`         | Consumes the `INTEXURAOS_<SUFFIX>_URL` env vars at runtime.                                                                                                                                      |
| `.github/workflows/deploy.yml`   | Two inline `CLOUD_RUN_SERVICES=(...)` arrays remain (workflow-permission limitation noted in `verify-web-service-manifest.mjs`); they are kept lock-stepped against the manifest by the checker. |

The lockstep checker must compare:
- set derived from `service-manifest.json` (← was: cloudbuild.yaml regex)
- set derived from `apps/web/src/config.ts`
- both sets derived from each `CLOUD_RUN_SERVICES=(...)` block in `.github/workflows/deploy.yml`

These four sets must be set-equal.

---

## Task 1: Add manifest fixture support to the lockstep test (red)

**Files:**
- Modify: `scripts/ci/__tests__/check-web-env-lockstep.test.ts`

The current test exercises a `WEB_ENV_LOCKSTEP_CLOUDBUILD` override that points the script at a fixture cloudbuild.yaml with an inline array. After the fix the script will read from a manifest, so we add a `WEB_ENV_LOCKSTEP_MANIFEST` override and a `MANIFEST_FIXTURE` JSON fixture, then convert the existing scenarios to use it. The "regression guard" test that runs against the real repo files stays unchanged — it is the test that is currently failing in CI.

- [ ] **Step 1: Replace the cloudbuild fixture with a manifest fixture and rewrite scenarios**

Open `scripts/ci/__tests__/check-web-env-lockstep.test.ts` and replace its full contents with:

```ts
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../check-web-env-lockstep.cjs');

const MANIFEST_FIXTURE = JSON.stringify({
  services: [
    { name: 'user-service', envSuffix: 'USER_SERVICE' },
    { name: 'image-service', envSuffix: 'IMAGE_SERVICE' },
  ],
});

const CONFIG_FIXTURE = `
import type { AppConfig } from '@/types';
function getServiceUrl(envVar: string, apiPath: string): string { return apiPath; }
export function getConfig(): AppConfig {
  return {
    authServiceUrl: getServiceUrl('INTEXURAOS_USER_SERVICE_URL', '/api/user'),
    imageServiceUrl: getServiceUrl('INTEXURAOS_IMAGE_SERVICE_URL', '/api/images'),
  } as AppConfig;
}
`;

const DEPLOY_FIXTURE = `
jobs:
  monolith:
    steps:
      - run: |
          CLOUD_RUN_SERVICES=(
            "user-service:USER_SERVICE"
            "image-service:IMAGE_SERVICE"
          )
  individual:
    steps:
      - run: |
          CLOUD_RUN_SERVICES=(
            "user-service:USER_SERVICE"
            "image-service:IMAGE_SERVICE"
          )
`;

describe('check-web-env-lockstep', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lockstep-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(env: Record<string, string>) {
    return spawnSync('node', [SCRIPT], {
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });
  }

  function writeFixture(name: string, body: string) {
    const p = path.join(dir, name);
    writeFileSync(p, body);
    return p;
  }

  test('passes when manifest, config, and both deploy.yml arrays agree', () => {
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', MANIFEST_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', DEPLOY_FIXTURE),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/lockstep OK/);
  });

  test('fails when deploy.yml array is missing an entry that manifest has', () => {
    const driftedDeploy = DEPLOY_FIXTURE.replaceAll('"image-service:IMAGE_SERVICE"\n', '');
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', MANIFEST_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', driftedDeploy),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/deploy\.yml\[0\] is missing INTEXURAOS_IMAGE_SERVICE_URL/);
    expect(r.stderr).toMatch(/deploy\.yml\[1\] is missing INTEXURAOS_IMAGE_SERVICE_URL/);
  });

  test('fails when only one of the two deploy.yml arrays drifts', () => {
    const partialDrift = DEPLOY_FIXTURE.replace(
      /individual:[\s\S]*$/,
      `individual:
    steps:
      - run: |
          CLOUD_RUN_SERVICES=(
            "user-service:USER_SERVICE"
          )
`
    );
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', MANIFEST_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', CONFIG_FIXTURE),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', partialDrift),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/deploy\.yml\[1\] is missing INTEXURAOS_IMAGE_SERVICE_URL/);
    expect(r.stderr).not.toMatch(/deploy\.yml\[0\] is missing/);
  });

  test('fails when config.ts consumes an env var that the manifest does not list', () => {
    const driftedConfig = CONFIG_FIXTURE.replace(
      "} as AppConfig;",
      "    extraUrl: getServiceUrl('INTEXURAOS_NOPE_SERVICE_URL', '/api/nope'),\n  } as AppConfig;"
    );
    const r = run({
      WEB_ENV_LOCKSTEP_MANIFEST: writeFixture('service-manifest.json', MANIFEST_FIXTURE),
      WEB_ENV_LOCKSTEP_CONFIG: writeFixture('config.ts', driftedConfig),
      WEB_ENV_LOCKSTEP_DEPLOY_YML: writeFixture('deploy.yml', DEPLOY_FIXTURE),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /config\.ts consumes INTEXURAOS_NOPE_SERVICE_URL but cloudbuild does not fetch it/
    );
  });

  test('passes against the real repo files (regression guard)', () => {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(out).toMatch(/lockstep OK/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails the way we expect**

Run: `pnpm --filter root run vitest run scripts/ci/__tests__/check-web-env-lockstep.test.ts` (or from repo root: `pnpm vitest run scripts/ci/__tests__/check-web-env-lockstep.test.ts`).

Expected: 4 of 5 tests FAIL because the script still reads from `WEB_ENV_LOCKSTEP_CLOUDBUILD`. The "regression guard" test also FAILS with the same `Error: CLOUD_RUN_SERVICES array not found in cloudbuild.yaml` we see in CI today. Capture the failure output before moving on.

---

## Task 2: Switch `check-web-env-lockstep.cjs` from cloudbuild regex to manifest reader (green)

**Files:**
- Modify: `scripts/ci/check-web-env-lockstep.cjs`

We replace `extractFromCloudbuild` with `extractFromManifest`, change the env override name, and update both the call site in `main()` and the public `module.exports`. The diff messages keep the legacy `cloudbuild fetches ...` / `cloudbuild does not fetch ...` wording so existing test/grep patterns still match (the diff is already worded in terms of "what gets baked into the prod bundle", not in terms of which file holds the list).

- [ ] **Step 1: Rewrite the script**

Replace the full contents of `scripts/ci/check-web-env-lockstep.cjs` with:

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const MANIFEST =
  process.env.WEB_ENV_LOCKSTEP_MANIFEST ??
  path.join(REPO_ROOT, 'apps/web/service-manifest.json');
const CONFIG_TS =
  process.env.WEB_ENV_LOCKSTEP_CONFIG ?? path.join(REPO_ROOT, 'apps/web/src/config.ts');
const DEPLOY_YML =
  process.env.WEB_ENV_LOCKSTEP_DEPLOY_YML ?? path.join(REPO_ROOT, '.github/workflows/deploy.yml');

function extractCloudRunSuffixes(arrayBody) {
  return [...arrayBody.matchAll(/"[^"]+:([A-Z0-9_]+)"/g)].map((x) => x[1]);
}

// Source of truth for the web bundle's Cloud Run URLs is
// apps/web/service-manifest.json. apps/web/cloudbuild.yaml reads it at build
// time via `jq`, so it cannot be regex'd here. Re-deriving from the manifest
// keeps "what cloudbuild fetches" and "what we lockstep against" in sync.
function extractFromManifest(src) {
  let parsed;
  try {
    parsed = JSON.parse(src);
  } catch (err) {
    throw new Error(`service-manifest.json is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.services)) {
    throw new Error('service-manifest.json must have a "services" array');
  }
  return new Set(parsed.services.map((s) => `INTEXURAOS_${s.envSuffix}_URL`));
}

function extractFromConfig(src) {
  const m = [...src.matchAll(/getServiceUrl\('([A-Z0-9_]+)'/g)];
  return new Set(m.map((x) => x[1]));
}

// deploy.yml carries TWO independent CLOUD_RUN_SERVICES arrays (monolith-deploy
// and per-service web-deploy). Both must agree with the manifest or the
// workflow you happen to take in prod will silently bake the wrong env. The
// migration of these two arrays to read from the manifest is tracked as a
// follow-up — it requires the GitHub `workflows` permission scope (see the
// note in scripts/verify-web-service-manifest.mjs).
function extractFromDeployYml(src) {
  const matches = [...src.matchAll(/CLOUD_RUN_SERVICES=\(([\s\S]*?)\)/g)];
  if (matches.length === 0) throw new Error('CLOUD_RUN_SERVICES array not found in deploy.yml');
  return matches.map(
    (m) => new Set(extractCloudRunSuffixes(m[1]).map((s) => `INTEXURAOS_${s}_URL`))
  );
}

function diff(label, expected, actual) {
  const errors = [];
  for (const name of expected) if (!actual.has(name)) errors.push(`${label} is missing ${name}`);
  for (const name of actual) if (!expected.has(name)) errors.push(`${label} has extra ${name}`);
  return errors;
}

function main() {
  const cloudbuild = extractFromManifest(fs.readFileSync(MANIFEST, 'utf-8'));
  const config = extractFromConfig(fs.readFileSync(CONFIG_TS, 'utf-8'));
  const deployArrays = extractFromDeployYml(fs.readFileSync(DEPLOY_YML, 'utf-8'));

  const errors = [];
  for (const name of cloudbuild)
    if (!config.has(name))
      errors.push(`cloudbuild fetches ${name} but config.ts does not consume it`);
  for (const name of config)
    if (!cloudbuild.has(name))
      errors.push(`config.ts consumes ${name} but cloudbuild does not fetch it`);

  deployArrays.forEach((arr, i) => {
    errors.push(...diff(`deploy.yml[${i}]`, cloudbuild, arr));
  });

  if (errors.length > 0) {
    console.error('Web env-var drift detected:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('Web env-var lockstep OK');
}

if (require.main === module) main();

module.exports = { extractFromManifest, extractFromConfig, extractFromDeployYml };
```

Notes on the diff:
- `CLOUDBUILD` constant + `WEB_ENV_LOCKSTEP_CLOUDBUILD` env override → renamed to `MANIFEST` + `WEB_ENV_LOCKSTEP_MANIFEST`.
- `extractFromCloudbuild` → `extractFromManifest`; reads `apps/web/service-manifest.json`, parses JSON, returns the same `INTEXURAOS_<envSuffix>_URL` set the prior regex used to produce.
- `module.exports` updated accordingly.
- `extractFromDeployYml` is unchanged. The variable name `cloudbuild` inside `main()` is kept (it semantically still represents "what cloudbuild bakes into the bundle"), so error strings continue to read `cloudbuild fetches ...` / `cloudbuild does not fetch ...` exactly as before.

- [ ] **Step 2: Run the targeted test and confirm it now passes**

Run: `pnpm vitest run scripts/ci/__tests__/check-web-env-lockstep.test.ts`

Expected: all 5 tests PASS, including the "regression guard" against the real repo files. Output ends with `Tests  5 passed`.

- [ ] **Step 3: Run the standalone script against the real repo (sanity)**

Run: `node scripts/ci/check-web-env-lockstep.cjs`

Expected stdout: `Web env-var lockstep OK` and exit code 0.

- [ ] **Step 4: Drift sanity check (manual, revert immediately)**

Temporarily delete one entry from `apps/web/service-manifest.json` (e.g. the `web-agent` line). Run: `node scripts/ci/check-web-env-lockstep.cjs`

Expected: exit code 1; stderr contains `config.ts consumes INTEXURAOS_WEB_AGENT_URL but cloudbuild does not fetch it` and two `deploy.yml[i] has extra INTEXURAOS_WEB_AGENT_URL` lines. Restore the file (`git checkout -- apps/web/service-manifest.json`).

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/check-web-env-lockstep.cjs scripts/ci/__tests__/check-web-env-lockstep.test.ts
git commit -m "[INT-1579] fix(ci): read web env-lockstep from service-manifest.json

apps/web/cloudbuild.yaml no longer carries an inline CLOUD_RUN_SERVICES=(
array (it reads from apps/web/service-manifest.json via jq), so the regex
in scripts/ci/check-web-env-lockstep.cjs threw 'CLOUD_RUN_SERVICES array
not found in cloudbuild.yaml' and broke Tests (3/3) on the development->main
PR. Read from the manifest instead — the new source of truth — and update
the test fixture/env override to match."
```

---

## Task 3: Run full CI and open the fix PR

**Files:** none changed; this is the integration check.

- [ ] **Step 1: Run the project CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked-INT-1579.txt`

Expected: full pipeline passes. The previously-failing Static Validation entry `web-env-lockstep` (line 69 of `scripts/ci.mjs`) and the Vitest test `scripts/ci/__tests__/check-web-env-lockstep.test.ts` both report green.

- [ ] **Step 2: Push the branch and open the PR**

The fix branch is whatever the executor used (e.g. `fix/int-1579-web-env-lockstep`). Open a PR against `development`:

```bash
gh pr create \
  --base development \
  --title "[INT-1579] fix(ci): web env-lockstep reads service-manifest.json" \
  --body "$(cat <<'EOF'
## Summary
- Restores green CI on PR #1894 (development → main): the `Tests (3/3)` shard was failing because `scripts/ci/check-web-env-lockstep.cjs` still tried to regex `CLOUD_RUN_SERVICES=(` out of `apps/web/cloudbuild.yaml`, which has been migrated to read from `apps/web/service-manifest.json` via `jq`.
- The script and its Vitest fixture now derive the canonical service set from `apps/web/service-manifest.json` directly. The diff against `apps/web/src/config.ts` and the two `CLOUD_RUN_SERVICES=(...)` arrays in `.github/workflows/deploy.yml` is unchanged.
- `deploy.yml` keeps its inline arrays for now (workflow-permission constraint already documented in `scripts/verify-web-service-manifest.mjs`); the lockstep checker still asserts they match the manifest.

## Test plan
- [ ] `pnpm vitest run scripts/ci/__tests__/check-web-env-lockstep.test.ts` — 5/5 green.
- [ ] `node scripts/ci/check-web-env-lockstep.cjs` — exits 0, prints `Web env-var lockstep OK`.
- [ ] `pnpm run ci:tracked` — green end-to-end.
- [ ] Manual drift check: remove one entry from `apps/web/service-manifest.json`, rerun the script, expect exit 1 with both `config.ts consumes ...` and `deploy.yml[i] has extra ...` errors. Revert.

Fixes INT-1579.
EOF
)"
```

- [ ] **Step 3: Verify CI on the new PR**

Run: `gh pr checks $(gh pr view --json number -q .number)`

Expected: `Tests (3/3)` and every other required check pass.

---

## Self-Review

**Spec coverage:** The Linear issue asks to investigate why GH Actions failed on `development → main` and prepare a fix PR. Tasks 1–3 cover diagnosis (already done in the Evidence section), the failing-test-first change, the implementation, the drift sanity check, and the PR. ✓

**Placeholder scan:** No "TBD", "implement later", or unspecified validation. Every step has the exact code or command. ✓

**Type consistency:** The script exports `extractFromManifest` (renamed from `extractFromCloudbuild`); both Task 1 (test rewrite) and Task 2 (script rewrite) use the same name and the same env override `WEB_ENV_LOCKSTEP_MANIFEST`. The fixture variable in tests is `MANIFEST_FIXTURE` consistently. The error messages emitted by the script (`cloudbuild fetches ...`, `cloudbuild does not fetch ...`, `deploy.yml[i] is missing ...`, `deploy.yml[i] has extra ...`) match the regexes asserted in the tests. ✓

## Out of scope (follow-ups, NOT part of this fix)

- Migrating the two `CLOUD_RUN_SERVICES=(...)` arrays in `.github/workflows/deploy.yml` to read from `apps/web/service-manifest.json` via `jq`. This requires the `workflows` permission scope and is already documented as a follow-up in `scripts/verify-web-service-manifest.mjs`. Doing it here would expand the blast radius of an urgent CI-unblock fix.
- Deleting the legacy regex helper `extractCloudRunSuffixes` once `deploy.yml` is also migrated. Keep it for now — it is the only consumer-side parser for the workflow file.
