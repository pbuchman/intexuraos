# Hetzner Runtime Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent production deployment from accepting an unhealthy PM2 service and bound local PM2 log growth without disrupting Grafana Alloy.

**Architecture:** The PM2 reload script discovers health URLs from the rendered ecosystem config and requires consecutive all-green checks. A separate root-run installer owns an idempotent `/etc/logrotate.d` policy; provisioning and every production deployment invoke it before runtime readiness is declared.

**Tech Stack:** Bash, embedded Node.js JSON parsing, PM2, curl, logrotate, Vitest runtime contract tests.

## Global Constraints

- Discover every rendered PM2 app with a numeric `PORT`; the current production config contains 18 such apps.
- Retain an explicit `PM2_HEALTH_URLS` override for controlled tests.
- Require three consecutive healthy passes by default before `pm2 save`.
- Never print environment values or secrets in readiness failure output.
- Rotate each `/home/deploy/.pm2/logs/*.log` daily or at 100 MB, retain 14 rotations, compress with delay, and reopen PM2 logs after rotation.
- The logrotate installer must require `INTEXURAOS_ENVIRONMENT=prod`, root for installation, and successful policy validation.
- Run `pnpm run ci:tracked` before every commit.

---

### Task 1: Discover and Stabilize All PM2 Health Checks

**Files:**
- Modify: `scripts/__tests__/hetzner-runtime.test.ts`
- Modify: `scripts/hetzner/reload-pm2.sh`
- Modify: `docs/operations/hetzner-prod-runbook.md`

**Interfaces:**
- Consumes: rendered JSON path `RENDERED_CONFIG` and optional space-delimited `PM2_HEALTH_URLS`.
- Produces: derived `http://127.0.0.1:<PORT>/health` list and a readiness result after `PM2_HEALTH_CONSECUTIVE_SUCCESSES` all-green passes.

- [ ] **Step 1: Write failing runtime contract assertions**

Replace the two hard-coded URL assertions with:

```ts
expect(script).toContain('PM2_HEALTH_URLS="${PM2_HEALTH_URLS:-}"');
expect(script).toContain('PM2_HEALTH_CONSECUTIVE_SUCCESSES="${PM2_HEALTH_CONSECUTIVE_SUCCESSES:-3}"');
expect(script).toContain('derive_health_urls()');
expect(script).toContain('config.apps');
expect(script).toContain('app.env?.PORT');
expect(script).toContain('http://127.0.0.1:${port}/health');
expect(script).toContain('healthy_passes=$((healthy_passes + 1))');
expect(script).toContain('healthy_passes=0');
expect(script).toContain('PM2 health checks did not remain ready');
expect(script).toMatch(/wait_for_http_health[\s\S]*pm2 save/);
```

Also parse `ecosystem.config.prod.cjs` in the test and assert all apps have unique numeric ports and the expected count is 18.

- [ ] **Step 2: Run the runtime test and verify RED**

Run: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts`

Expected: FAIL because only two fixed URLs are configured and one successful pass returns immediately.

- [ ] **Step 3: Derive URLs from rendered config**

Set the defaults:

```bash
PM2_HEALTH_URLS="${PM2_HEALTH_URLS:-}"
PM2_HEALTH_CONSECUTIVE_SUCCESSES="${PM2_HEALTH_CONSECUTIVE_SUCCESSES:-3}"
```

Add `derive_health_urls()` using embedded Node.js:

```bash
derive_health_urls() {
  node - "${RENDERED_CONFIG}" <<'NODE'
const { readFileSync } = require('node:fs');
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!config || !Array.isArray(config.apps)) {
  throw new Error('Rendered PM2 config must contain apps');
}
const urls = config.apps.map((app) => {
  const port = Number(app.env?.PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PM2 app ${app.name ?? 'unknown'} has invalid PORT`);
  }
  return `http://127.0.0.1:${port}/health`;
});
if (new Set(urls).size !== urls.length) {
  throw new Error('Rendered PM2 config contains duplicate health ports');
}
process.stdout.write(urls.join(' '));
NODE
}
```

After installing `RENDERED_CONFIG`, populate `PM2_HEALTH_URLS` from this function only when the override is empty.

- [ ] **Step 4: Require consecutive healthy passes**

Validate `PM2_HEALTH_CONSECUTIVE_SUCCESSES` as a positive integer. In `wait_for_http_health`, initialize `healthy_passes=0`; increment it only when no URL failed, return only at the configured count, and reset it to zero after any failed URL. On timeout print the last failed URLs and `pm2 status`, without printing config or environment content.

- [ ] **Step 5: Verify the runtime contract**

Run:

```bash
bash -n scripts/hetzner/reload-pm2.sh
PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts
```

Expected: PASS.

### Task 2: Idempotent PM2 Log Rotation

**Files:**
- Create: `scripts/hetzner/install-pm2-logrotate.sh`
- Modify: `scripts/hetzner/provision.sh`
- Modify: `scripts/hetzner/github-actions-deploy.sh`
- Modify: `scripts/__tests__/hetzner-runtime.test.ts`
- Modify: `docs/operations/hetzner-prod-runbook.md`

**Interfaces:**
- Consumes: `DEPLOY_USER`, `PM2_HOME`, `PM2_BIN`, and optional `LOGROTATE_CONFIG_PATH`.
- Produces: validated root-owned logrotate policy and PM2 descriptor reopen through `runuser`.

- [ ] **Step 1: Add failing installer and integration tests**

Add `spawnSync` to the child-process import and declare `installPm2LogrotatePath`. Assert a non-prod invocation fails:

```ts
const nonProd = spawnSync('bash', [installPm2LogrotatePath, '--render'], {
  encoding: 'utf8',
  env: Object.assign({}, process.env, {
    INTEXURAOS_ENVIRONMENT: 'dev',
    PM2_BIN: '/usr/bin/pm2',
  }),
});
expect(nonProd.status).not.toBe(0);
expect(nonProd.stderr).toContain('INTEXURAOS_ENVIRONMENT must be prod');
```

Render the policy without installing it:

```ts
const rendered = execFileSync('bash', [installPm2LogrotatePath, '--render'], {
  encoding: 'utf8',
  env: Object.assign({}, process.env, {
    INTEXURAOS_ENVIRONMENT: 'prod',
    PM2_BIN: '/usr/bin/pm2',
  }),
});
for (const directive of [
  '/home/deploy/.pm2/logs/*.log', 'daily', 'maxsize 100M', 'rotate 14',
  'compress', 'delaycompress', 'missingok', 'notifempty', 'su deploy deploy',
  'create 0640 deploy deploy', 'sharedscripts', 'reloadLogs',
]) {
  expect(rendered).toContain(directive);
}
```

Assert the installer source contains `logrotate --debug`, `install -o root -g root -m 0644`, and cleanup traps. Assert both `provision.sh` and `github-actions-deploy.sh` invoke it with prod and root privileges.

- [ ] **Step 2: Run the runtime test and verify RED**

Run: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts`

Expected: FAIL because the installer and integrations do not exist.

- [ ] **Step 3: Implement the installer**

Create a Bash script with `set -euo pipefail`, `--render` and install modes, prod guard, root guard for install mode, temporary-file cleanup, command checks, and this generated policy:

```text
/home/deploy/.pm2/logs/*.log {
  daily
  maxsize 100M
  rotate 14
  compress
  delaycompress
  missingok
  notifempty
  su deploy deploy
  create 0640 deploy deploy
  sharedscripts
  postrotate
    /usr/sbin/runuser -u deploy -- env PM2_HOME=/home/deploy/.pm2 /usr/bin/pm2 reloadLogs >/dev/null 2>&1 || true
  endscript
}
```

Substitute configured values while rendering. In install mode validate the temporary policy with `logrotate --debug`, then atomically install it to `/etc/logrotate.d/intexuraos-pm2` as `root:root` mode `0644`. Re-running the installer must replace the same file with identical content.

- [ ] **Step 4: Integrate provisioning and deployment**

Add `logrotate` to base packages. Add `install_pm2_logrotate()` to provisioning and call it after the deploy user and PM2 exist. In `deploy_runtime`, call:

```bash
run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/install-pm2-logrotate.sh'
```

Place it after Grafana Alloy installation and before dependency installation so a rotation-policy failure stops deployment early.

- [ ] **Step 5: Document runtime operations**

In `docs/operations/hetzner-prod-runbook.md`, document all-service readiness, the three-pass stability window, override use for controlled diagnostics, logrotate policy location, dry-run validation, forced-rotation verification, `pm2 reloadLogs`, Alloy-active verification, and rollback that preserves rotated logs.

- [ ] **Step 6: Verify scripts and commit**

Run:

```bash
bash -n scripts/hetzner/reload-pm2.sh
bash -n scripts/hetzner/install-pm2-logrotate.sh
bash -n scripts/hetzner/provision.sh
bash -n scripts/hetzner/github-actions-deploy.sh
PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run scripts/__tests__/hetzner-runtime.test.ts
PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm run ci:tracked
git add scripts/hetzner/reload-pm2.sh scripts/hetzner/install-pm2-logrotate.sh scripts/hetzner/provision.sh scripts/hetzner/github-actions-deploy.sh scripts/__tests__/hetzner-runtime.test.ts docs/operations/hetzner-prod-runbook.md
git commit -m "fix: harden Hetzner runtime readiness"
```

Expected: syntax checks, tests, and full CI pass; the commit contains only runtime safety changes.

### Task 3: Post-Merge Runtime Verification

**Files:**
- Verify: merged `development` deployment on home-dev and Hetzner production.

**Interfaces:**
- Consumes: merged commit and existing deployment workflows.
- Produces: evidence that every service remains healthy, log rotation is installed, and Alloy continues collecting active logs.

- [ ] **Step 1: Verify dev deployment**

Confirm the home-dev checkout reaches the merged commit, all expected PM2 processes are online, and every dev health endpoint returns success.

- [ ] **Step 2: Monitor production workflow**

Wait for the GitHub Hetzner deployment triggered by the merge. Expected: installer validation succeeds, all 18 local health endpoints pass three consecutive checks, `pm2 save` occurs afterward, and public smoke checks pass.

- [ ] **Step 3: Verify production host state**

Confirm all 18 PM2 services are online with no deployment-time restart loop, `/etc/logrotate.d/intexuraos-pm2` matches the documented policy, `logrotate --debug` accepts it, Grafana Alloy is active, and PM2 active log files are open after a controlled rotation check.

- [ ] **Step 4: Observe steady state**

Review PM2, nginx, and Alloy logs after deployment. Expected: no new production 5xx, no all-service readiness failures, no logrotate errors, and local PM2 log growth is bounded by the 100 MB per-file threshold.
