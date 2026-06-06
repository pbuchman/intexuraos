# Code Task Dispatch Status And Recovery Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` if subagents are explicitly requested and available; otherwise use `superpowers:executing-plans` to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** Make code-task dispatch failures actionable for users across all worker types, and fix the callback/recovery gaps that currently leave tasks appearing stuck after worker execution fails.

**Architecture:** Keep dispatch ownership in `apps/code-agent`, worker runtime health in `workers/orchestrator`, shared worker capability metadata in `packages/code-task-domain`, and presentation in `apps/web`. Introduce durable code-task system statuses, task-scoped callback URL handling, WhatsApp notifications, and explicit verification for scheduler, nginx, worker auth, callback, and zombie recovery behavior.

**Tech Stack:** TypeScript, Fastify, Firestore, Firebase Admin, React, Vite, Vitest, Terraform, Cloud Scheduler, Google Cloud Monitoring/Logging, Hetzner nginx/OpenResty, orchestrator systemd service.

---

## Current Investigation

The original "queued for execution" failure was caused by the Hetzner nginx JWT verifier failing before requests reached `code-agent`.

Evidence:

- Current branch includes the runtime dependency fix:
  - `scripts/hetzner/install-nginx-and-cert.sh` installs `lua-cjson` and `lua-resty-openidc`.
  - `scripts/hetzner/provision.sh` installs `lua5.1` and `lua-cjson`.
  - `scripts/hetzner/deploy-nginx.sh` verifies Lua JWT dependencies before `nginx -t`.
- The latest `development` deployment for commit `ad56fed6f6` succeeded.
- Cloud Scheduler logs now show `POST https://intexuraos.cloud/internal/drain-queue` returning HTTP 200.

The specific task `task_ef1f1da8-fd5f-4fb1-ba94-c6eed27cc1cc` is no longer queued. It is stale in Firestore as `status: dispatched`.

Evidence:

- Firestore task fields:
  - `status: dispatched`
  - `workerLocation: home-dev`
  - `workerType: codex-xhigh`
  - `agentType: planning`
  - `dispatchedAt: 2026-06-04T16:24:17Z`
  - `lastHeartbeat: 2026-06-04T16:24:18Z`
  - `Total log lines: 0`
- `home-dev` orchestrator logs show the worker accepted the task, created the worktree, started the `codex-xhigh` runtime, then failed:
  - log upload attempts failed with connection failures against the worker's static `INTEXURAOS_CODE_AGENT_URL`.
  - webhook attempts to `https://intexuraos.cloud/api/code/internal/...` failed with 521/522.
  - runtime exited with code 1.
  - Codex failed to refresh its token: `400 Bad Request: Your session has ended. Please log in again.`
  - final status update failed after retries.
- `home-dev` pending webhook state still contains pending task events and completion callbacks for this task, with attempts already near 200.
- The current `home-dev` health endpoint reports ready capacity and active Claude/Codex auth today, but that does not change the task-time evidence that Codex auth failed during this execution.

The stale `dispatched` state is caused by a second failure path: worker completion and status callbacks could not reach the code-agent service, and zombie recovery is currently failing.

Evidence:

- Production `ecosystem.config.prod.cjs` sets the code-agent public service URL to `https://intexuraos.cloud/api/code`.
- `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`, `drainRetryQueue.ts`, and `routes/internal/task-admin-routes.ts` build worker webhook URLs from that service URL.
- Hetzner nginx explicitly rejects `/api/<service>/internal/...` and only exposes internal code-agent routes under canonical `/internal/...` paths.
- The worker therefore received webhook URLs such as `https://intexuraos.cloud/api/code/internal/webhooks/task-complete`, which nginx rejects by design.
- The worker also used its static `INTEXURAOS_CODE_AGENT_URL=http://localhost:8128` for `/internal/logs`, `/internal/code-tasks/:id/status`, and `/internal/turn-metrics`; that is wrong for tasks dispatched by the prod code-agent.
- Cloud Scheduler logs show `POST https://intexuraos.cloud/internal/code/detect-zombies` returning HTTP 500, so the stale dispatched task is not being recovered.
- The exact prod app exception for `/internal/code/detect-zombies` is not yet captured because SSH to the Hetzner host is blocked by a changed host key. This must be resolved through the normal host-key verification path before implementation sign-off.

## Dependency Investigation

Runtime and dependency surfaces that matter for this fix:

- Root scripts:
  - `pnpm run ci:tracked`
  - `pnpm run verify:workspace:tracked -- <workspace>`
  - `pnpm test`
  - `pnpm build`
  - `pnpm typecheck`
- Test framework:
  - `vitest ^4.0.16`
  - `@testing-library/*` for web tests
- Code-agent dependencies:
  - Fastify
  - Firebase Admin / Firestore
  - Google Cloud Monitoring
  - `jose`
  - Zod
- Orchestrator dependencies:
  - Dockerode
  - `@anthropic-ai/sdk`
  - `@google/genai`
  - `jose`
  - `jsonwebtoken`
  - `nock`
- Web dependencies:
  - React 19
  - Vite 7
  - `lucide-react`
  - Firebase client SDK
- Hetzner runtime dependencies:
  - nginx extras
  - nginx Lua module
  - Lua 5.1
  - `lua-cjson`
  - LuaRocks / OpenResty libraries
- Terraform:
  - Terraform `>= 1.5.0`
  - Google provider `~> 5.0`
  - Hetzner provider `~> 1.45`

Existing tests already cover part of the new branch:

- `scripts/__tests__/hetzner-runtime.test.ts` verifies public API route generation, `/api/<service>/internal` blocking, canonical internal paths, Lua dependency installation, and Lua dependency verification before `nginx -t`.

Missing coverage that this plan must add:

- Prod code-agent must not generate `/api/code/internal/...` callback URLs.
- Orchestrator task callbacks must use the task-provided callback base, not the worker's static local code-agent URL.
- Pending webhook retry must normalize previously generated `/api/code/internal/...` URLs so already stuck callbacks can recover.
- Cloud Scheduler jobs with request bodies must declare JSON `Content-Type`, and bodyless jobs must not send a body.
- `/internal/code/detect-zombies` must be directly verified, not assumed from queue-drain success.
- Worker health probe data must preserve auth, Docker, and disk blockers.
- Dispatch blocker classification must apply to Codex, Claude, and API-key-backed worker types.
- Queue UI must display active system status, not only queued task rows.
- WhatsApp notification must be sent when dispatch is blocked and deduplicated while the blocker remains active.

## Endpoint Changes

Modified endpoints:

- `GET /api/code/queue`
  - Add active dispatch system statuses to the queue response.
  - Keep existing queued task fields unchanged.
- `POST /internal/drain-queue`
  - Continue returning the existing drain result shape.
  - Add side effects that upsert/resolve dispatch system statuses and send deduplicated WhatsApp notifications.
- `POST /internal/code/detect-zombies`
  - Keep route semantics.
  - Fix scheduler request shape and add direct tests so the route does not fail on empty JSON bodies or missing JSON headers.
- `POST /internal/webhooks/task-complete`
  - Keep handler contract.
  - Ensure newly generated worker webhook URLs target canonical `/internal/webhooks/task-complete`.
- `POST /internal/webhooks/task-event`
  - Keep handler contract.
  - Ensure newly generated worker webhook URLs target canonical `/internal/webhooks/task-event`.
- `POST /internal/logs`
  - Keep handler contract.
  - Ensure workers upload task logs to the task callback base.
- `POST /internal/code-tasks/:taskId/status`
  - Keep handler contract.
  - Ensure workers commit terminal status to the task callback base.
- `POST /internal/turn-metrics`
  - Keep handler contract.
  - Ensure task-scoped turn metrics use the task callback base.

New endpoints:

- `GET /api/code/system-status`
  - Returns active code-task system statuses for the current user.
  - Used by the queue page and available for future status surfaces.

Removed endpoints:

- None.

Explicitly invalid endpoints:

- `/api/code/internal/...` remains invalid in production and should continue returning 404 at nginx.

## Desired Behavior

When code tasks cannot be dispatched because no worker can execute them, users must see a durable system status and receive a WhatsApp notification explaining the blocker.

Examples:

- No enabled workers exist for the task's worker type.
- Workers are registered but unreachable.
- Workers are healthy but at capacity.
- Workers lack required Codex auth.
- Workers lack required Claude auth.
- Workers lack a required API-key-backed provider.
- Workers cannot run tasks because Docker is unhealthy.
- Workers cannot run tasks because disk health checks fail.

The status must apply across all worker types, including Codex, Claude, and provider-backed Claude-compatible workers.

## Implementation Plan

### 1. Confirm Production Recovery Evidence Before Code Changes

- [ ] Verify the Hetzner host-key change through the expected infrastructure source, then update the local known-hosts entry through the normal safe path.
- [ ] Capture the production code-agent logs for `/internal/code/detect-zombies` around the HTTP 500 events.
- [ ] Record the exact Fastify/nginx/app exception in the implementation notes.
- [ ] Re-run Cloud Scheduler log queries for:
  - `intexuraos-code-tasks-drain-queue-prod-hetzner`
  - `intexuraos-code-tasks-zombie-sweep-prod-hetzner`
- [ ] Confirm whether zombie sweep fails before Fastify routing, inside request parsing, inside auth, or inside the zombie detector use case.

Acceptance:

- The implementation starts with exact zombie-sweep failure evidence, not inference.
- If the exception differs from the scheduler body/header hypothesis, the implementation updates this plan before coding.

### 2. Add Canonical Code-Task Callback Configuration

- [ ] Add a code-agent config field named `codeTaskCallbackBaseUrl`.
- [ ] Read it from `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL`.
- [ ] Default it to the current `serviceUrl` only for compatibility.
- [ ] Normalize by trimming trailing slashes.
- [ ] Add validation that production callback URLs generated for internal worker callbacks do not include `/api/code/internal`.
- [ ] Update `ecosystem.config.prod.cjs` for the code-agent process:
  - `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL=https://intexuraos.cloud`
- [ ] Update the development ecosystem config to preserve the currently valid dev callback base:
  - `INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL=https://dev.intexuraos.cloud/api/code`
- [ ] Update Terraform environment variables for the code-agent workspace according to the repo's env-var pattern.
- [ ] Document the variable in the relevant `.claude/reference` environment or infrastructure reference if implementation reveals a new durable convention.

Code shape:

```ts
export interface CodeTaskCallbackConfig {
  readonly codeTaskCallbackBaseUrl: string;
}

export function buildInternalCallbackUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
```

Acceptance:

- Prod worker callback URLs are generated as `https://intexuraos.cloud/internal/...`.
- Dev callback URLs remain compatible with the current dev ingress.
- Existing public API URL behavior remains unchanged.

### 3. Replace Service URL Callback Generation In Code-Agent

- [ ] Update `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`.
- [ ] Update `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`.
- [ ] Update `apps/code-agent/src/routes/internal/task-admin-routes.ts`.
- [ ] Build worker webhook URLs with `codeTaskCallbackBaseUrl`, not `serviceUrl`.
- [ ] Add unit tests proving:
  - prod config creates `/internal/webhooks/task-complete`.
  - prod config creates `/internal/webhooks/task-event`.
  - no generated callback URL contains `/api/code/internal`.
  - dev config can still generate the dev-compatible prefix.

Acceptance:

- New production dispatches cannot produce the currently broken `/api/code/internal/...` callbacks.

### 4. Make Orchestrator Use Task-Scoped Callback URLs

- [ ] Add a worker-side callback URL helper in `workers/orchestrator/src/services`.
- [ ] Derive the task callback base from `task.webhookUrl`.
- [ ] Use that base for:
  - `/internal/logs`
  - `/internal/code-tasks/:taskId/status`
  - `/internal/turn-metrics`
  - task event webhooks
  - task completion webhooks
- [ ] Keep `config.codeAgentUrl` only as a fallback for legacy tasks that have no webhook URL.
- [ ] Add URL normalization for pending retry records:
  - rewrite `https://intexuraos.cloud/api/code/internal/...` to `https://intexuraos.cloud/internal/...`.
  - rewrite only recognized internal callback paths.
  - never rewrite arbitrary public API URLs.
- [ ] Add tests for:
  - canonical prod webhook URL derivation.
  - dev `/api/code/internal/...` compatibility if still required by dev ingress.
  - log upload URL selection.
  - terminal status URL selection.
  - pending webhook retry URL normalization.
  - refusal to normalize unknown paths.

Code shape:

```ts
const INTERNAL_MARKER = "/internal/";

export function deriveCallbackBaseUrl(webhookUrl: string | undefined, fallbackBaseUrl: string): string {
  if (!webhookUrl) {
    return fallbackBaseUrl.replace(/\/+$/, "");
  }

  const parsed = new URL(normalizeInternalCallbackUrl(webhookUrl));
  const markerIndex = parsed.pathname.indexOf(INTERNAL_MARKER);
  if (markerIndex === -1) {
    return fallbackBaseUrl.replace(/\/+$/, "");
  }

  parsed.pathname = parsed.pathname.slice(0, markerIndex);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}
```

Acceptance:

- A worker receiving a prod task posts logs, status, metrics, and webhooks to canonical prod internal URLs.
- Existing pending webhooks from the bad prod path can drain without manual state surgery.

### 5. Fix Zombie Sweep Scheduler Request Shape

- [ ] Update `terraform/hetzner-prod/scheduler.tf` so the zombie sweep job does not send an empty body unless the route requires it.
- [ ] Prefer `body = null` for `/internal/code/detect-zombies`.
- [ ] If production logs prove a JSON body is required, keep `body = base64encode("{}")` and add `headers = { "Content-Type" = "application/json" }`.
- [ ] Add static tests in `scripts/__tests__/hetzner-runtime.test.ts`:
  - drain queue has no body.
  - zombie sweep has no body, or has JSON `Content-Type` if the body remains.
  - execution memory prune keeps JSON `Content-Type` because it sends JSON.
- [ ] Add an app-level route test for `/internal/code/detect-zombies` with no body.
- [ ] Add an app-level route test for `/internal/code/detect-zombies` with `{}` and JSON `Content-Type` if the route should tolerate it.

Acceptance:

- Cloud Scheduler can call zombie sweep successfully.
- The route can recover stale `dispatched` and `running` tasks.

### 6. Share Worker Capability Metadata Across Code-Agent And Orchestrator

- [ ] Add shared capability metadata in `packages/code-task-domain`, next to the existing `CODE_TASK_WORKER_TYPES` source in `packages/code-task-domain/src/codeTaskWorkerTypes.ts`.
- [ ] Include every worker type currently listed by `CODE_TASK_WORKER_TYPES`:
  - `auto`
  - `opus`
  - `sonnet`
  - `minimax`
  - `mimo-pro`
  - `glm`
  - `qwen`
  - `kimi`
  - `codex`
  - `codex-xhigh`
  - `openrouter-free`
- [ ] Represent:
  - runtime family: `codex`, `claude`, or provider-backed compatible runtime.
  - required auth provider: `codex`, `claude`, API key env var, or none.
  - whether Docker is required.
  - worker type display name.
- [ ] Refactor `workers/orchestrator/src/services/isolation/types.ts` so the orchestrator's richer runtime config is either derived from or statically checked against the shared capability metadata.
- [ ] Refactor `workers/orchestrator/src/services/task-dispatcher/preflight.ts` so auth-provider selection does not duplicate worker capability rules privately.
- [ ] Refactor code-agent dispatch classification to use the same metadata.
- [ ] Extend `workers/orchestrator/src/services/isolation/__tests__/types.test.ts` and `packages/code-task-domain/src/__tests__/codeTaskWorkerTypes.test.ts` so tests fail if a worker type exists in one map but not the other.

Code shape:

```ts
export type CodeTaskAuthRequirement =
  | { readonly kind: "codex" }
  | { readonly kind: "claude" }
  | { readonly kind: "api_key"; readonly envVar: string }
  | { readonly kind: "none" };

export interface CodeTaskWorkerCapability {
  readonly workerType: string;
  readonly displayName: string;
  readonly runtimeFamily: "codex" | "claude" | "provider";
  readonly auth: CodeTaskAuthRequirement;
  readonly requiresDocker: boolean;
}
```

Acceptance:

- Codex and Claude blockers are classified from the same worker capability source.
- New worker types cannot silently skip blocker classification.

### 7. Preserve Worker Health Details In Code-Agent

- [ ] Extend `apps/code-agent/src/infra/services/workerHealthProbe.ts` response types to include:
  - `workerAuths`
  - `dockerHealthy`
  - `diskHealthy`
  - any existing capacity fields
- [ ] Extend domain health state types to preserve those fields.
- [ ] Keep old workers compatible by treating missing fields as unknown, not healthy.
- [ ] Add tests for:
  - Codex unavailable auth.
  - Claude unavailable auth.
  - Docker unhealthy.
  - Disk unhealthy.
  - legacy health responses without detailed fields.

Acceptance:

- Code-agent can explain why a worker cannot accept a task before blindly attempting dispatch.

### 8. Add Dispatch Blocker Classification

- [ ] Add a domain service in `apps/code-agent/src/domain/services` that classifies dispatchability for a task worker type.
- [ ] Inputs:
  - task worker type.
  - enabled worker settings.
  - probed worker health states.
  - shared worker capability metadata.
- [ ] Outputs:
  - `dispatchable`.
  - or a typed blocker reason with affected worker names and remediation text.
- [ ] Classify:
  - no enabled workers.
  - no reachable workers.
  - all workers busy or at capacity.
  - Codex auth unavailable.
  - Claude auth unavailable.
  - required provider API key unavailable.
  - Docker unavailable.
  - disk unavailable.
  - unknown worker type.
- [ ] Add table-driven tests covering every worker type family.

Code shape:

```ts
export type CodeTaskDispatchBlockerReason =
  | "no_enabled_workers"
  | "workers_unreachable"
  | "workers_at_capacity"
  | "codex_auth_unavailable"
  | "claude_auth_unavailable"
  | "provider_auth_unavailable"
  | "docker_unavailable"
  | "disk_unavailable"
  | "unknown_worker_type";
```

Acceptance:

- The dispatch drain path can produce a user-facing reason before a task sits silently queued.

### 9. Persist Code-Task System Statuses

- [ ] Add a Firestore-backed repository owned by code-agent.
- [ ] Use a collection name such as `code_task_system_statuses`.
- [ ] Register the collection in the repo's Firestore collection manifest if required by local conventions.
- [ ] Store statuses by deterministic scope:
  - user id.
  - component: `code-task-dispatch`.
  - worker type.
  - blocker reason.
- [ ] Persist:
  - `status: active | resolved`
  - `severity: warning | critical`
  - `reason`
  - `message`
  - `remediation`
  - `affectedTaskCount`
  - `exampleTaskIds`
  - `workerNames`
  - `firstSeenAt`
  - `lastSeenAt`
  - `resolvedAt`
  - `lastNotifiedAt`
- [ ] Upsert active statuses idempotently.
- [ ] Resolve statuses when dispatch becomes possible or a task dispatch succeeds.
- [ ] Add repository tests using the existing Firestore test pattern.

Code shape:

```ts
export interface CodeTaskSystemStatus {
  readonly id: string;
  readonly userId: string;
  readonly component: "code-task-dispatch";
  readonly status: "active" | "resolved";
  readonly severity: "warning" | "critical";
  readonly workerType: string;
  readonly reason: CodeTaskDispatchBlockerReason;
  readonly message: string;
  readonly remediation: string;
  readonly affectedTaskCount: number;
  readonly exampleTaskIds: readonly string[];
  readonly workerNames: readonly string[];
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly resolvedAt?: Date;
  readonly lastNotifiedAt?: Date;
}
```

Acceptance:

- Status survives page refreshes and is visible even when no new drain attempt is running.

### 10. Integrate Status Handling Into Queue Drain And Retry Drain

- [ ] In `drainTaskQueue`, classify blockers before attempting dispatch.
- [ ] When no enabled worker or no capable worker exists:
  - upsert active system status.
  - send deduplicated WhatsApp notification.
  - keep queued tasks queued.
  - return the existing drain response with blocker details added where appropriate.
- [ ] When dispatch errors prove capacity or capability blockers:
  - upsert active system status.
  - preserve existing retry behavior.
- [ ] When a dispatch succeeds:
  - resolve matching active statuses for that user and worker type.
- [ ] Apply equivalent behavior in `drainRetryQueue`.
- [ ] Add tests for:
  - no enabled workers.
  - Codex auth unavailable.
  - Claude auth unavailable.
  - provider auth unavailable.
  - all workers at capacity.
  - unreachable workers.
  - successful dispatch resolves prior status.
  - retry drain records blockers.

Acceptance:

- Queued tasks are accompanied by actionable status whenever the system knows no worker can process them.

### 11. Add WhatsApp Dispatch-Blocked Notifications

- [ ] Add `notifyTaskDispatchBlocked` to `apps/code-agent/src/domain/services/whatsappNotifier.ts`.
- [ ] Implement it in the existing notifier implementation.
- [ ] Include:
  - affected worker type.
  - blocker reason.
  - affected task count.
  - one example task id.
  - remediation text.
  - link to the queue or worker settings page.
- [ ] Deduplicate by `CodeTaskSystemStatus.lastNotifiedAt`.
- [ ] Use a sensible resend interval, such as once per active blocker per 6 hours, unless existing notification policy has a stricter convention.
- [ ] Add tests that prove:
  - notification is sent on first blocker.
  - notification is not repeatedly sent on every scheduler tick.
  - notification is sent again after the resend interval.
  - Codex and Claude blocker messages are different and accurate.

Acceptance:

- A user gets a clear WhatsApp notification when dispatch is blocked, without scheduler spam.

### 12. Expose System Status Through API

- [ ] Add `GET /system-status` in the code-agent API route tree so it is externally available as `/api/code/system-status`.
- [ ] Return active statuses for the authenticated user.
- [ ] Include active statuses in `GET /queue` so the queue page can render without a second request if preferred.
- [ ] Add route tests for:
  - authenticated user sees own statuses.
  - statuses from another user are hidden.
  - resolved statuses are excluded by default.
  - queue response includes statuses.

Response shape:

```ts
export interface CodeTaskSystemStatusDto {
  readonly id: string;
  readonly component: "code-task-dispatch";
  readonly severity: "warning" | "critical";
  readonly workerType: string;
  readonly reason: string;
  readonly message: string;
  readonly remediation: string;
  readonly affectedTaskCount: number;
  readonly exampleTaskIds: readonly string[];
  readonly workerNames: readonly string[];
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}
```

Acceptance:

- System status is available to the web app and can be inspected independently of queued task rows.

### 13. Display Dispatch System Status In The Web App

- [ ] Update code-agent API client types.
- [ ] Update the dispatch queue data hook.
- [ ] Add an actionable system status panel to `apps/web/src/pages/DispatchQueuePage.tsx`.
- [ ] Keep the queued task table unchanged.
- [ ] Display:
  - blocker title.
  - affected worker type.
  - affected task count.
  - example task id.
  - remediation.
  - last observed time.
- [ ] Add a link or action to the relevant worker settings page if one exists.
- [ ] Use existing visual conventions and `lucide-react` icons.
- [ ] Add tests for:
  - no status shown when none active.
  - Codex auth blocker text.
  - Claude auth blocker text.
  - no enabled workers blocker text.
  - multiple active blockers.

Acceptance:

- Users do not only see "queued"; they see why dispatch cannot happen and what to investigate.

### 14. Add Scheduler And Runtime Alerting

- [ ] Add monitoring for Cloud Scheduler failures on:
  - drain queue.
  - zombie sweep.
- [ ] Prefer a log-based alert or validated Cloud Scheduler metric filter that explicitly catches HTTP 5xx for those job names.
- [ ] Before writing Terraform, verify the metric or log schema with:

```bash
gcloud logging read \
  'resource.type="cloud_scheduler_job" AND resource.labels.job_id=("intexuraos-code-tasks-drain-queue-prod-hetzner" OR "intexuraos-code-tasks-zombie-sweep-prod-hetzner")' \
  --project intexuraos-dev-pbuchman \
  --limit 5 \
  --format json
```

- [ ] Add Terraform tests or static runtime tests that ensure both scheduler jobs are covered by an alert policy.
- [ ] Add notification-channel routing according to the existing infrastructure convention.

Acceptance:

- Future nginx/app/scheduler failures are visible as infrastructure status, not only as queued tasks.

### 15. Build Recovery For The Existing Stale Task

- [ ] After callback URL and zombie sweep fixes are deployed, allow pending webhooks to retry naturally.
- [ ] Manually trigger or wait for zombie sweep.
- [ ] Verify `task_ef1f1da8-fd5f-4fb1-ba94-c6eed27cc1cc` transitions out of stale `dispatched`.
- [ ] Confirm logs or failure summary become visible in Firestore/API.
- [ ] If pending webhooks are exhausted or malformed beyond safe normalization, perform a documented one-time repair through a script reviewed before execution.

Acceptance:

- The investigated task reaches a terminal state or a documented explicit recovery state.

## Verification Plan

Use test-first implementation. Add failing tests before implementation for each behavior below.

Targeted test commands:

```bash
pnpm --filter @intexuraos/code-task-domain test
pnpm --filter @intexuraos/code-agent test
pnpm --filter @intexuraos/orchestrator test
pnpm --filter @intexuraos/web test
pnpm vitest run scripts/__tests__/hetzner-runtime.test.ts
pnpm vitest run scripts/__tests__/ecosystem.prod.config.test.ts
```

Workspace verification:

```bash
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- orchestrator
pnpm run verify:workspace:tracked -- web
```

Terraform verification:

```bash
terraform -chdir=terraform/hetzner-prod fmt -check
terraform -chdir=terraform/hetzner-prod init -backend=false
terraform -chdir=terraform/hetzner-prod validate
```

Full tracked verification:

```bash
pnpm run ci:tracked
```

Production smoke verification after deployment:

```bash
gcloud logging read \
  'resource.type="cloud_scheduler_job" AND resource.labels.job_id="intexuraos-code-tasks-drain-queue-prod-hetzner"' \
  --project intexuraos-dev-pbuchman \
  --limit 5

gcloud logging read \
  'resource.type="cloud_scheduler_job" AND resource.labels.job_id="intexuraos-code-tasks-zombie-sweep-prod-hetzner"' \
  --project intexuraos-dev-pbuchman \
  --limit 5
```

Direct authenticated endpoint probes after deployment:

```bash
AUDIENCE="https://intexuraos.cloud"
TOKEN="$(gcloud auth print-identity-token --audiences="$AUDIENCE")"

curl -sS -o /tmp/drain-queue-response.json -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST \
  https://intexuraos.cloud/internal/drain-queue

curl -sS -o /tmp/detect-zombies-response.json -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST \
  https://intexuraos.cloud/internal/code/detect-zombies

curl -sS -o /tmp/blocked-internal-api-response.txt -w "%{http_code}\n" \
  -X POST \
  https://intexuraos.cloud/api/code/internal/webhooks/task-complete
```

Manual live checks:

- [ ] Confirm `/api/code/internal/...` still returns 404 in prod.
- [ ] Confirm generated prod worker webhook URLs use `/internal/...`.
- [ ] Confirm `/internal/drain-queue` returns 2xx from scheduler.
- [ ] Confirm `/internal/code/detect-zombies` returns 2xx from scheduler.
- [ ] Create or use a controlled canary queued task for each worker family:
  - Codex worker.
  - Claude worker.
  - API-key-backed provider worker if available.
- [ ] Temporarily simulate missing auth in tests, not production, and prove API/UI/WhatsApp blockers work.
- [ ] In production, verify real blocker display only from actual safe conditions, not by disabling live workers.

Evidence required before completion:

- Test output from targeted suites.
- `pnpm run ci:tracked` success.
- Terraform validate success.
- Cloud Scheduler logs showing drain queue and zombie sweep no longer returning 5xx.
- Firestore/API evidence that the original task is no longer stale or has an explicit recovered status.
- Screenshot or test output proving the queue page renders active dispatch system statuses.
- WhatsApp notifier test output proving deduplication and message content.

## Risk Controls

- Do not change nginx to allow `/api/code/internal/...`; that path is intentionally blocked.
- Do not make workers depend on their static local `INTEXURAOS_CODE_AGENT_URL` for task-scoped callbacks.
- Do not classify missing health fields as healthy.
- Do not spam WhatsApp on every scheduler tick.
- Do not manually mutate the stale task until callback retry and zombie recovery have been tested.
- Do not bypass changed SSH host-key warnings without verifying the host identity first.
- Do not implement only Codex handling; every worker family must be represented in shared capability tests.

## Plan Review

Self-review checklist for the implementing agent:

- [ ] Root cause evidence distinguishes the original queued failure from the current stale-dispatched failure.
- [ ] Endpoint changes are explicit.
- [ ] Callback URL fixes address both new tasks and existing pending retry records.
- [ ] Dispatch status applies to Codex, Claude, and provider-backed workers.
- [ ] User-visible status and WhatsApp notification are both covered.
- [ ] Zombie sweep recovery is verified directly.
- [ ] Scheduler monitoring covers the paths that failed before the application was reached.
- [ ] Tests fail before implementation and prove the behavior after implementation.
- [ ] Live verification is specific enough to detect another queue-drain-only false positive.
