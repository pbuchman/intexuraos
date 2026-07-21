# Intex Agent Verification, Release, and Live Acceptance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete execution-goal steps 13–15: prove the integrated system automatically, merge and deploy the reviewed revision, run a zero-side-effect Home Dev preflight, then execute exactly one authorized live Matrix corpus and verify the same run in the authenticated browser.

**Architecture:** Deterministic composition tests cover paid/external boundaries with fakes and throwing sentinels. One repository-wide CI gate freezes the implementation revision. GitHub checks and exact-SHA Home Dev deployment precede a read-only preflight. The paid live run is a separate user-authorized operation followed by Matrix/WhatsApp, report, desktop, mobile, and settings acceptance.

**Tech Stack:** Vitest, repository verification scripts, Git/GitHub, Home Dev SSH wrapper, Matrix/WhatsApp, Chrome browser automation.

## Global Constraints

- This file is Ultra planning output. Steps 13–15 use a GPT-5.6 Extra High orchestrator;
  delegate deterministic verification, security/privacy review, operational preflight,
  and browser audit to lower-cost `gpt-5.6-terra` medium/high subagents. Do not use Ultra.
- A reviewer may inspect but must not silently edit the implementation it reviews.
- No corpus/test Matrix traffic or paid LLM call occurs in step 13 or the step-14
  preflight. The sole exception is the one required completion notification, sent only
  after each step's entire gate has passed.
- Steps 1–12 create no Git commit. Step 13 materializes their exact intended diff on the
  latest `development` in a disposable clone, runs `pnpm run ci:tracked` once after
  integrated review, then commits the byte-identical tested tree. No later commit is
  planned; every required later commit receives its own full CI first, regardless of scope.
- No ticket number is required for branch, commit, push, or PR. Do not pause for one.
- The live corpus is never retried automatically. If send/delivery is ambiguous, reconcile
  the recorded idempotency/correlation state and report the blocker.
- Each completed step gets the exact message from the 15-step goal only after its full gate
  passes and delivery is machine-confirmed.

## Step 13 — Integrated Automated Verification and Review

### Task 13.0: Materialize the exact change on latest `development`

- [ ] Fetch the latest protected `development` and create a clean disposable clone at
  `$HOME/.cache/intexuraos/matrix-corpus-integration` from that exact commit; never use a
  Git worktree.
- [ ] In the authoring checkout, stage only the reviewed intended file manifest from steps
  1–12, explicitly excluding the five protected user-owned documents, credentials, local
  configs, artifacts, and every unrelated file. Record create/modify/delete/mode plus
  SHA-256 for each entry.
- [ ] Pipe the exact binary index diff against the fetched `development` into the clone's
  index. Resolve any base conflict in the clone, rerun affected focused tests/review, and
  update the manifest; never copy the authoring checkout wholesale.
- [ ] Prove the integration clone has no untracked or unstaged file and that its staged
  manifest equals the reviewed intended manifest. All remaining step-13 work, CI, commit,
  push, and PR actions use this clone, so protected authoring-checkout files cannot enter
  tool/test globs or the commit.

### Create

- `tools/intex-agent-evals/src/__tests__/matrixCorpusComposition.test.ts`
- any narrowly scoped fake adapters/fixtures colocated under
  `tools/intex-agent-evals/src/__tests__/fixtures/`

### Modify only when coverage exposes a real gap

- focused tests from steps 2–12
- `apps/web/src/pages/__tests__/IntexAgentSessionsPage.test.tsx`
- `apps/web/src/services/__tests__/intexAgentApi.test.ts`
- Matrix-corpus evaluator tests

### Task 13.1: Prove the complete state machine with real composition and fake boundaries

- [ ] Build one integration harness that composes the production orchestrator, control
  clients, mappers, and state transitions. Fake only Matrix, WhatsApp, Firestore, Pub/Sub,
  DeepSeek, and MiniMax boundary ports; do not mock the state machine under test.
- [ ] Add passing proof for 20 scenarios/59 turns, sequential concurrency one, all agent
  calls on DeepSeek, every correlated reply on MiniMax, confirmation zero-LLM behavior,
  strict mocks, exact usage/cost, quiesce/drain, artifact staging, terminal ack/release,
  ready publication, and cleanup.
- [ ] Add failure matrices for behavioral-continue, infrastructure/safety immediate stop,
  lease expiry, stale fence, crash/recovery boundaries, ambiguous sends, overflow/unbound
  replies, MiniMax protocol failure, artifact failed/unknown, and exact exit precedence.
- [ ] Use throwing production-client sentinels and assert zero construction, resolution,
  admission, and calls across normal plus confirmed test turns.

### Task 13.2: Close cross-surface browser and privacy coverage

- [ ] Rerun/extend Test Runs desktop/mobile/deep-link/loading/empty/error/revision tests and
  model-card save/reset/reload/race tests.
- [ ] Seed every public mapper, report, log capture, Sentry capture, CLI output, and DOM
  fixture with forbidden identifiers/credentials/raw tool/model payloads; assert none can
  escape and unknown fields fail closed.
- [ ] Prove endpoint diagnostic uses DeepSeek, Matrix corpus uses DeepSeek, MiniMax remains
  judge-only within automated endpoint/Matrix acceptance, and legacy command semantics
  have not changed.

### Task 13.3: Run independent review gates

- [ ] Assign separate subagents to: code/architecture; control-plane security and race
  safety; privacy/reporting; test completeness; UX/accessibility. Supply the frozen specs,
  plans, goal, diff, and focused evidence.
- [ ] Classify findings Critical, Important, Minor. Resolve all Critical/Important findings
  with focused RED/GREEN tests; rerun only the affected workspace checks.
- [ ] Repeat the relevant independent review until no Critical/Important finding remains.

### Task 13.4: Run the single implementation-wide CI gate

Run focused validates first:

```bash
pnpm --filter @intexuraos/intex-agent-evals validate
pnpm run verify:workspace:tracked -- intex-agent
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:workspace:tracked -- user-service
pnpm run verify:workspace:tracked -- web
pnpm verify:firestore
pnpm verify:migrations
pnpm verify:firestore-artifacts
```

In the clean latest-base integration clone, record the exact staged tree with
`git write-tree`, materialize that same index into the working files, and require no
untracked or unstaged content. Then run exactly one repository-wide gate:

```bash
pnpm run ci:tracked
```

- [ ] Record command, exit status, staged tree hash, base `HEAD`, test count, and safe
  duration summary.
- [ ] If it fails, diagnose systematically and repair with focused tests. Do not commit a
  failing tree. Restage the reviewed repair before another mandatory gate. For an external
  infrastructure failure, wait for independently verified recovery and rerun once; never
  loop unchanged failures to seek a flaky pass.
- [ ] After a pass, prove `git write-tree` still equals the tested tree and the working
  files equal the index. Commit that exact tree once, then prove `HEAD^{tree}` equals the
  tested tree. Do not amend or add code afterward. Machine-confirm the step-13 WhatsApp
  message and advance to step 14.

## Step 14 — PR, Exact-SHA Deployment, and Read-Only Home Dev Preflight

### Task 14.1: Publish and merge the reviewed branch

- [ ] Reconfirm the diff contains only intended implementation/plan/spec files and excludes
  protected user-owned untracked documents, local configs, secrets, and generated reports.
- [ ] From the step-13 integration clone, push its current `codex/` branch and open a PR
  against `development` without a ticket number. Include requirements traceability,
  focused evidence, step-13 CI result, security/privacy review result, rollout plan, and
  explicit live-test deferral.
- [ ] Wait for all required GitHub checks and human/required approval. Resolve review
  feedback through the same focused TDD/review discipline; do not bypass protection. Every
  corrective commit first receives a complete `pnpm run ci:tracked` gate, with no
  scope-based exception.
- [ ] Merge, record the exact 40-character merged SHA, and do not reuse pre-merge evidence
  if the merge result contains code not previously tested by required checks.
- [ ] Create or refresh a dedicated disposable machine-local clone at
  `$HOME/.cache/intexuraos/matrix-corpus-acceptance` (never a Git worktree) so its clean
  detached `HEAD` equals the exact merged SHA. Run the wrapper from that clone; do not
  mutate the user's feature checkout to manufacture requested-revision equality.

### Task 14.2: Wait for and attest Home Dev deployment

- [ ] Observe the existing Home Dev deployment mechanism; do not add a new deploy workflow,
  pull files manually, restart around gates, or copy local code into the server.
- [ ] Wait until Intex Agent, WhatsApp Service, User Service, Matrix adapter, authenticated
  web backend, collections/indexes, and feature flags are healthy and expose the exact
  merged SHA. A descendant/ancestor/different SHA does not pass.
- [ ] Verify implementation-critical remote paths are clean, including untracked files,
  without printing file content or protected configuration.

### Task 14.3: Run zero-message, zero-LLM preflight

```bash
scripts/run-intex-agent-evals-home-dev.sh preflight
```

- [ ] Confirm the protected machine-local alias maps to exactly one enabled canonical user,
  one Matrix identity/room, one private WhatsApp account/sender, and a ready bridge. Output
  must contain only safe check names/statuses.
- [ ] Confirm the effective Intex model is DeepSeek through either explicit or
  `default_absent`, survives a settings reload, and is available to evaluation. Confirm
  MiniMax evaluator configuration without calling it.
- [ ] Confirm no capability, session, artifact directory, Matrix/WhatsApp event, or LLM
  usage record was created by preflight; also confirm zero lease/context/projection/outbox/
  receipt/probe creation, zero Firestore/Pub/Sub writes, and no persistent filesystem
  change. The check also performs no temporary filesystem create/delete probe.
- [ ] If blocked, stop with the exact closed failure and state the single external/user
  intervention required. Do not improvise around identity, revision, account, or secrets.
- [ ] After every check passes, machine-confirm the step-14 WhatsApp message and advance to
  step 15.

## Step 15 — One Live Corpus and Authenticated Browser Acceptance

### User intervention gate

- [ ] Stop before the paid live command and request the user's explicit current instruction
  “odpal testy” (or the exact command). Earlier planning approval does not silently trigger
  this one-run external action.

### Task 15.1: Execute exactly one canonical live run

```bash
scripts/run-intex-agent-evals-home-dev.sh matrix-corpus
```

- [ ] Do not run endpoint/full/smoke before or after it unless separately requested.
- [ ] Observe only safe framed progress. Reconcile every scenario/turn/session, visible
  scenario-number header, Matrix event, WhatsApp ingress/delivery, assistant reply,
  selected/mock tool event, confirmation, deterministic result, MiniMax result, usage,
  cost, quiesce/release, terminal event, artifact status, and cleanup.
- [ ] Require exactly 20 scenarios and 59 planned/completed turns, every agent call on
  DeepSeek, every correlated reply judged by MiniMax, zero production tool resolution/
  admission/calls, final exit `0`, and artifact delivery `ready`.
- [ ] On behavioral `1` or infrastructure/safety/artifact `2`, do not retry. Preserve safe
  artifacts/state, identify the exact failed boundary, and request intervention only when
  repository-safe recovery cannot progress.

### Task 15.2: Audit the same run in authenticated Chrome

- [ ] Use the existing logged-in Chrome/Home Dev session and open the canonical
  `/#/intex-agent/sessions?view=test-runs` route with `run` and `scenario` set exactly to
  the safe identifiers returned by that same live run; do not copy either identifier into
  a tracked file or final report narrative.

- [ ] Desktop: verify run header, 20-scenario rail, all 59 turns across scenarios,
  selected/mock distinction, confirmations, deterministic and per-reply MiniMax cards,
  DeepSeek/MiniMax identities, duration, usage/cost, and artifact-ready outcome.
- [ ] Mobile viewport: verify responsive order, rail navigation, focus/scroll restoration,
  readable timelines/cards, and no clipped/overflowed primary actions.
- [ ] Settings (read-only): verify exactly DeepSeek V4 Flash, MiniMax M3, and Gemini 3 Flash
  Preview; the current explicit value or absent default displays effective DeepSeek and
  remains unchanged after reload. Save/reset behavior is already proven automatically in
  step 13 and is not exercised against the operator's live preference.
- [ ] Inspect browser-visible state and safe final JSON/Markdown for absence of account,
  phone, room, token, capability, private session/binding/event IDs, raw tool payloads,
  provider payloads, and MiniMax rationale.

### Task 15.3: Final artifact review and completion

- [ ] Cross-check CLI exit, safe JSON, Markdown, Test Runs DTO/UI, Matrix/WhatsApp evidence,
  usage/cost totals, exact deployed SHA, cleanup, and artifact-delivery status for the same
  run. Any disagreement fails acceptance.
- [ ] Obtain final independent artifact/privacy/completeness review with zero unresolved
  Critical/Important findings.
- [ ] Machine-confirm the exact step-15 WhatsApp message, mark the active goal complete,
  and report the final evidence links plus any frozen deferred-perfection items.
