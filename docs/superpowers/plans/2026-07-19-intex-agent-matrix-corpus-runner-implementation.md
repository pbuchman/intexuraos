# Intex Agent Matrix Corpus Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete execution-goal steps 11–12: run the canonical 20-scenario/59-turn corpus sequentially through Matrix/WhatsApp on DeepSeek V4 Flash, judge replies with MiniMax M3, and publish privacy-safe terminal artifacts through the Home Dev wrapper.

**Architecture:** The evaluator orchestrates but never bypasses transport or writes Intex-owned collections. Typed internal clients drive the already-implemented control planes. A separate matrix-corpus state machine correlates exact replies/confirmations, continues behavioral failures, stops safety/infrastructure failures, stages artifacts before finalization, and publishes only after signed terminal acknowledgment.

**Tech Stack:** TypeScript CLI, Zod, Matrix client-server API, Fastify internal clients, Bash SSH wrapper, Vitest.

## Global Constraints

- This is Ultra planning output only. Execute with a GPT-5.6 Extra High orchestrator and
  delegate catalog/client, state-machine, artifact, and wrapper slices to independent
  `gpt-5.6-terra` medium/high subagents. Do not use Ultra for implementation.
- Follow
  [`2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md`](../specs/2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md)
  exactly. The core/UX plans are completed dependencies, not code to duplicate here.
- The runner sends no message and calls no LLM before all preflight checks pass.
- `matrix-corpus` executes once per explicit authorization. There is no automatic scenario
  or run retry after an ambiguous send or failure.
- Agent calls are always `or:deepseek/deepseek-v4-flash`; evaluator calls are always
  `or:minimax/minimax-m3`; no Sonnet and no fallback exist.
- Step 11 and 12 each get focused TDD, review, a hash/evidence checkpoint, and exact
  WhatsApp completion. They create no Git commit and do not run full repository CI; step
  13 owns the tested-tree commit gate.

## Step 11 — Canonical Sequential Matrix Corpus

### Create

- `tools/intex-agent-evals/src/matrixCorpus/types.ts`
- `tools/intex-agent-evals/src/matrixCorpus/catalog.ts`
- `tools/intex-agent-evals/src/matrixCorpus/controlPlaneClient.ts`
- `tools/intex-agent-evals/src/matrixCorpus/correlation.ts`
- `tools/intex-agent-evals/src/matrixCorpus/runMatrixCorpus.ts`
- `tools/intex-agent-evals/src/__tests__/matrixCorpusCatalog.test.ts`
- `tools/intex-agent-evals/src/__tests__/matrixCorpusControlPlaneClient.test.ts`
- `tools/intex-agent-evals/src/__tests__/matrixCorpusCorrelation.test.ts`
- `tools/intex-agent-evals/src/__tests__/matrixCorpusRunner.test.ts`
- `packages/internal-clients/src/intex-agent/types.ts`
- `packages/internal-clients/src/intex-agent/client.ts`
- `packages/internal-clients/src/intex-agent/index.ts`
- `packages/internal-clients/src/intex-agent/__tests__/client.test.ts`

### Modify

- `tools/intex-agent-evals/src/live/matrixClient.ts`
- `tools/intex-agent-evals/src/live/runMatrixSmoke.ts`
- `tools/intex-agent-evals/src/endpointClient.ts`
- `tools/intex-agent-evals/src/__tests__/matrixClient.test.ts`
- `tools/intex-agent-evals/src/__tests__/runMatrixSmoke.test.ts`
- `tools/intex-agent-evals/src/__tests__/runEndpointScenario.test.ts`
- `tools/intex-agent-evals/src/__tests__/cli.test.ts`
- `apps/intex-agent/src/domain/testConversation/testConversationTypes.ts`
- `apps/intex-agent/src/routes/testConversationRoutes.ts`
- `apps/intex-agent/src/services.ts`
- `apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts`
- `apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts`
- `apps/intex-agent/src/__tests__/services.test.ts`
- `packages/internal-clients/src/whatsapp-service/types.ts`
- `packages/internal-clients/src/whatsapp-service/client.ts`
- `packages/internal-clients/src/whatsapp-service/index.ts`
- `packages/internal-clients/src/whatsapp-service/__tests__/client.test.ts`
- `packages/internal-clients/src/index.ts`

### Task 11.1: Freeze catalog and model invariants

- [x] Write RED tests that load exactly `intex-eval-001` through `020`, total exactly 59
  ordered turns, maximum 20 turns in one scenario, unique/stable digests, closed mock
  profiles, valid confirmation references, and no real-looking identifiers.
- [x] Implement `loadCanonicalMatrixCorpus()` by consuming the existing scenario JSON
  files and adding only Matrix execution profile validation; do not fork message/semantic
  content into a second catalog.
- [x] Export literal constants:

```ts
export const MATRIX_CORPUS_AGENT_MODEL = 'or:deepseek/deepseek-v4-flash' as const;
export const MATRIX_CORPUS_JUDGE_MODEL = 'or:minimax/minimax-m3' as const;
```

- [x] Make both endpoint request/response and Matrix run profile contain the literal agent
  model. The test-conversation runner constructs every classifier/generation/repair client
  from the request model, not global config. Any different model is rejected before the
  first provider call.

### Task 11.2: Add shared strict typed control-plane clients

- [x] Write RED decoder tests for every WhatsApp/Intex endpoint, unknown fields, closed
  errors, abort/timeout, changed idempotency response, wrong run/fence, and accidental raw
  private data.
- [x] Implement the reusable WhatsApp/Intex internal-client operations for provision,
  exact-request control authorization, context, activate, renew,
  capability, transport status, evidence, projection, artifact delivery, quiesce,
  context finalize, release, terminal status, and exact cleanup.
- [x] Before every authority-bearing Intex mutation, request a short-lived WhatsApp
  `control-authorizations` envelope for the exact canonical request body and submit that
  envelope unchanged. Never cache, synthesize, or reuse an authorization for another
  operation/body; a retry may reuse it only for the byte-identical idempotent mutation
  while it remains valid.
- [x] Make evaluator `matrixCorpus/controlPlaneClient.ts` a thin composition adapter over
  those shared clients; it must not redeclare wire DTOs or decoders. Clients return only
  closed domain results and never log bodies, route identifiers, raw errors, capabilities,
  or account data.

### Task 11.3: Correlate transport replies and confirmations exactly

- [x] Extend private Matrix timeline decoding with event ID and origin timestamp plus the
  exact correlation markers required by the control plane. Keep the legacy smoke selector
  behavior unchanged behind its own tests.
- [x] Write RED tests for cursor capture, limited sync, event duplication/redaction/edit,
  wrong puppet, wrong turn/session, zero-to-five replies, sixth reply, unbound reply,
  completion/failure marker, timeout, and ambiguous outbound send.
- [x] Implement `collectCorrelatedReplies()` using durable control/evidence status. Never
  pick the first plausible room message and never resend an ambiguous turn.
- [x] For confirmation turns, issue/use the exact bound confirmation capability and wait
  for the confirmation resolution/completion evidence; no LLM evaluation applies to the
  control itself.

### Task 11.4: Implement the sequential run state machine

- [x] Write RED runner tests for canonical order, concurrency one, one session per scenario,
  exact continuation, lease renewals, projection CAS refetch, behavioral continuation
  through scenario 20, immediate safety/infra stop, quiesce/drain, staged-artifact gate,
  finalization, release, terminal ack, and cleanup.
- [x] Implement `runMatrixCorpus()` as explicit run/scenario/turn states. It must not call
  `runEndpointCorpus()` or `runMatrixSmoke()` internally.
- [x] Evaluate every correlated assistant reply independently with the existing MiniMax
  judge and separately apply deterministic assertions. A bounded schema-repair judge call
  is allowed; another verdict request or model substitution is not.
- [x] Reconcile expected/observed/judged reply counts, selected/mock tool evidence,
  confirmations, agent usage, evaluator usage, and provider-reported costs before a
  scenario/run can pass.
- [x] Return exit precedence: `0` complete pass, `1` complete behavioral failure,
  `2` infrastructure/safety/artifact-delivery failure.

### Task 11.5: Keep the operator command unavailable until the preflight is complete

- [x] Test `runMatrixCorpus()` only through direct dependency-injected composition in step
  11. Do not add `matrix-corpus` to the public CLI or wrapper in this step.
- [x] Add a regression assertion that the step-11 CLI rejects `matrix-corpus`; the selector
  is enabled only in step 12 after the zero-side-effect preflight and artifact boundary are
  implemented and tested.

### Step 11 focused verification

```bash
pnpm exec vitest run \
  tools/intex-agent-evals/src/__tests__/matrixCorpusCatalog.test.ts \
  tools/intex-agent-evals/src/__tests__/matrixCorpusControlPlaneClient.test.ts \
  tools/intex-agent-evals/src/__tests__/matrixCorpusCorrelation.test.ts \
  tools/intex-agent-evals/src/__tests__/matrixCorpusRunner.test.ts \
  tools/intex-agent-evals/src/__tests__/cli.test.ts \
  tools/intex-agent-evals/src/__tests__/matrixClient.test.ts \
  tools/intex-agent-evals/src/__tests__/runMatrixSmoke.test.ts \
  tools/intex-agent-evals/src/__tests__/runEndpointScenario.test.ts \
  packages/internal-clients/src/intex-agent/__tests__/client.test.ts \
  packages/internal-clients/src/whatsapp-service/__tests__/client.test.ts
pnpm exec vitest run \
  apps/intex-agent/src/__tests__/routes/testConversationRoutes.test.ts \
  apps/intex-agent/src/__tests__/domain/runTestConversation.test.ts \
  apps/intex-agent/src/__tests__/services.test.ts
pnpm --filter @intexuraos/intex-agent-evals validate
pnpm run verify:package-exports
```

- [x] Obtain independent state-machine, transport-correlation, and model-boundary review;
  resolve findings, record the step-11 hash/evidence checkpoint, machine-confirm its
  WhatsApp message, and advance to step 12 without a Git commit.

### Step 11 evidence checkpoint — 2026-07-20

- Implementation manifest: 324 modified/untracked non-plan files, path-sorted with each
  file's SHA-256 and then hashed as one manifest:
  `07c7076608224039992a2fef354492e0a0e05cc4d4774212159fd2c30fef5003`.
- The complete evaluator validation passed 18 files and 835 tests, including exactly 20
  scenarios, 59 turns, a maximum of 20 turns, strict correlation, one unique created
  session per scenario, DeepSeek V4 Flash agent binding, MiniMax M3 judge binding, and the
  intentionally unavailable step-11 public `matrix-corpus` selector.
- Internal clients passed 25 files and 356 tests plus typecheck and ESLint. The focused
  Intex Agent suites passed 4 files and 139 tests plus typecheck and ESLint. The focused
  WhatsApp transport/client suites passed 2 files and 13 tests plus typecheck and scoped
  ESLint. Package exports, focused Prettier, and `git diff --check` passed.
- Independent state-machine, transport/privacy/correlation, and model/catalog reviewers
  returned `READY` after duplicate-session, terminal-barrier, response-identity, private
  logging, immutable-authorization, redaction, and model-boundary findings were resolved.
- The exact step-11 completion message was accepted and reread as the bound Matrix user's
  own byte-matching `m.room.message`; `/whoami` matched its sender and mautrix persisted
  exactly one non-empty WhatsApp message mapping for that event. No account or transport
  identifier is stored in this checkpoint.
- Full `pnpm run ci:tracked` remains intentionally deferred to the single step-13 commit
  gate. No commit or `origin/development` integration occurred at this checkpoint.

## Step 12 — Reports, Retention, Wrapper, and Home Dev Wiring

### Create

- `tools/intex-agent-evals/src/matrixCorpus/preflight.ts`
- `tools/intex-agent-evals/src/matrixCorpus/reportSchema.ts`
- `tools/intex-agent-evals/src/matrixCorpus/reportArtifacts.ts`
- `tools/intex-agent-evals/src/__tests__/matrixCorpusPreflight.test.ts`
- `tools/intex-agent-evals/src/__tests__/matrixCorpusReport.test.ts`
- `tools/intex-agent-evals/src/__tests__/matrixCorpusRetention.test.ts`

### Modify

- `tools/intex-agent-evals/src/preflight.ts`
- `tools/intex-agent-evals/src/reportWriter.ts`
- `tools/intex-agent-evals/src/cli.ts`
- `tools/intex-agent-evals/src/__tests__/preflight.test.ts`
- `tools/intex-agent-evals/src/__tests__/reportWriter.test.ts`
- `tools/intex-agent-evals/src/__tests__/cli.test.ts`
- `scripts/run-intex-agent-evals-home-dev.sh`
- `scripts/__tests__/run-intex-agent-evals-home-dev.test.ts`
- `package.json`
- `docs/testing/intex-agent-evals.md`
- `apps/intex-agent/src/config.ts`
- `apps/intex-agent/src/index.ts`
- `apps/intex-agent/src/__tests__/config.test.ts`
- `apps/intex-agent/src/__tests__/services.test.ts`
- `apps/whatsapp-service/src/config.ts`
- `apps/whatsapp-service/src/index.ts`
- `apps/whatsapp-service/src/__tests__/config.test.ts`
- `apps/whatsapp-service/src/__tests__/services.test.ts`
- `ecosystem.config.cjs`
- `ecosystem.config.prod.cjs`
- `scripts/__tests__/ecosystem.config.test.ts`
- `scripts/__tests__/ecosystem.prod.config.test.ts`
- `firestore-collections.json`
- `firestore.indexes.json`

### Task 12.1: Implement a zero-side-effect corpus preflight

- [ ] Write RED tests for every closed preflight boundary in the live-acceptance spec,
  exact requested/deployed SHA equality, dirty tracked/untracked critical paths, account
  tuple uniqueness, health/sync/bridge readiness, runtime/rollout, clocks, catalog/model,
  strict-mock coverage, capacity, active-run conflict, and static output.
- [ ] Implement `runMatrixCorpusPreflight()` so it creates no run/artifact directory,
  acquires no lease, registers no context/projection, creates no outbox/receipt/probe,
  issues no capability, sends no Matrix/WhatsApp message, calls no LLM, performs no
  Firestore/Pub/Sub write, and performs no filesystem mutation, including temporary
  create/delete probes.
- [ ] Test the complete preflight with throwing implementations for every mutating port and
  byte/count snapshots of filesystem plus fake service state before/after.
- [ ] Replace the existing MiniMax probe in the canonical `preflight` command with strict
  credential/config plus live catalog/capability readiness. Preserve legacy evaluation
  commands' actual judge calls after preflight.
- [ ] On failure stdout is empty and stderr contains only the closed preflight line plus
  wrapper framing; never include identifiers or raw errors.

### Task 12.2: Stage, terminalize, and publish safe artifacts

- [ ] Write RED schema/privacy tests seeded with every forbidden class: account/session/
  transport IDs, capability/token/key, prompts/replies outside allowed timeline output,
  raw arguments/results, provider payloads, MiniMax rationale, Firebase data, and errors.
- [ ] Implement strict JSON report schema and deterministic Markdown view with requested/
  deployed SHA, catalog digests, DeepSeek/MiniMax identities, totals, integer nano-USD,
  closed failures, cleanup, and artifact-delivery status.
- [ ] `stageMatrixCorpusArtifacts()` writes hidden mode-`0600` candidates, validates both,
  and sends their digests before `finalizing`. Publish atomically only after terminal ack
  and release; then mark ready. Crash/failure follows the exact failed/unknown contracts.
- [ ] Keep legacy `EvaluationReportV1` and writer unchanged for endpoint/full/smoke.

### Task 12.3: Apply exact-ID retention

- [ ] Write RED retention tests for current acceptance, latest ready pass, latest failed
  acceptance, artifact pending/staged, target fence, partial cleanup, retries, and proof
  that ordinary sessions/preferences/account data remain byte-identical.
- [ ] Delete only evicted exact run IDs from each owner through its guarded cleanup route;
  never use user-wide selectors. Provision the new fence before evicting old data.

### Task 12.4: Harden the Home Dev wrapper and repository command

- [ ] Add RED shell tests for exact 40-character local/remote SHA equality, clean critical
  paths including untracked files, strict framed output state machine, signal handling,
  command/argument rejection, exit propagation, and report path only when ready.
- [ ] Only now add `matrix-corpus` to the CLI and wrapper. A composition-order test must
  prove `preflight PASS -> provisioning -> activation`; all run/capability/artifact/message/
  LLM ports throw if touched before the preflight result is passed.
- [ ] Add root `eval:intex-agent:matrix-corpus`, while keeping the SSH wrapper the
  canonical machine-local operator command.
- [ ] Update the runbook: “odpal testy” means exactly one `matrix-corpus`; endpoint and
  targeted scenario are diagnostics; legacy `full` remains endpoint plus one smoke;
  `matrix-smoke` remains one message.
- [ ] Do not add a deploy/pull/restart side effect to the wrapper.

### Task 12.5: Complete fail-closed Home Dev wiring

- [ ] Add focused config/client/index/ownership tests for all service URLs, runtime flags,
  evaluator binding, signing/encryption key references, collection ownership, and indexes.
- [ ] Production must explicitly disable Matrix corpus and reject activation even if key
  variables exist. Do not add Home Dev private values to repository or production secret
  loaders.
- [ ] Keep operator IDs, Matrix token/targets, room/account/sender mappings, and credentials
  only under the protected machine-local config (`0700` directory, `0600` files, owner UID,
  no symlinks). Tracked code stores only schemas and safe aliases.

### Step 12 focused verification

```bash
pnpm exec vitest run \
  tools/intex-agent-evals/src/__tests__/matrixCorpusPreflight.test.ts \
  tools/intex-agent-evals/src/__tests__/matrixCorpusReport.test.ts \
  tools/intex-agent-evals/src/__tests__/matrixCorpusRetention.test.ts \
  tools/intex-agent-evals/src/__tests__/preflight.test.ts \
  tools/intex-agent-evals/src/__tests__/reportWriter.test.ts \
  tools/intex-agent-evals/src/__tests__/cli.test.ts \
  scripts/__tests__/run-intex-agent-evals-home-dev.test.ts \
  apps/intex-agent/src/__tests__/config.test.ts \
  apps/intex-agent/src/__tests__/services.test.ts \
  apps/whatsapp-service/src/__tests__/config.test.ts \
  apps/whatsapp-service/src/__tests__/services.test.ts \
  scripts/__tests__/ecosystem.config.test.ts \
  scripts/__tests__/ecosystem.prod.config.test.ts
pnpm --filter @intexuraos/intex-agent-evals validate
pnpm --filter @intexuraos/internal-clients typecheck
pnpm verify:firestore
pnpm verify:firestore-artifacts
pnpm verify:boundaries
pnpm verify:workspace-deps
```

- [ ] Obtain independent report/privacy, wrapper/operations, and production-fail-closed
  review. Resolve findings, record the step-12 hash/evidence checkpoint, machine-confirm
  its WhatsApp message, and advance to step 13 without a Git commit.
