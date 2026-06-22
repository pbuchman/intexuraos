# INT-1672 - Agent-First User Input Architecture Investigation

**Status:** Investigation complete. This document is a migration proposal only; it does not make runtime behavior changes.

**Linear:** [INT-1672](https://linear.app/pbuchman/issue/INT-1672)

**Goal:** Simplify the commands-agent and actions-agent split so user input is handled by an agent-first system that can understand broad requests from WhatsApp and other supported sources, select from a curated set of tools, and execute or ask for confirmation without a separate classification-to-dispatch handoff.

## Recommendation

Keep `commands-agent` as the user-input boundary and evolve it into an agent-first input orchestrator. Retire `actions-agent` as a separate service after a staged migration.

The current split is useful for auditability, approvals, and retry behavior, but it forces user input through a static type classifier and then through another service that performs the real work. The simpler target is:

1. Ingest user input from WhatsApp, voice transcription, and PWA commands into `commands-agent`.
2. Persist the input for audit and idempotency.
3. Run a tool-calling input agent over a curated tool catalog.
4. Execute supported tools directly or create a confirmation session when confidence, risk, or missing details require user approval.
5. Send user-facing confirmations through the existing WhatsApp notification path.

This keeps the important durability properties while removing the duplicated action model, action queue, and command-to-action service boundary.

## Current Architecture

The system currently has two orchestration layers:

- `commands-agent` owns input ingestion, command persistence, and LLM classification.
- `actions-agent` owns action persistence, confidence gates, approvals, retries, and downstream service calls.

Important evidence from the current code:

- WhatsApp text and voice events are normalized into `command.ingest` events in `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts:830` and `apps/whatsapp-service/src/domain/whatsapp/usecases/handleTranscriptionCompleted.ts:135`.
- `commands-agent` declares `POST /internal/commands` in `apps/commands-agent/src/routes/internalRoutes.ts:11`, decodes the Pub/Sub message at `apps/commands-agent/src/routes/internalRoutes.ts:107`, and calls `processCommandUseCase` at `apps/commands-agent/src/routes/internalRoutes.ts:141`.
- Commands are persisted before classification in `apps/commands-agent/src/domain/usecases/processCommand.ts:199`.
- The classifier prompt only returns one static type, confidence, title, and reasoning. See `packages/llm-prompts/src/classification/commandClassifierPrompt.ts:28` and the action type enum in `packages/llm-prompts/src/classification/contextSchemas.ts:11`.
- `commands-agent` creates actions by calling `actions-agent` through `packages/internal-clients/src/actions-agent/client.ts:76`, then publishes `action.created` in `apps/commands-agent/src/domain/usecases/processCommand.ts:285`.
- `actions-agent` persists an action in `apps/actions-agent/src/infra/firestore/actionRepository.ts:81`, then processes it through `/internal/actions/process` in `apps/actions-agent/src/routes/internalRoutes.ts:335`.
- `actions-agent` gates low-confidence work through approvals in `apps/actions-agent/src/domain/usecases/handleActionTemplate.ts:35`.
- Existing handlers already represent the practical tool surface: todos, notes, links, calendar, research, Linear, and code in `apps/actions-agent/src/domain/usecases/actionHandlerRegistry.ts:15`.

There is also duplication between the services:

- Both services define action-like models and events.
- Both services publish or consume `action.created`.
- `actions-agent` calls back to `commands-agent` to fetch command details for some handlers, including link handling and action type changes.
- Terraform and local process config carry separate `commands-ingest`, `actions-queue`, and approval-reply delivery paths for what is one user-input workflow.

## Target Architecture

`commands-agent` becomes the input agent:

```text
WhatsApp / voice / PWA input
  -> command.ingest or POST /commands
  -> commands-agent persists input
  -> tool-calling input agent selects supported tool(s)
  -> direct downstream service call or confirmation session
  -> WhatsApp/PWA confirmation and resource status update
```

The first implementation should use a curated tool catalog rather than exposing every internal OpenAPI route. `cron-agent` already proves the tool-calling pattern with `apps/cron-agent/src/domain/use-cases/execute-action.ts:20` and `apps/cron-agent/src/infra/openapi-tool-registry.ts:7`, but user input from WhatsApp should start narrower because it is conversational, high-volume, and user-facing.

The input agent should have these initial tools:

| User intent | Tool | Existing implementation to reuse | Target owner |
| --- | --- | --- | --- |
| Create a todo | `create_todo` | `apps/actions-agent/src/domain/usecases/executeTodoAction.ts` | `commands-agent` tool adapter calling `todos-agent` |
| Create a note | `create_note` | `apps/actions-agent/src/domain/usecases/executeNoteAction.ts` | `commands-agent` tool adapter calling `notes-agent` |
| Save a link | `save_bookmark` | `apps/actions-agent/src/domain/usecases/executeLinkAction.ts` | `commands-agent` tool adapter calling `bookmarks-agent` |
| Create calendar event | `preview_calendar_action`, `execute_calendar_action` | `apps/actions-agent/src/domain/usecases/handleCalendarAction.ts` and `executeCalendarAction.ts` | `commands-agent` tool adapter calling `calendar-agent` |
| Create research draft | `create_research_draft` | `apps/actions-agent/src/domain/usecases/executeResearchAction.ts` | `commands-agent` tool adapter calling `research-agent` |
| Create Linear issue | `create_linear_issue` | `apps/actions-agent/src/domain/usecases/executeLinearAction.ts` | `commands-agent` tool adapter calling `linear-agent` |
| Start code task | `submit_code_task` | `apps/actions-agent/src/domain/usecases/executeCodeAction.ts` | `commands-agent` tool adapter calling `code-agent` |
| Ask for confirmation | `request_confirmation` | Approval session flow in `apps/actions-agent/src/domain/usecases/handleApprovalReply.ts` | `commands-agent` session store |

`reminder` is currently a classifier type but has no registered `actions-agent` handler. Do not expose `create_reminder` as an active tool until there is a real downstream implementation.

## What Changes

### Commands-Agent

`commands-agent` changes from "classify and enqueue action" to "persist input and run tools."

Expected new internal modules:

- `domain/input-agent`: owns prompt construction, tool-call loop, max-iteration limits, and clarification responses.
- `domain/tools`: curated tool definitions and Zod schemas for each supported action.
- `domain/sessions`: durable confirmation sessions, idempotency keys, status updates, and user-visible execution results.
- `infra/tool-adapters`: thin clients around existing internal service clients.

The curated tool registry is a module boundary, not an HTTP endpoint. It should define the allowed tool names, input schemas, side-effect policy, confirmation requirement, and adapter function for each supported tool.

The current command document can remain as the audit root. Add a new `command_sessions` collection owned by `commands-agent` and registered in `firestore-collections.json`; do not have `commands-agent` write the existing `actions`, `actions_transitions`, or `approval_messages` collections while those remain owned by `actions-agent`. During compatibility, old action records should be served by `actions-agent` shims or moved through an explicit ownership-transfer/data-migration step.

### Actions-Agent

`actions-agent` should be treated as a migration source, not the permanent owner of execution:

- Port side-effecting execution orchestration into `commands-agent` domain use cases and tool adapters. Share only DTOs, Zod contracts, and internal client wrappers through packages if needed.
- Move approval reply handling into `commands-agent`.
- Keep compatibility shims for old action routes until all producers and consumers are switched.
- Remove the service, action queue, and related Terraform only after production traffic proves the new input path.

### Tool Selection

The input agent should not be a strict one-label classifier. It should receive user text, source metadata, and allowed tools, then either:

- call exactly one tool;
- call a small sequence of tools when explicitly requested and safe;
- ask a clarification question;
- create a confirmation session for risky or ambiguous actions;
- decline unsupported work with a concise explanation.

The prompt should constrain the supported range instead of trying to classify every input into a known enum.

### Approval and Confirmation

The approval behavior is valuable and should survive the service consolidation.

Keep these concepts:

- confidence or risk threshold for auto-execution;
- WhatsApp approval buttons;
- approval reply correlation;
- idempotent execution after approval;
- final success or failure notification.

Move the implementation from action-centric records to input sessions. This avoids preserving `actions-agent` just to support approvals.

## Endpoint Changes

- **Modified:**
  - `POST /internal/commands` - keep the `command.ingest` consumer contract, but process the persisted input through the tool-calling input agent instead of static classification plus `actions-agent` handoff.
  - `POST /internal/retry-pending` - keep the Cloud Scheduler route, but change it from retrying `pending_classification` through the classifier/action path to retrying failed or pending command-session input-agent processing.
  - `POST /commands` - keep the public command entry point, but return command/session state from the input-agent path.
  - `POST /internal/actions/approval-reply` - compatibility phase only: keep action-keyed legacy replies in `actions-agent` until old approval messages drain; session-keyed replies should move to `commands-agent`. Do not blind-forward old replies because legacy resolution reads `approval_messages` and `actions`, which remain `actions-agent` owned during rollout.
  - `PATCH /internal/actions/:actionId/status` - compatibility phase only: forward long-running status updates to the new session status route while `code-agent` still reports action ids.
  - `GET /actions` - compatibility phase only: continue serving the web inbox from action records, session records, or a dual-read adapter until the web app moves to command sessions.
  - `PATCH /actions/:actionId` - compatibility phase only: translate status updates, archive/reject actions, and type corrections into session operations.
  - `DELETE /actions/:actionId` - compatibility phase only: keep serving the legacy delete while the web app moves to archive-only session updates, unless product explicitly chooses to preserve hard delete.
  - `POST /actions/batch` - compatibility phase only: batch fetch action/session records while the web app migrates away from action ids.
  - `POST /actions/:actionId/execute` - compatibility phase only: execute the matching session tool or return the same unsupported-type error semantics.
  - `GET /actions/:actionId/preview` - compatibility phase only: return the session preview, initially for calendar sessions.
  - `POST /actions/:actionId/resolve-duplicate` - compatibility phase only: resolve bookmark duplicate sessions with the same skip/update choices.
- **Created:**
  - `POST /internal/commands/approval-reply` - receives WhatsApp approval replies for input sessions.
  - `PATCH /internal/commands/sessions/:sessionId/status` - receives downstream status updates for long-running tool executions such as code tasks.
  - `GET /commands/sessions` - replacement web inbox list endpoint for pending, awaiting-approval, completed, failed, rejected, and archived sessions.
  - `PATCH /commands/sessions/:sessionId` - replacement endpoint for archive, reject, proceed, and type-correction style session updates.
  - `POST /commands/sessions/batch` - replacement for batch fetching visible inbox records by session id.
  - `POST /commands/sessions/:sessionId/execute` - replacement for manual execution from the web inbox.
  - `GET /commands/sessions/:sessionId/preview` - replacement for calendar preview and any future previewable tool sessions.
  - `POST /commands/sessions/:sessionId/resolve-duplicate` - replacement for bookmark duplicate conflict resolution.
- **Removed:**
  - Final state only: `POST /internal/actions`, `POST /internal/actions/process`, `POST /internal/actions/:actionType`, `POST /internal/actions/retry-pending`, `POST /internal/actions/approval-reply`, and `PATCH /internal/actions/:actionId/status` after producers have moved.
  - Final state only: `GET /actions`, `PATCH /actions/:actionId`, `DELETE /actions/:actionId`, `POST /actions/batch`, `POST /actions/:actionId/execute`, `GET /actions/:actionId/preview`, and `POST /actions/:actionId/resolve-duplicate` after the web app uses command-session routes.
  - The `actions-queue` Pub/Sub topic and push subscription after no code path publishes `action.created`.
  - The `approval-reply` subscription target to `actions-agent` after new WhatsApp approval replies point to `commands-agent` and old action-keyed approvals have drained.
  - The standalone `actions-agent` service, PM2 entry, route ownership, and Terraform service wiring after compatibility windows close.
- **Unchanged:**
  - `GET /commands`, `PATCH /commands/:commandId`, and `DELETE /commands/:commandId` - keep command-history list, archive/update, and delete behavior separate from the new command-session inbox.
  - `GET /internal/commands/:commandId` - keep the commands-owned internal lookup route during compatibility for existing action flows such as link execution and type correction. It can remain after `actions-agent` retirement as a general command lookup route because it does not require action-owned collections.
  - WhatsApp webhook ingestion and transcription completion routes.
  - The `command.ingest` event shape for the first migration phase.
  - Downstream internal APIs for `notes-agent`, `todos-agent`, `bookmarks-agent`, `calendar-agent`, `research-agent`, `linear-agent`, and `code-agent`.
  - `whatsapp-send-message` publishing for user-facing confirmations.

## Web Inbox Replacement

The web app currently treats public `actions-agent` routes as the pending-work inbox. The session replacement must preserve these user workflows before `actions-agent` can be removed.

| Current action workflow | Current endpoint | Session replacement |
| --- | --- | --- |
| List pending and historical work | `GET /actions` | `GET /commands/sessions` |
| Archive, reject, proceed, or correct type | `PATCH /actions/:actionId` | `PATCH /commands/sessions/:sessionId` |
| Delete an item | `DELETE /actions/:actionId` | Archive through `PATCH /commands/sessions/:sessionId`; preserving hard delete is a product decision for a later API |
| Batch hydrate items by id | `POST /actions/batch` | `POST /commands/sessions/batch` |
| Manually execute a pending item | `POST /actions/:actionId/execute` | `POST /commands/sessions/:sessionId/execute` |
| View a calendar preview | `GET /actions/:actionId/preview` | `GET /commands/sessions/:sessionId/preview` |
| Resolve duplicate bookmark conflicts | `POST /actions/:actionId/resolve-duplicate` | `POST /commands/sessions/:sessionId/resolve-duplicate` |

The replacement session model should keep the fields needed by those screens: user id, source command id, selected tool, confidence or risk metadata, title, status, tool payload, preview payload, result resource URL, error details, timestamps, and correction history.

The web app also has a direct Firestore live-update path: `apps/web/src/hooks/useActionChanges.ts:89` listens to the `actions` collection. Replace it with a `command_sessions` listener, or dual-listen to `actions` and `command_sessions` during rollout. The implementation PR must add the required Firestore security rules and composite indexes for `command_sessions` before switching the inbox refresh path.

## Command Session Data Model

Create `command_sessions` as a `commands-agent` owned collection and add it to `firestore-collections.json` in the implementation PR. Each session should reference its source command id and store tool selection, risk/confirmation state, status, preview data, result metadata, error details, timestamps, and the active approval correlation metadata.

If user corrections or status history must remain queryable, create a `command_session_transitions` collection owned by `commands-agent` for that history. If the old `actions` collection must stay readable during rollout, keep those writes and reads behind `actions-agent` compatibility endpoints until the web app migrates. If production data needs to survive after retiring `actions-agent`, run an explicit migration from `actions`, `actions_transitions`, and `approval_messages` into `command_sessions` and `command_session_transitions`, then update Firestore ownership metadata as part of that migration.

## Non-HTTP Consumers

Do not treat this migration as HTTP-only. The following non-HTTP paths must move with the service simplification:

- Cloud Scheduler calls `commands-agent` `POST /internal/retry-pending`, declared in `apps/commands-agent/src/routes/internalRoutes.ts:169`. Today `retryPendingCommands` retries `pending_classification` and creates actions through `actions-agent` at `apps/commands-agent/src/domain/usecases/retryPendingCommands.ts:92`. The replacement should retry command sessions through the input-agent path and update scheduler naming, route ownership, metrics, and response fields if the endpoint contract changes.
- The web inbox uses the `actions` Firestore listener in `apps/web/src/hooks/useActionChanges.ts:89`. Move that listener to `command_sessions` or dual-listen during rollout, with matching security rules and indexes.
- WhatsApp approval replies arrive through the `approval-reply` Pub/Sub push subscription. Old action-keyed approvals must stay resolvable by `actions-agent` until drained; new session-keyed approvals can use `commands-agent`. If a central commands route receives a legacy reply, it must call an `actions-agent` compatibility endpoint instead of reading action-owned collections directly.

## Migration Plan

### Phase 1: Add the Agent-First Path Behind a Flag

- Add a curated tool catalog to `commands-agent`.
- Port the simplest handlers first: note, todo, bookmark.
- Persist an input session beside the command document.
- Keep the existing classifier and `actions-agent` handoff as the fallback path.
- Add golden tests for tool selection, unsupported requests, missing-detail clarification, and idempotency.

### Phase 2: Move Calendar and Approval Flows

- Add calendar preview and execution tools.
- Move approval reply handling into `commands-agent`.
- Preserve old `/internal/actions/approval-reply` for in-flight action approvals until they drain; only route new session-keyed approvals to `commands-agent`.
- Confirm WhatsApp button metadata can address the new session id.

### Phase 3: Move Long-Running and External Work

- Port research, Linear, and code task tools.
- Add the replacement status callback route for code tasks.
- Keep old action status callbacks until `code-agent` is updated.
- Confirm important WhatsApp completion notifications remain marked as important when they are primary confirmations.

### Phase 4: Cut Over Producers and Consumers

- Switch WhatsApp and PWA command processing to the agent-first path by default.
- Update web inbox surfaces from action records to command sessions or dual-read during rollout.
- Remove `action.created` publication from `commands-agent`.
- Disable `actions-queue` processing after the queue drains.

### Phase 5: Retire Actions-Agent

- Remove `actions-agent` from runtime config, Terraform, and route ownership.
- Drop compatibility routes and unused clients.
- Migrate or archive `actions`, `actions_transitions`, and `approval_messages` collections according to retention needs.
- Update service docs and architecture diagrams.

## Key Decisions

- Keep `commands-agent` as the single user-input owner because every source already converges there.
- Do not expose a broad OpenAPI tool registry to WhatsApp input in the first implementation; use curated tools with schemas and explicit side-effect policies.
- Preserve approval/session behavior because it is the main safety feature currently provided by `actions-agent`.
- Retire `actions-agent` only after a compatibility window. Immediate deletion would break approval replies, web inbox behavior, action retries, and code-agent status mirroring.
- Treat `reminder` as unsupported until a real handler exists.

## Risks and Open Questions

- The web app relies on public `actions-agent` routes for pending approvals, manual execution, previews, duplicate resolution, and action updates. That surface needs either dual-read support or a replacement command-session API.
- The current correction path stores `actions_transitions`. The replacement `command_session_transitions` history should preserve training and audit value.
- Calendar, Linear, and code tasks have higher external side effects than notes and todos. They should keep confirmation thresholds even if the input agent is confident.
- Multi-action requests need a product decision. The agent can support them technically, but the initial rollout should limit sequences to low-risk combinations or ask for confirmation.
- Production migration needs collection retention decisions for `commands`, `actions`, `actions_transitions`, and `approval_messages`.

## Acceptance Criteria for the First Implementation PR

- `commands-agent` has a tested tool registry with note, todo, and bookmark tools.
- The input-agent prompt can select a tool, ask a clarification, or return unsupported intent without creating an action record.
- Existing `command.ingest` and `POST /commands` callers continue to work.
- The old classifier plus `actions-agent` handoff remains available behind a fallback flag.
- Tests cover supported WhatsApp-style requests such as "create a note from this" and "add this as a todo".
- No `actions-agent` runtime deletion happens until approval replies, web inbox dependencies, and code-task status callbacks have replacements.

Calendar preview and execution should be the Phase 2 acceptance target, before the agent-first path becomes the default for WhatsApp and PWA inputs.

## Recommended Next PR

Implement the `commands-agent` curated tool catalog and input-session model behind a feature flag, then port note, todo, and bookmark execution from `actions-agent`. This gives an end-to-end agent-first path with low-risk tools while keeping the existing actions pipeline available as a fallback.
