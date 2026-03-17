# Cron Agent Service — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a new `cron-agent` service that manages user-defined recurring schedules described in human language, executes them by calling other IntexuraOS service APIs on schedule, logs all execution events, and provides a web UI for managing schedules and viewing execution logs.

**Architecture:** A new Fastify app (`apps/cron-agent`) owns two Firestore collections (`cron_schedules`, `cron_executions`). Cloud Scheduler calls `POST /internal/tick` every minute. The tick handler evaluates all active schedules against current time, and for each due schedule, executes the configured action by calling the target service's API via `internal-clients`. An LLM (Gemini Flash) converts human-language schedule descriptions into cron expressions at schedule creation time. The web app (`apps/web`) adds a "Cron Agent" sidebar section with two views: Schedules list and Executions log, following the same patterns as Code Tasks.

**Tech Stack:** Fastify, TypeScript strict mode, Firestore, Cloud Scheduler, Gemini Flash (cron parsing), TailwindCSS, React 18, Vitest, Lucide icons

---

## Endpoint Changes

### cron-agent (NEW service — `apps/cron-agent`)

**Created:**
- `GET /health` — Health check
- `POST /internal/tick` — Cloud Scheduler tick (every minute), evaluates and executes due schedules
- `GET /schedules` — List all schedules (JWT auth, paginated)
- `POST /schedules` — Create a new schedule (JWT auth)
- `GET /schedules/:id` — Get schedule details (JWT auth)
- `PATCH /schedules/:id` — Update a schedule (JWT auth)
- `DELETE /schedules/:id` — Soft-delete a schedule (JWT auth)
- `POST /schedules/:id/trigger` — Manually trigger a schedule (JWT auth)
- `GET /executions` — List executions with optional schedule filter (JWT auth, paginated)
- `GET /executions/:id` — Get execution details (JWT auth)

### web app
**Modified:** None (new pages only, existing routes unchanged)
**Unchanged:** All existing routes

---

## Firestore Collections

### `cron_schedules` (owner: cron-agent)
```typescript
interface CronSchedule {
  id: string;                        // auto-generated
  userId: string;                    // Auth0 user ID
  name: string;                      // human-readable name
  description: string;               // human-language schedule description (e.g. "every minute check if...")
  cronExpression: string;            // parsed cron expression (e.g. "* * * * *")
  timezone: string;                  // IANA timezone (default: "UTC")
  action: {
    type: 'http';                    // extensible action type
    serviceUrl: string;              // target service base URL env var name (e.g. "INTEXURAOS_CODE_AGENT_URL")
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;                    // endpoint path (e.g. "/internal/drain-queue")
    headers?: Record<string, string>;
    body?: unknown;
  };
  status: 'active' | 'paused' | 'deleted';
  lastExecutedAt: string | null;     // ISO timestamp
  nextExecutionAt: string | null;    // ISO timestamp (precomputed)
  executionCount: number;
  failureCount: number;
  createdAt: string;                 // ISO timestamp
  updatedAt: string;                 // ISO timestamp
}
```

### `cron_executions` (owner: cron-agent)
```typescript
interface CronExecution {
  id: string;                        // auto-generated
  scheduleId: string;                // reference to cron_schedules
  scheduleName: string;              // denormalized for list display
  userId: string;                    // Auth0 user ID
  status: 'running' | 'success' | 'failure' | 'skipped';
  trigger: 'scheduled' | 'manual';  // how it was triggered
  startedAt: string;                 // ISO timestamp
  completedAt: string | null;        // ISO timestamp
  durationMs: number | null;
  request: {
    method: string;
    url: string;
    body?: unknown;
  };
  response: {
    statusCode: number;
    body?: unknown;
  } | null;
  error: string | null;             // error message if failed
  createdAt: string;                // ISO timestamp
}
```

---

## Service URL & Port

- **Port (dev):** 8130 (next after chat-agent at 8129)
- **Env var name:** `INTEXURAOS_CRON_AGENT_URL`
- **Cloud Run service name:** `intexuraos-cron-agent`
- **Terraform service key:** `cron_agent`

---

## Subtask Contracts

This plan splits into **2 independent subtasks** by service boundary. Each subtask defines its input/output contract so agents can work in parallel without coordination.

### Subtask 1: cron-agent backend service (`apps/cron-agent`)

**Owns:** All backend code, Firestore collections, Terraform infrastructure, ecosystem config, `firestore-collections.json` updates, `packages/internal-clients` cron-agent client addition.

**API Contract (consumed by Subtask 2):**

```typescript
// GET /schedules?status=active,paused&limit=50&cursor=xxx
// Response:
interface ListSchedulesResponse {
  schedules: CronSchedule[];
  nextCursor?: string;
  total: number;
}

// POST /schedules
// Request:
interface CreateScheduleRequest {
  name: string;
  description: string;          // human language, LLM converts to cron
  action: CronSchedule['action'];
  timezone?: string;            // defaults to "UTC"
}
// Response: CronSchedule

// GET /schedules/:id
// Response: CronSchedule

// PATCH /schedules/:id
// Request: Partial<Pick<CronSchedule, 'name' | 'description' | 'status' | 'action' | 'timezone'>>
// Response: CronSchedule

// DELETE /schedules/:id (soft delete — sets status to 'deleted')
// Response: { success: true }

// POST /schedules/:id/trigger
// Response: CronExecution

// GET /executions?scheduleId=xxx&status=success,failure&limit=50&cursor=xxx
// Response:
interface ListExecutionsResponse {
  executions: CronExecution[];
  nextCursor?: string;
  total: number;
}

// GET /executions/:id
// Response: CronExecution

// POST /internal/tick (Cloud Scheduler, OIDC or X-Internal-Auth)
// Response: { executed: number; skipped: number; errors: number }
```

All public endpoints use `Authorization: Bearer <JWT>` (Auth0). All responses wrapped in `{ success: true, data: ... }` or `{ success: false, error: { code, message } }`.

### Subtask 2: web app UI (`apps/web`)

**Owns:** All frontend code — sidebar changes, new pages, hooks, API service layer, types.

**Depends on (contract only, no code dependency):** The API contract defined above. The web app calls the cron-agent service at `config.cronAgentUrl` (configured via `INTEXURAOS_CRON_AGENT_URL` env var or dev proxy `/api/cron-agent`).

**UI Pages:**
1. **Schedules List** (`/#/cron-agent`) — Table of schedules with status filters, create button, inline pause/resume actions
2. **Schedule Detail** (`/#/cron-agent/:id`) — View/edit schedule, recent executions for this schedule, manual trigger button
3. **New Schedule** (`/#/cron-agent/new`) — Form: name, human-language description, action config (service, method, path, body)
4. **Executions Log** (`/#/cron-agent/executions`) — Filterable log of all executions across schedules, status indicators, duration

**Sidebar:** "Cron Agent" collapsible section between "Code Tasks" and "Research Studio", with subitems: "Schedules" and "Executions"

---

## Subtask 1: cron-agent Backend Service

### Task 1: Project Scaffolding

**Files:**
- Create: `apps/cron-agent/package.json`
- Create: `apps/cron-agent/tsconfig.json`
- Create: `apps/cron-agent/vitest.config.ts`
- Create: `apps/cron-agent/Dockerfile`
- Create: `apps/cron-agent/.dockerignore`
- Create: `apps/cron-agent/src/index.ts`
- Create: `apps/cron-agent/src/config.ts`
- Create: `apps/cron-agent/src/services.ts`
- Create: `apps/cron-agent/src/server.ts`
- Modify: `firestore-collections.json` — add `cron_schedules` and `cron_executions`
- Modify: `ecosystem.config.cjs` — add cron-agent service on port 8130

- [ ] **Step 1: Scaffold package.json**

Copy structure from an existing app (e.g., `apps/bookmarks-agent/package.json`). Set name to `@intexuraos/cron-agent`. Include dependencies: `fastify`, `@intexuraos/common-core`, `@intexuraos/common-http`, `@intexuraos/http-server`, `@intexuraos/http-contracts`, `@intexuraos/infra-firestore`, `@intexuraos/infra-sentry`, `@intexuraos/infra-gemini`, `cron-parser` (for cron expression parsing and next-execution calculation).

- [ ] **Step 2: Scaffold tsconfig.json, vitest.config.ts, Dockerfile, .dockerignore**

Copy from an existing simple app like `apps/bookmarks-agent`. Adjust paths.

- [ ] **Step 3: Create config.ts**

```typescript
export interface CronAgentConfig {
  port: number;
  gcpProjectId: string;
  internalAuthToken: string;
  authAudience: string;
  serviceUrls: Record<string, string>; // map of env var name → URL
  geminiApiKey: string;
}

export function loadConfig(): CronAgentConfig {
  // Read from INTEXURAOS_* env vars
  // serviceUrls populated from all INTEXURAOS_*_URL env vars
}
```

- [ ] **Step 4: Create services.ts with DI container**

Follow the `initServices` / `getServices` / `setServices` / `resetServices` pattern from code-agent. ServiceContainer includes: `firestore`, `logger`, `scheduleRepo`, `executionRepo`, `cronParser` (use case), `tickHandler` (use case), `scheduleManager` (use case).

- [ ] **Step 5: Create server.ts with route registration**

Fastify server with `registerCoreSchemas`, health check, and route registration stubs.

- [ ] **Step 6: Create index.ts entry point**

```typescript
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_GEMINI_APP_API_KEY',
];
const PRODUCTION_ONLY_ENV = [
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_CODE_AGENT_URL',
];
```

Validate env, load config, init services, build server, listen on port 8080.

- [ ] **Step 7: Update firestore-collections.json**

Add:
```json
"cron_schedules": {
  "owner": "cron-agent",
  "description": "User-defined recurring schedules with cron expressions and action definitions"
},
"cron_executions": {
  "owner": "cron-agent",
  "description": "Execution log entries for cron schedule runs"
}
```

- [ ] **Step 8: Update ecosystem.config.cjs**

Add `cron-agent` entry on port 8130 in Phase 1 (independent). Add `INTEXURAOS_CRON_AGENT_URL: 'http://localhost:8130'` to `COMMON_SERVICE_URLS`.

- [ ] **Step 9: Run build to verify scaffolding compiles**

Run: `cd /repo && pnpm install && pnpm --filter @intexuraos/cron-agent build`

- [ ] **Step 10: Commit**

```bash
git add apps/cron-agent/ firestore-collections.json ecosystem.config.cjs
git commit -m "feat(cron-agent): scaffold new service with DI, config, and Firestore collections"
```

### Task 2: Firestore Repositories

**Files:**
- Create: `apps/cron-agent/src/domain/types.ts`
- Create: `apps/cron-agent/src/domain/ports/schedule-repository.ts`
- Create: `apps/cron-agent/src/domain/ports/execution-repository.ts`
- Create: `apps/cron-agent/src/infra/firestore-schedule-repository.ts`
- Create: `apps/cron-agent/src/infra/firestore-execution-repository.ts`
- Create: `apps/cron-agent/src/infra/__tests__/firestore-schedule-repository.test.ts`
- Create: `apps/cron-agent/src/infra/__tests__/firestore-execution-repository.test.ts`

- [ ] **Step 1: Define domain types in `domain/types.ts`**

Export `CronSchedule`, `CronExecution`, `CreateScheduleInput`, `UpdateScheduleInput`, `CreateExecutionInput`, status union types — matching the Firestore schema defined above.

- [ ] **Step 2: Define repository port interfaces**

`ScheduleRepository`: `create`, `findById`, `findByUserId` (paginated, status filter), `update`, `findDueSchedules(now: Date)` (returns active schedules where `nextExecutionAt <= now`).

`ExecutionRepository`: `create`, `findById`, `findByUserId` (paginated, scheduleId + status filters), `findByScheduleId` (paginated).

- [ ] **Step 3: Write failing tests for ScheduleRepository**

Use in-memory Firestore fake (follow existing test patterns with `setServices`). Test: create, findById returns created, findByUserId with pagination and status filter, findDueSchedules returns only due active schedules, update changes fields.

- [ ] **Step 4: Implement FirestoreScheduleRepository**

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Write failing tests for ExecutionRepository**

Test: create, findById, findByUserId with filters, findByScheduleId pagination.

- [ ] **Step 7: Implement FirestoreExecutionRepository**

- [ ] **Step 8: Run tests, verify pass**

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(cron-agent): add Firestore repositories for schedules and executions"
```

### Task 3: Cron Expression Parsing Use Case

**Files:**
- Create: `apps/cron-agent/src/domain/use-cases/parse-schedule.ts`
- Create: `apps/cron-agent/src/domain/use-cases/__tests__/parse-schedule.test.ts`
- Create: `apps/cron-agent/src/prompts/parse-schedule-prompt.ts`

- [ ] **Step 1: Create the prompt for LLM cron parsing**

```typescript
import { PromptBuilder } from '@intexuraos/llm-prompts';

export const parseSchedulePrompt = new PromptBuilder({
  name: 'parse-schedule',
  version: '1.0.0',
  system: `You convert human-language schedule descriptions into standard cron expressions (5 fields: minute hour day-of-month month day-of-week). Return ONLY valid JSON: {"cronExpression": "<expression>", "humanSummary": "<readable summary>"}. If the description cannot be converted, return {"error": "<reason>"}.`,
});
```

- [ ] **Step 2: Write failing tests for parse-schedule use case**

Test cases:
1. "every minute" → `* * * * *`
2. "every 5 minutes" → `*/5 * * * *`
3. "every hour at minute 0" → `0 * * * *`
4. "every day at 3am UTC" → `0 3 * * *`
5. "every weekday at 9am" → `0 9 * * 1-5`
6. Invalid/nonsensical input → returns error Result
7. LLM returns invalid cron → returns error Result (validate with cron-parser)

Use a fake LLM client that returns predetermined responses.

- [ ] **Step 3: Implement parse-schedule use case**

```typescript
interface ParseScheduleDeps {
  logger: Logger;
  geminiClient: GeminiClient; // or LLM interface
}

export async function parseSchedule(
  deps: ParseScheduleDeps,
  description: string,
): Promise<Result<{ cronExpression: string; humanSummary: string }, ParseError>> {
  // 1. Call LLM with prompt
  // 2. Parse JSON response
  // 3. Validate cronExpression with cron-parser
  // 4. Compute humanSummary if not provided
  // 5. Return Result
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cron-agent): add LLM-based schedule parsing use case"
```

### Task 4: Tick Handler Use Case

**Files:**
- Create: `apps/cron-agent/src/domain/use-cases/handle-tick.ts`
- Create: `apps/cron-agent/src/domain/use-cases/__tests__/handle-tick.test.ts`
- Create: `apps/cron-agent/src/domain/use-cases/execute-schedule.ts`
- Create: `apps/cron-agent/src/domain/use-cases/__tests__/execute-schedule.test.ts`

- [ ] **Step 1: Write failing tests for execute-schedule**

Test cases:
1. Successful execution — creates execution record with status `success`, response captured
2. HTTP error — creates execution record with status `failure`, error message captured
3. Network timeout — creates execution record with status `failure`
4. Updates schedule `lastExecutedAt`, `nextExecutionAt`, `executionCount`
5. On failure, increments schedule `failureCount`

Use fake HTTP client (nock) and in-memory repos.

- [ ] **Step 2: Implement execute-schedule**

```typescript
interface ExecuteScheduleDeps {
  logger: Logger;
  executionRepo: ExecutionRepository;
  scheduleRepo: ScheduleRepository;
  internalAuthToken: string;
  serviceUrls: Record<string, string>;
}

export async function executeSchedule(
  deps: ExecuteScheduleDeps,
  schedule: CronSchedule,
  trigger: 'scheduled' | 'manual',
): Promise<Result<CronExecution, ExecuteError>>
```

Resolves the service URL from `schedule.action.serviceUrl` env var name → actual URL. Makes HTTP call with `X-Internal-Auth`. Records execution.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Write failing tests for handle-tick**

Test cases:
1. No due schedules → returns `{ executed: 0, skipped: 0, errors: 0 }`
2. One due schedule → executes it, returns `{ executed: 1 }`
3. Multiple due schedules → executes all
4. Schedule execution fails → counts as error, continues with next
5. Skips schedules already running (guard against overlapping ticks via execution check)

- [ ] **Step 5: Implement handle-tick**

```typescript
export async function handleTick(deps: HandleTickDeps): Promise<TickResult> {
  const now = new Date();
  const dueSchedules = await deps.scheduleRepo.findDueSchedules(now);
  // For each: executeSchedule, then update nextExecutionAt using cron-parser
  // Return summary counts
}
```

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(cron-agent): add tick handler and schedule execution use cases"
```

### Task 5: Schedule Management Use Case

**Files:**
- Create: `apps/cron-agent/src/domain/use-cases/manage-schedule.ts`
- Create: `apps/cron-agent/src/domain/use-cases/__tests__/manage-schedule.test.ts`

- [ ] **Step 1: Write failing tests for schedule CRUD**

Test cases:
1. Create schedule — calls parseSchedule, stores with computed `nextExecutionAt`, status `active`
2. Create with invalid description — returns parse error
3. Get schedule by ID — returns schedule if userId matches
4. Get schedule by ID — returns NOT_FOUND if wrong user
5. List schedules — returns paginated, filtered by status
6. Update schedule name — updates only name, keeps cron
7. Update schedule description — re-parses cron expression
8. Pause schedule — sets status to `paused`, clears `nextExecutionAt`
9. Resume schedule — sets status to `active`, recomputes `nextExecutionAt`
10. Delete schedule — soft-deletes (status `deleted`)

- [ ] **Step 2: Implement manage-schedule**

```typescript
interface ManageScheduleDeps {
  logger: Logger;
  scheduleRepo: ScheduleRepository;
  parseSchedule: typeof parseSchedule;
}

export function createScheduleManager(deps: ManageScheduleDeps) {
  return {
    create(userId: string, input: CreateScheduleInput): Promise<Result<CronSchedule, ScheduleError>>,
    getById(userId: string, id: string): Promise<Result<CronSchedule, ScheduleError>>,
    list(userId: string, options: ListOptions): Promise<Result<ListSchedulesResponse, ScheduleError>>,
    update(userId: string, id: string, input: UpdateScheduleInput): Promise<Result<CronSchedule, ScheduleError>>,
    delete(userId: string, id: string): Promise<Result<void, ScheduleError>>,
    trigger(userId: string, id: string): Promise<Result<CronExecution, ScheduleError>>,
  };
}
```

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cron-agent): add schedule management use case with CRUD and manual trigger"
```

### Task 6: HTTP Routes

**Files:**
- Create: `apps/cron-agent/src/routes/schedule-routes.ts`
- Create: `apps/cron-agent/src/routes/execution-routes.ts`
- Create: `apps/cron-agent/src/routes/internal-routes.ts`
- Create: `apps/cron-agent/src/routes/index.ts`
- Create: `apps/cron-agent/src/routes/__tests__/schedule-routes.test.ts`
- Create: `apps/cron-agent/src/routes/__tests__/execution-routes.test.ts`
- Create: `apps/cron-agent/src/routes/__tests__/internal-routes.test.ts`

- [ ] **Step 1: Write failing tests for schedule routes**

Use `app.inject()` pattern. Test:
1. `GET /schedules` — 200 with list
2. `GET /schedules` — 401 without auth
3. `POST /schedules` — 201 creates schedule
4. `POST /schedules` — 400 missing required fields
5. `GET /schedules/:id` — 200 returns schedule
6. `GET /schedules/:id` — 404 not found
7. `PATCH /schedules/:id` — 200 updates
8. `DELETE /schedules/:id` — 200 soft-deletes
9. `POST /schedules/:id/trigger` — 200 triggers execution

- [ ] **Step 2: Implement schedule-routes.ts**

Each route: `logIncomingRequest`, validate JWT auth, extract userId, call schedule manager, return `reply.ok(data)` or `reply.fail(code, message)`. Include Fastify JSON schemas for request/response validation.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Write failing tests for execution routes**

1. `GET /executions` — 200 with paginated list
2. `GET /executions?scheduleId=xxx` — filters by schedule
3. `GET /executions/:id` — 200 returns execution
4. `GET /executions/:id` — 404 not found

- [ ] **Step 5: Implement execution-routes.ts**

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Write failing tests for internal routes**

1. `POST /internal/tick` — 200 with OIDC auth (Cloud Scheduler)
2. `POST /internal/tick` — 200 with X-Internal-Auth
3. `POST /internal/tick` — 401 without auth
4. Verify tick handler is called and response shape is correct

- [ ] **Step 8: Implement internal-routes.ts**

Follow the exact OIDC + X-Internal-Auth dual-auth pattern from code-agent's drain-queue endpoint.

- [ ] **Step 9: Run tests, verify pass**

- [ ] **Step 10: Wire routes into server.ts and services.ts**

Update `initServices` to construct all repositories and use cases. Register all route files in `server.ts`.

- [ ] **Step 11: Run full test suite**

Run: `pnpm --filter @intexuraos/cron-agent test`

- [ ] **Step 12: Commit**

```bash
git commit -m "feat(cron-agent): add HTTP routes for schedules, executions, and internal tick"
```

### Task 7: Terraform & Infrastructure

**Files:**
- Modify: `terraform/environments/dev/main.tf` — add cron-agent Cloud Run service and Cloud Scheduler job
- Modify: `terraform/environments/dev/variables.tf` (if needed for new vars)

- [ ] **Step 1: Add cron-agent to services locals**

```hcl
cron_agent = {
  name      = "intexuraos-cron-agent"
  app_path  = "apps/cron-agent"
  port      = 8080
  min_scale = 0
  max_scale = 1
}
```

- [ ] **Step 2: Add Cloud Run module for cron-agent**

Follow existing service module pattern. Include env vars: `INTEXURAOS_GCP_PROJECT_ID`, `INTEXURAOS_INTERNAL_AUTH_TOKEN`, `INTEXURAOS_AUTH_AUDIENCE`, `INTEXURAOS_GEMINI_APP_API_KEY`, `INTEXURAOS_CODE_AGENT_URL`, and other service URLs as needed.

- [ ] **Step 3: Add Cloud Scheduler job**

```hcl
resource "google_cloud_scheduler_job" "cron_agent_tick" {
  name        = "intexuraos-cron-agent-tick-${var.environment}"
  description = "Trigger cron-agent tick every minute to evaluate due schedules"
  schedule    = "*/1 * * * *"
  time_zone   = "UTC"
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "${module.cron_agent.service_url}/internal/tick"
    oidc_token {
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = module.cron_agent.service_url
    }
  }

  retry_config {
    retry_count = 0
  }
}
```

- [ ] **Step 4: Add IAM binding for Cloud Scheduler → cron-agent**

```hcl
resource "google_cloud_run_service_iam_member" "scheduler_invokes_cron_agent" {
  project  = var.project_id
  location = var.region
  service  = local.services.cron_agent.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_scheduler.email}"
}
```

- [ ] **Step 5: Commit**

```bash
git commit -m "infra(cron-agent): add Cloud Run service and Cloud Scheduler tick job"
```

### Task 8: CI Verification

- [ ] **Step 1: Build all packages**

Run: `pnpm install && pnpm build`

- [ ] **Step 2: Run workspace verification**

Run: `pnpm run verify:workspace:tracked -- cron-agent`

- [ ] **Step 3: Run full CI**

Run: `pnpm run ci:tracked`

- [ ] **Step 4: Fix any issues found**

- [ ] **Step 5: Final commit if fixes needed**

---

## Subtask 2: Web App UI

### Task 1: Types and API Service Layer

**Files:**
- Create: `apps/web/src/types/cronAgent.ts`
- Modify: `apps/web/src/types/index.ts` — re-export new types
- Create: `apps/web/src/services/cronAgentApi.ts`
- Modify: `apps/web/src/config.ts` — add `cronAgentUrl`

- [ ] **Step 1: Add cron agent types**

```typescript
export interface CronSchedule {
  id: string;
  userId: string;
  name: string;
  description: string;
  cronExpression: string;
  timezone: string;
  action: {
    type: 'http';
    serviceUrl: string;
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  status: 'active' | 'paused' | 'deleted';
  lastExecutedAt: string | null;
  nextExecutionAt: string | null;
  executionCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export type CronScheduleStatus = CronSchedule['status'];

export interface CronExecution {
  id: string;
  scheduleId: string;
  scheduleName: string;
  userId: string;
  status: 'running' | 'success' | 'failure' | 'skipped';
  trigger: 'scheduled' | 'manual';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  request: { method: string; url: string; body?: unknown };
  response: { statusCode: number; body?: unknown } | null;
  error: string | null;
  createdAt: string;
}

export type CronExecutionStatus = CronExecution['status'];

export interface ListSchedulesResponse {
  schedules: CronSchedule[];
  nextCursor?: string;
  total: number;
}

export interface ListExecutionsResponse {
  executions: CronExecution[];
  nextCursor?: string;
  total: number;
}

export interface CreateScheduleRequest {
  name: string;
  description: string;
  action: CronSchedule['action'];
  timezone?: string;
}
```

- [ ] **Step 2: Add cronAgentUrl to config.ts**

Add `cronAgentUrl` to `AppConfig` interface and `getConfig()`:
```typescript
cronAgentUrl: getServiceUrl('INTEXURAOS_CRON_AGENT_URL', '/api/cron-agent'),
```

- [ ] **Step 3: Create cronAgentApi.ts service layer**

Follow `codeAgentApi.ts` pattern exactly:
```typescript
export async function listSchedules(accessToken: string, options?: { status?: CronScheduleStatus[]; limit?: number; cursor?: string }): Promise<ListSchedulesResponse>
export async function createSchedule(accessToken: string, request: CreateScheduleRequest): Promise<CronSchedule>
export async function getSchedule(accessToken: string, id: string): Promise<CronSchedule>
export async function updateSchedule(accessToken: string, id: string, updates: Partial<CreateScheduleRequest & { status: CronScheduleStatus }>): Promise<CronSchedule>
export async function deleteSchedule(accessToken: string, id: string): Promise<void>
export async function triggerSchedule(accessToken: string, id: string): Promise<CronExecution>
export async function listExecutions(accessToken: string, options?: { scheduleId?: string; status?: CronExecutionStatus[]; limit?: number; cursor?: string }): Promise<ListExecutionsResponse>
export async function getExecution(accessToken: string, id: string): Promise<CronExecution>
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): add cron agent types and API service layer"
```

### Task 2: React Hooks

**Files:**
- Create: `apps/web/src/hooks/useCronSchedules.ts`
- Create: `apps/web/src/hooks/useCronExecutions.ts`
- Modify: `apps/web/src/hooks/index.ts` — re-export new hooks

- [ ] **Step 1: Create useCronSchedules hook**

Follow `useCodeTasks` pattern:
```typescript
export function useCronSchedules(options?: { status?: CronScheduleStatus[] }): {
  schedules: CronSchedule[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: (showLoading?: boolean) => Promise<void>;
  createSchedule: (request: CreateScheduleRequest) => Promise<string>;
  updateSchedule: (id: string, updates: Partial<CreateScheduleRequest>) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  triggerSchedule: (id: string) => Promise<void>;
}
```

Uses `useAuth()` for `getAccessToken`, `isMountedRef` pattern, cursor-based pagination, merge-based refresh for stable references.

- [ ] **Step 2: Create useCronExecutions hook**

```typescript
export function useCronExecutions(options?: { scheduleId?: string; status?: CronExecutionStatus[] }): {
  executions: CronExecution[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: (showLoading?: boolean) => Promise<void>;
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): add useCronSchedules and useCronExecutions hooks"
```

### Task 3: Sidebar Navigation

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Add Cron Agent sidebar section**

Add between Code Tasks and Research Studio sections:
1. Import `Clock`, `Activity` from `lucide-react`
2. Add `cronAgentItems` array: `[{ to: '/cron-agent', label: 'Schedules', icon: Clock }, { to: '/cron-agent/executions', label: 'Executions', icon: Activity }]`
3. Add `isCronAgentOpen` state with localStorage persistence (initialized from `window.location.hash.includes('/cron-agent')`)
4. Add auto-expand `useEffect` for `/cron-agent` routes
5. Add collapsible section UI — copy exact Code Tasks pattern with `Clock` icon and "Cron Agent" label

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): add Cron Agent section to sidebar navigation"
```

### Task 4: Schedules List Page

**Files:**
- Create: `apps/web/src/pages/cron-agent/CronSchedulesPage.tsx`
- Create: `apps/web/src/pages/cron-agent/index.ts`
- Modify: `apps/web/src/pages/index.ts` — re-export

- [ ] **Step 1: Create CronSchedulesPage**

Follow `CodeTasksPage` styling and structure:
- Layout with sidebar
- Page header: "Schedules" title with count + "New Schedule" button (links to `/cron-agent/new`)
- Filter pills: Active (default), Paused, All
- Table/card list showing: name, cron expression (human-readable), next execution time (relative), last executed (relative), execution count, failure count, status badge
- Status badges: `active` = green dot, `paused` = yellow dot
- Row actions: Pause/Resume toggle, Trigger now, Delete
- Click row → navigate to `/cron-agent/:id`
- Empty state: "No schedules yet. Create your first schedule."
- localStorage for filter/sort persistence

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): add Schedules list page for Cron Agent"
```

### Task 5: Schedule Detail & Create Pages

**Files:**
- Create: `apps/web/src/pages/cron-agent/CronScheduleViewPage.tsx`
- Create: `apps/web/src/pages/cron-agent/CronScheduleNewPage.tsx`

- [ ] **Step 1: Create CronScheduleViewPage**

Shows:
- Schedule details: name, description (human language), parsed cron expression, timezone, status, action config
- Edit inline (name, description — re-triggers LLM parse on description change)
- Pause/Resume/Delete action buttons
- "Trigger Now" button
- Recent executions list (last 20, using `useCronExecutions({ scheduleId })`)
- Each execution row: timestamp, status badge, duration, trigger type

- [ ] **Step 2: Create CronScheduleNewPage**

Form fields:
- Name (text input, required)
- Description (textarea, required — placeholder: "Describe when this should run, e.g. 'every 5 minutes check if there is a running code task'")
- Action config:
  - Service (dropdown of known services from config)
  - Method (GET/POST/PATCH/DELETE dropdown)
  - Path (text input)
  - Request body (optional JSON textarea)
- Timezone (dropdown, default UTC)
- Submit → `createSchedule` → navigate to `/cron-agent/:id`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): add Schedule detail view and create form pages"
```

### Task 6: Executions Log Page

**Files:**
- Create: `apps/web/src/pages/cron-agent/CronExecutionsPage.tsx`

- [ ] **Step 1: Create CronExecutionsPage**

Follow Code Tasks list styling:
- Layout with sidebar
- Page header: "Executions" title with count
- Filter pills: All, Success, Failure, Running, Skipped
- Optional schedule filter dropdown
- Table showing: timestamp (relative), schedule name (link to schedule), status badge, trigger type (scheduled/manual), duration, response status code
- Click row → expand inline to show request/response details and error message (if any)
- Auto-refresh every 30 seconds
- Status badges: `success` = green, `failure` = red, `running` = blue pulse, `skipped` = gray

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): add Executions log page for Cron Agent"
```

### Task 7: Routing & Vite Proxy

**Files:**
- Modify: `apps/web/src/App.tsx` — add routes
- Modify: `apps/web/vite.config.ts` — add dev proxy for cron-agent

- [ ] **Step 1: Add routes to App.tsx**

```typescript
import { CronSchedulesPage, CronScheduleViewPage, CronScheduleNewPage, CronExecutionsPage } from '@/pages';

// Inside AppRoutes, add:
<Route path="/cron-agent" element={<ProtectedRoute><CronSchedulesPage /></ProtectedRoute>} />
<Route path="/cron-agent/new" element={<ProtectedRoute><CronScheduleNewPage /></ProtectedRoute>} />
<Route path="/cron-agent/executions" element={<ProtectedRoute><CronExecutionsPage /></ProtectedRoute>} />
<Route path="/cron-agent/:id" element={<ProtectedRoute><CronScheduleViewPage /></ProtectedRoute>} />
```

- [ ] **Step 2: Add Vite proxy**

```typescript
'/api/cron-agent': {
  target: 'http://localhost:8130',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/cron-agent/, ''),
},
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): add routing and Vite proxy for Cron Agent pages"
```

### Task 8: CI Verification

- [ ] **Step 1: Build web app**

Run: `pnpm --filter @intexuraos/web build`

- [ ] **Step 2: Run full CI**

Run: `pnpm run ci:tracked`

- [ ] **Step 3: Fix any issues**

- [ ] **Step 4: Final commit if needed**
