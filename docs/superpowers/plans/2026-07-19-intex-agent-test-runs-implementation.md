# Intex Agent Test Runs Backend and Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete execution-goal steps 9–10: persist a bounded, owner-only safe Test Runs read model and render it in the existing Intex Agent Sessions experience without exposing private test/session data.

**Architecture:** Intex Agent owns run/scenario projections and maps closed public DTOs field by field. Public readers are Home Dev- and evaluator-user-gated before Firestore access. Web adds a URL-addressable Test Runs tab, bounded polling, run/scenario rails, and a safe timeline; it never reads raw sessions or authorizes itself.

**Tech Stack:** TypeScript, Fastify, Firestore transactions/indexes, React, React Router, Tailwind, Vitest/Testing Library.

## Global Constraints

- This plan is an Ultra-only planning artifact. Production work begins only after the
  explicit transition to a GPT-5.6 Extra High orchestrator.
- The primary agent implements each step directly. Subagents are reserved for bounded,
  independent review after the implementation and focused verification evidence exist;
  they do not act as the main execution path.
- The contracts and limits in
  [`2026-07-19-intex-agent-test-runs-ux-design.md`](../specs/2026-07-19-intex-agent-test-runs-ux-design.md)
  are exact. Do not simplify DTO unions, lifecycle/artifact separation, retention, or
  committed-watermark semantics.
- Step 9 and step 10 each receive RED/GREEN evidence, focused validation, independent
  review, a hash/evidence checkpoint, and their exact WhatsApp completion message. They
  create no Git commit; step 13 commits the single unchanged CI-tested tree.
- No `pnpm run ci:tracked` in steps 9–10. Step 13 is the implementation-wide CI gate.

## Step 9 — Test Runs Backend and Artifact Lifecycle

### Create

- `apps/intex-agent/src/domain/testRuns/safeMapper.ts`
- `apps/intex-agent/src/domain/testRuns/retention.ts`
- `apps/intex-agent/src/domain/testRuns/sizePolicy.ts`
- `apps/intex-agent/src/routes/testRunRoutes.ts`
- `apps/intex-agent/src/jobs/testRunArtifactSweeper.ts`
- `apps/intex-agent/src/__tests__/domain/testRuns/safeMapper.test.ts`
- `apps/intex-agent/src/__tests__/domain/testRuns/retention.test.ts`
- `apps/intex-agent/src/__tests__/domain/testRuns/sizePolicy.test.ts`
- `apps/intex-agent/src/__tests__/routes/testRunRoutes.test.ts`
- `apps/intex-agent/src/__tests__/jobs/testRunArtifactSweeper.test.ts`
- `migrations/124_intex-agent-matrix-corpus-indexes.mjs`
- `migrations/__tests__/124-intex-agent-matrix-corpus-indexes.test.ts`
- `packages/http-contracts/src/intexAgentTestRuns.ts`
- `packages/http-contracts/src/__tests__/intexAgentTestRuns.test.ts`

### Modify

- `apps/intex-agent/src/domain/testRuns/types.ts`
- `apps/intex-agent/src/domain/testRuns/stateMachine.ts`
- `apps/intex-agent/src/domain/testRuns/ports/testRunRepository.ts`
- `apps/intex-agent/src/infra/firestore/testRunRepository.ts`
- `apps/intex-agent/src/__tests__/domain/testRuns/types.test.ts`
- `apps/intex-agent/src/__tests__/domain/testRuns/stateMachine.test.ts`
- `apps/intex-agent/src/__tests__/infra/firestore/testRunRepository.test.ts`
- `apps/intex-agent/src/domain/sessions/types.ts`
- `apps/intex-agent/src/domain/ports/sessionRepository.ts`
- `apps/intex-agent/src/infra/firestore/sessionRepository.ts`
- `apps/intex-agent/src/routes/sessionRoutes.ts`
- `apps/intex-agent/src/routes/matrixCorpusRoutes.ts`
- `apps/intex-agent/src/server.ts`
- `apps/intex-agent/src/services.ts`
- `apps/intex-agent/src/__tests__/infra/firestore/sessionRepository.test.ts`
- `apps/intex-agent/src/__tests__/routes/sessionRoutes.test.ts`
- `apps/intex-agent/src/__tests__/routes/matrixCorpusRoutes.test.ts`
- `apps/intex-agent/src/__tests__/services.test.ts`
- `apps/intex-agent/src/config.ts`
- `apps/intex-agent/src/index.ts`
- `apps/user-service/src/routes/settingsRoutes.ts`
- `apps/user-service/src/config.ts`
- `apps/user-service/src/index.ts`
- `apps/user-service/src/services.ts`
- `apps/user-service/src/__tests__/settingsRoutes.test.ts`
- `apps/user-service/src/__tests__/config.test.ts`
- `apps/user-service/src/__tests__/openapi-contract.test.ts`
- `apps/user-service/src/__tests__/schemas.test.ts`
- `ecosystem.config.cjs`
- `ecosystem.config.prod.cjs`
- `terraform/environments/dev/main.tf`
- `scripts/__tests__/ecosystem.config.test.ts`
- `scripts/__tests__/ecosystem.prod.config.test.ts`
- `packages/http-contracts/src/index.ts`
- `firestore-collections.json`
- `firestore.indexes.json`
- `migrations/manifest.json`

### Task 9.1: Encode the closed aggregate and lifecycle rules

- [x] Write RED schema/state tests for every lifecycle/verdict/artifact state, illegal
  transition, immutable field, derived total, ordering/uniqueness bound, nano-USD rule,
  terminal candidate, and finalizing gate.
- [x] Implement the exact `IntexAgentTestRunRecordV1`, scenario projection, summary,
  evidence, usage, artifact delivery, and public DTO types from the UX specification.
- [x] Extend the private lifecycle foundation created in step 6; do not introduce a second
  state machine/repository. State, repository, and internal-route tests require literal
  `agentModel === or:deepseek/deepseek-v4-flash` and
  `evaluatorModel === or:minimax/minimax-m3`.
- [x] Implement these pure transitions:

```ts
applyTestRunProjectionCas(current, command): TestRunTransitionResult;
applyTerminalControl(current, signedEvent): TestRunTransitionResult;
applyArtifactDeliveryTransition(current, command): TestRunTransitionResult;
applyAbandonedRecovery(current, signedEvent): TestRunTransitionResult;
```

- [x] Keep lifecycle/verdict separate from artifact delivery. Evaluator progression stops
  at `finalizing`; only signed terminal control applies the immutable candidate. A delivery
  failure never rewrites a terminal agent outcome.
- [x] The private terminal manifest stores the JSON and Markdown candidate SHA-256 digests
  plus a composite digest of their canonical ordered pair. Preterminal failure codes are
  limited to staging/validation; post-terminal failure is publication-only. No digest or
  path is exposed by a public DTO.
- [x] Serialize worst-case fixtures and enforce 64 KiB run/128 KiB scenario limits before
  first write. Oversize is failure; evidence is never truncated.

### Task 9.2: Implement revision/watermark-safe persistence

- [x] Write RED repository tests for create/update CAS, scenario revision, immutable
  binding, contiguous event ranges, projection/session race, one retry, stale response,
  terminal idempotency, and artifact-deadline transitions.
- [x] Extend the step-6 `testRunRepository.ts` transactions so the full run summary and
  affected safe-evidence scenario projection advance atomically with `expectedRevision`,
  `expectedScenarioRevision`, and the existing monotonic `eventWatermark` validation.
- [x] Scenario readers authorize the owner run first, derive its private session binding,
  read only `eventSequence <= watermark`, reread the projection, retry once on a changed
  revision, and otherwise return the static retryable stale-projection error—never partial
  data.
- [x] Register exact ownership and indexes:

```text
intex_agent_session_events: sessionId ASC, eventSequence ASC
intex_agent_test_runs: userId ASC, runtimeAudience ASC, startedAt DESC
intex_agent_test_runs: artifactDelivery.status ASC, finishedAt ASC
```

- [x] Register migration `124_intex-agent-matrix-corpus-indexes.mjs` in the manifest and
  regenerate the tracked index artifact; its test must reject missing, duplicate, or
  differently ordered index fields.

### Task 9.3: Implement deterministic retention and artifact deadline recovery

- [x] Write RED tests for the four-record internal query, max-two visible slots, current
  acceptance, latest ready success, latest failed acceptance, duplicate-slot prevention,
  superseded static `404`, exact-ID deletion, and ordinary-session preservation.
- [x] Implement retention selection exactly as the spec defines; never query or delete by
  user alone.
- [x] Implement the ten-minute staged-artifact sweeper with revision-checked
  `staged -> unknown/REPORT_DELIVERY_STATUS_TIMEOUT`, but only for a terminal run whose
  `finishedAt` is non-null and older than the deadline; it cannot touch preterminal staged
  runs, scan sessions/messages, or change lifecycle/verdict.
- [x] Wire the sweeper through Intex Agent startup/config with a reentrancy-safe 30-second
  tick, transaction claim, fake-clock overlap/restart tests, and graceful shutdown; enable
  it only behind the same Home Dev Test Runs guard.
- [x] Exact-ID cleanup first verifies the target manifest/fence and rereads every recorded
  session, requiring exact `kind`, audience, run, scenario, user, and session ID equality.
  It also requires the current caller's provisioning fence, the target's terminal record
  fence, and proof that the caller has not activated. A missing/mismatched binding stops
  cleanup. Delete projections, confirmations, contexts, ingest receipts, events, and
  sessions only from that proven manifest; delete the target manifest/tombstone/terminal
  candidate last, and preserve all ordinary data. Route tests from the control-plane step
  are extended after the step-9 projections exist.

### Task 9.4: Add owner-only public reads and guarded internal writes

- [x] Write RED route tests for no auth, foreign user, wrong audience, feature off,
  configured-user mismatch, missing/hidden/expired run, strict schemas, no-store headers,
  response mapping failures, bodyless logging, and zero Firestore reads before gates pass.
- [x] Implement:

```http
GET /test-runs
GET /test-runs/:runId
GET /test-runs/:runId/scenarios/:scenarioId
PUT /internal/test-runs/:runId/projection
PUT /internal/test-runs/:runId/artifact-delivery
```

- [x] Build every public object field by field in `safeMapper.ts`. Unknown event types or
  invalid critical fields fail closed. Never copy `userId`, session/binding/event IDs,
  arbitrary payloads, capabilities, raw tool data, provider metadata, or MiniMax rationale.
- [x] Add `intexAgentCapabilities.testRuns` to authenticated
  `GET /users/:uid/settings`: available only for runtime `home-dev`, the exact configured
  evaluator user, and the server Test Runs read flag; unavailable otherwise. Auth/self
  checks precede availability, and the response exposes no reason or identity. Add config,
  OpenAPI, and zero-leak route tests.
- [x] Name the fail-closed flag `INTEXURAOS_INTEX_AGENT_TEST_RUNS_READ_ENABLED`, parse only
  exact `true | false`, require it in User Service startup, inject it through `services.ts`,
  set it true only in Home Dev dev wiring, and explicitly false in production. Add exact
  ecosystem/Terraform/config tests and never expose the flag to the browser.
- [x] Projection and preterminal artifact routes require internal auth plus the exact active
  run/fence. Post-terminal `staged -> ready | failed` requires the immutable historical
  terminal fence plus terminal-control event ID and can mutate delivery metadata only.
  Neither route accepts raw content, paths, transport identifiers, or errors.

### Task 9.5: Hide test sessions from legacy session APIs

- [x] Add RED tests showing `/sessions` excludes test profiles and detail/events return the
  same static `404` for missing, foreign, and test sessions.
- [x] Authorize/load the exact session before event reads; ordinary session behavior and
  historical unsequenced ordering remain compatible.
- [x] Register Test Runs routes/jobs only when the server-side Home Dev guard is active.

### Step 9 focused verification

```bash
pnpm --filter @intexuraos/intex-agent test -- \
  src/__tests__/domain/testRuns \
  src/__tests__/infra/firestore/testRunRepository.test.ts \
  src/__tests__/infra/firestore/sessionRepository.test.ts \
  src/__tests__/routes/testRunRoutes.test.ts \
  src/__tests__/routes/sessionRoutes.test.ts \
  src/__tests__/routes/matrixCorpusRoutes.test.ts \
  src/__tests__/jobs/testRunArtifactSweeper.test.ts \
  src/__tests__/services.test.ts
pnpm exec vitest run migrations/__tests__/124-intex-agent-matrix-corpus-indexes.test.ts
pnpm --filter @intexuraos/intex-agent typecheck
pnpm exec vitest run \
  packages/http-contracts/src/__tests__/intexAgentTestRuns.test.ts \
  apps/user-service/src/__tests__/settingsRoutes.test.ts \
  apps/user-service/src/__tests__/config.test.ts \
  apps/user-service/src/__tests__/openapi-contract.test.ts \
  apps/user-service/src/__tests__/schemas.test.ts \
  scripts/__tests__/ecosystem.config.test.ts \
  scripts/__tests__/ecosystem.prod.config.test.ts
pnpm --filter @intexuraos/http-contracts typecheck
pnpm --filter @intexuraos/user-service typecheck
pnpm run verify:package-exports
pnpm verify:firestore
pnpm verify:migrations
pnpm verify:firestore-artifacts
pnpm run verify:workspace:tracked -- intex-agent
pnpm run verify:workspace:tracked -- user-service
```

- [x] Obtain independent API/privacy, persistence/race, and migration review. Resolve all
  Critical/Important findings, record the step-9 hash/evidence checkpoint, machine-confirm
  its WhatsApp message, and advance to step 10 without a Git commit.

### Step 9 evidence checkpoint — 2026-07-20

- Implementation manifest: 267 non-plan files, SHA-256
  `125c0c02b6f916f8a60c06aceddc83c568ef358ce1ac2036e7c1e875eeb4ad94`.
- `verify:workspace:tracked intex-agent` passed source/test typecheck, targeted lint, 56 test
  files and 1402 tests; coverage: 96.19% statements, 95.00% branches, 98.21% functions,
  97.26% lines.
- `verify:workspace:tracked user-service`, HTTP contract typecheck/tests, migration 124,
  package exports, Firestore ownership/index artifacts, and migration verification passed.
- Independent API/privacy, persistence/race, and config/migration reviews all returned
  `READY` after every Critical/Important finding was resolved.
- Exact WhatsApp checkpoint message was accepted by Matrix, reread with matching sender and
  body, and machine-confirmed in the mautrix-whatsapp message mapping.
- Full `pnpm run ci` remains intentionally deferred to step 13.

## Step 10 — Authenticated Test Runs Web Experience

### Create

- `apps/web/src/types/intexAgentTestRuns.ts`
- `apps/web/src/services/intexAgentTestRunsDecoder.ts`
- `apps/web/src/services/__tests__/intexAgentTestRunsDecoder.test.ts`
- `apps/web/src/components/intex-agent/IntexTestRunHeader.tsx`
- `apps/web/src/components/intex-agent/IntexTestRunSelector.tsx`
- `apps/web/src/components/intex-agent/IntexTestScenarioRail.tsx`
- `apps/web/src/components/intex-agent/IntexTestScenarioTimeline.tsx`
- `apps/web/src/components/intex-agent/testRunPresentation.ts`
- matching tests under `apps/web/src/components/intex-agent/__tests__/`

### Modify

- `apps/web/src/types/index.ts`
- `apps/web/src/services/intexAgentApi.ts`
- `apps/web/src/services/authApi.ts`
- `apps/web/src/services/__tests__/intexAgentApi.test.ts`
- `apps/web/src/services/__tests__/authApi.test.ts`
- `apps/web/src/pages/IntexAgentSessionsPage.tsx`
- `apps/web/src/pages/__tests__/IntexAgentSessionsPage.test.tsx`
- `apps/web/package.json`
- `pnpm-lock.yaml`

### Task 10.1: Add closed browser types and API functions

- [x] Write RED API tests for exact paths/encoding, authentication, strict DTO fixtures,
  and proof that private/unknown sentinel fields do not survive parsing/presentation.
- [x] Mirror only the public Test Runs DTOs in `intexAgentTestRuns.ts` and re-export them.
- [x] Decode every response with the strict shared runtime schemas before storing browser
  state. Unknown/private fields, malformed discriminants, unsafe integers, and over-bound
  arrays fail closed; `apiRequest<T>` generic typing alone is not validation.
- [x] Add to `intexAgentApi.ts`:

```ts
listIntexAgentTestRuns(token): Promise<TestRunListDtoV1>;
getIntexAgentTestRun(token, runId): Promise<TestRunDtoV1>;
getIntexAgentTestScenario(token, runId, scenarioId): Promise<TestScenarioDtoV1>;
```

### Task 10.2: Add URL-authoritative tabs, selection, and refresh

- [x] Write RED page tests for `view=regular|test-runs`, `run`, and `scenario` deep links;
  invalid/stale IDs; browser navigation; capability unavailable; user switch; and request
  race cancellation.
- [x] Keep the canonical route `/#/intex-agent/sessions`. Default absent `view` to normal
  sessions; the Test Runs tab exists only when server capabilities allow it.
- [x] Resolve `GET /users/:uid/settings` first. Construct no tab, Test Runs decoder/client
  call, request, focus target, or deep-link state unless
  `intexAgentCapabilities.testRuns.status === 'available'`; capability revocation aborts
  work and clears all owner data.
- [x] In Test Runs view, select the requested retained run/scenario when valid, otherwise
  replace the URL with the first allowed item. Never mix `session` with `run/scenario`.
- [x] Poll the selected run every two seconds while lifecycle is nonterminal or artifact
  delivery is `pending/staged`; refresh scenario only when its revision advances. Poll run
  discovery every five seconds while visible, including after terminalization. Coalesce
  equivalent requests, refresh immediately on visibility return, abort/clear on auth or
  user changes, retain the last complete projection on transient failure, and back off to
  at most 15 seconds. A delayed response cannot regress revision or terminal state.

### Task 10.3: Render the run header, rail, and safe timeline

- [x] Write RED component tests for lifecycle/verdict/artifact distinction, 20-scenario
  ordering/filtering, current progress, DeepSeek/MiniMax labels, duration, exact nullable
  cost, tool selected vs mock executed, confirmations, deterministic cards, one MiniMax
  card per reply, and pending/not-evaluated states.
- [x] Implement presentation helpers with exhaustive discriminated-union switches. Unknown
  data never renders as raw JSON/text.
- [x] Use natural scenario labels from the catalog—not message text—in the rail. Render
  message text only in the selected authenticated scenario timeline.

### Task 10.4: Complete responsive and accessible behavior

- [x] Add RED desktop/mobile tests for timeline-first navigation on narrow screens, focus
  restoration, keyboard-selectable tabs/rails, labelled progress/status, non-color-only
  verdicts, loading skeletons, empty state, retryable stale state, and static errors.
- [x] Reuse the current Sessions page visual hierarchy. On desktop keep rail/timeline
  columns; on mobile preserve selected content and scroll/focus behavior.
- [x] Verify no test-mode control, capability, account identifier, session ID, transport ID,
  raw tool payload, or evaluator rationale enters DOM, browser logs, or URLs.

### Step 10 focused verification

```bash
pnpm --filter @intexuraos/web exec vitest run \
  src/services/__tests__/intexAgentApi.test.ts \
  src/services/__tests__/authApi.test.ts \
  src/services/__tests__/intexAgentTestRunsDecoder.test.ts \
  src/components/intex-agent/__tests__/testRunPresentation.test.ts \
  src/components/intex-agent/__tests__/IntexTestRunHeader.test.tsx \
  src/components/intex-agent/__tests__/IntexTestRunSelector.test.tsx \
  src/components/intex-agent/__tests__/IntexTestScenarioRail.test.tsx \
  src/components/intex-agent/__tests__/IntexTestScenarioTimeline.test.tsx \
  src/pages/__tests__/IntexAgentSessionsPage.test.tsx
pnpm run verify:workspace:tracked -- web
pnpm verify:workspace-deps
```

- [x] Obtain independent UX/accessibility and privacy review, resolve findings, record the
  step-10 hash/evidence checkpoint, machine-confirm its WhatsApp message, and advance to
  step 11 without a Git commit.

### Step 10 evidence checkpoint — 2026-07-20

- Implementation manifest: 295 non-plan files, SHA-256
  `8d4b7335fab6b8edaca0fa5b07fe684b42aa5b543e7ea36979c884a0de44d41a`.
- The nine focused Test Runs web files passed 64 tests; the complete web suite passed all
  148 files and 1073 tests. Web typecheck, targeted ESLint/Prettier, workspace dependency
  verification, and `git diff --check` passed.
- `verify:workspace:tracked web` passed its web typecheck/lint/test work but its script also
  spilled into the monorepo suite. Two in-scope facade/verifier failures found there were
  fixed and their 130 targeted tests passed; the sole remaining failure is an unchanged
  production Hetzner callback expectation outside step 10, deferred to the later approved
  `origin/development` update rather than mutating unrelated infrastructure here.
- Independent privacy and UX/accessibility reviews returned `READY` after owner isolation,
  authorization revocation, request races, monotonic revision fences, static errors,
  mobile focus, and bounded scenario retry/backoff findings were resolved.
- The exact step-10 completion message was accepted and reread as the bound Matrix user's
  own byte-matching `m.room.message`; mautrix persisted exactly one non-empty WhatsApp
  message mapping for that event. No account or transport identifier is stored here.
- Full `pnpm run ci` remains intentionally deferred to step 13.
