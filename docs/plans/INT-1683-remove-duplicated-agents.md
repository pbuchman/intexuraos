# Remove Duplicated Agents Implementation Plan

> **For Codex console workers:** Use one primary Codex console session to execute this plan sequentially. Codex subagents may review the work, but do not split implementation through the IntexuraOS code-task system. Steps use checkbox (`- [ ]`) syntax for tracking. Before implementation, update the working branch from `origin/development`; this plan was rewritten after `origin/development` already contained direct Intex tools.

**Goal:** Remove the duplicated `commands-agent` and `actions-agent` systems and leave `intex-agent` as the only runtime identity for text-only direct-tool conversations.

**Architecture:** Do not port the old command/action/approval pattern into Intex. Keep the current Intex direct-tool runtime from `origin/development` as the boundary, delete the old command/action services, and remove their callers, UI, infrastructure, docs, shared clients, and metadata. Existing Firestore data stays in place, but runtime code must stop reading or writing old command/action collections.

**Tech Stack:** TypeScript, Fastify, Vitest, React/Vite, Firestore, Pub/Sub HTTP push, Terraform, PM2, Hetzner nginx, `pnpm run ci:tracked`.

## Global Constraints

- Execute this as one primary Codex console cleanup, not as Linear child issues and not as IntexuraOS code tasks.
- Codex subagents may be used for read-only review checkpoints.
- Update from `origin/development` before editing so the current Intex direct tools are present.
- Do not add new Intex tools while doing this cleanup.
- Current supported Intex tools are only `create_note`, `create_calendar_event`, `create_research`, `create_link`, and `create_code_task`.
- Do not port old command classification, action planning, approval gates, retry-pending queues, action history, command history, or action status mirroring into Intex.
- Intex supports text messages only for now.
- Voice messages must receive an explicit unsupported response before transcription or Intex ingestion.
- Approval handling is deleted for now. Future destructive-operation approval must be designed as a new Intex tool-call policy, not restored from `actions-agent`.
- Existing Firestore documents in `commands`, `actions`, `actions_transitions`, and `approval_messages` are not deleted by this plan.
- Runtime code must not read from or write to `commands`, `actions`, `actions_transitions`, or `approval_messages` after implementation.
- Removed agent package names must not appear in runtime code, tests, generated config, Terraform, README, or user-facing docs after implementation.
- Every HTTP endpoint touched during cleanup must still call `logIncomingRequest()`.
- Before final commit, run `pnpm run ci:tracked`.

---

## Current Direct-Tool Boundary

The current branch already has direct Intex tools in:

- `apps/intex-agent/src/domain/agent/toolDefinitions.ts`
- `apps/intex-agent/src/domain/agent/toolExecutor.ts`
- `apps/intex-agent/src/domain/agent/systemPrompt.ts`

Those files are the source of truth for supported Intex work. The cleanup may adjust copy, tests, and wiring around these existing tools, but it must not recover extra behavior from `commands-agent` or `actions-agent`.

## Explicit Deletion Decisions

- Delete command/action runtime behavior instead of porting it.
- Delete command/action history APIs and UI.
- Delete approvals and approval reply matching.
- Delete code-task action-status callbacks and status mirroring.
- Delete all public command/action compatibility routes.
- Delete all internal command/action compatibility routes.
- Remove code references to old Firestore command/action collections while preserving stored data.
- Keep WhatsApp text ingestion to Intex.
- Stop voice transcription from feeding Intex; reply that voice messages are not supported yet.
- Remove command/action-specific transcription vocabulary.
- Remove command/action shared contracts, internal clients, service catalog entries, infrastructure, docs, and generated service wiring.

## Endpoint Changes

### Created

- None.

### Modified

- `POST /internal/intex-agent/messages` remains the Intex-native text ingestion route.
- WhatsApp webhook handling changes so audio/voice messages do not start transcription for Intex and instead send a text-only unsupported response.
- Code-agent routes stop mirroring task state to old action status callbacks.

### Removed

Remove these public routes from nginx, generated web config, service manifests, docs, and tests:

- `/api/commands`
- `/api/actions`

Remove these old internal routes from service catalogs, docs, tests, Pub/Sub push targets, and callers:

- `POST /internal/commands`
- `POST /internal/retry-pending`
- `GET /internal/commands/:commandId`
- `POST /internal/actions`
- `POST /internal/actions/:actionType`
- `POST /internal/actions/process`
- `POST /internal/actions/retry-pending`
- `POST /internal/actions/approval-reply`
- `PATCH /internal/actions/:actionId/status`
- `POST /internal/code/process`
- `POST /internal/whatsapp/pubsub/transcription-completed`

Do not recreate these routes under `/internal/intex-agent`.

### Unchanged

- `GET /intex-agent/sessions`
- `GET /intex-agent/sessions/:sessionId`
- `GET /intex-agent/sessions/:sessionId/events`
- Current Intex text conversation behavior.
- Current Intex direct tools listed in this plan.
- Existing downstream service APIs for notes, calendar, research, bookmarks, and code tasks that are already used by current Intex tools.
- WhatsApp outbound send topic and payload shape, except messages related only to removed approvals or voice transcription flows.

## Reference Inventory

Initial cleanup surfaces found on the updated branch:

- Delete app packages: `apps/commands-agent/**`, `apps/actions-agent/**`.
- Update Intex copy/tests only where needed: `apps/intex-agent/**`.
- Remove status mirroring, old action clients, `/internal/code/process`, and new action/approval field writes from `apps/code-agent/**`.
- Make WhatsApp text-only for Intex and delete approval, command-ingest, audio-stored, and transcription-completed flows in `apps/whatsapp-service/**`.
- Remove web command/action UI, routes, navigation, config, clients, generated service URL wiring, Firestore listeners, and stale voice/approval copy in `apps/web/**`.
- Remove old transcription vocabulary in `workers/transcription/**`.
- Remove runtime infrastructure in `ecosystem.config.cjs`, `ecosystem.config.prod.cjs`, `ecosystem.generated.cjs`, `terraform/**`, `scripts/hetzner/**`, and Pub/Sub tooling.
- Remove shared contracts/clients/catalog entries in `packages/http-contracts/**`, `packages/internal-clients/**`, and `packages/service-catalog/**`.
- Update Firestore registry/index ownership in `firestore-collections.json`, `firestore.indexes.json`, and immutable migration artifacts.
- Remove user-facing docs in `README.md`, `docs/overview.md`, `docs/services/commands-agent/**`, `docs/services/actions-agent/**`, package docs, runbooks, validation docs, and architecture docs.
- Update validation scripts and tests that hard-code removed service names.

## Task 0: Branch Sync And Baseline Inventory

**Files:**

- Read: `apps/intex-agent/src/domain/agent/toolDefinitions.ts`
- Read: `apps/intex-agent/src/domain/agent/toolExecutor.ts`
- Read: `apps/intex-agent/src/domain/agent/systemPrompt.ts`
- Read: `docs/plans/INT-1683-remove-duplicated-agents.md`

**Interfaces:**

- Consumes: latest `origin/development`.
- Produces: a clean working tree and a reference list for cleanup.

- [ ] **Step 1: Confirm branch state**

  Run: `git status --short --branch`

  Expected: current feature branch is clean or only contains intentional plan edits.

- [ ] **Step 2: Update from development**

  Run: `git fetch origin development && git merge --ff-only origin/development`

  Expected: fast-forward succeeds, or the branch is already up to date.

- [ ] **Step 3: Confirm current Intex tools**

  Run: `sed -n '1,240p' apps/intex-agent/src/domain/agent/toolDefinitions.ts`

  Expected: tool definitions contain only the current direct tools: `create_note`, `create_calendar_event`, `create_research`, `create_link`, and `create_code_task`.

- [ ] **Step 4: Capture removed-agent references**

  Run:

  ```bash
  rg -l "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commandsAgent|actionsAgent|Commands Agent|Actions Agent|commands agent|actions agent" apps packages terraform scripts tools docs README.md firestore-collections.json eslint.config.js ecosystem.config.cjs ecosystem.config.prod.cjs ecosystem.generated.cjs apps/web/service-manifest.json pnpm-lock.yaml vitest.setup.ts CHANGELOG.md | sort
  ```

  Expected before cleanup: many matches. Use this as the work queue, not as a reason to preserve behavior.

## Task 1: Delete Old App Packages And Keep Intex Direct Tools

**Files:**

- Delete: `apps/commands-agent/**`
- Delete: `apps/actions-agent/**`
- Modify: `pnpm-workspace.yaml` if it has explicit package references.
- Modify: `pnpm-lock.yaml`
- Modify: `apps/intex-agent/src/domain/agent/systemPrompt.ts`
- Modify: `apps/intex-agent/src/__tests__/domain/toolDefinitions.test.ts`
- Modify: `apps/intex-agent/src/__tests__/domain/toolExecutor.test.ts`
- Modify: `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`

**Interfaces:**

- Consumes: current Intex direct-tool definitions.
- Produces: no `@intexuraos/commands-agent` or `@intexuraos/actions-agent` packages and no new Intex command/action compatibility behavior.

- [ ] **Step 1: Write failing Intex boundary tests**

  Add or update Intex tests proving:

  - Tool definitions are limited to `create_note`, `create_calendar_event`, `create_research`, `create_link`, and `create_code_task`.
  - The system prompt says unsupported work should not call a tool.
  - The system prompt does not advertise approvals, command classification, action queues, or voice support.

  Run: `pnpm --filter @intexuraos/intex-agent test`

  Expected before cleanup: FAIL if old behavior is still referenced or prompt copy is stale.

- [ ] **Step 2: Delete old app directories**

  Remove `apps/commands-agent/**` and `apps/actions-agent/**`.

- [ ] **Step 3: Refresh workspace metadata**

  Run: `pnpm install --lockfile-only`

  Expected: `pnpm-lock.yaml` removes old app importers.

- [ ] **Step 4: Verify Intex only kept direct tools**

  Run: `pnpm --filter @intexuraos/intex-agent test`

  Expected: PASS.

- [ ] **Step 5: Verify old package names are absent from app runtime**

  Run:

  ```bash
  rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commandsAgent|actionsAgent" apps/intex-agent apps/commands-agent apps/actions-agent pnpm-lock.yaml
  ```

  Expected after cleanup: no matches, with deleted directories absent.

## Task 2: Remove Code-Agent Action Status Mirroring

**Files:**

- Delete: `apps/code-agent/src/infra/clients/actionsAgentClient.ts`
- Delete: `apps/code-agent/src/infra/services/statusMirrorServiceImpl.ts`
- Modify: `apps/code-agent/src/config.ts`
- Modify: `apps/code-agent/src/index.ts`
- Modify: `apps/code-agent/src/services.ts`
- Modify: `apps/code-agent/src/services/types.ts`
- Modify: `apps/code-agent/src/services/factories/clientFactory.ts`
- Modify: `apps/code-agent/src/services/factories/e2eMocks.ts`
- Modify: `apps/code-agent/src/domain/usecases/processCodeAction.ts`
- Modify: `apps/code-agent/src/domain/usecases/cancelTaskWithNonce.ts`
- Modify: `apps/code-agent/src/domain/usecases/handleTaskCompletion.ts`
- Modify: `apps/code-agent/src/domain/usecases/recordTaskEvent.ts`
- Modify: `apps/code-agent/src/domain/usecases/sendTaskMessage.ts`
- Modify: `apps/code-agent/src/domain/usecases/cancelTask.ts`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Modify: `apps/code-agent/src/routes/code/schemas.ts`
- Modify: `apps/code-agent/src/infra/firestore/task-serializer.ts`
- Modify: `apps/code-agent/src/infra/firestore/task-dedup.ts`
- Modify: `packages/internal-clients/src/code-agent/client.ts`
- Modify: `packages/internal-clients/src/code-agent/types.ts`
- Modify: code-agent tests that reference `actionsAgentClient`, `statusMirrorService`, `actionsAgentUrl`, or action-status callback behavior.

**Interfaces:**

- Consumes: current code-agent task creation and webhook behavior.
- Produces: code-agent with no `INTEXURAOS_ACTIONS_AGENT_URL`, no action status callback client, no action-status mirroring, no `/internal/code/process` action entrypoint, and no new `actionId`/`approvalEventId` writes.

- [ ] **Step 1: Write failing config and service composition tests**

  Update code-agent tests so they expect:

  - `INTEXURAOS_ACTIONS_AGENT_URL` is not required.
  - service composition does not create `actionsAgentClient`.
  - service composition does not create `statusMirrorService`.

  Run: `pnpm --filter @intexuraos/code-agent test`

  Expected before implementation: FAIL while removed dependencies still exist.

- [ ] **Step 2: Write failing webhook/status tests**

  Update tests around task completion, cancellation, interruption, and failure so they assert no HTTP call is made to `/internal/actions/:actionId/status`, even when old task records contain `actionId`.

  Run: `pnpm --filter @intexuraos/code-agent test`

  Expected before implementation: FAIL while status mirroring still runs.

- [ ] **Step 3: Write failing action-entrypoint removal tests**

  Update route, OpenAPI, and internal-client tests so they expect `POST /internal/code/process` to be absent and `CodeAgentServiceClient.submitTask` to no longer send old action-style payloads.

  Run: `pnpm --filter @intexuraos/code-agent test`

  Run: `pnpm --filter @intexuraos/internal-clients test`

  Expected before implementation: FAIL while the old actions-agent code-action entrypoint remains.

- [ ] **Step 4: Write failing action-field write tests**

  Update direct code-submit tests so newly created code tasks do not fabricate, persist, deduplicate by, serialize, or expose `actionId` or `approvalEventId`. Historical stored records may still contain those fields, but new writes must not create them.

  Run: `pnpm --filter @intexuraos/code-agent test`

  Expected before implementation: FAIL while direct submit paths still synthesize action/approval fields.

- [ ] **Step 5: Remove action status client and mirror service**

  Delete the client and mirror service. Remove constructor parameters, service-container properties, e2e fake methods, nock setup, and config fields that existed only for action status callbacks.

- [ ] **Step 6: Remove all mirror call sites**

  Remove `statusMirrorService` dependencies and calls from task completion, task event recording, task messages/resume, cancellation, queue/dispatch, feedback, and service wiring paths.

- [ ] **Step 7: Remove the old action code-process entrypoint**

  Delete or refactor `processCodeAction`, remove `POST /internal/code/process`, remove the internal client method and types that called it, and update OpenAPI/tests. Keep the current direct code-task creation API used by Intex tools.

- [ ] **Step 8: Stop new action/approval field writes**

  Preserve current code-agent task creation and code-task APIs. If `actionId` remains on persisted historical task records, treat it as inert legacy data and stop using it for callbacks.

- [ ] **Step 9: Verify code-agent**

  Run: `pnpm --filter @intexuraos/code-agent test`

  Run: `pnpm --filter @intexuraos/internal-clients test`

  Run: `pnpm run verify:workspace:tracked -- code-agent`

  Run: `rg -n "actions-agent|ACTIONS_AGENT|actionsAgent|ActionsAgent|statusMirrorService|updateActionStatus|/internal/code/process|approvalEventId" apps/code-agent packages/internal-clients/src/code-agent`

  Expected after cleanup: no matches except comments only if the implementation deliberately keeps a migration note. Prefer zero matches.

## Task 3: Make WhatsApp Text-Only For Intex

**Files:**

- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/processAudioMessage.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/handleTranscriptionCompleted.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/events/events.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/eventPublisher.ts`
- Modify: `apps/whatsapp-service/src/infra/pubsub/publisher.ts`
- Modify: `apps/whatsapp-service/src/config.ts`
- Modify: `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/fakes.ts`
- Modify: WhatsApp config, webhook, transcription, and publisher tests.

**Interfaces:**

- Consumes: inbound WhatsApp text messages.
- Produces: `intex.message.ingest` only for text messages.
- Produces: a clear WhatsApp reply for voice/audio messages saying voice is not supported yet.
- Produces: no `whatsapp.audio.stored`, `srt.transcription.completed`, or `whatsapp_voice` path into Intex.

- [ ] **Step 1: Write failing text-ingestion tests**

  Tests must prove a normal WhatsApp text message publishes exactly one `intex.message.ingest` event and does not publish command-ingest or approval-reply events.

  Run: `pnpm --filter @intexuraos/whatsapp-service test`

  Expected before implementation: FAIL while old publishers or approval branches remain.

- [ ] **Step 2: Write failing voice unsupported tests**

  Tests must prove audio/voice webhook messages:

  - do not request transcription for Intex,
  - do not publish `whatsapp.audio.stored`,
  - do not publish `intex.message.ingest`,
  - send a user-facing reply equivalent to: `Voice messages are not supported by Intex yet. Please send text for now.`

  Run: `pnpm --filter @intexuraos/whatsapp-service test`

  Expected before implementation: FAIL while voice transcription still feeds Intex.

- [ ] **Step 3: Write failing transcription-completed route tests**

  Tests must prove `POST /internal/whatsapp/pubsub/transcription-completed` is removed, or if an ack-only grace handler is kept for in-flight Pub/Sub messages, it must not update Intex sessions and must not publish `intex.message.ingest`.

  Run: `pnpm --filter @intexuraos/whatsapp-service test`

  Expected before implementation: FAIL while transcription completion still publishes voice text into Intex.

- [ ] **Step 4: Write failing approval deletion tests**

  Tests must prove button, interactive, reply, and reaction flows no longer publish `action.approval.reply` and no longer special-case approval correlation IDs.

  Run: `pnpm --filter @intexuraos/whatsapp-service test`

  Expected before implementation: FAIL while approval reply paths remain.

- [ ] **Step 5: Remove command/action/approval event publishers**

  Delete event types, port methods, fake state, Pub/Sub publishers, env vars, and topic config that only support command ingest or approval replies.

- [ ] **Step 6: Remove audio transcription publishing for Intex**

  Stop `processAudioMessage` from publishing `whatsapp.audio.stored` for Intex. Remove `publishAudioStored`, `audioStoredTopic`, `whatsapp.audio.stored`, `/transcription-completed`, and `srt.transcription.completed` wiring when they only exist to support voice-message transcription into Intex.

- [ ] **Step 7: Keep non-Intex WhatsApp behavior intact**

  Preserve unrelated WhatsApp storage, contacts, outbound send, delivery status, link preview extraction, and message browsing behavior.

- [ ] **Step 8: Verify WhatsApp service**

  Run: `pnpm --filter @intexuraos/whatsapp-service test`

  Run: `pnpm run verify:workspace:tracked -- whatsapp-service`

  Run: `rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|command.ingest|approval.reply|publishApprovalReply|publishCommandIngest|publishAudioStored|whatsapp.audio.stored|audioStoredTopic|/transcription-completed|srt.transcription.completed|whatsapp_voice" apps/whatsapp-service`

  Expected after cleanup: no old command/action/approval matches. `whatsapp_voice` should be absent from Intex ingestion paths.

## Task 4: Remove Web Command/Action UI And Config

**Files:**

- Delete: `apps/web/src/services/commandsApi.ts`
- Delete: `apps/web/src/pages/InboxPage.tsx` and focused `apps/web/src/pages/inbox/**` files if they only display command/action history.
- Delete: `apps/web/src/components/ActionDetailModal.tsx` if it only serves old action history.
- Delete: `apps/web/src/components/ActionItem.tsx` if it only serves old action history.
- Delete: `apps/web/src/components/CommandDetailModal.tsx` if it only serves old command history.
- Delete: `apps/web/src/components/CommandItem.tsx` if it only serves old command history.
- Delete: `apps/web/src/components/ConfigurableActionButton.tsx` if it only serves old command/action execution.
- Delete: `apps/web/src/config/action-config.yaml`
- Delete: `apps/web/src/services/actionConfigLoader.ts`
- Delete: `apps/web/src/services/actionExecutor.ts`
- Delete: `apps/web/src/hooks/useActionConfig.ts`
- Delete: `apps/web/src/services/conditionEvaluator.ts` if it only supports old action config.
- Delete: `apps/web/src/types/actionConfig.ts`
- Delete: `apps/web/src/hooks/useActionChanges.ts`
- Delete: `apps/web/src/hooks/useCommandChanges.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/pages/ShareTargetPage.tsx`
- Modify: `apps/web/src/context/SyncQueueContext.tsx`
- Modify: `apps/web/src/config.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/index.ts`
- Modify: `apps/web/src/hooks/index.ts` if present.
- Modify: `apps/web/src/components/index.ts` if present.
- Modify: `apps/web/src/components/DevBar.tsx`
- Modify: `apps/web/src/hooks/useDevBarState.ts`
- Modify: `apps/web/src/components/home/HeroSection.tsx`
- Modify: `apps/web/src/components/home/VoiceSection.tsx`
- Modify: `apps/web/src/pages/GoogleCalendarConnectionPage.tsx`
- Modify: `apps/web/src/pages/LinearConnectionPage.tsx`
- Modify: other homepage, settings, connection, or onboarding copy that advertises voice notes, voice commands, or approval-gated actions.
- Modify: `apps/web/service-manifest.json`
- Regenerate: `apps/web/src/config.generated.ts`
- Regenerate: `ecosystem.generated.cjs`
- Regenerate: `terraform/environments/dev/service-urls.auto.tfvars.json`
- Modify: web tests for removed pages, services, config, and devbar tabs.

**Interfaces:**

- Consumes: existing Intex conversations UI.
- Produces: web app with no command/action history UI and no command/action service URLs.

- [x] **Step 1: Write failing web config tests**

  Tests must prove `AppConfig` no longer exposes `commandsAgentServiceUrl` or `actionsAgentUrl`.

  Run: `pnpm --filter @intexuraos/web test`

  Expected before implementation: FAIL while old config fields exist.

- [x] **Step 2: Write failing routing/navigation tests**

  Tests must prove `/inbox` no longer routes to command/action history, auth/default redirects do not land on `/inbox`, the sidebar does not expose command/action inbox navigation, and the command devbar tab is absent.

  Run: `pnpm --filter @intexuraos/web test`

  Expected before implementation: FAIL while old routes and navigation remain.

- [x] **Step 3: Write failing old plumbing tests**

  Tests or dead-code checks must prove command/action modals, list items, configurable action buttons, action config loading, condition evaluation, action execution, command/action Firestore listeners, and command/action barrel exports are gone.

  Run: `pnpm --filter @intexuraos/web test`

  Expected before implementation: FAIL while old plumbing remains.

- [x] **Step 4: Write failing web-copy tests**

  Tests or content assertions must prove homepage, settings, connection, and onboarding copy no longer advertises voice notes, voice commands, voice-first support, or approval-gated actions.

  Run: `pnpm --filter @intexuraos/web test`

  Expected before implementation: FAIL while stale voice/approval copy remains.

- [x] **Step 5: Delete old web clients and UI**

  Remove command/action API clients, old history pages, old action config execution, command/action Firestore listeners, route entries, sidebar entries, devbar command tools, and user-facing labels. Keep the existing Intex conversations UI and route users there instead of `/inbox`.

- [x] **Step 6: Remove generated service wiring inputs**

  Remove `commands-agent` and `actions-agent` from `apps/web/service-manifest.json`.

- [x] **Step 7: Regenerate service wiring**

  Run: `pnpm run generate:service-wiring`

  Expected: generated web, PM2, and Terraform service URL files no longer contain command/action service URLs.

- [x] **Step 8: Verify web**

  Run: `pnpm --filter @intexuraos/web test`

  Run: `pnpm run verify:workspace:tracked -- web`

  Run: `pnpm run verify:service-wiring`

  Run:

  ```bash
  rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commandsAgent|actionsAgent|Commands Agent|Actions Agent|commandsAgentServiceUrl|actionsAgentUrl|commandsApi|ActionDetailModal|CommandDetailModal|ActionItem|CommandItem|ConfigurableActionButton|useActionConfig|conditionEvaluator|actionExecutor|useActionChanges|useCommandChanges|collection\\(db, 'commands'|collection\\(db, 'actions'|action-config|Voice-First|voice note|voice command|voice commands|approval-gated" apps/web ecosystem.generated.cjs terraform/environments/dev/service-urls.auto.tfvars.json
  ```

  Expected after cleanup: no matches.

## Task 5: Remove Pub/Sub, Transcription Vocabulary, And Firestore Index Ownership

**Files:**

- Modify: `workers/transcription/src/providers/speechmatics/vocabulary.ts`
- Modify: transcription vocabulary tests if present.
- Modify: `tools/pubsub-ui/server.mjs`
- Modify: `tools/pubsub-ui/index.html`
- Modify: `tools/pubsub-ui/README.md`
- Modify: `scripts/pubsub-publish-test.mjs`
- Modify: `firestore-collections.json`
- Modify: `firestore.indexes.json` via a new immutable migration artifact.
- Modify: `migrations/manifest.json`
- Create: one new migration file named with the next valid id accepted by `pnpm run verify:migrations` after syncing the migration manifest, using the suffix `remove-command-action-indexes`.
- Create/modify: a hard removed-agent verifier or tests, for example `scripts/verify-removed-agents.mjs` and `scripts/__tests__/verify-removed-agents.test.ts`.
- Modify: Firestore, Pub/Sub, and migration tests.

**Interfaces:**

- Consumes: retained Firestore data policy.
- Produces: no active Pub/Sub topics, vocabulary hints, registry ownership, or index declarations for removed command/action runtime.

- [x] **Step 1: Write failing retired-topic tests**

  Tests or a hard verifier must expect removed command/action/approval topics and push targets to be absent from Pub/Sub UI, publish-test templates, Terraform, and generated/runtime config.

  It must explicitly fail on `actions-queue`, `action.created`, `INTEXURAOS_PUBSUB_ACTIONS_QUEUE`, `calendar-preview`, `commands-ingest`, `approval-reply`, `INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC`, and `INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC`.

  Run: `pnpm vitest run scripts/__tests__/verify-removed-agents.test.ts`

  Expected before implementation: FAIL while old topics remain.

- [x] **Step 2: Write failing vocabulary tests**

  Tests must prove removed agent names and command/action-specific voice hints are not present.

  Run: `pnpm --filter @intexuraos/transcription test`

  Expected before implementation: FAIL if old vocabulary hints remain.

- [x] **Step 3: Write failing Firestore registry/index tests**

  Tests or a hard verifier must prove runtime code no longer references `commands`, `actions`, `actions_transitions`, or `approval_messages`, and `firestore-collections.json` no longer contains those collection rows.

  Run: `pnpm vitest run scripts/__tests__/verify-removed-agents.test.ts`

  Run: `pnpm run verify:firestore`

  Expected before implementation: FAIL while old owners, runtime references, or index declarations remain.

- [x] **Step 4: Remove Pub/Sub topics and push templates**

  Delete command ingest, approval reply, action process, and retry-pending topic definitions and test templates. Keep unrelated WhatsApp outbound and Intex message ingestion topics.

- [x] **Step 5: Remove transcription vocabulary**

  Remove old command/action/Intex voice-assistant vocabulary hints that only existed to improve unsupported voice flows.

- [x] **Step 6: Remove Firestore active ownership and indexes**

  Remove old collection rows from `firestore-collections.json` after runtime references are gone. Because `firestore.indexes.json` contains old `commands` and `actions` indexes, add the next valid immutable migration with `removedCollectionGroups` for removed index groups, update `migrations/manifest.json` as required, and run the migration artifact generator instead of editing historical migrations.

- [x] **Step 7: Regenerate and verify Firestore artifacts**

  Run: `node scripts/migrate.mjs --write-artifacts-only`

  Run: `pnpm run verify:migrations`

  Run: `pnpm run verify:firestore-artifacts`

  Expected: migration manifest, generated indexes, and Firestore artifacts are consistent.

- [x] **Step 8: Verify data-plane cleanup**

  Run: `pnpm run verify:pubsub`

  Run: `pnpm run verify:firestore`

  Run: `pnpm vitest run scripts/__tests__/verify-removed-agents.test.ts`

  Run: `pnpm --filter @intexuraos/transcription test`

  Run:

  ```bash
  rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commands_agent|actions_agent|command.ingest|approval.reply|commands-ingest|approval-reply|actions-queue|action.created|calendar-preview|INTEXURAOS_PUBSUB_ACTIONS_QUEUE|INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC|INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC" tools scripts workers/transcription firestore-collections.json firestore.indexes.json
  ```

  Expected after cleanup: no runtime references. Historical migration files are intentionally excluded because immutable migrations may keep old service names or collection group names in comments; new migration artifacts must still pass `pnpm run verify:migrations` and `pnpm run verify:firestore-artifacts`.

## Task 6: Remove Runtime Infrastructure

**Files:**

- Modify: `ecosystem.config.cjs`
- Modify: `ecosystem.config.prod.cjs`
- Modify: `ecosystem.generated.cjs`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `terraform/environments/dev/service-urls.auto.tfvars.json`
- Modify: `terraform/hetzner-prod/main.tf`
- Modify: `terraform/hetzner-prod/pubsub.tf` if present.
- Modify: `terraform/hetzner-prod/retained-gcp.tf`
- Modify: `terraform/hetzner-prod/scheduler.tf`
- Modify: `terraform/hetzner-prod/imports.tf`
- Modify: `terraform/hetzner-prod/outputs.tf`
- Modify: `terraform/modules/iam/main.tf`
- Modify: `terraform/modules/iam/outputs.tf`
- Modify: `scripts/hetzner/nginx/intexuraos.conf`
- Modify: `scripts/hetzner/cutover-gcp-edge.sh`
- Modify: `scripts/hetzner/nginx/jwt-verify.lua`
- Modify: `apps/api-docs-hub/src/config.ts`
- Modify: `apps/api-docs-hub/src/__tests__/server.test.ts`
- Modify: infrastructure tests under `scripts/__tests__/**`.

**Interfaces:**

- Consumes: `intex-agent` runtime on port `8134`.
- Produces: no PM2, nginx, Terraform, IAM, OpenAPI hub, service URL, or generated config wiring for old agent services.

- [x] **Step 1: Write failing infrastructure tests**

  Update tests to expect:

  - no PM2 entries for `commands-agent` or `actions-agent`,
  - no nginx routes for `/api/commands` or `/api/actions`,
  - no old service URL env vars,
  - no old OpenAPI URL env vars,
  - no old IAM service accounts or outputs,
  - no old Pub/Sub push subscriptions,
  - no old Cloud Scheduler jobs for `/internal/retry-pending` or `/internal/actions/retry-pending`,
  - no old Terraform imports or outputs for removed Pub/Sub subscriptions.

  Run:

  ```bash
  pnpm vitest run scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts
  ```

  Expected before implementation: FAIL while old infrastructure remains.

- [x] **Step 2: Remove old service runtime entries**

  Delete old ports, env vars, PM2 process definitions, prod service maps, nginx upstreams/routes, JWT route allowlists, OpenAPI hub entries, Terraform service modules, service accounts, IAM bindings, outputs, imports, scheduler jobs, and push subscriptions.

- [x] **Step 3: Regenerate service wiring**

  Run: `pnpm run generate:service-wiring`

  Expected: generated files contain `INTEXURAOS_INTEX_AGENT_URL` but not old command/action service URLs.

- [x] **Step 4: Verify infrastructure**

  Run: `pnpm run verify:service-wiring`

  Run: `pnpm vitest run scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts`

  Run:

  ```bash
  rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commands_agent|actions_agent|/api/commands|/api/actions|/internal/retry-pending|/internal/actions/retry-pending|commands-ingest|actions-queue|approval-reply" terraform ecosystem.config.cjs ecosystem.config.prod.cjs ecosystem.generated.cjs scripts/hetzner apps/api-docs-hub scripts/__tests__
  ```

  Expected after cleanup: no matches.

## Task 7: Remove Shared Contracts, Clients, Catalog Entries, And Docs

**Files:**

- Modify/delete: `packages/http-contracts/src/zod/commands-agent.ts`
- Modify/delete: `packages/internal-clients/src/commands-agent/**`
- Modify/delete: `packages/internal-clients/src/actions-agent/**`
- Modify: `packages/internal-clients/src/index.ts`
- Modify: `packages/service-catalog/src/internalServiceCatalog.ts`
- Modify: `packages/service-catalog/src/__tests__/internalServiceCatalog.test.ts`
- Modify: `package.json`
- Create/modify: `scripts/verify-removed-agents.mjs`
- Create/modify: `scripts/__tests__/verify-removed-agents.test.ts`
- Modify: `eslint.config.js`
- Modify: `scripts/verify-env-vars.mjs`
- Modify: `scripts/verify-common.mjs`
- Modify: `scripts/log-viewer.mjs`
- Modify: `scripts/dev-setup.mjs`
- Delete: `docs/services/commands-agent/**`
- Delete: `docs/services/actions-agent/**`
- Modify: `README.md`
- Modify: `docs/overview.md`
- Modify: `docs/services/index.md`
- Modify: `docs/services/intex-agent/**` if present.
- Modify: `docs/superpowers/specs/2026-06-24-intex-agent-whatsapp-sessions-design.md`
- Modify: `docs/superpowers/plans/2026-06-24-intex-agent-whatsapp-sessions.md`
- Modify: user-facing docs and validation docs that mention old command/action agents.

**Interfaces:**

- Consumes: canonical direct-tool Intex model from this plan.
- Produces: no shared package exports, service catalog metadata, lint exceptions, script allowlists, or user-facing docs for removed agents.

- [x] **Step 1: Write failing package/catalog absence tests**

  Update service catalog and package tests so they fail while old command/action clients/contracts/catalog entries remain.

  Run: `pnpm --filter @intexuraos/service-catalog test`

  Run: `pnpm --filter @intexuraos/internal-clients test`

  Expected before implementation: FAIL while old shared metadata remains.

- [x] **Step 2: Add a hard removed-agent verifier**

  Add `scripts/verify-removed-agents.mjs` and a `verify:removed-agents` package script. The verifier must fail on removed service names, env vars, package paths, public/internal routes, Pub/Sub retired topics, and old Firestore registry rows in runtime code, generated config, Terraform, shared packages, README, and user-facing docs.

  Run: `pnpm vitest run scripts/__tests__/verify-removed-agents.test.ts`

  Expected before implementation: FAIL while removed agent references remain.

- [x] **Step 3: Delete shared clients and contracts**

  Remove old command/action contract files, internal clients, exports, tests, and catalog entries. Do not rename them to Intex paths because the compatibility endpoints are being deleted.

- [x] **Step 4: Remove script and lint references**

  Delete old package names from lint boundaries, env-var verifiers, common verification scripts, log viewer service lists, dev setup scripts, and related tests.

- [x] **Step 5: Delete old docs and update Intex docs**

  Delete old service docs. Update user-facing docs to describe:

  - Intex text conversations,
  - direct tools only,
  - supported tools are notes, calendar events, research drafts, bookmarks, and code tasks,
  - no approvals right now,
  - no voice support right now.

- [x] **Step 6: Verify shared cleanup**

  Run: `pnpm run verify:package-exports`

  Run: `pnpm run verify:boundaries`

  Run: `pnpm run verify:removed-agents`

  Run: `pnpm run verify:dead-code`

  Run:

  ```bash
  rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commands_agent|actions_agent|commandsAgent|actionsAgent|Commands Agent|Actions Agent|commands agent|actions agent" README.md docs packages eslint.config.js scripts/verify-*.mjs scripts/log-viewer.mjs scripts/dev-setup.mjs pnpm-lock.yaml
  ```

  Expected after cleanup: no user-facing or runtime metadata matches. Archived planning/evidence files may remain only if the final verifier deliberately excludes them; prefer removing or redacting stale references when they are not needed.

## Task 8: Final Sweep And CI

**Files:**

- Modify any files found by final verification that still reference removed runtime behavior.

**Interfaces:**

- Consumes: completed cleanup tasks.
- Produces: one repo-wide verified cleanup.

- [x] **Step 1: Run generated/config verifiers**

  Run: `pnpm run generate:service-wiring`

  Run: `pnpm run verify:service-wiring`

  Run: `pnpm run verify:package-exports`

  Run: `pnpm run verify:boundaries`

  Run: `pnpm run verify:firestore`

  Run: `pnpm run verify:migrations`

  Run: `pnpm run verify:firestore-artifacts`

  Run: `pnpm run verify:pubsub`

  Run: `pnpm run verify:removed-agents`

  Run: `pnpm run verify:dead-code`

  Expected: all PASS.

- [x] **Step 2: Run focused workspace verifiers**

  Run: `pnpm run verify:workspace:tracked intex-agent`

  Run: `pnpm run verify:workspace:tracked code-agent`

  Run: `pnpm run verify:workspace:tracked whatsapp-service`

  Run: `pnpm run verify:workspace:tracked web`

  Expected: all PASS.

- [x] **Step 3: Run final reference sweep**

  Run:

  ```bash
  rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commands_agent|actions_agent|commandsAgent|actionsAgent|Commands Agent|Actions Agent|commands agent|actions agent" .
  ```

  Expected: no matches outside this plan and deliberately retained historical evidence/planning artifacts. If the final cleanup goal is strict, redact those historical artifacts too.

  Result: live-runtime sweep is clean. The only non-doc matches retained outside ignored historical artifacts are immutable migration comments in `migrations/018_actions-status-filter-index.mjs` and `migrations/030_actions-createdAt-sorting-index.mjs`; editing them changes manifest checksums, so they remain as historical migration evidence.

- [x] **Step 4: Run tracked CI**

  Run: `pnpm run ci:tracked`

  Expected: PASS completely.

  Result: PASS before reviewer sweep. Final post-review CI is tracked under Step 5.

- [x] **Step 5: Review with subagents before final handoff**

  Dispatch Codex reviewer subagents with isolated context. These are review-only agents, not IntexuraOS code tasks:

  - Reviewer A: backend/code-agent/Intex boundaries.
  - Reviewer B: WhatsApp/web text-only behavior and removed UI.
  - Reviewer C: infrastructure/shared metadata/docs/verification coverage.

  Each reviewer must check that the implementation follows this plan, does not port old command/action behavior, and leaves only current direct Intex tools.

  Result: Reviewer A, Reviewer B, and Reviewer C completed. Actionable findings were fixed, including code-agent duplicate handling, WhatsApp audio storage, stale web approval/voice copy, verifier coverage, and leftover docs/infrastructure references. Post-review `pnpm run ci:tracked` passed.

## Non-Goals

- Do not delete old Firestore documents from production or dev data.
- Do not build a new approval system.
- Do not build tool-call history UI.
- Do not add voice-message support.
- Do not add new Intex tools from old actions-agent behavior.
- Do not keep `/api/commands`, `/api/actions`, `/internal/commands`, or `/internal/actions` compatibility paths.
