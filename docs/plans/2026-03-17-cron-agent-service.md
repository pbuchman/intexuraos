# Cron Agent Service — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a new `cron-agent` service that manages user-defined recurring schedules described in human language, executes them as agentic tool-calling workflows on schedule, logs all execution events, and provides a web UI for managing schedules and viewing execution logs.

**Architecture:** A new Fastify app (`apps/cron-agent`) owns two Firestore collections (`cron_schedules`, `cron_executions`). Cloud Scheduler calls `POST /internal/cron/tick` every minute. The tick handler evaluates all active schedules against current time, and for each due schedule, executes the configured action using an LLM tool-calling agent. Actions are NOT simple HTTP calls — they are step-based sequences (including conditionals) described in human language and executed by a Gemini tool-calling agent. Tools are dynamically generated from each allowlisted service's OpenAPI spec (`/openapi.json`), filtered to `/internal/*` endpoints. Each service's tools are namespaced (e.g., `code_agent__get_running_tasks`) to avoid collisions. At schedule creation time, an LLM also converts the human-language schedule description into a cron expression. The web app (`apps/web`) adds a "Cron Agent" sidebar section with two views: Schedules list and Executions log, following the same patterns as Code Tasks. All routes use the `/cron/*` prefix.

**Tech Stack:** Fastify, TypeScript strict mode, Firestore, Cloud Scheduler, Gemini Flash (cron parsing + tool-calling agent), `@intexuraos/llm-contract` `ToolDefinition`/`ToolCallingClient`, TailwindCSS, React 18, Vitest, Lucide icons

---

## Endpoint Changes

### cron-agent (NEW service — `apps/cron-agent`)

**Created:**
- `GET /health` — Health check
- `GET /openapi.json` — OpenAPI spec (for api-docs-hub)
- `POST /internal/cron/tick` — Cloud Scheduler tick (every minute), evaluates and executes due schedules
- `GET /internal/cron/services` — List allowlisted services and their available tools (for UI dropdown)
- `GET /cron/schedules` — List all schedules (JWT auth, paginated)
- `POST /cron/schedules` — Create a new schedule (JWT auth)
- `GET /cron/schedules/:id` — Get schedule details (JWT auth)
- `PATCH /cron/schedules/:id` — Update a schedule (JWT auth)
- `DELETE /cron/schedules/:id` — Soft-delete a schedule (JWT auth)
- `POST /cron/schedules/:id/trigger` — Manually trigger a schedule (JWT auth)
- `GET /cron/executions` — List executions with optional schedule filter (JWT auth, paginated)
- `GET /cron/executions/:id` — Get execution details (JWT auth)

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
    services: string[];              // allowlisted service keys whose tools are available (e.g. ["code-agent"])
    instruction: string;             // human-language action description — step-based, may include conditionals
                                     // e.g. "check if any code task is running. if not, pick the oldest executable and dispatch it"
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
  toolCalls: Array<{                 // ordered log of all tool calls the agent made
    toolName: string;                // namespaced tool name (e.g. "code_agent__get_running_tasks")
    args: Record<string, unknown>;   // arguments passed to the tool
    result: string;                  // JSON string returned by the tool
    durationMs: number;
  }>;
  agentResponse: string | null;      // final LLM text response summarizing what was done
  tokenUsage: {                      // LLM usage for cost tracking
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
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

**Owns:** All backend code, Firestore collections, Firestore composite index migrations, Terraform infrastructure (including `terraform apply`), ecosystem config, `firestore-collections.json` updates, OpenAPI spec endpoint, tool generation from service OpenAPI specs.

**API Contract (consumed by Subtask 2):**

```typescript
// GET /cron/schedules?status=active,paused&limit=50&cursor=xxx
// Response:
interface ListSchedulesResponse {
  schedules: CronSchedule[];
  nextCursor?: string;
  total: number;
}

// POST /cron/schedules
// Request:
interface CreateScheduleRequest {
  name: string;
  description: string;              // human language, LLM converts to cron
  action: {
    services: string[];             // allowlisted service keys (e.g. ["code-agent"])
    instruction: string;            // human-language step sequence (e.g. "check running tasks, if none dispatch oldest")
  };
  timezone?: string;                // defaults to "UTC"
}
// Response: CronSchedule

// GET /cron/schedules/:id
// Response: CronSchedule

// PATCH /cron/schedules/:id
// Request: Partial<Pick<CronSchedule, 'name' | 'description' | 'status' | 'action' | 'timezone'>>
// Response: CronSchedule

// DELETE /cron/schedules/:id (soft delete — sets status to 'deleted')
// Response: { success: true }

// POST /cron/schedules/:id/trigger
// Response: CronExecution

// GET /cron/executions?scheduleId=xxx&status=success,failure&limit=50&cursor=xxx
// Response:
interface ListExecutionsResponse {
  executions: CronExecution[];
  nextCursor?: string;
  total: number;
}

// GET /cron/executions/:id
// Response: CronExecution

// GET /internal/cron/services
// Response: { services: Array<{ key: string; name: string; tools: Array<{ name: string; description: string }> }> }

// POST /internal/cron/tick (Cloud Scheduler, OIDC or X-Internal-Auth)
// Response: { executed: number; skipped: number; errors: number }
```

All public endpoints use `Authorization: Bearer <JWT>` (Auth0). All responses wrapped in `{ success: true, data: ... }` or `{ success: false, error: { code, message } }`.

### Subtask 2: web app UI (`apps/web`)

**Owns:** All frontend code — sidebar changes, new pages, hooks, API service layer, types.

**Depends on (contract only, no code dependency):** The API contract defined above. The web app calls the cron-agent service at `config.cronAgentUrl` (configured via `INTEXURAOS_CRON_AGENT_URL` env var or dev proxy `/api/cron-agent`).

**UI Pages:**
1. **Schedules List** (`/#/cron-agent`) — Table of schedules with status filters, create button, inline pause/resume actions
2. **Schedule Detail** (`/#/cron-agent/:id`) — View/edit schedule, recent executions for this schedule, manual trigger button
3. **New Schedule** (`/#/cron-agent/new`) — Form: name, human-language description, services selector (multi-select from available services), instruction textarea for step-based action
4. **Executions Log** (`/#/cron-agent/executions`) — Filterable log of all executions across schedules, expandable tool call details, agent response, token usage

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

Copy structure from an existing app (e.g., `apps/bookmarks-agent/package.json`). Set name to `@intexuraos/cron-agent`. Include dependencies: `fastify`, `@fastify/swagger` (for OpenAPI spec generation), `@intexuraos/common-core`, `@intexuraos/common-http`, `@intexuraos/http-server`, `@intexuraos/http-contracts`, `@intexuraos/infra-firestore`, `@intexuraos/infra-sentry`, `@intexuraos/infra-gemini`, `@intexuraos/llm-contract`, `@intexuraos/llm-prompts`, `cron-parser@^4.9.0` (for cron expression parsing and next-execution calculation — use the `cron-parser` npm package, not alternatives).

- [ ] **Step 2: Scaffold tsconfig.json, vitest.config.ts, Dockerfile, .dockerignore**

Copy from an existing simple app like `apps/bookmarks-agent`. Adjust paths.

- [ ] **Step 3: Create config.ts**

```typescript
export interface ServiceDefinition {
  key: string;                     // e.g. "code-agent"
  name: string;                    // human-readable: "Code Agent"
  url: string;                     // resolved from env var
  openapiUrl: string;              // e.g. "http://localhost:8128/openapi.json"
}

export interface CronAgentConfig {
  port: number;
  gcpProjectId: string;
  internalAuthToken: string;
  authAudience: string;
  authIssuer: string;
  authJwksUrl: string;
  sentryDsn: string;
  environment: string;
  allowedServices: ServiceDefinition[];  // allowlisted services whose tools can be used
  geminiApiKey: string;
}

export function loadConfig(): CronAgentConfig {
  // Read from INTEXURAOS_* env vars
  // port from PORT env var, default 8080
  // allowedServices built from known INTEXURAOS_*_URL env vars with fixed mapping:
  //   key → env var name → URL, openapiUrl = URL + "/openapi.json"
}
```

**Tool Generation Architecture:**
1. Each allowed service exposes `GET /openapi.json` (via `@fastify/swagger`, already exists in all services — see `api-docs-hub`)
2. At startup (and periodically), cron-agent fetches each service's OpenAPI spec
3. Filters to only `/internal/*` endpoints (these are the service's machine-callable capabilities)
4. Generates `ToolDefinition[]` from each endpoint:
   - **Tool name**: `{service_key}__{operationId}` (e.g., `code_agent__get_running_tasks`) — double underscore prevents collisions between services
   - **Description**: From OpenAPI `summary` + `description`
   - **Parameters**: From OpenAPI `parameters` + `requestBody` JSON Schema
   - **`run` callback**: Makes HTTP `{method} {service_url}{path}` with `X-Internal-Auth`, returns response body as JSON string
5. When executing a schedule, the agent receives only tools from `schedule.action.services`

**Important:** The `allowedServices` allowlist ensures only known services can have tools generated. The `action.services` array on each schedule further restricts which service tools are available for that specific execution — the LLM can only call tools from those listed services.

**Env var three-location rule (CLAUDE.md):** Every new env var must appear in: (1) `apps/cron-agent/src/index.ts` `REQUIRED_ENV` / `PRODUCTION_ONLY_ENV`, (2) `terraform/environments/dev/main.tf` Cloud Run module env block, (3) `ecosystem.config.cjs` env section. The `INTEXURAOS_CRON_AGENT_URL` env var must additionally be added to: (a) `ecosystem.config.cjs` `COMMON_SERVICE_URLS`, (b) `terraform/environments/dev/main.tf` in the web app module env block.

- [ ] **Step 4: Create services.ts with DI container**

Follow the `initServices` / `getServices` / `setServices` / `resetServices` pattern from code-agent. ServiceContainer includes: `firestore`, `logger`, `scheduleRepo`, `executionRepo`, `cronParser` (use case), `tickHandler` (use case), `scheduleManager` (use case), `toolRegistry` (service that fetches OpenAPI specs and generates `ToolDefinition[]`), `toolCallingClient` (`ToolCallingClient` from `@intexuraos/infra-gemini`), `actionExecutor` (use case that runs agent with tools for a schedule).

- [ ] **Step 5: Create server.ts with route registration**

Fastify server with `registerCoreSchemas`, health check, and route registration stubs.

- [ ] **Step 6: Create index.ts entry point**

```typescript
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_GEMINI_APP_API_KEY',
  'INTEXURAOS_SENTRY_DSN',
  'INTEXURAOS_ENVIRONMENT',
];
const PRODUCTION_ONLY_ENV = [
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_CODE_AGENT_URL',
];
```

Initialize Sentry (`initSentry({ dsn, environment, serviceName: 'cron-agent' })`), validate env, load config, init services, build server, listen on `parseInt(process.env['PORT'] ?? '8080', 10)`.

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

Add `cron-agent` entry on port 8130 in Phase 1 (independent). Add `INTEXURAOS_CRON_AGENT_URL: 'http://localhost:8130'` to `COMMON_SERVICE_URLS`. No `waitForService` needed (cron-agent is independent, no startup dependencies on other services).

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

Read the `PromptBuilder` interface from `@intexuraos/llm-prompts` (`packages/llm-prompts/src/types.ts`) and implement a conforming object. The prompt must have `name: 'parse-schedule'`, `description`, `version: '1.0.0'`, and a `build()` method that returns the system prompt instructing the LLM to convert human-language schedule descriptions into standard cron expressions (5 fields: minute hour day-of-month month day-of-week) and return JSON: `{"cronExpression": "<expression>", "humanSummary": "<readable summary>"}` or `{"error": "<reason>"}` on failure. **Prompt versioning (CLAUDE.md rule):** All `PromptBuilder` prompts require a semver `version` field. Bump on edit: major = behavior change, minor = new examples, patch = typos.

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

### Task 4: Tool Registry — OpenAPI-to-ToolDefinition Generator

**Files:**
- Create: `apps/cron-agent/src/domain/ports/tool-registry.ts`
- Create: `apps/cron-agent/src/infra/openapi-tool-registry.ts`
- Create: `apps/cron-agent/src/infra/__tests__/openapi-tool-registry.test.ts`

This is the core innovation: generating `ToolDefinition[]` dynamically from services' OpenAPI specs.

- [ ] **Step 1: Define ToolRegistry port interface**

```typescript
import type { ToolDefinition } from '@intexuraos/llm-contract';

interface ToolRegistry {
  /** Fetch and cache tools for a service. Returns namespaced ToolDefinition[]. */
  getToolsForService(serviceKey: string): Promise<ToolDefinition[]>;
  /** Get tools for multiple services (for schedule execution). */
  getToolsForServices(serviceKeys: string[]): Promise<ToolDefinition[]>;
  /** List all services and their available tool names (for UI). */
  listServiceTools(): Promise<Array<{ key: string; name: string; tools: Array<{ name: string; description: string }> }>>;
  /** Refresh cached specs from all services. Called periodically or at startup. */
  refreshAll(): Promise<void>;
}
```

- [ ] **Step 2: Write failing tests for OpenApiToolRegistry**

Test cases:
1. Fetches `/openapi.json` from a service URL, parses OpenAPI spec
2. Filters to only `/internal/*` endpoints
3. Generates correctly namespaced tool names: `{service_key}__{operationId}` (e.g., `code_agent__getRunningCodeTasks`)
4. Maps OpenAPI parameters + requestBody to JSON Schema `parameters`
5. The `run` callback makes the correct HTTP call with `X-Internal-Auth` header
6. Caches specs — second call doesn't re-fetch
7. `refreshAll()` re-fetches and updates cache
8. Rejects service keys not in allowlist
9. Handles service unreachable gracefully (returns empty tools, logs warning)
10. Tools from different services don't collide (double underscore namespace)

Use `nock` to mock `/openapi.json` responses with realistic OpenAPI specs.

- [ ] **Step 3: Implement OpenApiToolRegistry**

```typescript
export class OpenApiToolRegistry implements ToolRegistry {
  private cache: Map<string, ToolDefinition[]> = new Map();

  constructor(private deps: {
    allowedServices: ServiceDefinition[];
    internalAuthToken: string;
    logger: Logger;
  }) {}

  async getToolsForService(serviceKey: string): Promise<ToolDefinition[]> {
    // 1. Validate serviceKey is in allowedServices
    // 2. Check cache, return if fresh
    // 3. Fetch GET {service.openapiUrl}
    // 4. Parse OpenAPI spec
    // 5. Filter paths to /internal/* only
    // 6. For each endpoint, generate ToolDefinition:
    //    - name: `${serviceKey.replace(/-/g, '_')}__${operationId}`
    //    - description: from summary + description
    //    - parameters: from OpenAPI params + requestBody schema
    //    - run: closure that makes HTTP call with X-Internal-Auth
    // 7. Cache and return
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cron-agent): add OpenAPI-based tool registry for dynamic tool generation"
```

### Task 5: Action Executor — LLM Tool-Calling Agent

**Files:**
- Create: `apps/cron-agent/src/domain/use-cases/execute-action.ts`
- Create: `apps/cron-agent/src/domain/use-cases/__tests__/execute-action.test.ts`
- Create: `apps/cron-agent/src/prompts/execute-action-prompt.ts`

- [ ] **Step 1: Create the action execution prompt**

Implement a `PromptBuilder` conforming object with `name: 'execute-action'`, `version: '1.0.0'`. The system prompt instructs the LLM:
- You are an automation agent executing a scheduled task
- You have access to tools from specific IntexuraOS services
- Execute the user's instruction step by step, including any conditional logic
- Call tools as needed to accomplish the task
- When done, respond with a JSON summary: `{"outcome": "success"|"failure", "summary": "what was done", "details": [...]}`

**Prompt versioning (CLAUDE.md rule):** Semver `version` field required. Bump: major = behavior, minor = examples, patch = typos.

- [ ] **Step 2: Write failing tests for execute-action**

Test cases:
1. Simple action (one tool call) — calls tool, returns success with tool call log
2. Multi-step action — calls multiple tools in sequence
3. Conditional action — LLM uses tools to check state, conditionally calls other tools
4. Tool call fails — agent handles gracefully, reports failure
5. Unknown service key in `action.services` — returns error immediately
6. Max iterations reached — returns failure with partial tool log
7. Records all tool calls (name, args, result, duration) in execution record
8. Captures LLM token usage for cost tracking

Use fake `ToolCallingClient` and fake `ToolRegistry`.

- [ ] **Step 3: Implement execute-action**

```typescript
interface ExecuteActionDeps {
  logger: Logger;
  toolRegistry: ToolRegistry;
  toolCallingClient: ToolCallingClient;
}

export async function executeAction(
  deps: ExecuteActionDeps,
  action: CronSchedule['action'],
): Promise<Result<ActionResult, ActionError>> {
  // 1. Get tools for action.services via toolRegistry
  // 2. Build system prompt from execute-action-prompt
  // 3. Run toolCallingClient.run({ systemPrompt, messages: [{ role: 'user', content: action.instruction }], tools })
  // 4. Collect tool call log from the run (instrument tools to track calls)
  // 5. Parse LLM final response for outcome
  // 6. Return ActionResult with toolCalls[], agentResponse, tokenUsage
}

interface ActionResult {
  outcome: 'success' | 'failure';
  agentResponse: string;
  toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: string; durationMs: number }>;
  tokenUsage: { inputTokens: number; outputTokens: number; totalCost: number };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cron-agent): add LLM tool-calling action executor"
```

### Task 6: Tick Handler & Schedule Execution

**Files:**
- Create: `apps/cron-agent/src/domain/use-cases/handle-tick.ts`
- Create: `apps/cron-agent/src/domain/use-cases/__tests__/handle-tick.test.ts`
- Create: `apps/cron-agent/src/domain/use-cases/execute-schedule.ts`
- Create: `apps/cron-agent/src/domain/use-cases/__tests__/execute-schedule.test.ts`

- [ ] **Step 1: Write failing tests for execute-schedule**

Test cases:
1. Successful execution — creates execution record, runs action executor, updates record with tool calls + agent response
2. Action executor failure — creates execution record with status `failure`, error captured
3. Updates schedule `lastExecutedAt`, `nextExecutionAt`, `executionCount`
4. On failure, increments schedule `failureCount`
5. Token usage recorded in execution record

Use fake action executor and in-memory repos.

- [ ] **Step 2: Implement execute-schedule**

```typescript
interface ExecuteScheduleDeps {
  logger: Logger;
  executionRepo: ExecutionRepository;
  scheduleRepo: ScheduleRepository;
  executeAction: typeof executeAction;
}

export async function executeSchedule(
  deps: ExecuteScheduleDeps,
  schedule: CronSchedule,
  trigger: 'scheduled' | 'manual',
): Promise<Result<CronExecution, ExecuteError>>
```

Creates execution record with `status: 'running'`, calls `executeAction` with the schedule's action config, updates execution record with results (tool calls, agent response, token usage, status).

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Write failing tests for handle-tick**

Test cases:
1. No due schedules → returns `{ executed: 0, skipped: 0, errors: 0 }`
2. One due schedule → executes it, returns `{ executed: 1 }`
3. Multiple due schedules → executes all
4. Schedule execution fails → counts as error, continues with next
5. Skips schedules already running (guard against overlapping ticks — see mechanism below)

- [ ] **Step 5: Implement handle-tick**

```typescript
export async function handleTick(deps: HandleTickDeps): Promise<TickResult> {
  const now = new Date();
  const dueSchedules = await deps.scheduleRepo.findDueSchedules(now);
  // For each due schedule:
  //   1. Check for existing 'running' execution for this scheduleId (query executionRepo)
  //   2. If running execution exists → skip (count as skipped), prevents overlapping ticks
  //   3. Otherwise → create execution record with status 'running' FIRST (Firestore transaction)
  //   4. Execute the schedule action via action executor (LLM tool-calling agent)
  //   5. Update execution record with result (success/failure, tool calls, agent response)
  //   6. Update schedule's nextExecutionAt using cron-parser
  // Return summary counts { executed, skipped, errors }
}
```

**Overlapping execution guard:** Before executing a schedule, query `executionRepo` for any existing execution with `scheduleId` and `status === 'running'`. If found, skip the schedule for this tick. The execution record is created with `status: 'running'` inside a Firestore transaction before the action executor begins, ensuring atomicity. This prevents double-execution when Cloud Scheduler retries or ticks overlap.

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(cron-agent): add tick handler and schedule execution use cases"
```

### Task 7: Schedule Management Use Case

**Files:**
- Create: `apps/cron-agent/src/domain/use-cases/manage-schedule.ts`
- Create: `apps/cron-agent/src/domain/use-cases/__tests__/manage-schedule.test.ts`

- [ ] **Step 1: Write failing tests for schedule CRUD**

Test cases:
1. Create schedule — calls parseSchedule, validates action.services against allowlist, stores with computed `nextExecutionAt`, status `active`
2. Create with invalid description — returns parse error
3. Create with unknown service key in action.services — returns validation error
4. Get schedule by ID — returns schedule if userId matches
5. Get schedule by ID — returns NOT_FOUND if wrong user
6. List schedules — returns paginated, filtered by status
7. Update schedule name — updates only name, keeps cron
8. Update schedule description — re-parses cron expression
9. Update schedule instruction — updates action.instruction without re-parsing cron
10. Pause schedule — sets status to `paused`, clears `nextExecutionAt`
11. Resume schedule — sets status to `active`, recomputes `nextExecutionAt`
12. Delete schedule — soft-deletes (status `deleted`)

- [ ] **Step 2: Implement manage-schedule**

```typescript
interface ManageScheduleDeps {
  logger: Logger;
  scheduleRepo: ScheduleRepository;
  parseSchedule: typeof parseSchedule;
  toolRegistry: ToolRegistry;  // for validating action.services against available services
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

`CreateScheduleInput.action` uses the new schema: `{ services: string[], instruction: string }`. On create, validates that all service keys in `action.services` exist in the allowlist.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cron-agent): add schedule management use case with CRUD and manual trigger"
```

### Task 8: HTTP Routes

**Files:**
- Create: `apps/cron-agent/src/routes/schedule-routes.ts`
- Create: `apps/cron-agent/src/routes/execution-routes.ts`
- Create: `apps/cron-agent/src/routes/internal-routes.ts`
- Create: `apps/cron-agent/src/routes/index.ts`
- Create: `apps/cron-agent/src/routes/__tests__/schedule-routes.test.ts`
- Create: `apps/cron-agent/src/routes/__tests__/execution-routes.test.ts`
- Create: `apps/cron-agent/src/routes/__tests__/internal-routes.test.ts`

All public routes use `/cron/*` prefix. All internal routes use `/internal/cron/*` prefix.

- [ ] **Step 1: Write failing tests for schedule routes**

Use `app.inject()` pattern. Test:
1. `GET /cron/schedules` — 200 with list
2. `GET /cron/schedules` — 401 without auth
3. `POST /cron/schedules` — 201 creates schedule
4. `POST /cron/schedules` — 400 missing required fields
5. `POST /cron/schedules` — 400 unknown service key in action.services
6. `GET /cron/schedules/:id` — 200 returns schedule
7. `GET /cron/schedules/:id` — 404 not found
8. `PATCH /cron/schedules/:id` — 200 updates
9. `DELETE /cron/schedules/:id` — 200 soft-deletes
10. `POST /cron/schedules/:id/trigger` — 200 triggers execution

- [ ] **Step 2: Implement schedule-routes.ts**

Each route: `logIncomingRequest`, validate JWT auth, extract userId, call schedule manager, return `reply.ok(data)` or `reply.fail(code, message)`. Include Fastify JSON schemas for request/response validation. Register under `/cron/schedules` prefix.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Write failing tests for execution routes**

1. `GET /cron/executions` — 200 with paginated list
2. `GET /cron/executions?scheduleId=xxx` — filters by schedule
3. `GET /cron/executions/:id` — 200 returns execution (includes toolCalls, agentResponse, tokenUsage)
4. `GET /cron/executions/:id` — 404 not found

- [ ] **Step 5: Implement execution-routes.ts**

Each route: `logIncomingRequest`, validate JWT auth, extract userId, call execution repo, return `reply.ok(data)` or `reply.fail(code, message)`. Register under `/cron/executions` prefix.

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Write failing tests for internal routes**

1. `POST /internal/cron/tick` — 200 with OIDC auth (Cloud Scheduler)
2. `POST /internal/cron/tick` — 200 with X-Internal-Auth
3. `POST /internal/cron/tick` — 401 without auth
4. `GET /internal/cron/services` — 200 returns list of services with tool names
5. Verify tick handler is called and response shape is correct

- [ ] **Step 8: Implement internal-routes.ts**

`logIncomingRequest` on every handler. Follow the exact OIDC + X-Internal-Auth dual-auth pattern from code-agent's drain-queue endpoint. The tick response is wrapped in `{ success: true, data: { executed, skipped, errors } }`. The services endpoint returns `{ success: true, data: { services: [...] } }` from `toolRegistry.listServiceTools()`. Register under `/internal/cron` prefix.

- [ ] **Step 9: Run tests, verify pass**

- [ ] **Step 10: Wire routes into server.ts and services.ts**

Update `initServices` to construct all repositories, use cases, tool registry, and tool calling client. Register all route files in `server.ts`. Register `@fastify/swagger` for OpenAPI spec generation at `/openapi.json`.

- [ ] **Step 11: Run full test suite**

Run: `pnpm --filter @intexuraos/cron-agent test`

- [ ] **Step 12: Commit**

```bash
git commit -m "feat(cron-agent): add HTTP routes for schedules, executions, and internal tick"
```

### Task 9: Firestore Composite Index Migrations

**Files:**
- Create: `apps/cron-agent/migrations/001-composite-indexes.mjs`

- [ ] **Step 1: Create composite index migration**

The `findDueSchedules` query uses `status == 'active' AND nextExecutionAt <= now` — this requires a composite index. The `findByUserId` queries use `userId + status + createdAt` for ordering. Create migration file:

```javascript
// 001-composite-indexes.mjs
export const indexes = [
  {
    collectionGroup: 'cron_schedules',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'nextExecutionAt', order: 'ASCENDING' },
    ],
  },
  {
    collectionGroup: 'cron_schedules',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'cron_executions',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'cron_executions',
    fields: [
      { fieldPath: 'scheduleId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
  },
];
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(cron-agent): add Firestore composite index migrations"
```

### Task 10: Terraform & Infrastructure

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

Follow existing service module pattern. Include env vars: `INTEXURAOS_GCP_PROJECT_ID`, `INTEXURAOS_INTERNAL_AUTH_TOKEN`, `INTEXURAOS_AUTH_AUDIENCE`, `INTEXURAOS_AUTH_ISSUER`, `INTEXURAOS_AUTH_JWKS_URL`, `INTEXURAOS_SENTRY_DSN`, `INTEXURAOS_ENVIRONMENT`, `INTEXURAOS_GEMINI_APP_API_KEY`, `INTEXURAOS_CODE_AGENT_URL`, and other service URLs as needed. Also add `INTEXURAOS_CRON_AGENT_URL` to the web app's Terraform env vars for production.

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
    uri         = "${module.cron_agent.service_url}/internal/cron/tick"
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
  service  = module.cron_agent.service_name  # Verify actual module output name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_scheduler.email}"
}
```

- [ ] **Step 5: Add cron-agent to api-docs-hub config**

Update `apps/api-docs-hub/src/config.ts` to include cron-agent's OpenAPI URL. Add `INTEXURAOS_CRON_AGENT_OPENAPI_URL` env var to the api-docs-hub Terraform module and ecosystem.config.cjs.

- [ ] **Step 6: Commit Terraform changes**

```bash
git commit -m "infra(cron-agent): add Cloud Run service, Cloud Scheduler tick job, and api-docs-hub registration"
```

- [ ] **Step 7: Apply Terraform**

```bash
cd terraform/environments/dev
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

Verify:
- Cloud Run service `intexuraos-cron-agent` is created
- Cloud Scheduler job `intexuraos-cron-agent-tick-dev` is created and schedules every minute
- IAM binding allows Cloud Scheduler to invoke the cron-agent service
- Env vars are correctly set on the Cloud Run service

### Task 11: CI Verification

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
    services: string[];              // allowlisted service keys (e.g. ["code-agent"])
    instruction: string;             // human-language step sequence
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

export interface ToolCallLog {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}

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
  toolCalls: ToolCallLog[];
  agentResponse: string | null;
  tokenUsage: { inputTokens: number; outputTokens: number; totalCost: number } | null;
  error: string | null;
  createdAt: string;
}

export type CronExecutionStatus = CronExecution['status'];

export interface ServiceInfo {
  key: string;
  name: string;
  tools: Array<{ name: string; description: string }>;
}

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

Add `cronAgentUrl` to the `AppConfig` interface (in `types/index.ts` or wherever it's defined) and `getConfig()`:
```typescript
cronAgentUrl: getServiceUrl('INTEXURAOS_CRON_AGENT_URL', '/api/cron-agent'),
```

- [ ] **Step 3: Create cronAgentApi.ts service layer**

Follow `codeAgentApi.ts` pattern exactly. All requests target `/cron/*` paths:
```typescript
// All endpoints use /cron/* prefix
export async function listSchedules(accessToken: string, options?: { status?: CronScheduleStatus[]; limit?: number; cursor?: string }): Promise<ListSchedulesResponse>
export async function createSchedule(accessToken: string, request: CreateScheduleRequest): Promise<CronSchedule>
export async function getSchedule(accessToken: string, id: string): Promise<CronSchedule>
export async function updateSchedule(accessToken: string, id: string, updates: Partial<CreateScheduleRequest & { status: CronScheduleStatus }>): Promise<CronSchedule>
export async function deleteSchedule(accessToken: string, id: string): Promise<void>
export async function triggerSchedule(accessToken: string, id: string): Promise<CronExecution>
export async function listExecutions(accessToken: string, options?: { scheduleId?: string; status?: CronExecutionStatus[]; limit?: number; cursor?: string }): Promise<ListExecutionsResponse>
export async function getExecution(accessToken: string, id: string): Promise<CronExecution>
// Internal endpoint (no JWT, uses internal auth or proxied through dev)
export async function listAvailableServices(accessToken: string): Promise<ServiceInfo[]>
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): add cron agent types and API service layer"
```

### Task 2: React Hooks

**Files:**
- Create: `apps/web/src/hooks/useCronSchedules.ts`
- Create: `apps/web/src/hooks/useCronExecutions.ts`
- Create: `apps/web/src/hooks/useCronServices.ts`
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

- [ ] **Step 3: Create useCronServices hook**

```typescript
export function useCronServices(): {
  services: ServiceInfo[];
  loading: boolean;
  error: string | null;
}
```

Fetches available services + their tools via `listAvailableServices()`. Cached for the session (services don't change frequently).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): add useCronSchedules, useCronExecutions, and useCronServices hooks"
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
- Table/card list showing: name, cron expression (human-readable), services (chip badges), next execution time (relative), last executed (relative), execution count, failure count, status badge
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
- Schedule details: name, description (human language), parsed cron expression, timezone, status
- Action config: services list (chip badges), instruction text
- Available tools panel (expandable, shows tools from selected services)
- Edit inline (name, description — re-triggers LLM parse on description change; instruction — updates action.instruction)
- Pause/Resume/Delete action buttons
- "Trigger Now" button
- Recent executions list (last 20, using `useCronExecutions({ scheduleId })`)
- Each execution row: timestamp, status badge, duration, trigger type, tool calls count

- [ ] **Step 2: Create CronScheduleNewPage**

Form fields:
- Name (text input, required)
- Description (textarea, required — placeholder: "Describe when this should run, e.g. 'every 5 minutes check if there is a running code task'")
- Action config:
  - Services (multi-select chips from available services, fetched via `listAvailableServices()` — shows service name + tool count)
  - Instruction (textarea, required — placeholder: "Describe what to do step by step, e.g. 'check if any code task is running. if not, pick the oldest executable and dispatch it'")
- Timezone (dropdown, default UTC)
- Submit → `createSchedule` → navigate to `/cron-agent/:id`

Below the services multi-select, show an expandable "Available Tools" panel listing the tools for each selected service (name + description from `ServiceInfo.tools`), so the user knows what capabilities the agent will have.

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
- Table showing: timestamp (relative), schedule name (link to schedule), status badge, trigger type (scheduled/manual), duration, tool calls count, token cost
- Click row → expand inline to show:
  - Agent response (rendered as markdown)
  - Tool call log (collapsible list: tool name, args JSON, result JSON, duration per call)
  - Token usage breakdown (input/output tokens, cost)
  - Error message (if any)
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

- [ ] **Step 2: Add Vite proxy and production env var**

Add dev proxy to `vite.config.ts`:
```typescript
'/api/cron-agent': {
  target: 'http://localhost:8130',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/cron-agent/, ''),
},
```

Ensure `INTEXURAOS_CRON_AGENT_URL` is included in the web app's Vite env config (the `envPrefix` or `define` section) so it's available in production builds.

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
