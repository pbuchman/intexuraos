# Code Task Callback Environment Independence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure code tasks created by either dev or prod can run on any orchestrator machine while all logs, lifecycle events, status updates, and completion callbacks return to the owning code-agent environment.

**Architecture:** Code-agent owns environment selection by embedding a routable callback URL in every task submission. Orchestrator is deployment-independent: it must never infer dev/prod from `workerLocation`, host machine, or its fallback `INTEXURAOS_CODE_AGENT_URL` when a task provides `webhookUrl`. Public dev/prod callback URLs use `/api/code/internal/...`; localhost and test URLs may continue using direct `/internal/...` paths.

**Tech Stack:** TypeScript, Fastify, Vitest, PM2/nginx public routing, Terraform, Bash runtime secret rendering.

---

## Context

Incident task: `task_e6e339fa-e99a-4da8-9155-fb05c9a46cc8` for INT-1656 / PR #2121.

Observed evidence:

- Firestore task stayed `status=dispatched`, `callbackReceived=false`, and had zero `log_lines`.
- Orchestrator state showed the task was running on `home-dev`, but with `webhookUrl: https://intexuraos.cloud/internal/webhooks/task-complete`.
- Orchestrator posted logs and lifecycle callbacks to `https://intexuraos.cloud/internal/...` and received HTTP 401.
- The worker still completed the PR review and posted GitHub review `PRR_kwDOQrH2zs8AAAABCa8asQ` at `2026-06-09T09:50:59Z`.

Root cause:

- Runtime config and tests encode the stale assumption that prod callbacks should use bare-root internal paths:
  - `terraform/environments/dev/main.tf` sets `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL = local.public_origin`.
  - `scripts/hetzner/load-secrets.sh` writes `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL="${PUBLIC_ORIGIN}"`.
  - `apps/code-agent/src/domain/services/codeTaskCallbackUrls.ts` rejects prod `/api/code/internal/...` callback URLs.
  - `workers/orchestrator/src/services/callback-url.ts` rewrites prod `/api/code/internal/...` back to root `/internal/...`.
- That only works when the caller is colocated with a route that accepts root internal paths. It fails for environment-independent orchestrators running on another machine.

## Endpoint Changes

Modified:

- Existing internal callback URLs generated for public dev/prod domains change from `https://<domain>/internal/...` to `https://<domain>/api/code/internal/...`.

Created:

- None.

Removed:

- None.

Unchanged:

- `POST /internal/logs`
- `POST /internal/turn-metrics`
- `POST /internal/webhooks/task-event`
- `POST /internal/webhooks/task-complete`
- `PATCH /internal/code-tasks/:id/status`

These Fastify route handlers stay unchanged. Only the externally routable URLs used to reach them through public nginx routing change.

## File Structure

- `apps/code-agent/src/domain/services/codeTaskCallbackUrls.ts`
  - Owns callback URL construction for task submissions.
  - Must canonicalize public `intexuraos.cloud` and `dev.intexuraos.cloud` bases to `/api/code`.

- `apps/code-agent/src/__tests__/domain/services/codeTaskCallbackUrls.test.ts`
  - Unit tests for public-domain callback URL construction and localhost preservation.

- `apps/code-agent/src/__tests__/routes/internalDispatchMetadata.test.ts`
  - Tests task dispatch metadata emitted for continuation/adoption paths.

- `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`
  - Tests queued task dispatch payloads.

- `apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts`
  - Tests retry dispatch payloads.

- `workers/orchestrator/src/services/callback-url.ts`
  - Owns orchestrator-side derivation of log/status/metrics callback URLs from `task.webhookUrl`.
  - Must preserve task-provided environment and normalize legacy public root-internal URLs to `/api/code/internal/...`.

- `workers/orchestrator/src/services/webhook-client.ts`
  - Owns lifecycle/completion webhook delivery and pending webhook retry.
  - Must normalize URLs on first delivery and retry delivery.

- `workers/orchestrator/src/services/__tests__/callback-url.test.ts`
  - Unit tests for environment-independent callback derivation.

- `workers/orchestrator/src/__tests__/webhook-client.test.ts`
  - Pending webhook retry behavior tests.

- `workers/orchestrator/src/__tests__/log-forwarder.test.ts`
  - Log upload URL tests.

- `workers/orchestrator/src/services/__tests__/status-update-client.test.ts`
  - Terminal status URL tests.

- `workers/orchestrator/src/__tests__/turn-metrics-collector.test.ts`
  - Turn metrics callback URL tests.

- `terraform/environments/dev/main.tf`
  - Hetzner runtime config source for `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL`.

- `scripts/hetzner/load-secrets.sh`
  - Prod runtime `.env` renderer for `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL`.

- `ecosystem.config.prod.cjs`
  - Prod PM2 fallback runtime config when `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL` is not supplied in the environment.

- `scripts/__tests__/ecosystem.prod.config.test.ts`
  - Prod PM2 config assertion.

- `scripts/__tests__/hetzner-runtime.test.ts`
  - Runtime script/Terraform assertion.

- `.claude/CLAUDE.md`
  - Short, bold rule routing people to the detailed reference.

- `.claude/reference/environments.md`
  - Detailed environment/orchestrator independence rules.

- `.claude/reference/architecture.md`
  - Callback ownership architecture rule.

## Commit Gate Note

Project rules override the generic writing-plans preference for frequent commits. Do not create per-chunk commits unless `pnpm run ci:tracked` has passed immediately before that commit. This plan stages chunk-sized changes for review, then creates one final commit after Chunk 4 full CI passes.

## Chunk 1: Code-Agent Generates Routable Callback URLs

### Task 1: Reverse the code-agent callback URL invariant

**Files:**
- Modify: `apps/code-agent/src/domain/services/codeTaskCallbackUrls.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/codeTaskCallbackUrls.test.ts`

- [ ] **Step 1: Write failing unit tests**

Replace the stale prod-root expectations with public API prefix expectations:

```typescript
it('builds routable prod callback URLs through the public code-agent API prefix', () => {
  expect(buildTaskCompleteWebhookUrl('https://intexuraos.cloud/')).toBe(
    'https://intexuraos.cloud/api/code/internal/webhooks/task-complete'
  );
  expect(buildTaskEventWebhookUrl('https://intexuraos.cloud')).toBe(
    'https://intexuraos.cloud/api/code/internal/webhooks/task-event'
  );
});

it('builds routable dev callback URLs through the public code-agent API prefix', () => {
  expect(buildTaskCompleteWebhookUrl('https://dev.intexuraos.cloud')).toBe(
    'https://dev.intexuraos.cloud/api/code/internal/webhooks/task-complete'
  );
});

it('preserves already-canonical public callback bases', () => {
  expect(
    buildInternalCallbackUrl('https://intexuraos.cloud/api/code/', '/internal/logs')
  ).toBe('https://intexuraos.cloud/api/code/internal/logs');
});

it('preserves localhost direct internal callback URLs', () => {
  expect(buildTaskCompleteWebhookUrl('http://localhost:8128')).toBe(
    'http://localhost:8128/internal/webhooks/task-complete'
  );
});
```

Delete the existing test named `rejects prod callback URLs that would target /api/code/internal`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/services/codeTaskCallbackUrls.test.ts
```

Expected: FAIL because prod currently builds `https://intexuraos.cloud/internal/...` and rejects `/api/code/internal`.

- [ ] **Step 3: Implement minimal callback base normalization**

In `apps/code-agent/src/domain/services/codeTaskCallbackUrls.ts`, replace the rejecting helper with public-domain normalization:

```typescript
const TASK_COMPLETE_PATH = '/internal/webhooks/task-complete';
const TASK_EVENT_PATH = '/internal/webhooks/task-event';
const PUBLIC_CODE_AGENT_PATH = '/api/code';
const PUBLIC_CALLBACK_HOSTS = new Set(['intexuraos.cloud', 'dev.intexuraos.cloud']);

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizePublicCallbackBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const strippedPath = stripTrailingSlashes(parsed.pathname);

  if (!PUBLIC_CALLBACK_HOSTS.has(parsed.hostname)) {
    return stripTrailingSlashes(baseUrl);
  }

  if (strippedPath === '' || strippedPath === '/') {
    parsed.pathname = PUBLIC_CODE_AGENT_PATH;
    return stripTrailingSlashes(parsed.toString());
  }

  if (strippedPath === PUBLIC_CODE_AGENT_PATH) {
    parsed.pathname = PUBLIC_CODE_AGENT_PATH;
    return stripTrailingSlashes(parsed.toString());
  }

  return stripTrailingSlashes(baseUrl);
}

export function normalizeCallbackBaseUrl(baseUrl: string): string {
  return normalizePublicCallbackBaseUrl(stripTrailingSlashes(baseUrl));
}
```

Keep `buildInternalCallbackUrl`, `buildTaskCompleteWebhookUrl`, and `buildTaskEventWebhookUrl` as the public API used by queue/dispatch code.

- [ ] **Step 4: Run the focused test and confirm pass**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/services/codeTaskCallbackUrls.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update direct dispatch payload expectations**

Update tests that expect bare-root public callback URLs:

```bash
rg -n "https://intexuraos.cloud/internal/webhooks/task-complete|https://intexuraos.cloud/internal/logs" apps/code-agent/src/__tests__
```

Expected updates:

- `apps/code-agent/src/__tests__/routes/internalDispatchMetadata.test.ts`: configured public `codeTaskCallbackBaseUrl: 'https://intexuraos.cloud'` should now produce `https://intexuraos.cloud/api/code/internal/webhooks/task-complete`.
- Keep generic `https://callback.test/internal/...` expectations unchanged.
- Keep localhost expectations unchanged.

- [ ] **Step 6: Run relevant code-agent tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- \
  src/__tests__/domain/services/codeTaskCallbackUrls.test.ts \
  src/__tests__/routes/internalDispatchMetadata.test.ts \
  src/__tests__/domain/usecases/drainTaskQueue.test.ts \
  src/__tests__/domain/usecases/drainRetryQueue.test.ts
```

Expected: PASS.

- [ ] **Step 7: Stage chunk 1 changes without committing**

Stage these files so the integrator can inspect the chunk, but do not commit yet:

```bash
git add apps/code-agent/src/domain/services/codeTaskCallbackUrls.ts \
  apps/code-agent/src/__tests__/domain/services/codeTaskCallbackUrls.test.ts \
  apps/code-agent/src/__tests__/routes/internalDispatchMetadata.test.ts \
  apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts \
  apps/code-agent/src/__tests__/domain/usecases/drainRetryQueue.test.ts
```

Expected: files are staged or visible in `git diff --cached`; no commit is created before full `pnpm run ci:tracked` passes in Chunk 4.

## Chunk 2: Orchestrator Preserves Task Environment and Repairs Legacy Public URLs

### Task 2: Normalize public root-internal callback URLs forward to `/api/code/internal`

**Files:**
- Modify: `workers/orchestrator/src/services/callback-url.ts`
- Test: `workers/orchestrator/src/services/__tests__/callback-url.test.ts`

- [ ] **Step 1: Write failing orchestrator callback URL tests**

Replace stale reverse-normalization tests with forward-normalization tests:

```typescript
it('derives prod callback base from canonical public API callback URL', () => {
  expect(
    deriveCallbackBaseUrl(
      'https://intexuraos.cloud/api/code/internal/webhooks/task-complete',
      'http://localhost:8128'
    )
  ).toBe('https://intexuraos.cloud/api/code');
});

it('normalizes legacy prod root-internal callback URLs to public API callback URLs', () => {
  expect(
    normalizeInternalCallbackUrl('https://intexuraos.cloud/internal/webhooks/task-complete')
  ).toBe('https://intexuraos.cloud/api/code/internal/webhooks/task-complete');
});

it('normalizes legacy dev root-internal callback URLs to public API callback URLs', () => {
  expect(
    normalizeInternalCallbackUrl('https://dev.intexuraos.cloud/internal/logs')
  ).toBe('https://dev.intexuraos.cloud/api/code/internal/logs');
});

it('preserves canonical public API callback URLs', () => {
  expect(
    normalizeInternalCallbackUrl('https://intexuraos.cloud/api/code/internal/logs')
  ).toBe('https://intexuraos.cloud/api/code/internal/logs');
});

it('preserves localhost direct internal callback URLs', () => {
  expect(normalizeInternalCallbackUrl('http://localhost:8128/internal/logs')).toBe(
    'http://localhost:8128/internal/logs'
  );
});
```

Update `buildTaskCallbackUrl` expectations so a task webhook URL at `https://intexuraos.cloud/api/code/internal/webhooks/task-complete` produces `https://intexuraos.cloud/api/code/internal/logs`.

- [ ] **Step 2: Run focused orchestrator callback tests and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test -- src/services/__tests__/callback-url.test.ts
```

Expected: FAIL because current code maps `/api/code/internal/...` back to root `/internal/...`.

- [ ] **Step 3: Implement forward normalization**

In `workers/orchestrator/src/services/callback-url.ts`, use this model:

```typescript
const INTERNAL_MARKER = '/internal/';
const PUBLIC_CODE_AGENT_PREFIX = '/api/code';
const PUBLIC_INTERNAL_PREFIX = `${PUBLIC_CODE_AGENT_PREFIX}/internal/`;
const PUBLIC_CALLBACK_HOSTS = new Set(['intexuraos.cloud', 'dev.intexuraos.cloud']);

function isRecognizedInternalCallbackPath(pathname: string): boolean {
  if (pathname === '/internal/logs') return true;
  if (pathname === '/internal/turn-metrics') return true;
  if (pathname === '/internal/webhooks/task-complete') return true;
  if (pathname === '/internal/webhooks/task-event') return true;
  return /^\/internal\/code-tasks\/[^/]+\/status$/.test(pathname);
}

function isPublicCallbackHost(hostname: string): boolean {
  return PUBLIC_CALLBACK_HOSTS.has(hostname);
}

export function normalizeInternalCallbackUrl(url: string): string {
  const parsed = new URL(url);

  if (!isPublicCallbackHost(parsed.hostname)) {
    return url;
  }

  if (parsed.pathname.startsWith(PUBLIC_INTERNAL_PREFIX)) {
    return url;
  }

  if (!parsed.pathname.startsWith(INTERNAL_MARKER)) {
    return url;
  }

  if (!isRecognizedInternalCallbackPath(parsed.pathname)) {
    return url;
  }

  parsed.pathname = `${PUBLIC_CODE_AGENT_PREFIX}${parsed.pathname}`;
  return parsed.toString();
}
```

Keep `deriveCallbackBaseUrl()` deriving from the normalized URL first. Do not inspect `workerLocation`, machine hostname, or orchestrator `INTEXURAOS_ENVIRONMENT`.

- [ ] **Step 4: Run focused orchestrator callback tests and confirm pass**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test -- src/services/__tests__/callback-url.test.ts
```

Expected: PASS.

### Task 3: Update orchestrator callback consumers and tests

**Files:**
- Modify: `workers/orchestrator/src/services/webhook-client.ts`
- Test: `workers/orchestrator/src/__tests__/webhook-client.test.ts`
- Test: `workers/orchestrator/src/__tests__/log-forwarder.test.ts`
- Test: `workers/orchestrator/src/services/__tests__/status-update-client.test.ts`
- Test: `workers/orchestrator/src/__tests__/turn-metrics-collector.test.ts`

- [ ] **Step 1: Update tests that assert stale prod root-internal URLs**

Find stale expectations:

```bash
rg -n "https://intexuraos.cloud/internal|normalizes stale prod /api/code/internal" workers/orchestrator/src workers/orchestrator/src/__tests__
```

Required changes:

- `workers/orchestrator/src/__tests__/webhook-client.test.ts`: add first-delivery coverage and fix pending retry expectations:

```typescript
it('normalizes legacy prod root-internal webhook URLs before first delivery', async () => {
  mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

  const statePersistence = createStatePersistence();
  const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

  const result = await client.send({
    url: 'https://intexuraos.cloud/internal/webhooks/task-complete',
    secret: 'test-secret',
    payload: { taskId: 'task-prod', status: 'completed', duration: 1000 },
    taskId: 'task-prod',
  });

  expect(result.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledWith(
    'https://intexuraos.cloud/api/code/internal/webhooks/task-complete',
    expect.any(Object)
  );
});
```

For the existing pending retry test, rename it to `preserves canonical prod /api/code/internal pending webhook URLs before retrying` and change:

```typescript
expect(deliveredUrls).toEqual([
  'https://intexuraos.cloud/api/code/internal/webhooks/task-complete',
]);
```

Add a second pending retry test with input `https://intexuraos.cloud/internal/webhooks/task-complete` and the same expected delivered URL above.

- `workers/orchestrator/src/__tests__/log-forwarder.test.ts`: in `uses the task webhook base for task-scoped log uploads when provided`, change the webhook URL and expectation:

```typescript
forwarder.registerTask(
  'task-callback-base',
  webhookSecret,
  'https://intexuraos.cloud/api/code/internal/webhooks/task-complete'
);

expect(capturedUrl).toBe('https://intexuraos.cloud/api/code/internal/logs');
```

- `workers/orchestrator/src/services/__tests__/status-update-client.test.ts`: in `uses the task webhook base for terminal status callbacks when provided`, change the nock path and webhook URL:

```typescript
const taskCallbackOrigin = 'https://intexuraos.cloud';

nock(taskCallbackOrigin)
  .patch('/api/code/internal/code-tasks/task_prod/status')
  .reply(200, { success: true });

const result = await client.commit({
  taskId: 'task_prod',
  status: 'failed',
  completedAt: new Date('2026-04-17T10:00:00.000Z'),
  webhookUrl: 'https://intexuraos.cloud/api/code/internal/webhooks/task-complete',
});
```

- `workers/orchestrator/src/__tests__/turn-metrics-collector.test.ts`: in `publishes to the task-scoped callback base when webhookUrl is provided`, keep the existing `/api/code/internal/webhooks/task-complete` input and change the expectation:

```typescript
expect(url).toBe('https://intexuraos.cloud/api/code/internal/turn-metrics');
```

- [ ] **Step 2: Normalize lifecycle/completion first delivery URLs**

In `workers/orchestrator/src/services/webhook-client.ts`, update `send()` so direct lifecycle/completion delivery uses the same normalization as pending retry:

```typescript
const normalizedUrl = normalizeInternalCallbackUrl(url);
this.logger.info({ taskId, url: normalizedUrl, payload }, 'Sending webhook');
```

Then pass `normalizedUrl` to `deliver()`:

```typescript
await this.deliver(normalizedUrl, rawJsonBody, signature, timestamp);
```

When adding to the pending queue after retries fail, preserve `normalizedUrl`:

```typescript
await this.addToPendingQueue({
  url: normalizedUrl,
  secret,
  payload,
  taskId,
  attempts: MAX_RETRIES,
  createdAt: Date.now(),
});
```

- [ ] **Step 3: Run consumer tests**

Run:

```bash
pnpm --filter @intexuraos/orchestrator test -- \
  src/services/__tests__/callback-url.test.ts \
  src/__tests__/webhook-client.test.ts \
  src/__tests__/log-forwarder.test.ts \
  src/services/__tests__/status-update-client.test.ts \
  src/__tests__/turn-metrics-collector.test.ts
```

Expected: PASS.

- [ ] **Step 4: Stage chunk 2 changes without committing**

```bash
git add workers/orchestrator/src/services/callback-url.ts \
  workers/orchestrator/src/services/webhook-client.ts \
  workers/orchestrator/src/services/__tests__/callback-url.test.ts \
  workers/orchestrator/src/__tests__/webhook-client.test.ts \
  workers/orchestrator/src/__tests__/log-forwarder.test.ts \
  workers/orchestrator/src/services/__tests__/status-update-client.test.ts \
  workers/orchestrator/src/__tests__/turn-metrics-collector.test.ts
```

Expected: files are staged or visible in `git diff --cached`; no commit is created before full `pnpm run ci:tracked` passes in Chunk 4.

## Chunk 3: Runtime Config and Rule Documentation

### Task 4: Make prod runtime config emit the canonical callback base

**Files:**
- Modify: `ecosystem.config.prod.cjs`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `scripts/hetzner/load-secrets.sh`
- Test: `scripts/__tests__/ecosystem.prod.config.test.ts`
- Test: `scripts/__tests__/hetzner-runtime.test.ts`

- [ ] **Step 1: Write/update failing runtime config tests**

Update expectations:

```typescript
expect(byName.get('code-agent')?.env.INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL).toBe(
  'https://intexuraos.cloud/api/code'
);
```

In `scripts/__tests__/hetzner-runtime.test.ts`, expect the loader and Terraform to write `/api/code`:

```typescript
expect(script).toContain(
  'write_env_line "${output_path}" "INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL" "${PUBLIC_ORIGIN}/api/code"'
);
expect(terraform).toContain('INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL = "${local.public_origin}/api/code"');
```

- [ ] **Step 2: Run runtime config tests and confirm failure**

Run:

```bash
pnpm test -- scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts
```

Expected: FAIL because current config writes the bare public origin.

- [ ] **Step 3: Update runtime config sources**

In `terraform/environments/dev/main.tf`, change only the existing `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL` value inside `hetzner_runtime_env_vars` from `local.public_origin` to `"${local.public_origin}/api/code"`:

```hcl
hetzner_runtime_env_vars = {
  INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL = "${local.public_origin}/api/code"
}
```

In `scripts/hetzner/load-secrets.sh`, change only the existing `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL` value from `"${PUBLIC_ORIGIN}"` to `"${PUBLIC_ORIGIN}/api/code"`:

```bash
write_env_line "${output_path}" "INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL" "${PUBLIC_ORIGIN}/api/code"
```

In `ecosystem.config.prod.cjs`, change only the code-agent fallback from `PUBLIC_ORIGIN` to `${PUBLIC_ORIGIN}/api/code`:

```javascript
INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL:
  envValue('INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL') ?? `${PUBLIC_ORIGIN}/api/code`,
```

Do not change `INTEXURAOS_PUBLIC_ORIGIN`, `INTEXURAOS_WEB_APP_URL`, or `INTEXURAOS_WEB_URL`.

- [ ] **Step 4: Run runtime config tests and confirm pass**

Run:

```bash
pnpm test -- scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts
```

Expected: PASS.

### Task 5: Document the orchestrator/environment independence rule

**Files:**
- Modify: `.claude/CLAUDE.md`
- Modify: `.claude/reference/environments.md`
- Modify: `.claude/reference/architecture.md`

- [ ] **Step 1: Update `.claude/CLAUDE.md` with a bold rule**

In the `Architecture` or `Environments` section, add a compact rule:

```markdown
**Code Task Callback Ownership:** Orchestrator is deployment-independent. `workerLocation` is only the machine executing the task, never the task's dev/prod owner. The task's `webhookUrl` determines the owning code-agent environment, and public dev/prod callbacks MUST use `/api/code/internal/...`. Reference: `.claude/reference/environments.md`, `.claude/reference/architecture.md`
```

- [ ] **Step 2: Update `.claude/reference/environments.md`**

Add this under `Development Machines` or `Code Task Investigation`:

```markdown
## Code Task Worker Location vs Environment Ownership

**Orchestrator is deployment-independent.** A code task may run on `home-dev`, `mac-dev`, or another worker machine for either dev or prod. `workerLocation` answers "which machine is executing this task"; it does NOT answer "which environment owns this task."

The owning environment is carried by the task callback URLs:

| Owner | Canonical callback base |
| --- | --- |
| dev | `https://dev.intexuraos.cloud/api/code` |
| prod | `https://intexuraos.cloud/api/code` |

For task logs, lifecycle events, turn metrics, status updates, and completion callbacks, orchestrator MUST use the task-provided `webhookUrl` to derive sibling callback URLs. It MUST NOT infer callback destination from hostname, `workerLocation`, or its own fallback `INTEXURAOS_CODE_AGENT_URL` when `webhookUrl` is present.
```

- [ ] **Step 3: Update `.claude/reference/architecture.md`**

Add a short callback model section:

```markdown
## Code Task Callback Model

Code-agent owns callback URL generation when it creates or drains a task. Orchestrator owns execution only. This keeps orchestrator independent from deployment environments and lets any worker machine execute tasks for any code-agent instance.

Public dev/prod callback URLs are externally routable through nginx and MUST use `/api/code/internal/...`. Direct `/internal/...` callback URLs are valid only for localhost/test or explicitly host-local service URLs.
```

- [ ] **Step 4: Run formatting/static rule checks that cover docs**

Run:

```bash
pnpm run format:check -- .claude/CLAUDE.md .claude/reference/environments.md .claude/reference/architecture.md
pnpm run verify:v8-ignore
```

Expected: PASS.

- [ ] **Step 5: Stage chunk 3 changes without committing**

```bash
git add ecosystem.config.prod.cjs terraform/environments/dev/main.tf scripts/hetzner/load-secrets.sh \
  scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts \
  .claude/CLAUDE.md .claude/reference/environments.md .claude/reference/architecture.md
```

Expected: files are staged or visible in `git diff --cached`; no commit is created before full `pnpm run ci:tracked` passes in Chunk 4.

## Chunk 4: End-to-End Verification

### Task 6: Verify tracked workspace and runtime behavior

**Files:**
- No additional files expected.

- [ ] **Step 1: Run workspace-level tracked verification**

Run from repo root:

```bash
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- orchestrator
```

Expected: PASS.

- [ ] **Step 2: Run full tracked CI**

Run:

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-code-task-callback-env-independence.txt
```

Expected: PASS.

If it fails, analyze before changing anything:

```bash
rg "error|FAIL|failed|Failed" -C 3 /tmp/ci-output-code-task-callback-env-independence.txt
```

Fix every failure before commit/PR. Do not dismiss failures by workspace.

- [ ] **Step 3: Optional dev smoke check**

After deployment to dev, dispatch or retry a review task and verify all three:

```bash
.codex/skills/debug-code-task/scripts/fetch-task.sh <taskId> --logs
```

Expected:

- Task transitions from `dispatched` to a terminal review status.
- `log_lines` is non-zero.
- Orchestrator journal has no `Log upload rejected ... status=401` for the task.

- [ ] **Step 4: Create the final commit after full CI passes**

Only commit after Step 2 `pnpm run ci:tracked` has passed completely. Include all staged implementation, tests, config, and docs changes:

```bash
git status --short
git diff --cached --stat
git commit -m "fix: preserve code task callback environment ownership"
```

Expected: commit succeeds only after full CI evidence exists in `/tmp/ci-output-code-task-callback-env-independence.txt`.

## Implementation Notes

- Do not special-case by `workerLocation`.
- Do not special-case by `uname -n`.
- Do not use orchestrator's fallback `INTEXURAOS_CODE_AGENT_URL` when `task.webhookUrl` is present and parseable.
- Preserve localhost and arbitrary test domains. Only `intexuraos.cloud` and `dev.intexuraos.cloud` need public `/api/code` canonicalization.
- Backward compatibility matters: orchestrator should repair legacy public root-internal callback URLs so queued/running tasks created before deployment can still deliver callbacks.
- No Firestore schema migration is required.
- No endpoint handler changes are required.
- No Terraform apply is part of implementation. Runtime config changes flow through the existing deployment process.

## Handoff

Execution path is mandatory:

- If subagents are available, use `@superpowers:subagent-driven-development`. Assign one worker to Chunk 1, one worker to Chunk 2, then run Chunk 3 after both chunks are implemented, tested, reviewed, and staged to avoid test expectation churn. Run Chunk 4 in the integrator session.
- If subagents are not available, use `@superpowers:executing-plans` in the current session, executing chunks sequentially with a checkpoint after each chunk.
