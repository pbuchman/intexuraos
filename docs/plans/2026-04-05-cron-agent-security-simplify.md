# Cron Agent Security Validation & Config Simplification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant `description` field from cron schedules, enforce `allowedOperations` per service to restrict tool access, inject schedule-owner `userId` into all tool calls, and block application-wide endpoints from cron agent access.

**Architecture:** Four independent changes within `apps/cron-agent` (plus web app frontend). (1) Replace the stored `description` field with a transient `schedule` input for cron parsing. (2) Populate `allowedOperations` on every service in the catalog to create an explicit allowlist. (3) Inject `X-Cron-User-Id` header into all outgoing tool calls so downstream services can verify identity. (4) Audit and exclude application-wide endpoints from the allowlist.

**Tech Stack:** TypeScript, Fastify, Firestore, Vitest, React (web app)

---

## Investigation Findings

### Finding 1: `description` field is partially redundant

The `description` field on `CronSchedule` serves as the human-language timing input (e.g., "Every 5 minutes on weekdays"). It is parsed by Gemini LLM into a `cronExpression` + `humanSummary`. After parsing, the raw `description` is stored alongside the `cronExpression` but is never used again except for display.

The `instruction` field (`ScheduleAction.instruction`) describes **what to do** (the task). These are fundamentally different purposes, but the field name "description" is misleading and the original text is redundant once `cronExpression` exists.

**Decision:** Rename the API input from `description` to `schedule` (to clarify it's about timing), and stop storing the raw input. Instead, store the `humanSummary` returned by the LLM parser (currently discarded) in a new `scheduleSummary` field. This preserves display value while eliminating the confusing `description` field.

**Affected files:**
- `apps/cron-agent/src/domain/types.ts` — `CronSchedule`, `CreateScheduleInput`, `UpdateScheduleInput`
- `apps/cron-agent/src/routes/schemas.ts` — request/response JSON schemas
- `apps/cron-agent/src/routes/schedule-routes.ts` — route handlers and body types
- `apps/cron-agent/src/domain/use-cases/manage-schedule.ts` — create/update logic
- `apps/cron-agent/src/domain/use-cases/parse-schedule.ts` — returns `humanSummary` (already does)
- `apps/cron-agent/src/infra/firestore-schedule-repository.ts` — persistence
- `apps/web/src/types/cronAgent.ts` — frontend types
- `apps/web/src/services/cronAgentApi.ts` — API client
- `apps/web/src/pages/cron-agent/CronScheduleNewPage.tsx` — create form
- `apps/web/src/pages/cron-agent/CronScheduleViewPage.tsx` — view page
- `apps/web/src/pages/cron-agent/ScheduleListItem.tsx` — list display
- All related test files

### Finding 2: Tool/endpoint registry validation already exists — but `allowedOperations` is never populated

The `ServiceDefinition` type includes an `allowedOperations?: string[]` field (see `apps/cron-agent/src/config.ts:6`). The `OpenApiToolRegistry` already filters by it (`openapi-tool-registry.ts:129-134`). However, **no service in the catalog sets this field**, meaning ALL `/internal/*` endpoints from every configured service are exposed as tools.

The validation flow for tool selection is sound:
1. Service keys are validated against `toolRegistry.listServiceTools()` (manage-schedule.ts:51-59)
2. Preferred tools are validated against available tools from selected services (manage-schedule.ts:70-84)
3. During execution, only tools from selected services are loaded (execute-action.ts:28)

**Decision:** Populate `allowedOperations` for every service in the catalog. This is the designed mechanism — it just needs to be filled in. Requires auditing each service's OpenAPI spec to identify safe, user-scoped operationIds.

**Affected files:**
- `apps/cron-agent/src/config.ts` — add `allowedOperations` arrays to each catalog entry

### Finding 3: User ID is NOT injected into tool calls — critical security gap

When the cron agent's LLM executes tools, the execution flow is:
1. `executeSchedule()` receives the full `CronSchedule` including `userId` (execute-schedule.ts:26)
2. `executeAction()` receives only `schedule.action` — **userId is NOT passed** (execute-schedule.ts:45)
3. The LLM decides tool arguments freely, including any `userId` in request bodies or path parameters
4. `createRunCallback()` blindly passes whatever arguments the LLM provides (openapi-tool-registry.ts:213)

This means a compromised LLM (via prompt injection in the instruction text) could call endpoints with **any user's ID**. Examples of exploitable endpoints:
- `GET /internal/users/:uid/llm-keys` — access other users' API keys
- `GET /internal/users/:uid/oauth/google/token` — access other users' OAuth tokens
- `POST /internal/notes` with arbitrary `userId` in body — create notes for any user
- `POST /internal/issues` with spoofed `x-user-id` header — create Linear issues as any user

**Decision:** Inject the schedule owner's `userId` into all outgoing tool calls via an `X-Cron-User-Id` header. This requires:
1. Threading `userId` from `executeSchedule` → `executeAction` → `toolRegistry.getToolsForServices`
2. Adding the header in `createRunCallback()`
3. Downstream services should validate `X-Cron-User-Id` matches any userId in the request body/params (future work, not in this plan's scope — documented as follow-up)

Additionally, the system prompt should explicitly instruct the LLM to ONLY use the owner's userId — though this is a defense-in-depth measure, not a security boundary.

### Finding 4: Application-wide endpoints are exposed — access control gap

Several services expose `/internal/*` endpoints that are NOT user-scoped:

| Service              | Endpoint                                   | Risk                              |
| -------------------- | ------------------------------------------ | --------------------------------- |
| app-settings-service | `GET /internal/settings/pricing`           | Exposes global LLM pricing config |
| linear-agent         | `POST /internal/linear/sync-all`           | Triggers sync for ALL users       |
| linear-agent         | `POST /internal/linear/prune-issues`       | Prunes issues globally            |
| commands-agent       | `POST /internal/retry-pending`             | Retries all pending commands      |
| code-agent           | `POST /internal/merge-conflicts/reconcile` | Global reconciliation             |
| code-agent           | `POST /internal/archive-stale-groups`      | Global archive operation          |
| code-agent           | `POST /internal/execution-memory/process`  | Global memory processing          |
| web-agent            | `POST /internal/link-previews`             | No user scoping (low risk)        |

Additionally, some user-scoped endpoints expose sensitive data:
- `GET /internal/users/:uid/llm-keys` — decrypted API keys
- `GET /internal/users/:uid/oauth/google/token` — OAuth tokens

**Decision:** These are blocked by populating `allowedOperations` (Finding 2). Services like `app-settings-service` should have an **empty** `allowedOperations` array (no operations exposed). Sensitive endpoints on `user-service` should be excluded from the allowlist.

---

## File Structure

### Modified Files

| File                                                         | Change                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cron-agent/src/domain/types.ts`                        | Replace `description` with `scheduleSummary` on `CronSchedule`; replace `description` with `schedule` on `CreateScheduleInput`/`UpdateScheduleInput` |
| `apps/cron-agent/src/domain/ports/schedule-repository.ts`    | Update `create` signature (input type changes)                                                                                                       |
| `apps/cron-agent/src/domain/ports/tool-registry.ts`          | Add `ToolExecutionContext` interface; update `getToolsForService`/`getToolsForServices` to accept optional `context?: ToolExecutionContext`          |
| `apps/cron-agent/src/domain/use-cases/manage-schedule.ts`    | Pass `schedule` (not `description`) to parser; store `scheduleSummary`; pass `userId` to execute deps                                                |
| `apps/cron-agent/src/domain/use-cases/execute-action.ts`     | Accept `userId`, pass to tool registry and include in prompt                                                                                         |
| `apps/cron-agent/src/domain/use-cases/execute-schedule.ts`   | Pass `schedule.userId` to `executeAction`                                                                                                            |
| `apps/cron-agent/src/domain/use-cases/parse-schedule.ts`     | Rename param from `description` to `schedule` (cosmetic)                                                                                             |
| `apps/cron-agent/src/prompts/execute-action-prompt.ts`       | Add userId context to system prompt (version bump)                                                                                                   |
| `apps/cron-agent/src/infra/openapi-tool-registry.ts`         | Accept `userId` in `createRunCallback`, inject `X-Cron-User-Id` header                                                                               |
| `apps/cron-agent/src/infra/firestore-schedule-repository.ts` | Store `scheduleSummary` instead of `description`                                                                                                     |
| `apps/cron-agent/src/config.ts`                              | Add `allowedOperations` to every catalog entry                                                                                                       |
| `apps/cron-agent/src/routes/schemas.ts`                      | Update response schema (`scheduleSummary` replaces `description`)                                                                                    |
| `apps/cron-agent/src/routes/schedule-routes.ts`              | Update body types, pass `schedule` input to manager                                                                                                  |
| `apps/web/src/types/cronAgent.ts`                            | Replace `description` with `scheduleSummary`; update `CreateScheduleRequest`                                                                         |
| `apps/web/src/services/cronAgentApi.ts`                      | Update request type                                                                                                                                  |
| `apps/web/src/pages/cron-agent/CronScheduleNewPage.tsx`      | Rename field from "Description" to "Schedule"                                                                                                        |
| `apps/web/src/pages/cron-agent/CronScheduleViewPage.tsx`     | Display `scheduleSummary` instead of `description`                                                                                                   |
| `apps/web/src/pages/cron-agent/ScheduleListItem.tsx`         | Display `scheduleSummary` instead of `description`                                                                                                   |
| All `__tests__/` files for above                             | Update test data and assertions                                                                                                                      |

---

## Task Breakdown

### Task 1: Remove `description` field, replace with `schedule` input and `scheduleSummary` storage

**Files:**
- Modify: `apps/cron-agent/src/domain/types.ts`
- Modify: `apps/cron-agent/src/domain/ports/schedule-repository.ts`
- Modify: `apps/cron-agent/src/domain/use-cases/parse-schedule.ts`
- Modify: `apps/cron-agent/src/domain/use-cases/manage-schedule.ts`
- Modify: `apps/cron-agent/src/infra/firestore-schedule-repository.ts`
- Modify: `apps/cron-agent/src/routes/schemas.ts`
- Modify: `apps/cron-agent/src/routes/schedule-routes.ts`
- Test: `apps/cron-agent/src/domain/__tests__/types.test.ts`
- Test: `apps/cron-agent/src/domain/use-cases/__tests__/manage-schedule.test.ts`
- Test: `apps/cron-agent/src/domain/use-cases/__tests__/parse-schedule.test.ts`
- Test: `apps/cron-agent/src/routes/__tests__/schedule-routes.test.ts`
- Test: `apps/cron-agent/src/infra/__tests__/firestore-schedule-repository.test.ts`

- [ ] **Step 1: Update domain types**

In `apps/cron-agent/src/domain/types.ts`:

```typescript
// CronSchedule: replace `description: string` with `scheduleSummary: string`
export interface CronSchedule {
  id: string;
  userId: string;
  name: string;
  scheduleSummary: string;        // was: description
  cronExpression: string;
  timezone: string;
  action: ScheduleAction;
  status: ScheduleStatus;
  lastExecutedAt: string | null;
  nextExecutionAt: string | null;
  executionCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

// CreateScheduleInput: replace `description` with `schedule`
export interface CreateScheduleInput {
  name: string;
  schedule: string;               // was: description — human-language timing input for LLM parsing
  action: ScheduleAction;
  timezone: string;
}

// UpdateScheduleInput: replace `description` with `schedule`
export interface UpdateScheduleInput {
  name?: string | undefined;
  schedule?: string | undefined;  // was: description
  status?: ScheduleStatus | undefined;
  action?: ScheduleAction | undefined;
  timezone?: string | undefined;
}
```

- [ ] **Step 2: Update schedule repository port**

In `apps/cron-agent/src/domain/ports/schedule-repository.ts`, the `create` method signature uses `CreateScheduleInput` — it will pick up the type change automatically. No code changes needed, but verify the type flows correctly.

- [ ] **Step 3: Update parse-schedule use case (cosmetic rename)**

In `apps/cron-agent/src/domain/use-cases/parse-schedule.ts`, rename the parameter from `description` to `schedule`:

```typescript
export async function parseSchedule(
  deps: ParseScheduleDeps,
  schedule: string,       // was: description
): Promise<Result<ParseScheduleResult, ParseScheduleError>> {
  const { logger, geminiClient } = deps;

  const prompt = parseSchedulePrompt.build({ description: schedule });
  // ... rest unchanged
```

- [ ] **Step 4: Update manage-schedule use case**

In `apps/cron-agent/src/domain/use-cases/manage-schedule.ts`:

**create method** — pass `input.schedule` to parser, store `scheduleSummary`:
```typescript
// Line ~112: change input.description to input.schedule
const parseResult = await parseSchedule(parseDeps, input.schedule);
if (!parseResult.ok) {
  return err({
    code: 'PARSE_FAILED',
    message: parseResult.error.message,
  });
}

const { cronExpression, humanSummary } = parseResult.value;
const nextExecutionAt = computeNextExecution(cronExpression, input.timezone);

const result = await scheduleRepo.create(userId, {
  ...input,
  scheduleSummary: humanSummary,      // NEW: store the human summary
  cronExpression,
  nextExecutionAt,
});
```

**update method** — change `input.description` references to `input.schedule`:
```typescript
// Line ~201: change input.description to input.schedule
if (input.schedule !== undefined) {
  const parseResult = await parseSchedule(parseDeps, input.schedule);
  if (!parseResult.ok) {
    return err({ code: 'PARSE_FAILED', message: parseResult.error.message });
  }
  updates.scheduleSummary = parseResult.value.humanSummary;
  updates.cronExpression = parseResult.value.cronExpression;
  const tz = input.timezone ?? schedule.timezone;
  updates.nextExecutionAt = computeNextExecution(parseResult.value.cronExpression, tz);
}
```

- [ ] **Step 5: Update Firestore schedule repository**

In `apps/cron-agent/src/infra/firestore-schedule-repository.ts`, the `create` method builds a `CronSchedule` object. Update:

```typescript
const schedule: CronSchedule = {
  id: docRef.id,
  userId,
  name: input.name,
  scheduleSummary: input.scheduleSummary,  // was: description: input.description
  cronExpression: input.cronExpression,
  // ... rest unchanged
};
```

The `create` method signature in the port also needs the extra field. Update the `ScheduleRepository.create` signature input type to include `scheduleSummary`:

```typescript
create(userId: string, input: CreateScheduleInput & {
  scheduleSummary: string;
  cronExpression: string;
  nextExecutionAt: string | null;
}): Promise<Result<CronSchedule, ScheduleRepositoryError>>;
```

- [ ] **Step 6: Update route schemas and handlers**

In `apps/cron-agent/src/routes/schemas.ts`, update `scheduleResponseSchema`:
```typescript
// Replace `description: { type: 'string' }` with:
scheduleSummary: { type: 'string' },
```

In `apps/cron-agent/src/routes/schedule-routes.ts`:

Update `CreateScheduleBody` interface:
```typescript
interface CreateScheduleBody {
  name: string;
  schedule: string;          // was: description
  action: { ... };
  timezone?: string;
}
```

Update `createScheduleBodySchema`:
```typescript
const createScheduleBodySchema = {
  type: 'object',
  required: ['name', 'schedule', 'action'],  // was: 'description'
  properties: {
    name: { type: 'string', minLength: 1 },
    schedule: { type: 'string', minLength: 1 },  // was: description
    // ... rest unchanged
  },
} as const;
```

Update `UpdateScheduleBody` and `updateScheduleBodySchema` similarly (replace `description` with `schedule`).

Update the `POST /cron/schedules` handler:
```typescript
const result = await manager.create(auth.userId, {
  name: request.body.name,
  schedule: request.body.schedule,  // was: description
  action: { ... },
  timezone: request.body.timezone ?? 'UTC',
});
```

Update the `PATCH /cron/schedules/:id` handler similarly.

- [ ] **Step 7: Update all test files**

Update all test fixtures to replace `description` with `scheduleSummary` on `CronSchedule` objects and `schedule` on input objects. Key files:
- `manage-schedule.test.ts` — update `testSchedule`, create/update test inputs
- `parse-schedule.test.ts` — verify param rename
- `schedule-routes.test.ts` — update request bodies
- `firestore-schedule-repository.test.ts` — update stored objects
- `types.test.ts` — update normalize test data
- `execute-schedule.test.ts` — update schedule fixtures

- [ ] **Step 8: Run tests and verify**

Run: `pnpm run verify:workspace:tracked -- cron-agent`
Expected: All tests pass, coverage maintained.

- [ ] **Step 9: Commit**

```bash
git add apps/cron-agent/src/
git commit -m "feat(cron-agent): replace description with schedule input and scheduleSummary storage

Remove the redundant description field from CronSchedule. The API input
is renamed from 'description' to 'schedule' (clarifies it's about timing).
The stored field becomes 'scheduleSummary' (the LLM-generated human-readable
summary), replacing the raw user input that was never used after parsing.

INT-1288"
```

---

### Task 2: Populate `allowedOperations` for every service in the catalog

**Files:**
- Modify: `apps/cron-agent/src/config.ts`
- Test: `apps/cron-agent/src/__tests__/config.test.ts`

This task requires auditing each service's `/internal/*` endpoints and deciding which operationIds are safe for cron agent use. The `allowedOperations` mechanism already exists and is tested — we just need to populate the arrays.

- [ ] **Step 1: Audit and populate allowedOperations**

In `apps/cron-agent/src/config.ts`, add `allowedOperations` to every entry in `INTERNAL_API_SERVICE_CATALOG`. Below is the allowlist based on the security audit:

```typescript
const INTERNAL_API_SERVICE_CATALOG = [
  {
    key: 'user-service',
    name: 'User Service',
    baseUrlEnvVar: 'INTEXURAOS_USER_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_USER_SERVICE_OPENAPI_URL',
    allowedOperations: [],  // BLOCKED: exposes llm-keys, OAuth tokens — too sensitive
  },
  {
    key: 'notion-service',
    name: 'Notion Service',
    baseUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_NOTION_SERVICE_OPENAPI_URL',
    allowedOperations: ['getNotionContext', 'getNotionPagePreview'],
  },
  {
    key: 'whatsapp-service',
    name: 'WhatsApp Service',
    baseUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_WHATSAPP_SERVICE_OPENAPI_URL',
    allowedOperations: ['sendWhatsAppMessage'],
  },
  {
    key: 'mobile-notifications-service',
    name: 'Mobile Notifications Service',
    baseUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_OPENAPI_URL',
    allowedOperations: ['queryNotifications'],
  },
  {
    key: 'research-agent',
    name: 'Research Agent',
    baseUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_RESEARCH_AGENT_OPENAPI_URL',
    allowedOperations: ['createResearchDraft'],
  },
  {
    key: 'commands-agent',
    name: 'Commands Agent',
    baseUrlEnvVar: 'INTEXURAOS_COMMANDS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_COMMANDS_AGENT_OPENAPI_URL',
    allowedOperations: [],  // BLOCKED: retry-pending is app-wide, ingestCommand is PubSub-only
  },
  {
    key: 'actions-agent',
    name: 'Actions Agent',
    baseUrlEnvVar: 'INTEXURAOS_ACTIONS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_ACTIONS_AGENT_OPENAPI_URL',
    allowedOperations: ['createAction'],
  },
  {
    key: 'data-insights-agent',
    name: 'Data Insights Agent',
    baseUrlEnvVar: 'INTEXURAOS_DATA_INSIGHTS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_DATA_INSIGHTS_AGENT_OPENAPI_URL',
    allowedOperations: ['computeVisualization'],
  },
  {
    key: 'image-service',
    name: 'Image Service',
    baseUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_IMAGE_SERVICE_OPENAPI_URL',
    allowedOperations: ['generateImagePrompt', 'generateImage'],
    // NOTE: deleteImage excluded — no userId validation
  },
  {
    key: 'app-settings-service',
    name: 'Application Settings Service',
    baseUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_URL',
    openApiUrlEnvVar: 'INTEXURAOS_APP_SETTINGS_SERVICE_OPENAPI_URL',
    allowedOperations: [],  // BLOCKED: only has getAllPricing which is app-wide
  },
  {
    key: 'notes-agent',
    name: 'Notes Agent',
    baseUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_NOTES_AGENT_OPENAPI_URL',
    allowedOperations: ['createNote'],
  },
  {
    key: 'todos-agent',
    name: 'Todos Agent',
    baseUrlEnvVar: 'INTEXURAOS_TODOS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_TODOS_AGENT_OPENAPI_URL',
    allowedOperations: ['createTodo'],
  },
  {
    key: 'bookmarks-agent',
    name: 'Bookmarks Agent',
    baseUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_BOOKMARKS_AGENT_OPENAPI_URL',
    allowedOperations: ['createBookmark', 'getBookmark', 'updateBookmark'],
    // NOTE: force-refresh excluded — no explicit userId check
  },
  {
    key: 'calendar-agent',
    name: 'Calendar Agent',
    baseUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CALENDAR_AGENT_OPENAPI_URL',
    allowedOperations: ['processCalendarAction', 'generateCalendarPreview', 'createCalendarPreview'],
  },
  {
    key: 'chat-agent',
    name: 'Chat Agent',
    baseUrlEnvVar: 'INTEXURAOS_CHAT_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CHAT_AGENT_OPENAPI_URL',
    allowedOperations: [],  // REVIEW: needs operationId audit of chat-agent internal routes
  },
  {
    key: 'code-agent',
    name: 'Code Agent',
    baseUrlEnvVar: 'INTEXURAOS_CODE_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CODE_AGENT_OPENAPI_URL',
    allowedOperations: ['getDispatchMetadata', 'getLinearIssueContext'],
    // BLOCKED: merge-conflicts/reconcile, archive-stale-groups, execution-memory/process — all app-wide
  },
  {
    key: 'linear-agent',
    name: 'Linear Agent',
    baseUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_LINEAR_AGENT_OPENAPI_URL',
    allowedOperations: ['processLinearAction', 'validateIssue', 'generateIssueTitle', 'syncUser',
                        'createIssue', 'getIssueState', 'updateIssueState'],
    // BLOCKED: sync-all, prune-issues — app-wide scheduler operations
  },
  {
    key: 'web-agent',
    name: 'Web Agent',
    baseUrlEnvVar: 'INTEXURAOS_WEB_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_WEB_AGENT_OPENAPI_URL',
    allowedOperations: ['fetchLinkPreviews', 'summarizePage'],
  },
  {
    key: 'cron-agent',
    name: 'Cron Agent',
    baseUrlEnvVar: 'INTEXURAOS_CRON_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_CRON_AGENT_OPENAPI_URL',
    allowedOperations: [],  // BLOCKED: cron-agent should not call itself
  },
  {
    key: 'hellscript-agent',
    name: 'Hellscript Agent',
    baseUrlEnvVar: 'INTEXURAOS_HELLSCRIPT_AGENT_URL',
    openApiUrlEnvVar: 'INTEXURAOS_HELLSCRIPT_AGENT_OPENAPI_URL',
    allowedOperations: [],  // REVIEW: needs operationId audit
  },
] as const;
```

**IMPORTANT:** The exact `operationId` values above are educated guesses based on common naming conventions observed in the codebase. The implementing agent **MUST** verify each operationId by checking the actual OpenAPI specs or route definitions of each service. For each service:
1. Check `apps/<service>/src/routes/internalRoutes.ts` (or similar) for `operationId` values in route schemas
2. Verify the operationId matches exactly (case-sensitive)
3. If a service has no internal routes with operationIds, set `allowedOperations: []`

- [ ] **Step 1b: Update `buildAllowedServices` to propagate `allowedOperations`**

The `buildAllowedServices` function in `config.ts` converts catalog entries into `ServiceDefinition` objects. It currently does NOT copy `allowedOperations`, silently dropping the field and defeating the security allowlists.

Update the return object in `buildAllowedServices` to spread `allowedOperations` from the catalog entry:

```typescript
return [
  {
    key: entry.key,
    name: entry.name,
    url,
    openapiUrl: explicitOpenApiUrl !== '' ? explicitOpenApiUrl : `${url}/openapi.json`,
    ...(entry.allowedOperations !== undefined && {
      allowedOperations: [...entry.allowedOperations],
    }),
  },
];
```

Note: since `INTERNAL_API_SERVICE_CATALOG` is `as const`, `entry.allowedOperations` is `readonly string[]` — spread into a mutable array to satisfy `allowedOperations?: string[] | undefined`.

- [ ] **Step 2: Verify operationIds are correct**

For each service in the catalog, read the internal routes file and extract the actual `operationId` values. Update the allowlist with the verified values. This is critical — a typo means the operation is silently blocked.

Run this verification:
```bash
# For each service, check its internalRoutes for operationId values
grep -r "operationId" apps/*/src/routes/internal* --include="*.ts" -h
```

- [ ] **Step 3: Run tests and verify**

Run: `pnpm run verify:workspace:tracked -- cron-agent`
Expected: All tests pass. The existing `allowedOperations` filter test already covers the mechanism.

- [ ] **Step 4: Commit**

```bash
git add apps/cron-agent/src/config.ts
git commit -m "feat(cron-agent): populate allowedOperations for all services in catalog

Add explicit operation-level allowlists to every service in the internal
API catalog. Services with only app-wide or sensitive endpoints (user-service,
app-settings-service, commands-agent, cron-agent) get empty arrays, blocking
all their operations from cron tool access. This uses the existing
allowedOperations filter mechanism that was designed but never populated.

INT-1288"
```

---

### Task 3: Inject schedule-owner `userId` into all tool calls

**Files:**
- Modify: `apps/cron-agent/src/domain/use-cases/execute-action.ts`
- Modify: `apps/cron-agent/src/domain/use-cases/execute-schedule.ts`
- Modify: `apps/cron-agent/src/infra/openapi-tool-registry.ts`
- Modify: `apps/cron-agent/src/domain/ports/tool-registry.ts`
- Modify: `apps/cron-agent/src/prompts/execute-action-prompt.ts`
- Test: `apps/cron-agent/src/domain/use-cases/__tests__/execute-action.test.ts`
- Test: `apps/cron-agent/src/domain/use-cases/__tests__/execute-schedule.test.ts`
- Test: `apps/cron-agent/src/infra/__tests__/openapi-tool-registry.test.ts`

- [ ] **Step 1: Thread userId through the execution chain**

In `apps/cron-agent/src/domain/use-cases/execute-action.ts`, add `userId` parameter:

```typescript
export async function executeAction(
  deps: ExecuteActionDeps,
  action: ScheduleAction,
  userId: string,              // NEW parameter
): Promise<Result<ActionResult, ActionError>> {
```

In `apps/cron-agent/src/domain/use-cases/execute-schedule.ts`, pass `schedule.userId`:

```typescript
// Line ~45: add userId argument
const actionResult = await executeAction(actionDeps, schedule.action, schedule.userId);
```

- [ ] **Step 2: Update tool registry to accept userId context**

In `apps/cron-agent/src/domain/ports/tool-registry.ts`, add optional context to tool retrieval:

```typescript
export interface ToolExecutionContext {
  userId: string;
}

export interface ToolRegistry {
  getToolsForService(serviceKey: string, context?: ToolExecutionContext): Promise<ToolDefinition[]>;
  getToolsForServices(serviceKeys: string[], context?: ToolExecutionContext): Promise<ToolDefinition[]>;
  listServiceTools(): Promise<ServiceToolInfo[]>;
  refreshAll(): Promise<void>;
}
```

- [ ] **Step 3: Thread userId through fetchAndGenerateTools → createRunCallback**

In `apps/cron-agent/src/infra/openapi-tool-registry.ts`, thread `userId` through the tool generation pipeline so it's captured at tool-creation time rather than grafted onto cached tools:

**Update `createRunCallback` signature** to accept optional `userId`:

```typescript
private createRunCallback(
  service: ServiceDefinition,
  method: string,
  path: string,
  userId?: string,   // NEW — captured directly in the closure
): (args: Record<string, unknown>) => Promise<string> {
  const { internalAuthToken } = this.deps;
  const baseUrl = service.url;

  return async (args: Record<string, unknown>): Promise<string> => {
    // ... existing arg processing ...

    const headers: Record<string, string> = {
      'X-Internal-Auth': internalAuthToken,
      'Content-Type': 'application/json',
    };

    // Inject user identity for downstream authorization
    if (userId !== undefined) {
      headers['X-Cron-User-Id'] = userId;
    }

    // ... rest of fetch logic unchanged
  };
}
```

**Update `generateToolsFromSpec`** to accept optional `userId` and pass it to `createRunCallback`:

```typescript
private generateToolsFromSpec(
  service: ServiceDefinition,
  spec: Record<string, unknown>,
  userId?: string,   // NEW
): ToolDefinition[] {
  // ... existing path/operation iteration ...
  // In the tool creation:
  tools.push({
    name: toolName,
    description: toolDescription || `${method.toUpperCase()} ${path}`,
    parameters,
    run: this.createRunCallback(service, method, path, userId),  // Pass userId
  });
  // ...
}
```

**Update `fetchAndGenerateTools`** to accept and forward `userId`:

```typescript
private async fetchAndGenerateTools(
  service: ServiceDefinition,
  userId?: string,  // NEW
): Promise<ToolDefinition[]> {
  // ... fetch spec ...
  return this.generateToolsFromSpec(service, spec, userId);  // Forward userId
}
```

**Update `getToolsForService`** to accept context and pass `userId` to `fetchAndGenerateTools`:

```typescript
async getToolsForService(
  serviceKey: string,
  context?: ToolExecutionContext,
): Promise<ToolDefinition[]> {
  const service = this.serviceMap.get(serviceKey);
  if (service === undefined) {
    this.deps.logger.warn({ serviceKey }, 'Service not in allowlist');
    return [];
  }

  const userId = context?.userId;

  // NOTE: Cache stores tools WITHOUT userId context (cached at spec-fetch time).
  // If userId is needed, we bypass cache and re-fetch. This is intentional —
  // cached tools are shared across users; user-specific context must be injected at call time.
  if (userId === undefined) {
    const cached = this.cache.get(serviceKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const tools = await this.fetchAndGenerateTools(service, userId);

  // Only cache non-user-specific tools
  if (userId === undefined && tools.length > 0) {
    this.cache.set(serviceKey, tools);
  }
  return tools;
}
```

**Update `getToolsForServices`** similarly:

```typescript
async getToolsForServices(
  serviceKeys: string[],
  context?: ToolExecutionContext,
): Promise<ToolDefinition[]> {
  const results = await Promise.all(
    serviceKeys.map((key) => this.getToolsForService(key, context)),
  );
  return results.flat();
}
```

> **Why this approach:** `ToolDefinition` from `@intexuraos/llm-contract` only has `{ name, description, parameters, run }` — no `method` or `path` fields. The plan's original approach (rebuilding tools with `tool.method`/`tool.path`) would cause a TypeScript compile error. Threading `userId` through the generation pipeline is the correct approach. The cache bypass for user-specific requests is acceptable since tool generation is fast (just a local fetch of the OpenAPI spec).

- [ ] **Step 4: Update execute-action to pass userId context**

In `apps/cron-agent/src/domain/use-cases/execute-action.ts`:

```typescript
// Line ~28: pass context with userId
const tools = await toolRegistry.getToolsForServices(action.services, { userId });
```

- [ ] **Step 5: Update system prompt with userId context**

In `apps/cron-agent/src/prompts/execute-action-prompt.ts`, add userId to the prompt input and system prompt. Bump version to `3.0.0` (behavior change):

```typescript
interface ExecuteActionInput {
  instruction: string;
  serviceNames: string[];
  preferredTools: string[];
  userId: string;              // NEW
}

export const executeActionPrompt: PromptBuilder<ExecuteActionInput> = {
  name: 'execute-action',
  description: 'System prompt for the LLM tool-calling agent that executes scheduled actions',
  version: '3.0.0',           // MAJOR bump: behavior change

  build(input: ExecuteActionInput): string {
    // ... existing prompt ...
    // Add after "Guidelines:" section:
    return `...existing prompt text...

Security:
- You are executing on behalf of user ID: ${input.userId}
- When tools require a userId parameter, you MUST use exactly: ${input.userId}
- NEVER use a different userId — doing so is a security violation
- If a tool does not require userId, do not add one

...rest of prompt...`;
  },
};
```

Update the call site in `execute-action.ts`:
```typescript
const systemPrompt = executeActionPrompt.build({
  instruction: action.instruction,
  serviceNames,
  preferredTools: action.preferredTools,
  userId,                               // NEW
});
```

- [ ] **Step 6: Update all tests**

Update test files to pass `userId` through the execution chain:
- `execute-action.test.ts` — add `userId` argument to `executeAction` calls
- `execute-schedule.test.ts` — verify `userId` is threaded through
- `openapi-tool-registry.test.ts` — test that `X-Cron-User-Id` header is present in requests

Add a new test in `openapi-tool-registry.test.ts`:
```typescript
it('injects X-Cron-User-Id header when context provided', async () => {
  const tools = await registry.getToolsForService('code-agent', { userId: 'user-123' });
  // Call the tool and verify the header was sent
  // Use nock to assert the header
});
```

- [ ] **Step 7: Run tests and verify**

Run: `pnpm run verify:workspace:tracked -- cron-agent`
Expected: All tests pass with userId injection.

- [ ] **Step 8: Commit**

```bash
git add apps/cron-agent/src/
git commit -m "feat(cron-agent): inject schedule-owner userId into all tool calls

Thread the schedule owner's userId from executeSchedule through
executeAction into every outgoing tool HTTP call via a new
X-Cron-User-Id header. The system prompt also instructs the LLM
to only use the owner's userId in tool arguments. This prevents
a compromised LLM (via prompt injection) from accessing other
users' data through internal endpoints.

INT-1288"
```

---

### Task 4: Update web app frontend

**Files:**
- Modify: `apps/web/src/types/cronAgent.ts`
- Modify: `apps/web/src/services/cronAgentApi.ts`
- Modify: `apps/web/src/pages/cron-agent/CronScheduleNewPage.tsx`
- Modify: `apps/web/src/pages/cron-agent/CronScheduleViewPage.tsx`
- Modify: `apps/web/src/pages/cron-agent/ScheduleListItem.tsx`
- Test: `apps/web/src/__tests__/CronScheduleNewPage.test.tsx`

- [ ] **Step 1: Update frontend types**

In `apps/web/src/types/cronAgent.ts`:

```typescript
export interface CronSchedule {
  id: string;
  userId: string;
  name: string;
  scheduleSummary: string;     // was: description
  cronExpression: string;
  timezone: string;
  action: { ... };
  // ... rest unchanged
}

export interface CreateScheduleRequest {
  name: string;
  schedule: string;            // was: description
  action: CronSchedule['action'];
  timezone?: string;
}
```

- [ ] **Step 2: Update API client**

In `apps/web/src/services/cronAgentApi.ts`, the `createSchedule` function sends `CreateScheduleRequest` — the type change propagates automatically. Also update the `updateSchedule` function's `Partial<CreateScheduleRequest ...>` type.

- [ ] **Step 3: Update CronScheduleNewPage**

In `apps/web/src/pages/cron-agent/CronScheduleNewPage.tsx`:

```typescript
// Rename state: description → schedule
const [schedule, setSchedule] = useState('');

// Update isValid:
const isValid =
  name.trim().length > 0 &&
  schedule.trim().length > 0 &&
  selectedServiceKeys.size > 0 &&
  instruction.trim().length > 0;

// Update handleSubmit:
const result = await createScheduleApi(token, {
  name: name.trim(),
  schedule: schedule.trim(),     // was: description
  action: { ... },
  timezone,
});
```

Update the label and input:
```tsx
{/* Schedule (timing) */}
<div>
  <label htmlFor="schedule-timing" className="...">
    Schedule <span className="text-red-500">*</span>
  </label>
  <textarea
    id="schedule-timing"
    value={schedule}
    onChange={(e): void => { setSchedule(e.target.value); }}
    disabled={submitting}
    rows={2}
    placeholder="e.g. 'Every 5 minutes on weekdays' or 'Daily at 9am'"
    className="..."
  />
</div>
```

- [ ] **Step 4: Update CronScheduleViewPage**

In `apps/web/src/pages/cron-agent/CronScheduleViewPage.tsx`:

```tsx
{/* Replace description display with scheduleSummary */}
{schedule.scheduleSummary !== '' ? (
  <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
    {schedule.scheduleSummary}
  </p>
) : null}
```

- [ ] **Step 5: Update ScheduleListItem**

In `apps/web/src/pages/cron-agent/ScheduleListItem.tsx`:

```tsx
{/* Replace description with scheduleSummary */}
{schedule.scheduleSummary !== '' ? (
  <p className="mb-2 truncate text-xs text-slate-500 dark:text-slate-400">
    {schedule.scheduleSummary.length > 120
      ? `${schedule.scheduleSummary.slice(0, 120)}...`
      : schedule.scheduleSummary}
  </p>
) : null}
```

- [ ] **Step 6: Update frontend tests**

Update `apps/web/src/__tests__/CronScheduleNewPage.test.tsx` to use `schedule` instead of `description` in test data and assertions.

- [ ] **Step 7: Run tests and verify**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): update cron UI for schedule/scheduleSummary rename

Replace 'Description' field with 'Schedule' in the create form.
Display scheduleSummary instead of description in list and detail views.
Aligns with the backend API changes removing the description field.

INT-1288"
```

---

## Backward Compatibility Note

Existing Firestore documents have a `description` field but will NOT have `scheduleSummary`. The implementing agent should either:
1. **Preferred:** Add a Firestore migration that copies `description` → `scheduleSummary` for all existing documents and removes the `description` field
2. **Alternative:** Handle both fields in the read path with a fallback: `doc.scheduleSummary ?? doc.description ?? ''`

Option 2 is simpler and more resilient. If chosen, apply the fallback at the document read site before the `CronSchedule` cast, e.g. in `firestore-schedule-repository.ts` wherever `doc.data()` is read:

```typescript
// In firestore-schedule-repository.ts, wherever doc.data() is read:
const data = doc.data() as Record<string, unknown>;
const scheduleSummary = (data['scheduleSummary'] ?? data['description'] ?? '') as string;
return ok(normalizeCronSchedule({
  id: doc.id,
  ...data,
  scheduleSummary,
} as CronSchedule));
```

The `normalizeCronSchedule` function in `types.ts` is the wrong location because by the time `normalizeCronSchedule` is called, the data has already been cast to `CronSchedule`, so `description` and `scheduleSummary` are already the wrong TypeScript type (one is missing).

---

## Follow-Up Work (Not in This Plan)

1. **Downstream `X-Cron-User-Id` enforcement** — Each service should validate that `X-Cron-User-Id` matches any userId in the request body/params. This is a cross-service change and should be a separate task.
2. **Per-service auth tokens** — Replace the shared `INTEXURAOS_INTERNAL_AUTH_TOKEN` with per-service tokens to limit blast radius.
3. **Audit linear-agent `x-user-id` header** — The linear-agent internal issues routes accept `x-user-id` as a header without validation. This is a vulnerability independent of the cron agent.
4. **Firestore migration** — If option 1 is chosen for backward compatibility above, a migration script is needed.

---

## Endpoint Changes

### Modified
- `POST /cron/schedules` — Request body: `description` renamed to `schedule`
- `PATCH /cron/schedules/:id` — Request body: `description` renamed to `schedule`
- All schedule response objects — `description` field replaced with `scheduleSummary`

### Created
- None

### Removed
- None (fields renamed, not endpoints removed)

### Unchanged
- `GET /cron/services`
- `GET /cron/schedules`
- `GET /cron/schedules/:id`
- `DELETE /cron/schedules/:id`
- `POST /cron/schedules/:id/trigger`
- `GET /cron/executions`
- `GET /cron/executions/:id`
- `POST /internal/cron/tick`
