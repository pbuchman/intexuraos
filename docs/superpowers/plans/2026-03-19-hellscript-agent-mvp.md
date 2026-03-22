# Hellscript Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `hellscript-agent`, a new writing workspace service that stores a per-user thought log, infers intent from natural-language utterances, and creates read-only versioned markdown drafts only on explicit draft-update requests.

**Architecture:** `hellscript-agent` is a new Fastify app with standard app DI (`services.ts`) and hexagonal boundaries. Firestore stores one top-level buffer document plus append-only `events` and immutable `draft_versions` subcollections. The web app adds a new `Hellscript` section and three routes that deliberately reuse existing Code Tasks navigation and split-pane patterns instead of introducing a new interaction model.

**Tech Stack:** Fastify 5, TypeScript strict mode, Vitest, Firestore, Gemini, OpenAPI/Swagger, React 19, React Router hash routing, TailwindCSS.

**Reference Files:** `.claude/commands/create-service.md`, `.claude/reference/architecture.md`, `apps/notes-agent/src/server.ts`, `apps/notes-agent/src/__tests__/testUtils.ts`, `apps/notes-agent/src/__tests__/firestoreNoteRepository.test.ts`, `apps/cron-agent/src/index.ts`, `apps/cron-agent/src/services.ts`, `apps/web/src/pages/CodeTasksPage.tsx`, `apps/web/src/pages/CodeTaskNewPage.tsx`, `apps/web/src/pages/CodeTaskViewPageV2.tsx`, `apps/web/src/components/Sidebar.tsx`

---

## Scope Check

This remains one plan because the MVP only works when all of these ship together:

- `hellscript-agent` service
- web routes and split-pane workspace
- Firestore ownership and service registration
- local dev, build, and deploy wiring

---

## Endpoint Changes

### hellscript-agent

**Created**
- `GET /health`
- `GET /openapi.json`
- `POST /hellscript/impose`
- `GET /hellscript/buffers`
- `GET /hellscript/buffers/:id`

**Modified**
- None

**Removed**
- None

**Unchanged**
- All existing endpoints in all other services

### web app

**Created**
- `/#/hellscript`
- `/#/hellscript/new`
- `/#/hellscript/:id`

**Modified**
- `Sidebar.tsx` to add `Hellscript > Thoughts` and `Hellscript > New Conversation`

**Removed**
- None

**Unchanged**
- All existing routes

---

## Product Rules

- `POST /hellscript/impose` is the only write endpoint in MVP.
- Missing `bufferId` creates a new named buffer and returns its ID.
- Raw utterances are stored before interpretation or generation.
- Intent inference happens inside `hellscript-agent`; there is no upstream parser.
- The service must never generate proactively.
- Only explicit draft-update requests create a new draft version.
- Ambiguous destructive intent falls back to append-only behavior and stores a fallback reason.
- Drafts are immutable snapshots; versioning applies to drafts, not to the whole conversation.
- The right-hand canvas is read-only in MVP.
- No revert, merge, restore, or direct canvas editing in MVP.
- No general tool-calling loop in MVP. The only LLM generation action is draft generation.

---

## Data Model

- `hellscript_buffers/{bufferId}`
  - owner/user metadata
  - buffer title
  - materialized state
  - event count
  - latest draft metadata
  - `createdAt` / `updatedAt`
- `hellscript_buffers/{bufferId}/events/{eventId}`
  - raw utterance
  - interpreted intent kind
  - normalized payload
  - fallback reason, if any
  - `createdAt`
- `hellscript_buffers/{bufferId}/draft_versions/{draftVersionId}`
  - `versionNumber`
  - `markdown`
  - `requestText`
  - `createdAt`

---

## File Map

### Backend service

| Path                                                                                           | Responsibility                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/hellscript-agent/package.json`                                                           | Workspace package, scripts, dependencies                             |
| `apps/hellscript-agent/tsconfig.json`                                                          | TypeScript project config                                            |
| `apps/hellscript-agent/vitest.config.ts`                                                       | Local service test config                                            |
| `apps/hellscript-agent/Dockerfile`                                                             | Cloud Run image build                                                |
| `apps/hellscript-agent/.dockerignore`                                                          | Docker exclusions                                                    |
| `apps/hellscript-agent/src/index.ts`                                                           | Startup, env validation, Sentry, service init                        |
| `apps/hellscript-agent/src/config.ts`                                                          | Runtime config loading                                               |
| `apps/hellscript-agent/src/services.ts`                                                        | DI container                                                         |
| `apps/hellscript-agent/src/server.ts`                                                          | Fastify setup, auth, CORS, Swagger, route registration               |
| `apps/hellscript-agent/src/domain/models/*`                                                    | Buffer, event, draft version, materialized state types               |
| `apps/hellscript-agent/src/domain/ports/*`                                                     | Repository, interpreter, draft generator contracts                   |
| `apps/hellscript-agent/src/domain/services/applyIntentToState.ts`                              | Pure state transitions                                               |
| `apps/hellscript-agent/src/domain/usecases/{imposeOnBuffer,listBuffers,getBufferWorkspace}.ts` | Main backend behavior                                                |
| `apps/hellscript-agent/src/prompts/{interpret-impose-prompt,generate-draft-prompt}.ts`         | Versioned prompt builders                                            |
| `apps/hellscript-agent/src/infra/firestore/firestoreHellscriptRepository.ts`                   | Firestore adapter                                                    |
| `apps/hellscript-agent/src/infra/llm/{geminiIntentInterpreter,geminiDraftGenerator}.ts`        | Gemini adapters                                                      |
| `apps/hellscript-agent/src/routes/hellscriptRoutes.ts`                                         | Public JWT-protected Hellscript routes                               |
| `apps/hellscript-agent/src/__tests__/*`                                                        | Config, DI, server, domain, repo, route, and fake-collaborator tests |

### Web app

| Path                                                                  | Responsibility                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/web/src/types/hellscript.ts`                                    | Web-facing Hellscript types                                  |
| `apps/web/src/services/hellscriptAgentApi.ts`                         | API client for Hellscript endpoints                          |
| `apps/web/src/hooks/{useHellscriptBuffers,useHellscriptWorkspace}.ts` | Buffer list + workspace loading/mutation                     |
| `apps/web/src/pages/HellscriptBuffersPage.tsx`                        | Existing buffer list page                                    |
| `apps/web/src/pages/HellscriptConversationPage.tsx`                   | Split-pane workspace for `/new` and `/:id`                   |
| `apps/web/src/components/hellscript/*`                                | Buffer row, timeline, composer, draft pane, version selector |
| `apps/web/src/config.ts`                                              | `hellscriptAgentUrl`                                         |
| `apps/web/src/App.tsx`                                                | Hellscript routes                                            |
| `apps/web/src/components/Sidebar.tsx`                                 | `Hellscript` menu section                                    |
| `apps/web/src/services/__tests__/*`                                   | API client tests and config mock updates                     |
| `apps/web/src/hooks/__tests__/*`                                      | Hook tests                                                   |

### Infra and docs

| Path                                                    | Responsibility                                       |
| ------------------------------------------------------- | ---------------------------------------------------- |
| `firestore-collections.json`                            | Register `hellscript_buffers` owner + subcollections |
| `migrations/064_hellscript-agent-composite-indexes.mjs` | Composite index for `userId + updatedAt`             |
| `terraform/modules/iam/{main,outputs}.tf`               | Service account and outputs                          |
| `terraform/environments/dev/main.tf`                    | Cloud Run service, env vars, URL wiring              |
| `terraform/modules/cloud-build/main.tf`                 | Include `hellscript-agent` build target              |
| `cloudbuild/cloudbuild.yaml`                            | Root build/deploy wiring                             |
| `apps/hellscript-agent/cloudbuild.yaml`                 | Per-service build pipeline                           |
| `cloudbuild/scripts/deploy-hellscript-agent.sh`         | Deploy script                                        |
| `.github/workflows/deploy.yml`                          | Deploy workflow registration                         |
| `ecosystem.config.cjs`                                  | PM2 local service config                             |
| `.envrc.local.example`                                  | Local env var example                                |
| `apps/web/vite.config.ts`                               | `/api/hellscript-agent` proxy                        |
| `apps/web/cloudbuild.yaml`                              | Web build-time service lookup                        |
| `apps/api-docs-hub/src/config.ts`                       | OpenAPI discovery entry after first deploy           |
| `.claude/commands/create-domain-docs.md`                | Register Hellscript as a domain-layer service        |
| `tsconfig.json`                                         | Project reference                                    |

---

## Chunk 1: Service Shell and Domain Contracts

### Task 1: Scaffold `hellscript-agent`

**Files**
- Create: `apps/hellscript-agent/package.json`
- Create: `apps/hellscript-agent/tsconfig.json`
- Create: `apps/hellscript-agent/vitest.config.ts`
- Create: `apps/hellscript-agent/Dockerfile`
- Create: `apps/hellscript-agent/.dockerignore`
- Create: `apps/hellscript-agent/src/{index,config,services,server}.ts`
- Create: `apps/hellscript-agent/src/__tests__/{config.test.ts,services.test.ts,server.test.ts}`

- [ ] Read `notes-agent`, `cron-agent`, and `/create-service` references before scaffolding.
- [ ] Write failing tests for config loading, DI lifecycle, `/health`, `/openapi.json`, `/docs`, and CORS.
- [ ] Run `pnpm --filter @intexuraos/hellscript-agent test -- src/__tests__/config.test.ts src/__tests__/services.test.ts src/__tests__/server.test.ts` and confirm failure.
- [ ] Implement the minimal service shell:
  - `validateRequiredEnv()` in `src/index.ts`
  - Sentry init in `src/index.ts`
  - standard app DI helpers in `src/services.ts`
  - Fastify + auth + CORS + Swagger in `src/server.ts`
  - `GET /health`, `GET /openapi.json`, `GET /docs`
- [ ] Re-run the same targeted tests and confirm they pass.
- [ ] Commit: `feat(hellscript-agent): scaffold service shell`

### Task 2: Add domain models, prompts, and pure state transitions

**Files**
- Create: `apps/hellscript-agent/src/domain/models/{hellscriptBuffer,hellscriptEvent,hellscriptDraftVersion,materializedBufferState}.ts`
- Create: `apps/hellscript-agent/src/domain/ports/{hellscriptRepository,intentInterpreter,draftGenerator}.ts`
- Create: `apps/hellscript-agent/src/domain/services/applyIntentToState.ts`
- Create: `apps/hellscript-agent/src/prompts/{interpret-impose-prompt,generate-draft-prompt}.ts`
- Create: `apps/hellscript-agent/src/__tests__/applyIntentToState.test.ts`

- [ ] Write failing tests for `applyIntentToState()` covering:
  - append thought
  - add writing sample
  - replace style instructions
  - set audience/content goal metadata
  - delete thought by ID
  - reorder thoughts by ID list
  - ambiguous delete/reorder fallback
  - `update_draft` leaving thought ordering untouched
- [ ] Run `pnpm --filter @intexuraos/hellscript-agent test -- src/__tests__/applyIntentToState.test.ts` and confirm failure.
- [ ] Implement domain types and intent kinds for:
  - `append_thought`
  - `add_writing_sample`
  - `set_style_instructions`
  - `set_metadata`
  - `delete_thought`
  - `reorder_thoughts`
  - `update_draft`
  - `fallback_append`
- [ ] Implement `applyIntentToState()` with conservative destructive behavior and append-only fallback.
- [ ] Implement prompt builders with explicit version fields:
  - `interpret-impose-prompt.ts` version `1.0.0`
  - `generate-draft-prompt.ts` version `1.0.0`
- [ ] Re-run the targeted test and confirm it passes.
- [ ] Commit: `feat(hellscript-agent): add domain contracts and state transitions`

---

## Chunk 2: Backend Behavior and API

### Task 3: Implement use cases with in-memory fakes

**Files**
- Create: `apps/hellscript-agent/src/domain/usecases/{imposeOnBuffer,listBuffers,getBufferWorkspace}.ts`
- Create: `apps/hellscript-agent/src/__tests__/{fakeHellscriptRepository,fakeIntentInterpreter,fakeDraftGenerator}.ts`
- Create: `apps/hellscript-agent/src/__tests__/imposeOnBuffer.test.ts`

- [ ] Write failing use-case tests for:
  - creating a new buffer when `bufferId` is omitted
  - storing the raw utterance before interpretation
  - append/delete/reorder/fallback behavior
  - skipping draft generation when intent is not `update_draft`
  - creating draft version `1`, then incrementing versions on later updates
  - returning only `bufferId`, `action`, and optional `latestDraftVersionId`
- [ ] Run `pnpm --filter @intexuraos/hellscript-agent test -- src/__tests__/imposeOnBuffer.test.ts` and confirm failure.
- [ ] Implement the use-case flow:
  1. load or create buffer
  2. store raw utterance
  3. interpret intent
  4. apply state transition
  5. persist event + materialized state
  6. if explicit `update_draft`, generate markdown and append a draft version
  7. return a minimal response without inline markdown
- [ ] Implement `listBuffers()` and `getBufferWorkspace()` using the same repository port.
- [ ] Re-run the targeted use-case test and confirm it passes.
- [ ] Commit: `feat(hellscript-agent): add hellscript use cases`

### Task 4: Implement Firestore persistence

**Files**
- Create: `apps/hellscript-agent/src/infra/firestore/firestoreHellscriptRepository.ts`
- Create: `apps/hellscript-agent/src/__tests__/firestoreHellscriptRepository.test.ts`

- [ ] Write failing repository tests for create/list/load, event persistence, draft version append, owner scoping, and missing-buffer behavior.
- [ ] Run `pnpm --filter @intexuraos/hellscript-agent test -- src/__tests__/firestoreHellscriptRepository.test.ts` and confirm failure.
- [ ] Implement Firestore storage around:
  - top-level `hellscript_buffers`
  - `events` subcollection
  - `draft_versions` subcollection
- [ ] Implement title derivation once:
  - first non-empty appended thought
  - max 80 chars
  - fallback `"Untitled buffer"`
- [ ] Re-run the targeted repository test and confirm it passes.
- [ ] Commit: `feat(hellscript-agent): add firestore repository`

### Task 5: Wire Gemini adapters and HTTP routes

**Files**
- Create: `apps/hellscript-agent/src/infra/llm/{geminiIntentInterpreter,geminiDraftGenerator}.ts`
- Create: `apps/hellscript-agent/src/routes/hellscriptRoutes.ts`
- Create: `apps/hellscript-agent/src/__tests__/{testUtils.ts,hellscriptRoutes.test.ts}`
- Modify: `apps/hellscript-agent/src/{index,config,services,server}.ts`

- [ ] Extend config tests to cover Gemini config and default port handling.
- [ ] Implement `geminiIntentInterpreter`:
  - structured JSON output
  - strict validation
  - conservative `fallback_append` on parse/validation failure
- [ ] Implement `geminiDraftGenerator`:
  - takes materialized state, prior draft, audience, style instructions, and explicit request
  - returns markdown only
- [ ] Write failing route tests for auth, owner scoping, `POST /hellscript/impose`, `GET /hellscript/buffers`, and `GET /hellscript/buffers/:id`.
- [ ] Implement `hellscriptRoutes.ts` using:
  - `logIncomingRequest(request)`
  - route-level auth
  - `getServices()`
- [ ] Register routes in `server.ts` and wire real collaborators in `index.ts` / `services.ts`.
- [ ] Run:
  - `pnpm --filter @intexuraos/hellscript-agent test -- src/__tests__/hellscriptRoutes.test.ts src/__tests__/server.test.ts`
  - `pnpm run verify:workspace:tracked -- hellscript-agent`
- [ ] Commit: `feat(hellscript-agent): add llm adapters and routes`

---

## Chunk 3: Web App UX

### Task 6: Add web config, API client, hooks, navigation, and list page

**Files**
- Create: `apps/web/src/types/hellscript.ts`
- Create: `apps/web/src/services/hellscriptAgentApi.ts`
- Create: `apps/web/src/hooks/{useHellscriptBuffers,useHellscriptWorkspace}.ts`
- Create: `apps/web/src/pages/HellscriptBuffersPage.tsx`
- Create: `apps/web/src/pages/HellscriptConversationPage.tsx`
- Create: `apps/web/src/components/hellscript/HellscriptBufferRow.tsx`
- Create: `apps/web/src/services/__tests__/hellscriptAgentApi.test.ts`
- Create: `apps/web/src/hooks/__tests__/{useHellscriptBuffers.test.ts,useHellscriptWorkspace.test.ts}`
- Modify: `apps/web/src/{config.ts,App.tsx}`
- Modify: `apps/web/src/{types/index.ts,services/index.ts,hooks/index.ts}`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: existing tests that mock `AppConfig`

- [ ] Add web types for buffer summaries, events, draft versions, and workspace responses.
- [ ] Add `hellscriptAgentUrl` to `AppConfig` and `config.ts`.
- [ ] Write failing API client and hook tests for:
  - listing buffers
  - loading one workspace
  - posting `impose`
  - re-fetching workspace after a successful impose
  - returning a new `bufferId` when first posting from `/new`
- [ ] Implement `hellscriptAgentApi.ts` and both hooks.
- [ ] Update config mocks in existing tests that depend on the typed config object.
- [ ] Add sidebar entries:
  - `Hellscript`
  - `Thoughts`
  - `New Conversation`
- [ ] Add routes:
  - `/#/hellscript`
  - `/#/hellscript/new`
  - `/#/hellscript/:id`
- [ ] Build `HellscriptBuffersPage.tsx` and `HellscriptBufferRow.tsx` by copying Code Tasks list-page patterns.
- [ ] Create a placeholder `HellscriptConversationPage.tsx` so routing works before the full workspace is built.
- [ ] Run:
  - `pnpm --filter @intexuraos/web test -- src/services/__tests__/hellscriptAgentApi.test.ts src/hooks/__tests__/useHellscriptBuffers.test.ts src/hooks/__tests__/useHellscriptWorkspace.test.ts`
  - manual route smoke in `pnpm --filter @intexuraos/web dev`
- [ ] Commit: `feat(web): add hellscript list page and routing shell`

### Task 7: Build the split-pane workspace

**Files**
- Modify: `apps/web/src/pages/HellscriptConversationPage.tsx`
- Create: `apps/web/src/components/hellscript/{HellscriptTimeline,HellscriptComposer,HellscriptDraftPane,HellscriptVersionSelector}.tsx`

- [ ] Build the layout from existing Code Tasks workspace patterns:
  - left pane = timeline + composer
  - right pane = read-only draft canvas + version selector
  - mobile = stacked layout
- [ ] Implement `HellscriptTimeline` as a thought timeline, not a code-task execution log. It must show raw utterances, interpreted actions, fallback warnings, and draft-version creation events.
- [ ] Implement `HellscriptComposer` with multiline textarea, loading state, and first-submit navigation from `/new` to `/:id`.
- [ ] Implement `HellscriptDraftPane` with markdown rendering only and empty state when no draft exists yet.
- [ ] Implement `HellscriptVersionSelector`:
  - default to latest
  - switching versions affects only the right pane
  - no revert CTA
- [ ] Update `HellscriptConversationPage.tsx` to orchestrate hooks, selected draft version state, loading/error states, and refresh-after-impose behavior.
- [ ] Run manual UX verification in `pnpm --filter @intexuraos/web dev`.
- [ ] Commit: `feat(web): add hellscript workspace page`

---

## Chunk 4: Service Registration and Verification

### Task 8: Register storage ownership and deploy wiring

**Files**
- Modify: `firestore-collections.json`
- Create: `migrations/064_hellscript-agent-composite-indexes.mjs`
- Modify: `terraform/modules/iam/{main,outputs}.tf`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `terraform/modules/cloud-build/main.tf`
- Create: `apps/hellscript-agent/cloudbuild.yaml`
- Create: `cloudbuild/scripts/deploy-hellscript-agent.sh`
- Modify: `cloudbuild/cloudbuild.yaml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `ecosystem.config.cjs`
- Modify: `.envrc.local.example`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/cloudbuild.yaml`
- Modify: `tsconfig.json`

- [ ] Register `hellscript_buffers` in `firestore-collections.json` with `events` and `draft_versions` subcollections.
- [ ] Add the composite index migration for `userId` ascending + `updatedAt` descending.
- [ ] Add the `hellscript-agent` service account and outputs in the IAM module.
- [ ] Add `local.services.hellscript_agent`, Cloud Run module wiring, and `INTEXURAOS_HELLSCRIPT_AGENT_URL` to `terraform/environments/dev/main.tf`.
- [ ] Add local dev wiring:
  - `ecosystem.config.cjs` on port `8131`
  - `.envrc.local.example`
  - Vite proxy `/api/hellscript-agent -> http://localhost:8131`
- [ ] Add build and deploy wiring:
  - `terraform/modules/cloud-build/main.tf`
  - root `cloudbuild/cloudbuild.yaml`
  - `apps/hellscript-agent/cloudbuild.yaml`
  - `cloudbuild/scripts/deploy-hellscript-agent.sh`
  - `.github/workflows/deploy.yml`
  - `apps/web/cloudbuild.yaml`
- [ ] Add the new project reference to `tsconfig.json`.
- [ ] Verify:
  - `terraform -chdir=terraform/environments/dev fmt -check -recursive`
  - `terraform -chdir=terraform/environments/dev validate`
- [ ] Commit: `feat(hellscript-agent): register service in infra`

### Task 9: Docs registration and full verification

**Files**
- Modify: `apps/api-docs-hub/src/config.ts`
- Modify: `.claude/commands/create-domain-docs.md`

- [ ] After the first deploy, register the Hellscript OpenAPI URL in `apps/api-docs-hub/src/config.ts`.
- [ ] Register Hellscript in `.claude/commands/create-domain-docs.md` as a service with domain models, ports, and use cases.
- [ ] Run final verification from repo root:
  - `pnpm run verify:workspace:tracked -- hellscript-agent`
  - `pnpm run verify:workspace:tracked -- web`
  - `pnpm run verify:logging`
  - `pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-hellscript-agent.txt`
- [ ] If CI fails, inspect with `rg "error|FAIL" -C3 /tmp/ci-output-hellscript-agent.txt` and fix every failure before merge work.

---

## Delivery Checklist

### MVP behavior

- [ ] `POST /hellscript/impose` is the only write endpoint
- [ ] Omitting `bufferId` creates a new buffer and returns its ID
- [ ] Raw utterance persists before interpretation
- [ ] Intent inference happens inside `hellscript-agent`
- [ ] Ambiguous destructive edits fall back to append-only storage
- [ ] Explicit draft-update requests create new immutable draft versions
- [ ] Questions and loose notes do not trigger proactive generation
- [ ] The right pane is read-only in MVP

### UI contract

- [ ] `Hellscript` appears as its own sidebar section
- [ ] `Thoughts` and `New Conversation` are the two subitems
- [ ] `/#/hellscript` lists existing buffers
- [ ] `/#/hellscript/new` opens an empty workspace
- [ ] `/#/hellscript/:id` shows the split-pane workspace
- [ ] Left pane feels like Code Tasks message/log UI
- [ ] Right pane is a versioned draft canvas, not an editor

### Service creation checklist

- [ ] `apps/hellscript-agent` exists with standard app shell, DI, startup, routes, tests, and Dockerfile
- [ ] `validateRequiredEnv()` is used in startup
- [ ] Sentry is initialized
- [ ] `/health`, `/openapi.json`, and `/docs` are present
- [ ] All endpoints use `logIncomingRequest()`
- [ ] Firestore ownership is registered
- [ ] Composite indexes are added where query patterns need them
- [ ] IAM, Terraform, Cloud Build, deploy workflow, PM2, Vite proxy, and local env wiring are all updated
- [ ] `INTEXURAOS_HELLSCRIPT_AGENT_URL` is available to the web app
- [ ] `apps/api-docs-hub` is updated after first deploy

Plan complete and saved to `docs/superpowers/plans/2026-03-19-hellscript-agent-mvp.md`. Ready to execute?
