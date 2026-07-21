# Intex Agent Matrix Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete execution-goal steps 5–8: authorize Matrix-corpus traffic with one-use fenced capabilities, isolate encrypted test sessions, execute all tools through strict mocks, and persist safely correlated evidence and usage.

**Architecture:** WhatsApp Service owns lease/capability/transport authority and durable outboxes. Intex Agent verifies signed attestations, owns private encrypted run context and isolated sessions, chooses an executor from an immutable session profile, and exposes only closed evidence. No public message can request test mode.

**Tech Stack:** TypeScript, Fastify, Firestore transactions, Pub/Sub, Ed25519/JWS attestations, AES-256-GCM, Vitest.

## Global Constraints

- This is Ultra planning output only; no production implementation belongs to step 1.
- Execute later with a GPT-5.6 Extra High orchestrator. Assign focused RED/GREEN slices to
  `gpt-5.6-terra` medium/high subagents, one active writer per bounded file group. Use
  independent subagents for security/privacy and race-condition review. Do not use Ultra.
- The exact wire/state contracts in
  [`2026-07-19-intex-agent-matrix-corpus-design.md`](../specs/2026-07-19-intex-agent-matrix-corpus-design.md)
  override summaries in this plan.
- Each numbered execution step is separately tested, reviewed, hash-checkpointed, and
  followed by its exact machine-confirmed WhatsApp message before the next step begins.
  Steps 5–8 create no Git commit; step 13 commits the single unchanged CI-tested tree.
- Steps 5–8 are incremental component gates, not an operator-runnable corpus. Every
  cross-step dependency that is not implemented yet must return a closed not-ready result;
  production composition cannot activate a run until steps 6–9 are integrated, and no
  public runner selector exists until step 12. Component completion therefore never
  substitutes a fake dependency in production or weakens a later gate.
- RED must precede GREEN. Do not retrofit tests after implementation.
- Never construct or resolve production tool clients in the Matrix-corpus branch. A
  throwing sentinel at construction, admission, resolution, and invocation is mandatory.
- Do not run `pnpm run ci:tracked` in steps 5–8. Use focused service/package checks only.

## Shared Contract Files

### Create

- `packages/http-contracts/src/matrixCorpus.ts`
- `packages/http-contracts/src/__tests__/matrixCorpus.test.ts`

### Modify

- `packages/http-contracts/src/index.ts`
- `firestore-collections.json`
- `firestore.indexes.json`
- `ecosystem.config.cjs`
- `terraform/environments/dev/main.tf`

`matrixCorpus.ts` owns strict schemas/types for `MatrixCorpusCapabilityV1`,
`MatrixCorpusIngestContextV1`, `IntexAgentMatrixCorpusProfileV1`,
`StrictToolMockProfileV1`, `MatrixCorpusLlmCallContextV1`, attestations, terminal control,
and evidence cursors. Every object rejects unknown fields; every string/array/index is
bounded; canonical digests are versioned.

## Step 5 — Matrix/WhatsApp Control Plane

### Locked file map

Create under WhatsApp Service:

- `src/domain/matrixCorpus/visibleHeader.ts`
- `src/domain/matrixCorpus/types.ts`
- `src/domain/matrixCorpus/attestation.ts`
- `src/domain/matrixCorpus/controlPlane.ts`
- `src/domain/matrixCorpus/ports/matrixCorpusRepository.ts`
- `src/domain/matrixCorpus/ports/intexAgentMatrixCorpusClient.ts`
- `src/infra/firestore/matrixCorpusRepository.ts`
- `src/infra/http/intexAgentMatrixCorpusClient.ts`
- `src/infra/pubsub/matrixCorpusOutboxDrainer.ts`
- `src/routes/matrixCorpusRoutes.ts`
- `src/jobs/matrixCorpusLeaseSweeper.ts`

Modify:

- `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts`
- `apps/whatsapp-service/src/domain/whatsapp/events/events.ts`
- `apps/whatsapp-service/src/domain/whatsapp/ports/eventPublisher.ts`
- `apps/whatsapp-service/src/infra/pubsub/publisher.ts`
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- `apps/whatsapp-service/src/routes/internalRoutes.ts`
- `apps/whatsapp-service/src/routes/index.ts`
- `apps/whatsapp-service/src/services.ts`
- `apps/whatsapp-service/src/config.ts`
- `apps/whatsapp-service/src/index.ts`
- `apps/intex-agent/src/routes/internalRoutes.ts`
- `apps/intex-agent/src/infra/pubsub/decoder.ts`

Create under Intex Agent:

- `apps/intex-agent/src/domain/matrixCorpus/attestation.ts`
- `apps/intex-agent/src/domain/matrixCorpus/ingestReceiptService.ts`
- `apps/intex-agent/src/domain/matrixCorpus/ports/ingestReceiptRepository.ts`
- `apps/intex-agent/src/infra/firestore/ingestReceiptRepository.ts`
- `apps/intex-agent/src/domain/matrixCorpus/ports/testConfirmationRepository.ts`
- `apps/intex-agent/src/infra/firestore/testConfirmationRepository.ts`
- `apps/whatsapp-service/src/__tests__/integration/matrixCorpusControlPlaneComposition.test.ts`

### Task 5.1: Parse and remove the visible capability header

- [ ] Add RED parser/property tests for the exact versioned header, Unicode prompt
  normalization, digest stability, reserved-prefix malformation, size bounds, and proof
  that only the natural body survives.
- [ ] Implement `parseMatrixCorpusVisibleMessage()`,
  `normalizeMatrixCorpusPromptV1()`, and `digestMatrixCorpusPromptV1()`.
- [ ] Branch after canonical account mapping but before ordinary WhatsApp persistence,
  link preview, or Intex publish. A malformed reserved prefix fails closed and cannot fall
  through to the ordinary lane.

### Task 5.2: Implement lease, fence, and one-use capability transactions

- [ ] Write RED state-machine/repository tests for one live lease, non-authorizing
  provisioning, exact activation, renew, expiry, one-use issue/consume, replay, changed
  idempotency reuse, wrong run/user/transport/scenario/turn/prompt/session/confirmation,
  quiesce, drain, release-pending, and stale fences.
- [ ] Have the trusted evaluator generate each capability as `imc1_` plus exactly 32
  CSPRNG bytes in unpadded base64url and submit it as a write-only sensitive issuance
  field. Validate it server-side, persist only a keyed digest, never echo it, cap TTL at
  five minutes with 30-second accepted skew, and permit at most one unconsumed capability
  of any `start | turn | confirmation` phase per active exact run. An exact issuance
  retry resubmits the same caller-held raw value; add cross-phase issuance/consume and
  response-loss recovery tests.
- [ ] Implement these domain operations:

```ts
acquireProvisioningLease(input): Promise<ProvisioningLeaseResult>;
activateRun(input): Promise<ActivationResult>;
renewLease(input): Promise<LeaseRenewResult>;
issueCapability(input): Promise<CapabilityIssueResult>;
consumeCapabilityAndEnqueueIngest(input): Promise<CapabilityConsumeResult>;
quiesceRun(input): Promise<QuiesceResult>;
releaseRun(input): Promise<ReleaseResult>;
abandonExpiredRun(input): Promise<AbandonedRunResult>;
```

- [ ] Make capability consume, transport receipt, and ingest-outbox creation one Firestore
  transaction. Exact retries return the committed receipt; changed replay conflicts.
- [ ] Reuse with a different transport message ID must consume nothing, force safety
  quiescence, and persist one terminal correlated failure acknowledgment so transport
  retries stop. It cannot remain a recoverable active-run conflict.
- [ ] Implement terminal first-wins and outbox recovery at every crash boundary. A stale
  worker cannot renew, send, terminalize, or clean with an older fence.
- [ ] Freeze the cross-service saga gates: acquisition rejects any Intex current acceptance
  including terminal artifact `pending/staged`; activation requires matching context,
  manifest, preflight projection, and retention reconciliation; `drained=true` requires
  terminal turn markers, terminal outboxes, and zero reply/delivery work in flight;
  release requires matching tombstone/candidate/artifact digests; `released` requires the
  terminal-control acknowledgment.

### Task 5.3: Sign attestations and drain durable outboxes

- [ ] Add RED signature tests for issuer/audience/key version, payload digest, fence,
  receipt, expiry, wrong key, rotation, replay, malformed JWS, and unknown fields.
- [ ] Implement `signMatrixCorpusAttestation()` and
  `verifyMatrixCorpusAttestation()` with Ed25519; Intex Agent must not read WhatsApp-owned
  Firestore collections.
- [ ] Implement the ingest and terminal-control drainers. Publish retries retain the same
  receipt/event ID and never recreate or double-consume a capability.
- [ ] Add an Intex-owned receipt FSM
  `reserved -> processing -> llm_in_flight -> completed | failed`, bound to the exact
  attested payload digest plus stable session/event/tool/reply idempotency keys. The
  reserve and first durable processing intent are atomic. Idempotent repository/mock work
  may resume from `processing`; before any provider request, persist `llm_in_flight`.
  Recovery from `llm_in_flight` always terminally safety-stops as an ambiguous external
  effect and never retries the provider. A successful provider response advances to its
  durable outcome once; a crash before that write still takes the same no-retry safety
  path. Changed reuse forces the correlated replay failure.
- [ ] Keep the existing direct-ordinary/PubSub-wrapper top-level contract at
  `/internal/intex-agent/messages`; extend only the bounded inner Pub/Sub decoder with a
  closed signed evaluation variant. Direct signed evaluation input is rejected and no
  caller boolean enables mocks. A wrapped evaluation requires the edge-preserved Pub/Sub
  marker, valid edge-injected `X-Internal-Auth`, and a valid WhatsApp JWS; any subset is
  rejected. Disable body previews for the shared route. When corpus is disabled, keep
  ordinary direct/PubSub ingress and its response byte-compatible, but do not compose the
  evaluation verifier/receipt arm.

### Task 5.4: Expose the closed Home Dev-only control routes

- [ ] Add RED route/OpenAPI tests for auth, audience, configured user/transport binding,
  strict request/response schemas, bodyless logging, `409` CAS/fence conflicts, `410`
  expiry, idempotency, and zero account-existence signals.
- [ ] Implement the eight WhatsApp routes specified by the design:
  provision, activate, renew, capabilities, transport status, quiesce, release, cleanup.
- [ ] Authorize WhatsApp-owned exact cleanup with two fences: the current caller's
  provisioning fence and the terminal target record/manifest fence. Reject a nonterminal,
  current, or active target. Delete only that target's capabilities, ingest/terminal
  outboxes, transport receipts, and lease record; preserve raw webhook events and every
  unrelated/current-run record. Add positive, foreign-run, stale-fence, active-target, and
  retry route/repository tests.
- [ ] Update both async webhook processors to use the same parser/consume/outbox path.

### Task 5.5: Wire recovery and fail-closed configuration

- [ ] Add RED config/startup tests for disabled/missing values, Home Dev enablement, and
  rejection of `enabled=true` outside runtime audience `home-dev`.
- [ ] Wire schema-only environment names for enablement, evaluator binding, room/account
  binding, signing key/version, and binding HMAC. Values remain in protected Home Dev
  configuration and never enter tracked fixtures/logs. Do not add them to production
  secret-loading lists.
- [ ] Register ownership for the lease, capability, ingest outbox, terminal outbox, and
  transport-receipt collections and for the Intex receipt, test-confirmation, manifest,
  run-context, and scenario-context collections. Add startup wiring with a reentrancy-safe
  five-second outbox recovery drain and 30-second lease sweep; every candidate is claimed
  and phase/fence-revalidated transactionally, and shutdown drains/stops both loops.
- [ ] Add unit/fake-clock tests for trigger cadence, overlapping ticks, claim expiry,
  restart recovery, graceful shutdown, and no unhandled rejection.

### Step 5 focused verification

```bash
pnpm exec vitest run \
  packages/http-contracts/src/__tests__/matrixCorpus.test.ts \
  apps/whatsapp-service/src/__tests__/domain/matrixCorpus \
  apps/whatsapp-service/src/__tests__/infra/firestore/matrixCorpusRepository.test.ts \
  apps/whatsapp-service/src/__tests__/routes/matrixCorpusRoutes.test.ts \
  apps/whatsapp-service/src/__tests__/infra/pubsub/matrixCorpusOutboxDrainer.test.ts \
  apps/whatsapp-service/src/__tests__/jobs/matrixCorpusLeaseSweeper.test.ts \
  apps/whatsapp-service/src/__tests__/integration/matrixCorpusControlPlaneComposition.test.ts \
  apps/whatsapp-service/src/__tests__/usecases/processWebhookEventTextOnly.test.ts \
  apps/whatsapp-service/src/__tests__/usecases/retryPendingWebhookEvents.test.ts \
  apps/intex-agent/src/__tests__/routes/internalRoutes.test.ts \
  apps/intex-agent/src/__tests__/infra/pubsub/decoder.test.ts \
  apps/intex-agent/src/__tests__/domain/matrixCorpus/ingestReceiptService.test.ts \
  apps/intex-agent/src/__tests__/infra/firestore/testConfirmationRepository.test.ts
pnpm --filter @intexuraos/http-contracts typecheck
pnpm --filter @intexuraos/whatsapp-service typecheck
pnpm --filter @intexuraos/intex-agent typecheck
pnpm verify:firestore
pnpm verify:firestore-artifacts
```

- [ ] Obtain independent security/race review, resolve Critical/Important findings,
  record the step-5 hash/evidence checkpoint, machine-confirm its WhatsApp message, and
  advance to step 6 without a Git commit.

## Step 6 — Isolated Sessions and Encrypted Context

### Create

- `apps/intex-agent/src/domain/matrixCorpus/contextCrypto.ts`
- `apps/intex-agent/src/domain/matrixCorpus/contextService.ts`
- `apps/intex-agent/src/domain/matrixCorpus/matrixCorpusMessageHandler.ts`
- `apps/intex-agent/src/domain/matrixCorpus/ports/matrixCorpusContextRepository.ts`
- `apps/intex-agent/src/domain/matrixCorpus/ports/matrixCorpusManifestRepository.ts`
- `apps/intex-agent/src/infra/firestore/matrixCorpusContextRepository.ts`
- `apps/intex-agent/src/infra/firestore/matrixCorpusManifestRepository.ts`
- `apps/intex-agent/src/routes/matrixCorpusRoutes.ts`
- `apps/intex-agent/src/domain/testRuns/types.ts`
- `apps/intex-agent/src/domain/testRuns/stateMachine.ts`
- `apps/intex-agent/src/domain/testRuns/ports/testRunRepository.ts`
- `apps/intex-agent/src/infra/firestore/testRunRepository.ts`
- `apps/intex-agent/src/__tests__/domain/testRuns/types.test.ts`
- `apps/intex-agent/src/__tests__/domain/testRuns/stateMachine.test.ts`
- `apps/intex-agent/src/__tests__/infra/firestore/testRunRepository.test.ts`

### Modify

- `apps/intex-agent/src/domain/sessions/types.ts`
- `apps/intex-agent/src/domain/ports/sessionRepository.ts`
- `apps/intex-agent/src/infra/firestore/sessionRepository.ts`
- `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`
- `apps/intex-agent/src/services.ts`
- `apps/intex-agent/src/server.ts`

### Task 6.1: Encrypt and freeze run/scenario context

- [ ] Write RED crypto/repository tests for AES-256-GCM round-trip, wrong key/version,
  tampering, full associated-data binding, TTL, byte-identical idempotent registration,
  overlay ordering, fence mismatch, and plaintext leakage.
- [ ] Implement run registration that snapshots DeepSeek, prompt preferences, time zone,
  catalog evidence, and ordered scenario overlays exactly once.
- [ ] Append every created scenario/session binding atomically to the immutable run manifest
  before it becomes usable. The manifest records only exact owned run/scenario/session/
  user/audience/fence bindings used later for cleanup proof.
- [ ] Implement finalization that transactionally deletes scenario ciphertext and replaces
  run ciphertext with a durable tombstone/digest while preserving safe retained evidence.

### Task 6.2: Add a separate exact session/confirmation lane

- [ ] Write RED repository tests proving test sessions never participate in ordinary open,
  continuable, close, supersede, list, detail, or confirmation queries—even under
  interleaved account traffic.
- [ ] Add immutable `matrixCorpusProfile` and `lastEventSequence` to test sessions. Add
  exact-lane create/get methods bound to run, scenario, session, user, and fence.
- [ ] Make `appendEvent()` transactional: an identical event retry returns its committed
  positive sequence; changed reuse, gaps, duplicates, or exhaustion fail closed.
- [ ] Dispatch verified evaluation messages before any ordinary-session lookup. Keep test
  confirmations in the bound test lane.

### Task 6.3: Implement context/control/finalization routes

- [ ] Add RED route tests for context registration, finalize, control status,
  terminal-control first-wins, abandoned recovery, cleanup separation, and static errors.
- [ ] Create the full closed private Test Run aggregate types plus the minimal repository/
  transition foundation needed by context provisioning and signed terminal control. Step
  6 owns `preflight/running/finalizing/terminal` CAS, immutable terminal candidate, minimal
  scenario revision, and monotonic committed `eventWatermark`; step 9 extends the same
  files with safe evidence projections and public readers.
- [ ] Implement the five Intex private routes from the design. Only signed terminal control
  applies the stored finalizing candidate; evaluator writes cannot directly terminalize.
- [ ] Abandoned recovery atomically applies `running|finalizing -> stopped/not_evaluated`,
  active scenario `stopped`, remaining scenarios `not_run`, plus artifact `pending ->
  failed/REPORT_STAGING_INTERRUPTED` or `staged ->
  unknown/REPORT_DELIVERY_STATUS_TIMEOUT`; a terminal delivery state remains unchanged.
  The first valid release/abandoned terminal event wins and the opposite retry returns the
  stored outcome. Partial provisioning without message/session rolls back safely; partial
  state containing a capability/session/message is corruption and fails closed.
- [ ] Wire the context encryption secret/key version only on Home Dev and reject enablement
  without valid key material.

### Step 6 focused verification

```bash
pnpm --filter @intexuraos/intex-agent test -- \
  src/__tests__/domain/matrixCorpus/contextCrypto.test.ts \
  src/__tests__/domain/matrixCorpus/contextService.test.ts \
  src/__tests__/domain/matrixCorpus/matrixCorpusMessageHandler.test.ts \
  src/__tests__/infra/firestore/matrixCorpusContextRepository.test.ts \
  src/__tests__/infra/firestore/matrixCorpusManifestRepository.test.ts \
  src/__tests__/domain/testRuns/types.test.ts \
  src/__tests__/domain/testRuns/stateMachine.test.ts \
  src/__tests__/infra/firestore/testRunRepository.test.ts \
  src/__tests__/infra/firestore/sessionRepository.test.ts \
  src/__tests__/routes/matrixCorpusRoutes.test.ts
pnpm --filter @intexuraos/intex-agent typecheck
```

- [ ] Obtain independent isolation/crypto review, resolve findings, record the step-6
  hash/evidence checkpoint, machine-confirm its WhatsApp message, and advance to step 7
  without a Git commit.

## Step 7 — Strict Mocks for All 11 Tools

### Create

- `apps/intex-agent/src/domain/matrixCorpus/strictToolMockProfile.ts`
- `apps/intex-agent/src/domain/matrixCorpus/strictToolMockExecutor.ts`
- `apps/intex-agent/src/domain/matrixCorpus/toolSelectionPolicy.ts`
- `apps/intex-agent/src/domain/matrixCorpus/executorResolver.ts`
- `apps/intex-agent/src/domain/matrixCorpus/matrixCorpusExecutionService.ts`
- `apps/intex-agent/src/domain/matrixCorpus/ports/testConfirmationRepository.ts`
- `apps/intex-agent/src/infra/firestore/testConfirmationRepository.ts`

### Modify

- `apps/intex-agent/src/domain/agent/toolDefinitions.ts`
- `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`
- `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`
- `apps/intex-agent/src/domain/matrixCorpus/ingestReceiptService.ts`
- `apps/intex-agent/src/domain/matrixCorpus/ports/ingestReceiptRepository.ts`
- `apps/intex-agent/src/domain/sessions/types.ts`
- `apps/intex-agent/src/infra/firestore/ingestReceiptRepository.ts`
- `apps/intex-agent/src/infra/firestore/sessionRepository.ts`
- `apps/intex-agent/src/services.ts`

### Task 7.1: Validate a closed per-turn mock schedule

- [x] Write RED table tests for all 11 canonical tool names, bounded result schemas,
  per-turn call ordinals, repeated calls, missing/malformed config, extra schedule entries,
  and immutable digest verification.
- [x] Implement the strict profile decoder with no default result and no permissive reuse of
  `domain/testConversation/testToolMocks.ts`.
- [x] Require a catalog-derived expected schedule independent from the mock profile, sign and
  persist it with the test lane, and reject profile/schedule mismatch before executor creation.
- [x] For the four user-preference tools, operate only on the encrypted scenario overlay.
  Bind each mutation to receipt + tool + turn + ordinal; an exact retry returns the prior
  version, rejection changes nothing, and the real preference repository is never resolved.

### Task 7.2: Gate selection before any executor or production client

- [x] Write RED sentinels proving zero production construction, resolution, admission, and
  invocation for normal and confirmation flows.
- [x] Enforce the exact order `argument schema validation -> durable tool_call_started ->
  policy gate -> confirmation/executor`. Implement `evaluateMatrixCorpusToolSelection()`
  before confirmation preview, executor lookup, tool callback, or repair. Missing expected
  config is a safety stop;
  known unexpected/forbidden selection is behavioral evidence with no execution.
- [x] Make production client/executor creation lazy and reachable only through the ordinary
  resolver. Split `createOrdinaryRunner()` and `createMatrixCorpusRunner()`.
- [x] Compose verified Matrix ingest through the real strict execution service so the enabled
  Home Dev runtime reaches `completed`; retain `MATRIX_CORPUS_NOT_READY` only for deliberately
  incomplete test composition.

### Task 7.3: Use the same strict resolver for confirmation continuation

- [x] Write RED tests for accepted/rejected confirmations, cross-lane attempts, duplicate
  buttons, expiry, and proof of zero LLM calls/usage during confirmation handling.
- [x] Accepted test confirmation executes the scheduled strict mock; rejected confirmation
  executes no tool. Ordinary confirmations retain current behavior.
- [x] Make the durable confirmation-resolution boundary exactly retry-safe: an identical signed
  replay resumes deterministic event persistence, while changed decision/message/time rejects.

### Step 7 focused verification

```bash
pnpm --filter @intexuraos/intex-agent exec vitest run \
  src/__tests__/domain/matrixCorpus/strictToolMockProfile.test.ts \
  src/__tests__/domain/matrixCorpus/strictToolMockExecutor.test.ts \
  src/__tests__/domain/matrixCorpus/toolSelectionPolicy.test.ts \
  src/__tests__/domain/matrixCorpus/executorResolver.test.ts \
  src/__tests__/domain/matrixCorpus/matrixCorpusExecutionService.test.ts \
  src/__tests__/domain/matrixCorpus/matrixCorpusMessageHandler.test.ts \
  src/__tests__/domain/matrixCorpus/ingestReceiptService.test.ts \
  src/__tests__/infra/firestore/testConfirmationRepository.test.ts \
  src/__tests__/domain/intexAgentRunner.test.ts \
  src/__tests__/domain/handleIncomingMessage.test.ts \
  src/__tests__/domain/testToolMocks.test.ts \
  src/__tests__/services.test.ts
pnpm --filter @intexuraos/intex-agent typecheck
```

- [x] Obtain independent safety review centered on the zero-production-call proof, resolve
  findings, record the step-7 hash/evidence checkpoint, machine-confirm its WhatsApp
  message, and advance to step 8 without a Git commit.

## Step 8 — Correlation, Completion, Safe Evidence, and Usage

### Create

- `apps/intex-agent/src/domain/matrixCorpus/correlation.ts`
- `apps/intex-agent/src/domain/matrixCorpus/safeEvidence.ts`
- `apps/intex-agent/src/domain/matrixCorpus/usageProjection.ts`
- `apps/intex-agent/src/domain/matrixCorpus/evidenceService.ts`
- `packages/llm-contract/src/__tests__/types.test.ts`
- `apps/intex-agent/src/__tests__/integration/matrixCorpusIngressComposition.test.ts`

### Modify

- `apps/intex-agent/src/domain/sessions/types.ts`
- `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts`
- `apps/intex-agent/src/infra/pubsub/whatsappReplyPublisher.ts`
- `apps/intex-agent/src/routes/matrixCorpusRoutes.ts`
- `packages/llm-contract/src/types.ts`
- `packages/llm-contract/src/toolCalling.ts`
- `packages/llm-factory/src/llmClientFactory.ts`
- `packages/infra-openrouter/src/toolCallingClient.ts`
- `packages/infra-gemini/src/toolCallingClient.ts`

### Task 8.1: Close every turn with durable correlation markers

- [x] Write RED tests for event/receipt/session/capability/tool/reply joins, duplicates,
  out-of-order delivery, one-to-five replies, a sixth reply, unbound replies, completion,
  catchable failure, timeout, and publisher ambiguity.
- [x] Carry run/scenario/turn/session/fence through private correlation only. Emit
  `turn_processing_completed` only after durable acceptance of all reply publications;
  emit `turn_processing_failed` only after further publication is closed.
- [x] Return durable publisher receipts. Never infer completion from a quiet period.
- [x] Persist the Matrix idempotency key before issue and atomically attach the acknowledged
  Matrix event ID; prove bound room plus byte-identical capability-bearing text. Reconcile
  WhatsApp transport ingress/delivery digests, contiguous `replyIndex`, and the ordered
  reply-digest set stored in the completion marker.
- [x] Use a durable per-turn publication CAS (`open -> completing | failing -> closed`) and
  stable reply idempotency keys so publish-vs-failure races and crash-after-publish resume
  without an extra reply or a premature marker.

### Task 8.2: Persist distinct selected/mock evidence and closed facts

- [x] Write RED per-tool mapper tests seeded with raw IDs, URLs, arguments, results,
  credentials, prompts, reasoning, unknown fields, and object-shaped values.
- [x] Implement `mapSafeToolFacts()` field by field using only the spec's closed names and
  scalar values. Keep `selected` distinct from `mock_completed`/`mock_failed` and
  `unexpected_known_no_execution`.
- [x] Add the exact-fence/revision evidence endpoint; it returns no natural messages,
  private identifiers, arbitrary payloads, or transport IDs.
- [x] Add captured application-log and Sentry tests for issuance, reject, replay, outbox,
  signature, executor, evidence, cleanup, and every success/error path. Seed prompt,
  capability, raw IDs, arguments/results, and thrown errors; none may escape.

### Task 8.3: Record every provider call and exact run cost

- [x] Write RED tests for classifier/generation/repair call ordinals, multi-iteration tool
  loops, duplicate/missing/wrong-model usage, confirmations with zero usage, exact decimal
  nano-USD conversion, and global-usage isolation.
- [x] Extend closed LLM correlation and tool-calling results so every provider call reports
  tokens/provider cost independently. Preserve Gemini behavior as a regression.
- [x] Build run totals only from run-owned usage projection; never reconstruct them from
  global `llm_usage`.

### Step 8 focused verification

```bash
pnpm --filter @intexuraos/intex-agent test -- \
  src/__tests__/domain/matrixCorpus/correlation.test.ts \
  src/__tests__/domain/matrixCorpus/safeEvidence.test.ts \
  src/__tests__/domain/matrixCorpus/usageProjection.test.ts \
  src/__tests__/integration/matrixCorpusIngressComposition.test.ts \
  src/__tests__/routes/matrixCorpusRoutes.test.ts \
  src/__tests__/domain/handleIncomingMessage.test.ts
pnpm exec vitest run \
  packages/llm-contract/src/__tests__/types.test.ts \
  packages/infra-openrouter/src/__tests__/toolCallingClient.test.ts \
  packages/infra-gemini/src/__tests__/toolCallingClient.test.ts \
  packages/llm-factory/src/__tests__/llmClientFactory.test.ts
pnpm --filter @intexuraos/intex-agent typecheck
pnpm --filter @intexuraos/llm-contract typecheck
pnpm --filter @intexuraos/llm-factory typecheck
```

### Step 8 evidence checkpoint — 2026-07-20

- Implementation manifest: `249` modified/untracked non-plan files, path-sorted with each
  file's SHA-256 and then hashed as one manifest:
  `5d619e175287c454f1cd70436805fc85a027f2dbc02317338e360b3802d02ce0`.
- Fresh application tests: Intex Agent `1041/1041`; WhatsApp Service `1583/1583`.
- Focused package tests passed for common redaction/HTTP, Sentry, WhatsApp Pub/Sub,
  OpenRouter, Gemini, LLM contracts, and LLM factory; affected application typechecks,
  scoped ESLint, formatting, and `git diff --check` passed.
- Review-only privacy, usage/specification, and race/correlation reviewers returned
  `APPROVE` with no remaining Critical or Important finding. The bounded `1..5` reply
  contract belongs to correlation/receipt/evaluator handling; the current runner correctly
  emits one logical reply without narrowing that bound.
- The exact step-8 completion message was accepted as the bound Matrix user's own
  `m.room.message`, its content matched byte-for-byte, and mautrix persisted one non-empty
  WhatsApp message mapping for that Matrix event. No account or transport identifier is
  stored in this checkpoint.
- Full `pnpm run ci:tracked` remains intentionally deferred to the single step-13 commit
  gate. No commit or `origin/development` integration occurred at this checkpoint.

- [x] Obtain independent correlation/privacy/usage review, resolve findings, record the
  step-8 hash/evidence checkpoint, machine-confirm its WhatsApp message, and advance to
  step 9 without a Git commit.
