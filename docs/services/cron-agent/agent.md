# cron-agent — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| Name      | cron-agent                                                         |
| Role      | Manage and execute recurring schedules via LLM-driven tool calling |
| Goal      | Automate repetitive cross-service tasks on user-defined schedules  |

## Capabilities

### Create Schedule

**Endpoint:** `POST /cron/schedules`

**When to use:** When a user wants to automate a recurring task described in natural language.

**Input Schema:**

```typescript
interface CreateScheduleInput {
  name: string;
  description: string; // Natural language, e.g. "every weekday at 9am"
  action: {
    services: string[]; // Service keys from GET /cron/services
    instruction: string; // What the agent should do
    preferredTools?: string[]; // Tool names to prioritize
  };
  timezone?: string; // IANA timezone, default "UTC"
}
```

**Output Schema:**

```typescript
interface CronSchedule {
  id: string;
  userId: string;
  name: string;
  description: string;
  cronExpression: string;
  timezone: string;
  action: {
    services: string[];
    instruction: string;
    preferredTools: string[];
  };
  status: 'active' | 'paused' | 'deleted';
  lastExecutedAt: string | null;
  nextExecutionAt: string | null;
  executionCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}
```

**Example:**

```json
// Request
{
  "name": "Daily Report",
  "description": "every weekday at 9am",
  "action": {
    "services": ["notes-agent"],
    "instruction": "Create a note with today's date as the title."
  },
  "timezone": "Europe/Warsaw"
}

// Response (201)
{
  "success": true,
  "data": {
    "id": "sched_abc123",
    "cronExpression": "0 9 * * 1-5",
    "status": "active",
    "nextExecutionAt": "2026-03-23T08:00:00.000Z",
    "executionCount": 0
  }
}
```

### Trigger Schedule

**Endpoint:** `POST /cron/schedules/:id/trigger`

**When to use:** When you need to execute a schedule immediately without waiting for the next scheduled time.

**Input Schema:**

```typescript
interface TriggerInput {
  id: string; // Schedule ID (path parameter)
}
```

**Output Schema:**

```typescript
interface CronExecution {
  id: string;
  scheduleId: string;
  scheduleName: string;
  userId: string;
  status: 'running' | 'success' | 'failure' | 'skipped';
  trigger: 'scheduled' | 'manual';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  toolCalls: {
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    durationMs: number;
  }[];
  agentResponse: string | null;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  } | null;
  error: string | null;
  createdAt: string;
}
```

### List Available Services

**Endpoint:** `GET /cron/services`

**When to use:** Before creating a schedule, to discover which services and tools are available.

### List Schedules

**Endpoint:** `GET /cron/schedules`

**When to use:** To retrieve all schedules for the authenticated user.

**Query Parameters:** `status` (comma-separated), `limit` (max 100), `cursor`

### List Executions

**Endpoint:** `GET /cron/executions`

**When to use:** To review execution history and results.

**Query Parameters:** `scheduleId`, `status` (comma-separated), `limit` (max 100), `cursor`

### Process Tick (Internal)

**Endpoint:** `POST /internal/cron/tick`

**When to use:** Called by Cloud Scheduler to process all due schedules. Not for direct agent use.

## Constraints

**Do NOT:**

- Create schedules with intervals shorter than 5 minutes
- Trigger a schedule that already has a running execution
- Exceed 50 schedules per user
- Call `/internal/cron/tick` without proper authentication (OIDC or X-Internal-Auth)

**Requires:**

- Valid Bearer token (JWT) for all public endpoints
- Target services must be running and serving OpenAPI specs at their configured URLs
- At least one target service must have `/internal/*` endpoints

## Usage Patterns

### Pattern 1: Create and Verify Schedule

```
1. GET /cron/services to discover available services and tools
2. POST /cron/schedules with name, description, action
3. Verify cronExpression and nextExecutionAt in response
4. Optionally POST /cron/schedules/:id/trigger to test immediately
5. GET /cron/executions?scheduleId=:id to check result
```

### Pattern 2: Monitor Execution Health

```
1. GET /cron/schedules to list all active schedules
2. Check failureCount vs executionCount for each
3. GET /cron/executions?scheduleId=:id&status=failure to review failures
4. PATCH /cron/schedules/:id to pause problematic schedules
```

## Error Handling

| Error Code | Meaning                          | Recovery Action                      |
| ---------- | -------------------------------- | ------------------------------------ |
| 400        | Validation error or parse failed | Fix input; reword description        |
| 401        | Unauthorized                     | Refresh Bearer token                 |
| 404        | Schedule/execution not found     | Verify ID and ownership              |
| 409        | Schedule already running         | Wait for current execution to finish |
| 500        | Internal error                   | Retry with backoff                   |

## Dependencies

| Service          | Why Needed                        | Failure Behavior                 |
| ---------------- | --------------------------------- | -------------------------------- |
| Gemini 2.5 Flash | Parse schedules, execute actions  | Create/trigger fails             |
| Firestore        | Store schedules and executions    | All operations fail              |
| Target services  | Provide tools for agent execution | Execution fails for that service |
| Cloud Scheduler  | Invoke tick endpoint periodically | Scheduled executions stop        |
