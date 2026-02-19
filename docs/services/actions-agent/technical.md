# Actions Agent - Technical Reference

## Overview

Actions-agent is the central action lifecycle management service for IntexuraOS. It receives classified commands from
commands-agent, maintains action state in Firestore, routes actions to appropriate handlers via Pub/Sub, and tracks
execution status. In v2.0.0, it gained WhatsApp approval handling with atomic status transitions to prevent race
conditions. In v2.1.0, it migrated to the centralized `@intexuraos/internal-clients/user-service` package. In v3.0.0,
it added the `code` action type for dispatching Claude Code tasks via code-agent. In v4.0.0 (INT-524), the LLM
classification layer was removed entirely — all approval intents are now resolved deterministically via WhatsApp
interactive buttons.

## Architecture

```mermaid
graph TB
    subgraph "IntexuraOS Action Flow"
        User[User Command] --> WA[WhatsApp Service]
        WA --> CA[Commands Agent]
        CA -->|"action.created<br/>Pub/Sub event"| AA[Actions Agent]

        AA --> Firestore[(Firestore:<br/>actions collection)]
        AA --> PubSub[PubSub:<br/>actions queue]

        subgraph "Action Handlers"
            PubSub --> RH[Research Handler]
            PubSub --> TH[Todo Handler]
            PubSub --> NH[Note Handler]
            PubSub --> LH[Link Handler]
            PubSub --> CH[Calendar Handler]
            PubSub --> LIH[Linear Handler]
            PubSub --> COH[Code Handler]
        end

        RH --> RA[Research Agent]
        TH --> TA[Todos Agent]
        NH --> NA[Notes Agent]
        LH --> BA[Bookmarks Agent]
        CH --> CAL[Calendar Agent]
        LIH --> LA[Linear Agent]
        COH --> COA[Code Agent]

        AA --> WAP[WhatsApp Publisher]
        WAP --> WUser[WhatsApp Notification + Buttons]

        WA -->|"action.approval.reply<br/>Pub/Sub event"| AA
    end

    Scheduler[Cloud Scheduler] -->|"/internal/actions/retry-pending"| AA
```

## Recent Changes

| Commit     | Description                                                                  | Date       |
| ---------- | ---------------------------------------------------------------------------- | ---------- |
| `884bc168` | Add semver versioning to PromptBuilder; auto-execute now applies all types   | 2026-02-19 |
| `e60eafc1` | Rename INTEXURAOS_GUEST_ZAI_API_KEY → INTEXURAOS_ZAI_APP_API_KEY             | 2026-02-15 |
| `c72b7c53` | Add INTEXURAOS_GEMINI_APP_API_KEY for Gemini fallback in user service client | 2026-02-15 |
| `d81ee125` | Fix view-task button URL: /#/tasks/ → /#/code-tasks/                         | 2026-02-15 |
| `d7c6a061` | Add consistent icons to all WhatsApp approval/notification messages          | 2026-02-10 |
| `32e6e641` | Ack deleted actions in approval reply, notify via WhatsApp                   | 2026-02-16 |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration                                          | 2026-02-16 |
| `6063175b` | Add dev-mode log formatting for PM2 readability                              | 2026-02-16 |
| `0a6b7b8f` | Normalize cancel-with-nonce error codes to UPPER_CASE                        | 2026-02-10 |
| `090e1d9d` | INT-524 Unified interactive approval buttons (removed LLM + nonces)          | 2026-02-09 |
| `0f69a74b` | Add default model selector with platform Zai/Gemini fallback                 | 2026-02-09 |
| `44017d5c` | INT-473 Fix ESLint OOM with batched parallel lint runner                     | 2026-02-01 |
| `d713d754` | INT-156 Fix ActionDoc missing approvalNonce fields                           | 2026-01-31 |

## Data Flow

### Standard Action Flow

```mermaid
sequenceDiagram
    participant User
    participant WA as WhatsApp Service
    participant CA as Commands Agent
    participant AA as Actions Agent
    participant FS as Firestore
    participant PS as Pub/Sub
    participant Handler as Action Handler
    participant Target as Target Service

    User->>WA: Send command
    WA->>CA: Forward message
    CA->>CA: Classify command (LLM)
    CA->>AA: POST /internal/actions (create)
    AA->>FS: Save action (status: pending)
    AA->>PS: Publish action.created
    PS->>Handler: Push to /internal/actions/process
    Handler->>FS: updateStatusIf(awaiting_approval, pending)
    Handler->>AA: Send WhatsApp notification with buttons
    User->>WA: Tap "Approve" button
```

### Approval Reply Flow (v2.0.0, buttons-only in v4.0.0)

```mermaid
sequenceDiagram
    participant User
    participant WA as WhatsApp Service
    participant AA as Actions Agent
    participant FS as Firestore
    participant Target as Target Service

    User->>WA: Tap "Approve" button (buttonId: "approve:{actionId}")
    WA->>PS: Publish action.approval.reply
    PS->>AA: Push to /internal/actions/approval-reply
    AA->>FS: Get action by actionId
    AA->>FS: updateStatusIf(pending, awaiting_approval)
    Note over AA,FS: Atomic transaction prevents race condition
    AA->>WA: "✅ Approved! Processing your research..."
    AA->>Target: Execute action directly (or publish action.created)
```

## API Endpoints

### Public Endpoints

| Method | Path                                   | Description                            | Auth         |
| ------ | -------------------------------------- | -------------------------------------- | ------------ |
| GET    | `/actions`                             | List actions for authenticated user    | Bearer token |
| PATCH  | `/actions/:actionId`                   | Update action status or type           | Bearer token |
| DELETE | `/actions/:actionId`                   | Delete an action                       | Bearer token |
| POST   | `/actions/batch`                       | Fetch multiple actions by IDs (max 50) | Bearer token |
| POST   | `/actions/:actionId/execute`           | Synchronously execute an action        | Bearer token |
| GET    | `/actions/:actionId/preview`           | Get calendar action preview            | Bearer token |
| POST   | `/actions/:actionId/resolve-duplicate` | Skip or update duplicate bookmark      | Bearer token |

### Internal Endpoints

| Method | Path                               | Description                                      | Auth                    |
| ------ | ---------------------------------- | ------------------------------------------------ | ----------------------- |
| POST   | `/internal/actions`                | Create new action from classification            | Internal header or OIDC |
| POST   | `/internal/actions/:actionType`    | Process action from Pub/Sub (type-specific)      | Pub/Sub OIDC            |
| POST   | `/internal/actions/process`        | Process action from Pub/Sub (unified)            | Pub/Sub OIDC            |
| POST   | `/internal/actions/retry-pending`  | Retry actions stuck in pending (Cloud Scheduler) | OIDC or Internal        |
| POST   | `/internal/actions/approval-reply` | Handle WhatsApp button taps (v2.0.0)             | Pub/Sub OIDC            |

## Domain Models

### Action

| Field             | Type                    | Description                             |
| ----------------- | ----------------------- | --------------------------------------- |
| `id`              | string (UUID)           | Unique action identifier                |
| `userId`          | string                  | User who owns the action                |
| `commandId`       | string                  | Original command ID from commands-agent |
| `type`            | ActionType              | Classification result                   |
| `confidence`      | number (0-1)            | Classification confidence score         |
| `title`           | string                  | Action title/description                |
| `status`          | ActionStatus            | Current lifecycle state                 |
| `payload`         | Record<string, unknown> | Action-specific data                    |
| `resource_status` | ResourceStatus (opt)    | Status of associated resource           |
| `resource_error`  | string (optional)       | Error message from resource execution   |
| `createdAt`       | string (ISO 8601)       | Creation timestamp                      |
| `updatedAt`       | string (ISO 8601)       | Last update timestamp                   |

> **Note:** `approvalNonce` and `approvalNonceExpiresAt` fields were removed in v4.0.0 (INT-524).

### ActionType Enum

| Value      | Handler                     | Auto-Execute |
| ---------- | --------------------------- | ------------ |
| `todo`     | HandleTodoActionUseCase     | Yes (>= 90%) |
| `research` | HandleResearchActionUseCase | Yes (>= 90%) |
| `note`     | HandleNoteActionUseCase     | Yes (>= 90%) |
| `link`     | HandleLinkActionUseCase     | Yes (>= 90%) |
| `calendar` | HandleCalendarActionUseCase | No           |
| `linear`   | HandleLinearActionUseCase   | No           |
| `code`     | HandleCodeActionUseCase     | Yes (>= 90%) |
| `reminder` | Not implemented             | N/A          |

> **Note (v4.1.0):** Auto-execution applies to all action types based solely on confidence threshold (`>= 90%`). Previously only link actions auto-executed. Calendar and linear still require approval because their handlers do not pass an `executeAction` dependency to the idempotent handler wrapper.

### ActionStatus Enum

| Value               | Description                            |
| ------------------- | -------------------------------------- |
| `pending`           | Approved and ready for processing      |
| `awaiting_approval` | Low confidence, requires user approval |
| `processing`        | Handler is executing                   |
| `completed`         | Successfully executed                  |
| `failed`            | Execution failed                       |
| `rejected`          | User rejected the action               |
| `archived`          | No longer relevant                     |

### ApprovalMessage

| Field         | Type              | Description                           |
| ------------- | ----------------- | ------------------------------------- |
| `id`          | string (UUID)     | Firestore document ID                 |
| `wamid`       | string            | WhatsApp message ID (indexed)         |
| `actionId`    | string            | Reference to action awaiting approval |
| `userId`      | string            | User who should approve/reject        |
| `sentAt`      | string (ISO 8601) | When approval request was sent        |
| `actionType`  | ActionType        | Action type for logging               |
| `actionTitle` | string            | Action title for logging              |

### ApprovalReplyEvent (v2.0.0, button-based in v4.0.0)

| Field          | Type              | Description                                                                                                                     |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `type`         | string            | Always `action.approval.reply`                                                                                                  |
| `replyToWamid` | string            | Original approval message wamid                                                                                                 |
| `replyText`    | string            | User's reply text (may be empty for button taps)                                                                                |
| `userId`       | string            | User ID                                                                                                                         |
| `timestamp`    | string (ISO 8601) | Reply timestamp                                                                                                                 |
| `actionId`     | string (optional) | Action ID extracted from correlation ID                                                                                         |
| `buttonId`     | string (optional) | Button ID: `approve:{actionId}`, `reject:{actionId}`, `cancel:{actionId}`, `convert:{actionId}`, `cancel-task:{taskId}:{nonce}` |
| `buttonTitle`  | string (optional) | User-visible text of the clicked button                                                                                         |

### ApprovalIntent

| Value     | Description                      |
| --------- | -------------------------------- |
| `approve` | User approved the action         |
| `reject`  | User rejected the action         |
| `unclear` | Button re-sent (no LLM fallback) |

### ResourceStatus (v3.0.0)

| Value         | Description                              |
| ------------- | ---------------------------------------- |
| `dispatched`  | Code task sent to code-agent             |
| `running`     | Code task executing                      |
| `completed`   | Code task finished successfully          |
| `failed`      | Code task failed                         |
| `cancelled`   | Code task cancelled by user              |
| `interrupted` | Code task interrupted (e.g., VM stopped) |

### CodeActionPayload (v3.0.0)

| Field              | Type              | Description                                            |
| ------------------ | ----------------- | ------------------------------------------------------ |
| `prompt`           | string            | User's request (what they want Claude to do)           |
| `workerType`       | enum              | Which model to use: opus, auto, or glm (default: auto) |
| `linearIssueId`    | string (optional) | Existing Linear issue to work on                       |
| `linearIssueTitle` | string (optional) | Title of the Linear issue                              |
| `approvalEventId`  | string (optional) | UUID for idempotency (set on approval)                 |
| `resource_url`     | string (optional) | URL of created code task (set by code-agent)           |

### ActionTransition

| Field       | Type              | Description              |
| ----------- | ----------------- | ------------------------ |
| `id`        | string            | Unique transition ID     |
| `actionId`  | string            | Reference to action      |
| `fromType`  | ActionType        | Original type            |
| `toType`    | ActionType        | Corrected type           |
| `userId`    | string            | User who made correction |
| `timestamp` | string (ISO 8601) | When correction occurred |

## Key Use Cases

### handleApprovalReply (v2.0.0, redesigned in v4.0.0)

Processes WhatsApp button taps for action approval. In v4.0.0, LLM classification was removed entirely.

**Flow:**

1. Receive `action.approval.reply` event from whatsapp-service
2. If `buttonId` starts with `cancel-task:` — handle code task cancellation (no action lookup needed)
3. If `buttonId` starts with `view-task:` — send task URL to user (no action lookup needed)
4. Look up action by `actionId` (from correlationId) or `replyToWamid` (from approval_messages)
5. If action not found (deleted/expired) — return 200 with WhatsApp notification (prevents Pub/Sub retry)
6. Verify user ownership and action is not in terminal state
7. If `buttonId` present — dispatch to `handleButtonResponse` for deterministic intent resolution
8. If text reply (no button) — re-send approval buttons via WhatsApp

**Button ID formats:**

- `approve:{actionId}` — atomically update status, execute action, send confirmation
- `reject:{actionId}` / `cancel:{actionId}` — atomically mark rejected, send confirmation
- `convert:{actionId}` — mark rejected, send "Converting to Linear issue..." message
- `cancel-task:{taskId}:{nonce}` — cancel running code task via code-agent
- `view-task:{taskId}` — send task URL to user

**Race Condition Prevention:**

```typescript
const updateResult = await actionRepository.updateStatusIf(
  action.id,
  'pending', // new status
  'awaiting_approval' // expected current status
);

if (updateResult.outcome === 'status_mismatch') {
  // Another handler already processed this - idempotent return
  return ok({ matched: true, actionId: action.id });
}
```

### buildApprovalButtons (v4.0.0)

Creates WhatsApp interactive buttons for any action type.

```typescript
// Standard buttons (all action types)
buildApprovalButtons({ actionId });
// → [{ id: 'approve:{actionId}', title: 'Approve' }, { id: 'reject:{actionId}', title: 'Reject' }]

// Code actions (extra "Convert to Issue" button)
buildApprovalButtons({
  actionId,
  extraButtons: [
    { type: 'reply', reply: { id: `convert:${actionId}`, title: 'Convert to Issue' } },
  ],
});
```

### handleCodeAction (v3.0.0, simplified in v4.0.0)

Processes code action creation requests. Sends WhatsApp message with interactive buttons (no nonces).

**Flow:**

1. Check if action should be auto-executed via `shouldAutoExecute`
2. If auto-execute: call `executeCodeAction` directly
3. Otherwise: send WhatsApp message with Approve / Reject / Convert to Issue buttons

### executeCodeAction (v3.0.0)

Executes code actions by dispatching to code-agent.

**Flow:**

1. Retrieve action from repository
2. Validate action status (must be pending, awaiting_approval, or failed)
3. Generate `approvalEventId` UUID for idempotency
4. Call `codeAgentClient.submitTask` with action payload
5. Handle error codes: `WORKER_UNAVAILABLE` (mark failed), `DUPLICATE` (return existing task), network errors
6. On success: update action to completed with `resource_url` and `approvalEventId`
7. Send WhatsApp completion notification (best-effort)

### createIdempotentActionHandler

Wraps action handlers with idempotency protection to prevent duplicate WhatsApp notifications.

**Pattern:**

```typescript
const handler = registerActionHandler(createHandleXxxActionUseCase, deps);
// Internally calls updateStatusIf(awaiting_approval, [pending, failed])
// before invoking the wrapped handler
```

## Pub/Sub Events

### Published

| Event Type       | Topic           | Payload              |
| ---------------- | --------------- | -------------------- |
| `action.created` | `actions` queue | `ActionCreatedEvent` |

### Subscribed

| Event Type              | Subscription       | Handler                            |
| ----------------------- | ------------------ | ---------------------------------- |
| `action.created`        | `actions-queue`    | `/internal/actions/process`        |
| `action.approval.reply` | `approval-replies` | `/internal/actions/approval-reply` |

## Dependencies

### Internal Services

| Service           | Purpose                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| `commands-agent`  | Create new commands from transitions                                             |
| `research-agent`  | Execute research actions                                                         |
| `todos-agent`     | Execute todo actions                                                             |
| `notes-agent`     | Execute note actions                                                             |
| `bookmarks-agent` | Execute link actions                                                             |
| `calendar-agent`  | Execute calendar actions                                                         |
| `linear-agent`    | Execute Linear issue creation actions                                            |
| `code-agent`      | Execute code tasks (Claude Code) via submitTask and cancelTaskWithNonce (v3.0.0) |
| `user-service`    | Fetch user API keys for LLM (via `@intexuraos/internal-clients/user-service`)    |

### Infrastructure

| Component                                    | Purpose                            |
| -------------------------------------------- | ---------------------------------- |
| Firestore (`actions` collection)             | Action persistence                 |
| Firestore (`actions_transitions` collection) | Type correction tracking           |
| Firestore (`approval_messages` collection)   | WhatsApp message to action mapping |
| Pub/Sub (`actions` queue)                    | Event distribution                 |
| Pub/Sub (`whatsapp-send`)                    | Notification delivery              |
| Pub/Sub (`approval-replies`)                 | Approval reply events              |

## Configuration

| Environment Variable                       | Required | Description                                               |
| ------------------------------------------ | -------- | --------------------------------------------------------- |
| `INTEXURAOS_RESEARCH_AGENT_URL`            | Yes      | Research-agent base URL                                   |
| `INTEXURAOS_USER_SERVICE_URL`              | Yes      | User-service base URL                                     |
| `INTEXURAOS_COMMANDS_AGENT_URL`            | Yes      | Commands-agent base URL                                   |
| `INTEXURAOS_TODOS_AGENT_URL`               | Yes      | Todos-agent base URL                                      |
| `INTEXURAOS_NOTES_AGENT_URL`               | Yes      | Notes-agent base URL                                      |
| `INTEXURAOS_BOOKMARKS_AGENT_URL`           | Yes      | Bookmarks-agent base URL                                  |
| `INTEXURAOS_CALENDAR_AGENT_URL`            | Yes      | Calendar-agent base URL                                   |
| `INTEXURAOS_LINEAR_AGENT_URL`              | Yes      | Linear-agent base URL                                     |
| `INTEXURAOS_CODE_AGENT_URL`                | Yes      | Code-agent base URL (v3.0.0)                              |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`      | Yes      | App settings service URL (for LLM pricing)                |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`           | Yes      | Shared secret for service-to-service calls                |
| `INTEXURAOS_GCP_PROJECT_ID`                | Yes      | Google Cloud project ID                                   |
| `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`          | Yes      | Unified actions queue topic name                          |
| `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`    | Yes      | WhatsApp send topic                                       |
| `INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC` | Yes      | Calendar preview topic                                    |
| `INTEXURAOS_WEB_APP_URL`                   | Yes      | Web app URL for notification links                        |
| `INTEXURAOS_ZAI_APP_API_KEY`               | No       | ZAI platform API key for LLM fallback via user service    |
| `INTEXURAOS_GEMINI_APP_API_KEY`            | No       | Gemini platform API key for LLM fallback via user service |

## Gotchas

**Unified queue routing**: The `/internal/actions/process` endpoint receives all action types and dynamically selects
handlers. Unknown types are ignored (action stays pending) rather than failing.

**Pub/Sub authentication**: Pub/Sub push requests use OIDC tokens validated by Cloud Run. Direct service calls use
`X-Internal-Auth` header. Both paths are supported.

**Action type correction**: When user changes action type, the old type is logged to `actions_transitions` for ML
training data.

**Duplicate link handling**: Link actions may fail with `existingBookmarkId` in payload. Use
`/actions/:id/resolve-duplicate` to skip or refresh the existing bookmark.

**Batch endpoint limit**: Maximum 50 action IDs per batch request to prevent abuse.

**Reminder actions**: The reminder type is defined in the enum but has no handler. Actions of this type remain
in pending status indefinitely.

**Auto-execution threshold**: All action types with confidence >= 90% are auto-executed immediately via `shouldAutoExecute()`. The function is purely confidence-based — no type filtering. Calendar and linear still always require approval because their handlers do not inject an `executeAction` dependency into the idempotent wrapper.

**Approval reply idempotency (v2.0.0)**: The `updateStatusIf` method uses Firestore transactions to atomically check
and update status. If the status doesn't match expectations, the operation is a no-op, preventing race conditions
when multiple Pub/Sub messages arrive concurrently.

**Text replies re-send buttons (v4.0.0)**: When a user sends a text reply to an approval message (no buttonId),
the system re-sends fresh interactive buttons. There is no LLM fallback — approval is button-only.

**Deleted action handling (v4.0.0)**: When an action is not found during approval reply processing, the endpoint
returns 200 OK (not 500) so Pub/Sub stops retrying. A WhatsApp message informs the user the action is no longer
available. Any orphaned approval_messages are cleaned up.

**Cancel-task button nonce**: The `cancel-task:{taskId}:{nonce}` button format retains nonce validation, but this
is for code task cancellation security (cancelling a running task is irreversible), not approval.

**Error codes UPPER_CASE (v4.0.0)**: Cancel-task error codes are normalized: `INVALID_NONCE`, `NONCE_EXPIRED`,
`NOT_OWNER` (HTTP 403), `TASK_NOT_CANCELLABLE`.

**Create action endpoint no longer publishes events (v3.0.0)**: The `POST /internal/actions` endpoint only creates
the action record. Event publishing is the caller's responsibility (commands-agent) to prevent duplicate events.

**Response contract enforcement**: All routes use `reply.ok()` / `reply.fail()` exclusively. Raw `reply.send()` is
forbidden unless annotated with `@allow-raw-send`.

## File Structure

```
apps/actions-agent/src/
  domain/
    models/
      action.ts              # Action entity, factory, CodeActionPayload, ResourceStatus
      actionEvent.ts         # Event schemas
      actionTransition.ts    # Type correction tracking
      approvalMessage.ts     # WhatsApp approval tracking
      approvalReplyEvent.ts  # Approval reply event schema
    ports/
      actionRepository.ts    # Action storage interface + updateStatusIf
      actionTransitionRepository.ts
      approvalMessageRepository.ts   # Approval message storage
      actionEventPublisher.ts        # Event publishing port
      notificationSender.ts  # WhatsApp notifications
      codeAgentClient.ts     # Code-agent HTTP client port (v3.0.0)
      *ServiceClient.ts      # HTTP clients for other services
    usecases/
      handleApprovalReply.ts     # WhatsApp button tap handling (v4.0.0: buttons-only)
      handleCodeAction.ts        # Code action handler with interactive buttons
      executeCodeAction.ts       # Code action execution via code-agent
      handle*Action.ts           # Pub/Sub handlers (async, all use buildApprovalButtons)
      execute*Action.ts          # Direct execution (sync)
      createIdempotentActionHandler.ts  # Idempotency wrapper
      shouldAutoExecute.ts       # Auto-execution logic
      changeActionType.ts        # Type correction
      retryPendingActions.ts     # Scheduled retry
      actionHandlerRegistry.ts   # Handler routing
    utils/
      approvalButtons.ts         # buildApprovalButtons() - unified button factory (v4.0.0)
  infra/
    firestore/
      actionRepository.ts            # Includes atomic updateStatusIf
      actionTransitionRepository.ts
      approvalMessageRepository.ts   # Approval message persistence
    pubsub/
      actionEventPublisher.ts
    http/
      codeAgentHttpClient.ts   # Code-agent HTTP client (v3.0.0)
      *ServiceHttpClient.ts    # HTTP clients for other services
    notification/
      whatsappNotificationSender.ts
  routes/
    publicRoutes.ts          # User-facing endpoints
    internalRoutes.ts        # Service-to-service + Pub/Sub (includes approval-reply)
  services.ts                # DI container
```
