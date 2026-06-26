# Intex Agent WhatsApp Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `intex-agent` as the WhatsApp Assistant runtime for notes and calendar events, with explicit product-visible sessions, dev/prod deployment wiring, and a session browser UI.

**Architecture:** `whatsapp-service` remains the transport adapter and publishes `intex.message.ingest`; `intex-agent` owns sessions, LLM tool orchestration, tool execution, WhatsApp replies, and read APIs. Notes are created through `notes-agent` internal HTTP, calendar events through a new structured internal endpoint on `calendar-agent`, and web reads session/timeline data through authenticated `intex-agent` routes.

**Tech Stack:** TypeScript, Fastify, Vitest, Firestore, Pub/Sub HTTP push, `@intexuraos/llm-contract`, `@intexuraos/llm-factory`, OpenRouter model `or:google/gemini-3-flash-preview`, React/Vite/Tailwind web UI.

## Global Constraints

- Do not change `commands-agent` or `actions-agent` as the implementation target for this phase.
- Route WhatsApp Assistant text and completed voice transcripts to `intex-agent` instead of `command.ingest`.
- Supported user jobs are exactly: create notes and create calendar events.
- Unsupported requests must produce a WhatsApp-facing reply that says the request is not supported yet and lists notes and calendar events.
- Sessions are product state, not separate GPT threads.
- The assistant must explicitly tell the user when a new session starts.
- The assistant must explicitly acknowledge when a previous session finished, expired, closed, cancelled, or was superseded.
- Explicit new-session commands win over pending clarifications.
- The selected tool-calling model is `or:google/gemini-3-flash-preview`.
- Every HTTP endpoint must call `logIncomingRequest()`.
- Pub/Sub uses HTTP push only.
- Firestore collections must be registered in `firestore-collections.json` with one owning service.
- New service env vars must be wired in `apps/<service>/src/index.ts`, `terraform/environments/dev/main.tf`, and `ecosystem.config.cjs`.
- New web service URLs must be added to `apps/web/service-manifest.json` and regenerated with `pnpm run generate:service-wiring`.
- Before commit, `pnpm run ci:tracked` must pass.

---

## File Structure

Create:

- `apps/intex-agent/package.json` - package scripts and dependencies.
- `apps/intex-agent/Dockerfile` - service image build entrypoint.
- `apps/intex-agent/tsconfig.json` - service TypeScript config.
- `apps/intex-agent/vitest.config.ts` - service coverage/test config.
- `apps/intex-agent/src/index.ts` - env validation and server bootstrap.
- `apps/intex-agent/src/server.ts` - Fastify app, plugins, health, OpenAPI, routes.
- `apps/intex-agent/src/config.ts` - env parsing and typed service config.
- `apps/intex-agent/src/services.ts` - DI container, test overrides, factory wiring.
- `apps/intex-agent/src/domain/sessions/types.ts` - session, event, status, channel, source, and repository types.
- `apps/intex-agent/src/domain/sessions/sessionController.ts` - deterministic session lifecycle rules.
- `apps/intex-agent/src/domain/sessions/sessionTimeline.ts` - timeline event builders and summaries.
- `apps/intex-agent/src/domain/agent/systemPrompt.ts` - versioned prompt constant for the tool-calling runtime.
- `apps/intex-agent/src/domain/agent/toolDefinitions.ts` - `create_note` and `create_calendar_event` tool schemas and descriptions.
- `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` - LLM tool loop adapter and structured result normalization.
- `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts` - use case for inbound WhatsApp Assistant messages.
- `apps/intex-agent/src/domain/messages/sessionCommands.ts` - explicit new-session command parser.
- `apps/intex-agent/src/domain/tools/toolExecutor.ts` - note/calendar tool execution facade.
- `apps/intex-agent/src/domain/ports/*.ts` - repository, LLM, tool, clock, ID, WhatsApp publisher, and client ports.
- `apps/intex-agent/src/infra/firestore/sessionRepository.ts` - Firestore persistence for sessions and events.
- `apps/intex-agent/src/infra/http/notesAgentClient.ts` - internal notes client.
- `apps/intex-agent/src/infra/http/calendarAgentClient.ts` - internal calendar client.
- `apps/intex-agent/src/infra/pubsub/decoder.ts` - Pub/Sub push payload decoder for `intex.message.ingest`.
- `apps/intex-agent/src/infra/pubsub/whatsappReplyPublisher.ts` - `whatsapp.message.send` publisher adapter.
- `apps/intex-agent/src/routes/internalRoutes.ts` - `POST /internal/intex-agent/messages`.
- `apps/intex-agent/src/routes/sessionRoutes.ts` - `GET /intex-agent/sessions`, `GET /intex-agent/sessions/:sessionId`, `GET /intex-agent/sessions/:sessionId/events`.
- `apps/intex-agent/src/__tests__/...` - focused tests for each domain, route, and infra unit.

Modify:

- `apps/calendar-agent/src/routes/internalRoutes.ts` - add `POST /internal/calendar/events`.
- `apps/calendar-agent/src/services.ts` - expose dependencies needed by the structured internal event route if not already available.
- `packages/internal-clients/src/calendar-agent/types.ts` - add structured calendar event request/response types.
- `packages/internal-clients/src/calendar-agent/client.ts` - add `createEvent()`.
- `apps/whatsapp-service/src/domain/whatsapp/events/events.ts` - add `IntexMessageIngestEvent`.
- `apps/whatsapp-service/src/domain/whatsapp/ports/eventPublisher.ts` - add `publishIntexMessageIngest()`.
- `apps/whatsapp-service/src/infra/pubsub/publisher.ts` - publish new event type to the new topic.
- `apps/whatsapp-service/src/config.ts` - read `INTEXURAOS_PUBSUB_INTEX_MESSAGE_INGEST_TOPIC`.
- `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts` - route assistant text messages to `intex.message.ingest`.
- `apps/whatsapp-service/src/domain/whatsapp/usecases/handleTranscriptionCompleted.ts` - route completed voice transcripts to `intex.message.ingest`.
- `apps/web/service-manifest.json` - add `intex-agent` API path.
- `apps/web/src/config.ts` and generated config files - expose `intexAgentUrl`.
- `apps/web/src/services/*.ts`, `apps/web/src/hooks/*.ts`, `apps/web/src/types/index.ts` - add session API client, hook, and types.
- `apps/web/src/pages/IntexAgentSessionsPage.tsx` - add session browser page.
- `apps/web/src/App.tsx` and `apps/web/src/components/sidebar/navItems.ts` - add route/nav.
- `ecosystem.config.cjs`, `ecosystem.generated.cjs`, `.envrc.local.example` - dev PM2 and env wiring.
- `terraform/environments/dev/main.tf` - service module, Pub/Sub topic/subscription, env vars, IAM.
- `terraform/modules/iam/main.tf` - service account and permissions for `intex-agent`.
- `terraform/hetzner-prod/main.tf` and `scripts/hetzner/nginx/intexuraos.conf` - production service and nginx route.
- `tools/pubsub-ui/server.mjs`, `tools/pubsub-ui/index.html`, `tools/pubsub-ui/README.md`, `scripts/pubsub-publish-test.mjs` - Pub/Sub emulator registration and manual test template.
- `firestore-collections.json` - register `intex_agent_sessions` and `intex_agent_session_events`.
- `docs/architecture/api-contracts.md` and validation docs as needed by generated contract checks.

## Endpoint Changes

### Created

- `POST /internal/intex-agent/messages` - internal Pub/Sub push endpoint for WhatsApp Assistant text and transcription events.
- `GET /intex-agent/sessions` - authenticated web route listing current user's sessions.
- `GET /intex-agent/sessions/:sessionId` - authenticated web route reading a single current-user session.
- `GET /intex-agent/sessions/:sessionId/events` - authenticated web route reading current-user session timeline.
- `POST /internal/calendar/events` - internal structured calendar event creation endpoint for `intex-agent`.

### Modified

- `whatsapp-service` text-message processing publishes `intex.message.ingest` for Assistant messages.
- `whatsapp-service` transcription-completed processing publishes `intex.message.ingest` for Assistant voice transcripts.
- Web service wiring adds `/api/intex-agent`.
- Pub/Sub emulator and Terraform add the `intex-message-ingest` topic and HTTP push subscription.

### Removed

- No endpoint is removed in this phase.

### Unchanged

- `commands-agent` remains available with `POST /internal/commands`, `POST /internal/retry-pending`, and `GET /internal/commands/:commandId`.
- `actions-agent` remains available for current action flows.
- Existing `whatsapp.message.send` transport remains the outbound reply mechanism.
- Existing `POST /internal/notes` remains the note creation endpoint used by the new tool.

---

## Task 1: Session Domain Lifecycle

**Files:**

- Create: `apps/intex-agent/src/domain/sessions/types.ts`
- Create: `apps/intex-agent/src/domain/messages/sessionCommands.ts`
- Create: `apps/intex-agent/src/domain/sessions/sessionController.ts`
- Create: `apps/intex-agent/src/domain/sessions/sessionTimeline.ts`
- Test: `apps/intex-agent/src/__tests__/domain/sessionController.test.ts`
- Test: `apps/intex-agent/src/__tests__/domain/sessionCommands.test.ts`

**Interfaces:**

- Produces: `detectSessionCommand(text: string): SessionCommandResult`
- Produces: `decideSessionTransition(input: SessionTransitionInput): SessionTransitionDecision`
- Produces: `buildSessionStartedEvent(session: IntexAgentSession): IntexAgentSessionEventDraft`

- [ ] **Step 1: Write failing tests for explicit new-session commands**

Write tests proving `/new`, `new session`, and `new session: <request>` are recognized, return the remaining request text when present, and do not treat ordinary note content as a session command.

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/sessionCommands.test.ts`

Expected before implementation: FAIL because the package and function do not exist.

- [ ] **Step 2: Implement the command parser**

Implement a pure parser that returns `{ kind: 'none' }`, `{ kind: 'start_new', requestText: null }`, or `{ kind: 'start_new', requestText: string }`. The parser trims whitespace and keeps the remaining request text exactly enough for the agent to process it as the first turn in the new session.

- [ ] **Step 3: Verify command parser**

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/sessionCommands.test.ts`

Expected after implementation: PASS.

- [ ] **Step 4: Write failing tests for session transition decisions**

Cover these cases: no active session starts with `no_active_session`; completed prior session starts with `previous_completed`; waiting session plus ordinary reply continues same session; waiting session plus explicit new command supersedes prior session and starts a new one; active expired session closes with `expired` then starts a new session.

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/sessionController.test.ts`

Expected before implementation: FAIL because transition code does not exist.

- [ ] **Step 5: Implement session transition decisions**

Implement the pure state machine without Firestore, HTTP, Pub/Sub, or LLM dependencies. Return decision objects only; persistence and replies happen in later tasks.

- [ ] **Step 6: Verify session transition tests**

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/sessionController.test.ts`

Expected after implementation: PASS.

## Task 2: Intex Agent Service Skeleton And Routes

**Files:**

- Create: `apps/intex-agent/package.json`
- Create: `apps/intex-agent/Dockerfile`
- Create: `apps/intex-agent/tsconfig.json`
- Create: `apps/intex-agent/vitest.config.ts`
- Create: `apps/intex-agent/src/index.ts`
- Create: `apps/intex-agent/src/config.ts`
- Create: `apps/intex-agent/src/server.ts`
- Create: `apps/intex-agent/src/services.ts`
- Create: `apps/intex-agent/src/routes/internalRoutes.ts`
- Create: `apps/intex-agent/src/routes/sessionRoutes.ts`
- Test: `apps/intex-agent/src/__tests__/server.test.ts`
- Test: `apps/intex-agent/src/__tests__/routes/sessionRoutes.test.ts`

**Interfaces:**

- Consumes: domain lifecycle interfaces from Task 1.
- Produces: `buildServer(): Promise<FastifyInstance>`, `initServices(config: ServiceConfig): void`, `setServices(s: ServiceContainer): void`, `resetServices(): void`.

- [ ] **Step 1: Write failing route tests**

Use `app.inject()` and `setServices({ fakes })`. Cover health route availability, internal message route request logging/auth shape, session list returning current-user sessions, session get enforcing current user ownership, and session events returning chronological events.

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/server.test.ts src/__tests__/routes/sessionRoutes.test.ts`

Expected before implementation: FAIL because service files do not exist.

- [ ] **Step 2: Implement service skeleton**

Follow existing app patterns: Fastify, `intexuraFastifyPlugin`, `fastifyAuthPlugin`, `registerHealthCheck`, Swagger, `disableRequestLogging: true`, and `logIncomingRequest()` on each route.

- [ ] **Step 3: Verify route tests**

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/server.test.ts src/__tests__/routes/sessionRoutes.test.ts`

Expected after implementation: PASS.

## Task 3: Inbound Message Use Case And Tool Policy

**Files:**

- Create: `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`
- Create: `apps/intex-agent/src/domain/agent/systemPrompt.ts`
- Create: `apps/intex-agent/src/domain/agent/toolDefinitions.ts`
- Create: `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`
- Create: `apps/intex-agent/src/domain/tools/toolExecutor.ts`
- Test: `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`
- Test: `apps/intex-agent/src/__tests__/domain/toolDefinitions.test.ts`
- Test: `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`

**Interfaces:**

- Consumes: `SessionRepository`, `SessionTransitionDecision`, `WhatsAppReplyPublisher`, `ToolExecutor`, `ToolCallingClient`.
- Produces: `handleIncomingMessage(input, deps): Promise<Result<HandleIncomingMessageResult, Error>>`.

- [ ] **Step 1: Write failing tests for the five core conversation outcomes**

Cover: note one-message completion; calendar one-message completion; calendar missing date asks clarification and keeps session waiting; clarification answer continues same session and executes calendar tool; unsupported request replies unsupported and closes session as `unsupported`.

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/handleIncomingMessage.test.ts`

Expected before implementation: FAIL because the use case does not exist.

- [ ] **Step 2: Write failing tests for tool definitions**

Assert both tools exist, descriptions contain clear use conditions, unsupported intent is not a tool, and calendar description says missing date/time/title must trigger clarification before tool execution.

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/toolDefinitions.test.ts`

Expected before implementation: FAIL because tool definitions do not exist.

- [ ] **Step 3: Implement prompt and tools**

Add a versioned prompt constant with `version: '0.1.0'`, the selected model documented next to the runner factory, and tool definitions for `create_note` and `create_calendar_event`.

- [ ] **Step 4: Implement use case with fake-friendly ports**

The use case writes timeline events for session start, user message, assistant clarification, unsupported reply, tool call start, tool result, assistant confirmation, and session close. It publishes WhatsApp replies only after persistence succeeds.

- [ ] **Step 5: Verify message and tool tests**

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/domain/handleIncomingMessage.test.ts src/__tests__/domain/toolDefinitions.test.ts src/__tests__/domain/intexAgentRunner.test.ts`

Expected after implementation: PASS.

## Task 4: Persistence And Pub/Sub Adapters

**Files:**

- Create: `apps/intex-agent/src/infra/firestore/sessionRepository.ts`
- Create: `apps/intex-agent/src/infra/pubsub/decoder.ts`
- Create: `apps/intex-agent/src/infra/pubsub/whatsappReplyPublisher.ts`
- Test: `apps/intex-agent/src/__tests__/infra/firestore/sessionRepository.test.ts`
- Test: `apps/intex-agent/src/__tests__/infra/pubsub/decoder.test.ts`
- Test: `apps/intex-agent/src/__tests__/infra/pubsub/whatsappReplyPublisher.test.ts`
- Modify: `firestore-collections.json`

**Interfaces:**

- Consumes: domain repository and publisher ports.
- Produces: Firestore repository that stores sessions in `intex_agent_sessions` and events in `intex_agent_session_events`.

- [ ] **Step 1: Write failing adapter tests**

Use in-memory Firestore/test fakes where the repo already supports them. Cover user-scoped session listing, active-session lookup by channel, event chronological reads, Pub/Sub event type validation, and WhatsApp reply event shape.

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/infra/firestore/sessionRepository.test.ts src/__tests__/infra/pubsub/decoder.test.ts src/__tests__/infra/pubsub/whatsappReplyPublisher.test.ts`

Expected before implementation: FAIL because adapters do not exist.

- [ ] **Step 2: Implement adapters**

Persist server timestamps as ISO strings at the domain boundary. Reject Pub/Sub messages whose decoded `type` is not `intex.message.ingest`.

- [ ] **Step 3: Register Firestore ownership**

Add `intex_agent_sessions` and `intex_agent_session_events` with owner `intex-agent`.

- [ ] **Step 4: Verify adapter tests and Firestore ownership**

Run: `pnpm --filter @intexuraos/intex-agent test -- src/__tests__/infra/firestore/sessionRepository.test.ts src/__tests__/infra/pubsub/decoder.test.ts src/__tests__/infra/pubsub/whatsappReplyPublisher.test.ts`

Run: `pnpm run verify:firestore`

Expected after implementation: both commands PASS.

## Task 5: Calendar Internal Event Endpoint And Internal Client

**Files:**

- Modify: `apps/calendar-agent/src/routes/internalRoutes.ts`
- Modify: `packages/internal-clients/src/calendar-agent/types.ts`
- Modify: `packages/internal-clients/src/calendar-agent/client.ts`
- Test: `apps/calendar-agent/src/__tests__/routes/internalRoutes.createEvent.test.ts`
- Test: `packages/internal-clients/src/calendar-agent/client.test.ts`

**Interfaces:**

- Produces: `POST /internal/calendar/events`
- Produces: `CalendarAgentClient.createEvent(request): Promise<Result<CalendarCreateEventResponse, InternalClientError>>`

- [ ] **Step 1: Write failing route tests**

Cover internal auth, request validation, call into existing `createEvent()` use case, and response with created event ID/link.

Run: `pnpm --filter @intexuraos/calendar-agent test -- src/__tests__/routes/internalRoutes.createEvent.test.ts`

Expected before implementation: FAIL because the endpoint does not exist.

- [ ] **Step 2: Write failing internal-client tests**

Cover POST path `/internal/calendar/events`, internal auth header, success parse, validation failure mapping, and downstream error mapping.

Run: `pnpm --filter @intexuraos/internal-clients test -- src/calendar-agent/client.test.ts`

Expected before implementation: FAIL for missing client method.

- [ ] **Step 3: Implement endpoint and client**

Reuse `apps/calendar-agent/src/domain/useCases/createEvent.ts`; do not duplicate Google Calendar logic.

- [ ] **Step 4: Verify calendar route and client**

Run both commands from Steps 1 and 2.

Expected after implementation: PASS.

## Task 6: WhatsApp Routing To Intex Agent

**Files:**

- Modify: `apps/whatsapp-service/src/domain/whatsapp/events/events.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/eventPublisher.ts`
- Modify: `apps/whatsapp-service/src/infra/pubsub/publisher.ts`
- Modify: `apps/whatsapp-service/src/config.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/handleTranscriptionCompleted.ts`
- Test: existing WhatsApp service tests that currently assert command ingest publishing.

**Interfaces:**

- Produces: `IntexMessageIngestEvent` with `type: 'intex.message.ingest'`, `userId`, `messageId`, `text`, `sourceType`, `whatsappSender`, `timestamp`, and correlation fields.
- Produces: `EventPublisher.publishIntexMessageIngest(event)`.

- [ ] **Step 1: Update failing tests first**

Change tests to expect `publishIntexMessageIngest()` for ordinary Assistant text and completed voice transcripts, while approval replies with known action IDs still skip assistant ingest.

Run: `pnpm --filter @intexuraos/whatsapp-service test -- src/__tests__/usecases/handleTranscriptionCompleted.test.ts src/__tests__/webhookAsyncProcessing.test.ts src/__tests__/infra/pubsubPublisher.test.ts`

Expected before implementation: FAIL because production code still publishes command ingest.

- [ ] **Step 2: Implement new event type and publisher method**

Keep existing command ingest code available for flows that still use it. Add the new topic config and publish method without deleting command ingest.

- [ ] **Step 3: Route assistant messages to the new event**

Update ordinary text and completed transcription paths to publish `intex.message.ingest`. Keep approval reply behavior intact.

- [ ] **Step 4: Verify WhatsApp routing tests**

Run the command from Step 1.

Expected after implementation: PASS.

## Task 7: Dev And Prod Wiring

**Files:**

- Modify: `ecosystem.config.cjs`
- Modify: `.envrc.local.example`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `terraform/modules/iam/main.tf`
- Modify: `terraform/hetzner-prod/main.tf`
- Modify: `scripts/hetzner/nginx/intexuraos.conf`
- Modify: `tools/pubsub-ui/server.mjs`
- Modify: `tools/pubsub-ui/index.html`
- Modify: `tools/pubsub-ui/README.md`
- Modify: `scripts/pubsub-publish-test.mjs`
- Modify: `apps/web/service-manifest.json`
- Generated: `apps/web/src/config.generated.ts`
- Generated: `ecosystem.generated.cjs`
- Generated: `terraform/environments/dev/service-urls.auto.tfvars.json`

**Interfaces:**

- Produces: PM2 service `intex-agent` on a free port.
- Produces: dev/prod nginx path `/api/intex-agent`.
- Produces: Pub/Sub topic alias `intex-message-ingest` for dev PM2.

- [ ] **Step 1: Write or update infrastructure validation tests first**

Update existing tests for service manifest, ecosystem service list, Hetzner nginx routing, and Pub/Sub topic registration to expect `intex-agent` and `intex-message-ingest`.

Run: `pnpm vitest run scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts`

Expected before implementation: FAIL because wiring is absent.

- [ ] **Step 2: Add service and Pub/Sub wiring**

Use PM2 emulator topic aliases for dev and Terraform-managed names for retained GCP resources. Add all required env vars in the three required locations.

- [ ] **Step 3: Regenerate service wiring**

Run: `pnpm run generate:service-wiring`

Expected: generated files change for `INTEXURAOS_INTEX_AGENT_URL`.

- [ ] **Step 4: Verify wiring**

Run: `pnpm vitest run scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts`

Run: `pnpm run verify:service-wiring`

Expected after implementation: PASS.

## Task 8: Web Session Browser

**Files:**

- Create: `apps/web/src/services/intexAgentApi.ts`
- Create: `apps/web/src/hooks/useIntexAgentSessions.ts`
- Create: `apps/web/src/pages/IntexAgentSessionsPage.tsx`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/config.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/sidebar/navItems.ts`
- Test: `apps/web/src/services/intexAgentApi.test.ts`
- Test: `apps/web/src/hooks/useIntexAgentSessions.test.ts`

**Interfaces:**

- Consumes: `GET /intex-agent/sessions`, `GET /intex-agent/sessions/:sessionId`, `GET /intex-agent/sessions/:sessionId/events`.
- Produces: hash route `/#/intex-agent/sessions`.

- [ ] **Step 1: Write failing service and hook tests**

Cover request paths, envelope parsing, current-user session list behavior, selected session event loading, loading state, and error state.

Run: `pnpm --filter @intexuraos/web test -- src/services/intexAgentApi.test.ts src/hooks/useIntexAgentSessions.test.ts`

Expected before implementation: FAIL because files do not exist.

- [ ] **Step 2: Implement API service and hook**

Follow existing web API service and hook patterns. Do not use raw fetch if the repo wrapper is required.

- [ ] **Step 3: Implement UI**

Use a left session rail and right timeline panel similar to the Private WhatsApp conversation UI. Show session status, start/end reasons, user messages, assistant messages, clarifications, tool calls, and tool results.

- [ ] **Step 4: Verify web tests and hash routing**

Run: `pnpm --filter @intexuraos/web test -- src/services/intexAgentApi.test.ts src/hooks/useIntexAgentSessions.test.ts`

Run: `pnpm run verify:hash-routing`

Expected after implementation: PASS.

## Task 9: Scenario Contract And End-To-End Readiness

**Files:**

- Modify: `docs/superpowers/specs/2026-06-24-intex-agent-dev-api-test-scenarios.md`
- Create: `docs/services/intex-agent/technical.md`
- Create: `docs/services/intex-agent/features.md`

**Interfaces:**

- Consumes: implemented endpoints and UI from earlier tasks.
- Produces: docs that another agent can use to verify dev deployment by API.

- [ ] **Step 1: Align scenario docs with final endpoint names**

Ensure the scenario file names the actual dev ingress route and the actual session read routes implemented in Tasks 2 and 6.

- [ ] **Step 2: Document service endpoints and behavior**

Write concise service docs for internal ingest, web session APIs, tool behavior, session lifecycle, and unsupported requests.

- [ ] **Step 3: Verify documentation references**

Run: `pnpm run verify:endpoints`

Expected after implementation: PASS.

## Task 10: Final Verification

**Files:**

- All changed files.

**Interfaces:**

- Consumes: all prior task deliverables.
- Produces: a verified branch ready for PR.

- [ ] **Step 1: Run workspace-targeted verification**

Run:

```bash
pnpm run verify:workspace:tracked -- intex-agent
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:workspace:tracked -- calendar-agent
pnpm run verify:workspace:tracked -- web
```

Expected: every command exits 0.

- [ ] **Step 2: Run global tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: exits 0.

- [ ] **Step 3: Review goal requirements against evidence**

Check the design spec, dev API scenario spec, endpoint list, service wiring, route tests, domain tests, web tests, and CI output. Every explicit requirement must have direct evidence.

- [ ] **Step 4: Commit only after the commit gate passes**

If no Linear issue ID is available, do not fabricate one. Ask the user before creating a PR title/body that requires `INT-XXX`.
