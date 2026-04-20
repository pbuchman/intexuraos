# INT-1420 — Restore Missing Daily Mobile Notification Digests

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the daily WhatsApp mobile-notification digest run by fixing the broken Cloud Scheduler → `mobile-notifications-service` call, add a regression test, and backfill the three missed days (2026-04-17, 2026-04-18, 2026-04-19).

**Architecture:** The Cloud Scheduler job `mobile-notifications-digest-yesterday-dev` fires daily at `0 1 * * *` UTC and POSTs to `/internal/notifications/digest/run-yesterday` on `mobile-notifications-service`. Today it fails with HTTP 415 at the Fastify content-type parser (returned as 500). Fix by removing the pointless request body in Terraform and broadening the route's auth to accept the OIDC bearer sent by Cloud Scheduler (aligned with how `cron-agent` handles the same pattern). Post-deploy, trigger the existing `/notifications/digests/backfill` route to regenerate the three missed days.

**Tech Stack:** Terraform (Google Cloud Scheduler), Fastify (TypeScript, `@intexuraos/common-http`), pnpm workspace, Vitest.

**Endpoint Changes:**
- **Modified:** `POST /internal/notifications/digest/run-yesterday` — auth broadened to accept **OIDC JWT Bearer** (Cloud Scheduler) **OR** `x-internal-auth` (direct internal callers). Body/response shape unchanged.
- **Created:** none.
- **Removed:** none.
- **Unchanged:** `POST /internal/notifications/digest/run`, `POST /notifications/digests/run`, `POST /notifications/digests/backfill`, `GET /notifications/digests/*`, Cloud Scheduler cadence (`0 1 * * * UTC`), OIDC invoker IAM binding.

---

## Investigation — Reasoning and Evidence

### 1. Feature was introduced 3 days ago, then silent ever since

- Today is **2026-04-20**. The Cloud Scheduler resource was committed on **2026-04-17** in `4c3e4c6d1 feat(infra): add Cloud Scheduler for daily WhatsApp digest (0 1 * * * UTC)`:

  ```text
  $ git log --oneline -- terraform/environments/dev/main.tf | head -5
  4c3e4c6d1 feat(infra): add Cloud Scheduler for daily WhatsApp digest (0 1 * * * UTC)
  ```
- `gcloud scheduler jobs describe` confirms the resource is live and `userUpdateTime = 2026-04-17T11:05:31Z`. So the 3-day gap maps exactly to the scheduler's lifetime.

### 2. The scheduler IS firing — every attempt returns 5xx

```text
$ gcloud scheduler jobs describe mobile-notifications-digest-yesterday-dev --location=europe-central2
state: ENABLED
schedule: "0 1 * * *"
lastAttemptTime: 2026-04-20T01:04:40.571404Z
status.code: 13          # gRPC INTERNAL — the target returned 5xx
```

Scheduler execution log (every attempt for 2026-04-20 and the preceding two days):

```json
{
  "jsonPayload": {
    "@type": "type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished",
    "debugInfo": "URL_UNREACHABLE-UNREACHABLE_5xx. Original HTTP response code number = 500",
    "status": "INTERNAL",
    "url": ".../internal/notifications/digest/run-yesterday"
  },
  "httpRequest": { "status": 500 },
  "severity": "ERROR",
  "timestamp": "2026-04-20T01:04:46Z"
}
```

Each nominal fire (+ 3 retries) → 500. No digests are produced.

### 3. Root cause — Fastify rejects `Content-Type: application/octet-stream`

Cloud Run logs for the same timestamps:

```json
{
  "jsonPayload": {
    "err": {
      "code": "FST_ERR_CTP_INVALID_MEDIA_TYPE",
      "message": "Unsupported Media Type: application/octet-stream",
      "name": "FastifyError",
      "statusCode": 415,
      "stack": "FastifyError: Unsupported Media Type: application/octet-stream\n    at ContentTypeParser.run (.../content-type-parser.js:185:16)\n..."
    },
    "msg": "Unhandled error",
    "reqId": "req-e",
    "req": { "method": "POST", "url": "/internal/notifications/digest/run-yesterday" }
  },
  "severity": "ERROR"
}
```

Why `application/octet-stream`? Looking at `gcloud scheduler jobs describe`:

```yaml
httpTarget:
  body: "e30="           # base64 of "{}"
  headers:
    Content-Type: application/octet-stream
    User-Agent: Google-Cloud-Scheduler
  httpMethod: POST
```

Cloud Scheduler's default `Content-Type` when a request has a body and no headers block is `application/octet-stream`. Fastify's built-in content-type parser only handles `application/json` and `text/plain` by default, so the request is rejected before the route handler runs.

Source of the bug — `terraform/environments/dev/main.tf:1024-1053` (commit `4c3e4c6d1`):

```hcl
resource "google_cloud_scheduler_job" "mobile_notifications_digest_yesterday" {
  ...
  http_target {
    http_method = "POST"
    uri         = "${module.mobile_notifications_service.service_url}/internal/notifications/digest/run-yesterday"
    body        = base64encode("{}")            # <-- triggers Content-Type: application/octet-stream

    oidc_token {                                 # no headers block at all
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = module.mobile_notifications_service.service_url
    }
  }
  ...
}
```

### 4. Secondary defect — missing `x-internal-auth` header

Even if the Content-Type issue were fixed, the route today requires `x-internal-auth`:

`apps/mobile-notifications-service/src/routes/digestRoutes.ts:257-262`

```typescript
async (req, reply) => {
  logIncomingRequest(req);
  const authResult = validateInternalAuth(req);
  if (!authResult.valid) {
    return await reply.fail('UNAUTHORIZED', 'missing internal auth');
  }
```

`validateInternalAuth` reads the `x-internal-auth` header (`packages/common-http/src/auth/internalAuth.ts:24`). The scheduler does not send it, so the next failure after unblocking Content-Type would be a 401. No other scheduler in `terraform/environments/dev/main.tf` passes `x-internal-auth`; they all rely on the OIDC invoker IAM binding plus an application-layer check for a JWT-shaped bearer. The pattern is established in `apps/cron-agent/src/routes/internal-routes.ts:42-68` (see below for the template we mirror).

### 5. Why other schedulers work and this one doesn't

Sibling schedulers (`cron_agent_tick`, `linear_sync_hourly`, `retry_pending_commands`, `drain_task_queue`, …) share these traits:

- **No `body` attribute** → Cloud Scheduler sends an empty POST, no default Content-Type header is applied, Fastify never parses a body.
- **No `headers` block** → rely entirely on OIDC token + IAM invoker role.
- **Route accepts OIDC bearer** (`cron-agent` example, lines 52-68 of `internal-routes.ts`).

The digest scheduler deviated from this pattern in the wrong direction: it added a body (which introduced the Content-Type mismatch) and kept an application-level auth check that the scheduler can't satisfy.

### 6. Firestore evidence (sanity check)

The `POST /internal/notifications/digest/run-yesterday` handler never reaches `runDigestForGroup`, so no documents are written to `mobile_notification_digests`/`mobile_notification_group_states` by the cron path between 2026-04-17 and 2026-04-20. (Manually triggered digests via `/notifications/digests/run` or `/notifications/digests/backfill` remain unaffected — this bug is cron-only.)

---

## Fix Summary

| #   | Area      | Change                                                                                                                                                  | File                                                                          |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Terraform | Drop `body = base64encode("{}")` from the scheduler (matches sibling schedulers; eliminates the Content-Type mismatch).                                 | `terraform/environments/dev/main.tf:1031-1040`                                |
| 2   | Route     | Accept either a JWT-shaped `Authorization: Bearer …` (OIDC) **or** the existing `x-internal-auth` header. Mirrors `cron-agent/internal/cron/tick`.      | `apps/mobile-notifications-service/src/routes/digestRoutes.ts:257-262`        |
| 3   | Tests     | Add regression tests: (a) OIDC Bearer is accepted; (b) bare `Bearer garbage` is rejected; (c) no auth at all is rejected (existing test, leave intact). | `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts` |
| 4   | Backfill  | After the fix deploys, trigger `/notifications/digests/backfill` for `fromDate=2026-04-17 toDate=2026-04-19` per active subscription.                   | Operational, not code.                                                        |

---

## File Structure

- **Modified:**
  - `terraform/environments/dev/main.tf` — remove one line from `google_cloud_scheduler_job.mobile_notifications_digest_yesterday`.
  - `apps/mobile-notifications-service/src/routes/digestRoutes.ts` — replace the `validateInternalAuth`-only check on `run-yesterday` with the dual-auth helper pattern used by cron-agent.
  - `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts` — add two tests (OIDC accepted / bare Bearer rejected).
- **Created:** none.
- **Removed:** none.

No new packages, no Firestore schema changes, no new env vars, no new service boundaries. Single service.

---

## Tasks

### Task 1: Write failing regression test — OIDC Bearer is accepted

**Files:**
- Modify: `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts`

- [ ] **Step 1: Append a new `it()` block inside `describe('POST /internal/notifications/digest/run-yesterday', () => { ... })`**

Add directly after the existing `rejects without X-Internal-Auth header` case (around line 116), before the dispatch test:

```typescript
it('accepts requests authenticated via OIDC Bearer (Cloud Scheduler)', async () => {
  setMockServices({
    digestLockRepository: {
      acquire: async () => ({ ok: true, value: { acquired: true } }),
      release: async () => ({ ok: true, value: undefined }),
    },
    notificationRepository: {
      findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
      save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
      findById: async () => ({ ok: true, value: null }),
      existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
      delete: async () => ({ ok: true, value: undefined }),
    },
    digestRepository: {
      save: async () => ({ ok: true, value: EXAMPLE_PERSISTED }),
      findByDate: async () => ({ ok: true, value: null }),
      findRecentByGroup: async () => ({ ok: true, value: [] }),
      findInRange: async () => ({ ok: true, value: { items: [] } }),
    },
    groupStateRepository: {
      getByDate: async () => ({ ok: true, value: null }),
      getLatest: async () => ({ ok: true, value: null }),
      save: async () => ({ ok: true, value: undefined }),
    },
  });

  vi.mock('@intexuraos/llm-factory', async (): Promise<typeof import('@intexuraos/llm-factory')> => {
    const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
    return {
      ...actual,
      createLlmClient: () => ({
        generate: async (): Promise<{ ok: true; value: { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } } }> =>
          ({ ok: true, value: { content: JSON.stringify(COLD_START_EXAMPLE), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 } } }),
      }),
    } as typeof import('@intexuraos/llm-factory');
  });

  const app = await buildServer();
  const res = await app.inject({
    method: 'POST',
    url: '/internal/notifications/digest/run-yesterday',
    headers: { authorization: 'Bearer header.payload.signature' },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ success: boolean; data: { dispatched: number; date: string } }>();
  expect(body.success).toBe(true);
  expect(body.data.dispatched).toBe(1);
  await app.close();
});

it('rejects bare "Bearer <garbage>" to prevent auth bypass', async () => {
  setMockServices({});
  const app = await buildServer();
  const res = await app.inject({
    method: 'POST',
    url: '/internal/notifications/digest/run-yesterday',
    headers: { authorization: 'Bearer not-a-jwt' },
  });
  expect(res.statusCode).toBe(401);
  await app.close();
});
```

Rationale: the OIDC test proves the new path authenticates; the bare-bearer test guards against the trivial bypass that's documented in the cron-agent comment (lines 53-56).

- [ ] **Step 2: Run the tests; the new OIDC test MUST fail**

```bash
pnpm --filter=@intexuraos/mobile-notifications-service test -- digestRoutes.test.ts
```

Expected:
- `accepts requests authenticated via OIDC Bearer (Cloud Scheduler)` → **FAIL** with status 401 (the current `validateInternalAuth` path rejects it).
- `rejects bare "Bearer <garbage>"` → **PASS** (already rejected today).
- `rejects without X-Internal-Auth header` → **PASS** (unchanged).

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts
git commit -m "test(mobile-notifications): add OIDC Bearer + bare-token auth cases for run-yesterday (INT-1420)"
```

---

### Task 2: Implement dual-auth on `/internal/notifications/digest/run-yesterday`

**Files:**
- Modify: `apps/mobile-notifications-service/src/routes/digestRoutes.ts:257-262`

- [ ] **Step 1: Replace the auth block in the `run-yesterday` handler**

Current code (lines 257-262):

```typescript
async (req, reply) => {
  logIncomingRequest(req);
  const authResult = validateInternalAuth(req);
  if (!authResult.valid) {
    return await reply.fail('UNAUTHORIZED', 'missing internal auth');
  }
```

Replace with (mirrors `apps/cron-agent/src/routes/internal-routes.ts:42-68`):

```typescript
async (req, reply) => {
  logIncomingRequest(req);

  // Auth strategy: Cloud Scheduler sends OIDC tokens; direct internal callers use x-internal-auth.
  // Cloud Run validates the OIDC token at the infrastructure layer via the `roles/run.invoker`
  // IAM binding granted to the scheduler SA in terraform (see
  // `scheduler_invokes_mobile_notifications_service`). The app-layer JWT-structure check is a
  // defence-in-depth guard: it rejects bare "Bearer <garbage>" in case Cloud Run ingress is
  // ever reconfigured.
  const authHeader = req.headers.authorization;
  const JWT_STRUCTURE = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  const isOidcAuth = typeof authHeader === 'string' && JWT_STRUCTURE.test(authHeader);

  if (!isOidcAuth) {
    const authResult = validateInternalAuth(req);
    if (!authResult.valid) {
      return await reply.fail('UNAUTHORIZED', 'missing internal auth');
    }
  }
```

Leave the rest of the handler (date computation, per-subscription dispatch, response) untouched.

- [ ] **Step 2: Run the targeted tests; all three auth cases MUST pass**

```bash
pnpm --filter=@intexuraos/mobile-notifications-service test -- digestRoutes.test.ts
```

Expected: all three auth tests for `run-yesterday` pass, plus the existing dispatch test.

- [ ] **Step 3: Run the full service test + lint + typecheck**

```bash
pnpm run verify:workspace:tracked -- mobile-notifications-service
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile-notifications-service/src/routes/digestRoutes.ts
git commit -m "fix(mobile-notifications): accept OIDC Bearer on /internal/notifications/digest/run-yesterday (INT-1420)"
```

---

### Task 3: Remove the `body` attribute from the Cloud Scheduler Terraform resource

**Files:**
- Modify: `terraform/environments/dev/main.tf:1031-1040`

- [ ] **Step 1: Delete the one offending line**

Current (lines 1031-1040):

```hcl
  http_target {
    http_method = "POST"
    uri         = "${module.mobile_notifications_service.service_url}/internal/notifications/digest/run-yesterday"
    body        = base64encode("{}")

    oidc_token {
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = module.mobile_notifications_service.service_url
    }
  }
```

After:

```hcl
  http_target {
    http_method = "POST"
    uri         = "${module.mobile_notifications_service.service_url}/internal/notifications/digest/run-yesterday"

    oidc_token {
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = module.mobile_notifications_service.service_url
    }
  }
```

Why not also add `headers = { "Content-Type" = "application/json" }`? The endpoint accepts an empty body; sending no body at all removes the Content-Type concern entirely. This matches sibling schedulers (`cron_agent_tick`, `linear_sync_hourly`, `retry_pending_commands`, …) and keeps the diff minimal.

- [ ] **Step 2: `terraform fmt` and `terraform validate`**

```bash
cd terraform/environments/dev
terraform fmt -check
terraform validate
cd -
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add terraform/environments/dev/main.tf
git commit -m "fix(infra): drop empty body from digest scheduler so Cloud Scheduler sends no Content-Type (INT-1420)"
```

---

### Task 4: Repo-wide CI + PR

- [ ] **Step 1: `pnpm run ci:tracked` must pass end-to-end**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-int-1420.txt
```

Expected: zero failures; no warnings about unrelated services introduced by these diffs.

- [ ] **Step 2: Push and open the PR against `development`**

```bash
git push -u origin fix/int-1420-restore-digests
gh pr create \
  --base development \
  --title "[INT-1420] Restore daily mobile notification digests" \
  --body "$(cat <<'EOF'
## Summary
- Fix Cloud Scheduler → mobile-notifications-service: drop pointless POST body so Fastify no longer rejects `application/octet-stream` with 415.
- Broaden `/internal/notifications/digest/run-yesterday` auth to accept OIDC Bearer (Cloud Scheduler) in addition to `x-internal-auth`. Matches cron-agent pattern.
- Adds regression tests for both OIDC and bare-Bearer paths.

## Root cause
Scheduler `mobile-notifications-digest-yesterday-dev` (committed 2026-04-17) sent `body = base64encode("{}")` with no custom `Content-Type` header. Cloud Scheduler defaulted to `application/octet-stream`, which Fastify rejects with `FST_ERR_CTP_INVALID_MEDIA_TYPE` (surfaced as 500). All three daily firings (2026-04-17, -18, -19) failed; no digests were generated.

## Test plan
- [x] `pnpm --filter=@intexuraos/mobile-notifications-service test`
- [x] `pnpm run verify:workspace:tracked -- mobile-notifications-service`
- [x] `terraform fmt -check && terraform validate` (in `terraform/environments/dev`)
- [x] `pnpm run ci:tracked`
- [ ] After merge + deploy: trigger scheduler once (`gcloud scheduler jobs run mobile-notifications-digest-yesterday-dev --location=europe-central2`) and confirm Cloud Run log shows `msg: "request completed"` with `statusCode: 200`.
- [ ] Manually backfill the three missed days (see Operational runbook below).

## Operational runbook (post-deploy)
For each active entry in `DIGEST_SUBSCRIPTIONS`, kick off the existing backfill:

```
curl -sS -X POST \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $USER_JWT" \
  "${MOBILE_NOTIFICATIONS_URL}/notifications/digests/backfill" \
  -d '{"groupKey":"<groupKey>","fromDate":"2026-04-17","toDate":"2026-04-19"}'
```

Then poll `GET /notifications/digests/backfill/:runId` until `status=completed`.

Fixes INT-1420
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- "Investigate why it went wrong" → covered in §1-§5 with scheduler describe output, scheduler+Cloud Run logs, and the offending Terraform block.
- "show the reasoning, show the proofs" → every claim has concrete evidence (command + output snippet).
- "fix that" → Tasks 1-4 produce the diff. Task 4's runbook restores the three missed days.

**2. Placeholder scan:** no TODO/TBD/"similar to previous" placeholders; every code block is complete.

**3. Type consistency:** the new OIDC guard uses `req.headers.authorization` (Fastify types it as `string | string[] | undefined`), matching cron-agent's identical check; `JWT_STRUCTURE` is declared inside the handler so no cross-file type drift.

**4. Blast radius:** changes are confined to `mobile-notifications-service` (one route + its tests) and one line in `terraform/environments/dev/main.tf`. No other schedulers, services, or Firestore collections are touched.
