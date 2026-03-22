# Cron Agent — Technical Reference

## Overview

Cron Agent is an LLM-driven recurring schedule execution service. It accepts natural language schedule descriptions, converts them to cron expressions via Gemini 2.5 Flash, and executes user-defined instructions as autonomous tool-calling agents at scheduled intervals. Runs on Cloud Run as a Fastify application backed by Firestore for schedule and execution storage.

## Architecture

```mermaid
graph TB
    subgraph "External"
        Client[Web App / API Client]
        Scheduler[Cloud Scheduler]
    end

    subgraph "cron-agent"
        API[Fastify Routes]
        Parse[Parse Schedule<br>LLM → Cron Expression]
        Manage[Schedule Manager]
        Tick[Handle Tick]
        Execute[Execute Schedule]
        Action[Execute Action<br>Tool-Calling Agent]
        Registry[OpenAPI Tool Registry]
    end

    subgraph "Dependencies"
        Firestore[(Firestore<br>cron_schedules<br>cron_executions)]
        Gemini[Gemini 2.5 Flash]
        TargetSvcs[Target Services<br>via /internal/* APIs]
    end

    Client --> API
    Scheduler -->|POST /internal/cron/tick| Tick
    API --> Manage
    Manage --> Parse
    Parse --> Gemini
    Manage --> Execute
    Tick --> Execute
    Execute --> Action
    Action --> Registry
    Registry -->|fetch OpenAPI specs| TargetSvcs
    Action -->|tool calls via HTTP| TargetSvcs
    Manage --> Firestore
    Execute --> Firestore

    classDef service fill:#e1f5ff
    classDef storage fill:#fff4e6
    classDef external fill:#f0f0f0

    class API,Parse,Manage,Tick,Execute,Action,Registry service
    class Firestore storage
    class Client,Scheduler,Gemini,TargetSvcs external
```

## Data Flow

```mermaid
sequenceDiagram
    autonumber
    participant Scheduler as Cloud Scheduler
    participant CronAgent as cron-agent
    participant Firestore
    participant Gemini as Gemini 2.5 Flash
    participant Target as Target Service

    Note over Scheduler,Target: Schedule Creation
    CronAgent->>Gemini: Parse "every weekday at 9am"
    Gemini-->>CronAgent: {"cronExpression": "0 9 * * 1-5", "humanSummary": "..."}
    CronAgent->>Firestore: Create cron_schedules doc

    Note over Scheduler,Target: Scheduled Execution
    Scheduler->>+CronAgent: POST /internal/cron/tick
    CronAgent->>Firestore: Query due schedules (nextExecutionAt <= now)
    Firestore-->>CronAgent: Due schedules list
    CronAgent->>Firestore: Create cron_executions (status: running)
    CronAgent->>Target: Fetch OpenAPI spec
    Target-->>CronAgent: OpenAPI JSON
    CronAgent->>Gemini: Tool-calling agent loop
    Gemini-->>CronAgent: Tool call request
    CronAgent->>Target: Execute tool call (POST /internal/...)
    Target-->>CronAgent: Tool result
    CronAgent->>Firestore: Update execution (status: success, toolCalls, tokenUsage)
    CronAgent->>Firestore: Increment schedule counters, update nextExecutionAt
    CronAgent-->>-Scheduler: {executed, skipped, errors}
```

## Recent Changes

All changes are new in v3.4.0 — cron-agent is a brand-new service introduced in this release.

| Commit     | Description                                                      | Date       |
| ---------- | ---------------------------------------------------------------- | ---------- |
| `955c86d`  | Remove service URL validation from startup gate                  | 2026-03-20 |
| `f33e830`  | PR review comments for startup gate fix                          | 2026-03-20 |
| `0fc320f`  | Improve cron tool selection authoring                            | 2026-03-20 |
| `10ee94b`  | Restore cron-agent image build (INT-957)                         | 2026-03-19 |
| `8260b89`  | Add cron-agent to Cloud Build pipeline and deployment infra      | 2026-03-19 |
| `653a417`  | Harden security and error handling                               | 2026-03-19 |
| `bb4c426`  | Remove user instruction from system prompt, add scheduler retry  | 2026-03-19 |
| `b346207`  | Harden against prompt injection and abuse                        | 2026-03-19 |
| `4c9e400`  | Initial implementation — LLM-driven recurring schedule backend   | 2026-03-19 |

## API Endpoints

### Public Endpoints

| Method | Path                          | Purpose                                       | Auth   |
| ------ | ----------------------------- | --------------------------------------------- | ------ |
| GET    | `/cron/services`              | List available services and their tools       | Bearer |
| GET    | `/cron/schedules`             | List schedules with status filter, pagination | Bearer |
| POST   | `/cron/schedules`             | Create a new schedule                         | Bearer |
| GET    | `/cron/schedules/:id`         | Get a specific schedule                       | Bearer |
| PATCH  | `/cron/schedules/:id`         | Update a schedule                             | Bearer |
| DELETE | `/cron/schedules/:id`         | Soft-delete a schedule                        | Bearer |
| POST   | `/cron/schedules/:id/trigger` | Manually trigger a schedule execution         | Bearer |
| GET    | `/cron/executions`            | List executions with filters                  | Bearer |
| GET    | `/cron/executions/:id`        | Get a specific execution                      | Bearer |

### Internal Endpoints

| Method | Path                   | Purpose                              | Caller          |
| ------ | ---------------------- | ------------------------------------ | --------------- |
| POST   | `/internal/cron/tick`  | Process all due schedules            | Cloud Scheduler |

### System Endpoints

| Method | Path             | Purpose             |
| ------ | ---------------- | ------------------- |
| GET    | `/health`        | Health check        |
| GET    | `/openapi.json`  | OpenAPI spec        |
| GET    | `/docs`          | Swagger UI          |

## Domain Model

### CronSchedule

| Field              | Type                                  | Description                             |
| ------------------ | ------------------------------------- | --------------------------------------- |
| `id`               | `string`                              | Unique identifier                       |
| `userId`           | `string`                              | Owner user ID                           |
| `name`             | `string`                              | Display name                            |
| `description`      | `string`                              | Natural language schedule description   |
| `cronExpression`   | `string`                              | 5-field cron expression (LLM-generated) |
| `timezone`         | `string`                              | IANA timezone (default: UTC)            |
| `action`           | `ScheduleAction`                      | What to execute                         |
| `status`           | `'active' \                           | 'paused' \                              | 'deleted'` | Current state |
| `lastExecutedAt`   | `string \                             | null`                                   | ISO timestamp of last execution |
| `nextExecutionAt`  | `string \                             | null`                                   | ISO timestamp of next scheduled run |
| `executionCount`   | `number`                              | Total executions                        |
| `failureCount`     | `number`                              | Total failed executions                 |
| `createdAt`        | `string`                              | ISO creation timestamp                  |
| `updatedAt`        | `string`                              | ISO last-update timestamp               |

### ScheduleAction

| Field            | Type       | Description                                               |
| ---------------- | ---------- | --------------------------------------------------------- |
| `services`       | `string[]` | Service keys the agent can call (e.g., `["notes-agent"]`) |
| `instruction`    | `string`   | Natural language task instruction                         |
| `preferredTools` | `string[]` | Tool names to try first (optional)                        |

### CronExecution

| Field           | Type                                             | Description                     |
| --------------- | ------------------------------------------------ | ------------------------------- |
| `id`            | `string`                                         | Unique identifier               |
| `scheduleId`    | `string`                                         | Parent schedule ID              |
| `scheduleName`  | `string`                                         | Schedule name at execution time |
| `userId`        | `string`                                         | Owner user ID                   |
| `status`        | `'running' \                                     | 'success' \                     | 'failure' \ | 'skipped'` | Execution state |
| `trigger`       | `'scheduled' \                                   | 'manual'`                       | How it was triggered |
| `startedAt`     | `string`                                         | ISO start timestamp             |
| `completedAt`   | `string \                                        | null`                           | ISO completion timestamp |
| `durationMs`    | `number \                                        | null`                           | Total execution time |
| `toolCalls`     | `ToolCallLog[]`                                  | Detailed tool call records      |
| `agentResponse` | `string \                                        | null`                           | Final agent summary |
| `tokenUsage`    | `TokenUsage \                                    | null`                           | LLM token consumption |
| `error`         | `string \                                        | null`                           | Error message on failure |
| `createdAt`     | `string`                                         | ISO creation timestamp          |

**Status Values:**

| Status    | Meaning                                     |
| --------- | ------------------------------------------- |
| `running` | Execution in progress                       |
| `success` | Completed without errors                    |
| `failure` | Completed with errors                       |
| `skipped` | Skipped due to overlapping execution        |

## Firestore Collections

| Collection         | Owner      | Purpose                     |
| ------------------ | ---------- | --------------------------- |
| `cron_schedules`   | cron-agent | Schedule definitions        |
| `cron_executions`  | cron-agent | Execution history and logs  |

## Dependencies

### External Services

| Service            | Purpose                                     | Failure Mode                             |
| ------------------ | ------------------------------------------- | ---------------------------------------- |
| Gemini 2.5 Flash   | Schedule parsing and tool-calling execution | Schedule creation fails; execution fails |
| Cloud Scheduler    | Periodic tick invocation                    | Schedules stop executing                 |

### Internal Services (Dynamic)

The cron-agent does not have fixed internal service dependencies. Instead, it dynamically discovers target services at runtime by fetching their OpenAPI specs. The set of available services is configured via `buildInternalApiServiceDefinitions` from environment variables. The agent only calls `/internal/*` endpoints on these target services, using `X-Internal-Auth` for authentication.

## Configuration

| Variable                          | Purpose                                 | Required |
| --------------------------------- | --------------------------------------- | -------- |
| `INTEXURAOS_GCP_PROJECT_ID`       | GCP project ID                          | Yes      |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`  | Shared token for internal service calls | Yes      |
| `INTEXURAOS_GEMINI_APP_API_KEY`   | Gemini API key for LLM calls            | Yes      |
| `INTEXURAOS_SENTRY_DSN`           | Sentry error tracking DSN               | Yes      |
| `INTEXURAOS_ENVIRONMENT`          | Environment name (dev/production)       | Yes      |
| `INTEXURAOS_AUTH_AUDIENCE`        | Auth0 audience (production only)        | Prod     |
| `INTEXURAOS_AUTH_ISSUER`          | Auth0 issuer URL (production only)      | Prod     |
| `INTEXURAOS_AUTH_JWKS_URL`        | Auth0 JWKS URL (production only)        | Prod     |

## Gotchas

- **Tick auth is dual-mode:** The `/internal/cron/tick` endpoint accepts both Cloud Scheduler OIDC tokens (JWT structure validated) and `X-Internal-Auth` headers. In production, OIDC validation relies on Cloud Run's infrastructure-level token check, not application-level verification. If Cloud Run ingress settings change, this endpoint would need explicit OIDC validation added.
- **Description re-parse on update:** Changing a schedule's `description` field triggers an LLM call to re-parse the cron expression. This means updates with a new description are slower and can fail if the LLM cannot parse the new text.
- **Soft deletes only:** The DELETE endpoint sets `status: 'deleted'` and clears `nextExecutionAt` — it does not remove the Firestore document.
- **OpenAPI tool cache:** The `OpenApiToolRegistry` caches fetched tools in memory. Empty results (fetch failures) are intentionally not cached to allow recovery, but successful results persist until the service restarts.
- **Overlap protection:** Both scheduled ticks and manual triggers check for a running execution before starting a new one. The check queries Firestore for `status === 'running'` — there is no distributed lock, so a narrow race window exists under very high concurrency.
- **Response truncation:** Tool call responses are truncated at 50,000 bytes to prevent context overflow in the LLM agent loop.

## File Structure

```
apps/cron-agent/src/
├── domain/
│   ├── cron-utils.ts              # computeNextExecution helper
│   ├── types.ts                   # CronSchedule, CronExecution, ScheduleAction
│   ├── ports/
│   │   ├── schedule-repository.ts # Schedule persistence interface
│   │   ├── execution-repository.ts# Execution persistence interface
│   │   └── tool-registry.ts       # Tool discovery interface
│   └── use-cases/
│       ├── parse-schedule.ts      # LLM-based cron expression parsing
│       ├── manage-schedule.ts     # CRUD + trigger orchestration
│       ├── execute-schedule.ts    # Single schedule execution lifecycle
│       ├── execute-action.ts      # LLM tool-calling agent loop
│       └── handle-tick.ts         # Process all due schedules
├── infra/
│   ├── firestore-schedule-repository.ts
│   ├── firestore-execution-repository.ts
│   └── openapi-tool-registry.ts   # Discovers tools from service OpenAPI specs
├── prompts/
│   ├── parse-schedule-prompt.ts   # v1.1.0 — NL → cron expression
│   └── execute-action-prompt.ts   # v2.1.0 — tool-calling system prompt
├── routes/
│   ├── schedule-routes.ts         # Public schedule CRUD + trigger
│   ├── execution-routes.ts        # Public execution listing
│   ├── internal-routes.ts         # /internal/cron/tick
│   └── schemas.ts                 # Shared response schemas
├── config.ts
├── services.ts
├── server.ts
├── openapi.config.ts
└── index.ts
```
