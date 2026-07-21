# Intex Agent Matrix Corpus — 15-Step Execution Goal

**Date:** 2026-07-19
**Status:** Active goal definition
**Progress:** Steps 1–12 complete; step 13 is next.
**Execution method:** Primary-agent implementation with TDD and independent review-only subagents

## Reasoning and Orchestration Boundary

The work is split into two explicit phases:

1. **Planning phase — Ultra only.** Step 1 may inspect the repository, update the three
   approved specifications, write the executable implementation plans, run documentation
   and repository verification, and independently review/hash those planning artifacts.
   It must not
   modify production code, tests, infrastructure, or deployed state.
2. **Execution phase — Extra High primary-agent delivery.** Steps 2–15 are executed with
   the main agent at Extra High reasoning. Starting with step 6, the main agent owns all
   RED/GREEN implementation, integration, focused verification, deployment, and live
   acceptance work directly. Subagents may be used only after a bounded artifact is ready,
   for independent specification, code, security/privacy, test-completeness, or UX review.
   They are not the primary implementation path and do not edit the shared implementation.
   The main agent retains dependency ordering, shared-state ownership, fixes every accepted
   review finding, and owns the per-step WhatsApp completion protocol.

Changing from Ultra planning to Extra High execution is a visible phase transition after
step 1 is fully verified. Step 1 ends the Ultra run; before step 2, the user or platform
must continue the main task with Extra High reasoning. No implementation begins inside
the Ultra planning phase.

## Verification Budget

`pnpm run ci:tracked` has one planned repository-wide gate: step 13, after the complete
implementation and focused reviews are integrated. Step 1 uses documentation formatting,
link/consistency validation, and `git diff --check`; a docs-only change does not justify a
full codebase CI run. Steps 2–12 use only the focused RED/GREEN tests and workspace-local
validation named in their executable plans. Step 14 relies on the already-passed step-13
evidence plus required GitHub checks. No later commit is planned. If any corrective commit
becomes necessary, the repository rule requires another complete CI pass before that
commit regardless of perceived scope; unnecessary commits and blind repeated runs are
forbidden.

The repository requires a successful full CI gate before every commit. To satisfy that
rule without multiplying full runs, steps 1–12 create no Git commits. Each is frozen as a
reviewed checkpoint with exact content hashes and focused evidence in the active goal;
the protected user-owned files remain excluded. At the start of step 13, the exact intended
index diff is materialized onto the latest `development` in a dedicated disposable clone
(never a Git worktree). Integrated review and the single full CI run in that clone, and
only then is the identical tested tree committed there. Any later commit receives its own
full CI gate.

## Goal

Deliver the complete Home Dev Intex Agent testing workflow: DeepSeek V4 Flash is the
default Intex Agent model and the mandatory agent model for every automated evaluation
scenario; MiniMax M3 is the fixed semantic evaluator; the canonical 20-scenario corpus
runs through real Matrix and WhatsApp transport with all product tools strictly mocked;
the authenticated Test Runs UI and privacy-safe reports expose complete automated
evidence; and one deployed live run passes desktop, mobile, Matrix, and WhatsApp
acceptance.

## Authoritative Inputs

- [`2026-07-19-intex-agent-matrix-corpus-design.md`](../specs/2026-07-19-intex-agent-matrix-corpus-design.md)
- [`2026-07-19-intex-agent-test-runs-ux-design.md`](../specs/2026-07-19-intex-agent-test-runs-ux-design.md)
- [`2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md`](../specs/2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md)
- Design commit: `8562fcd8a0d9cdca689c5038c1fcce14c0371a4c`

## Executable Implementation Plans

- Steps 2–4:
  [`2026-07-19-intex-agent-deepseek-model-implementation.md`](./2026-07-19-intex-agent-deepseek-model-implementation.md)
- Steps 5–8:
  [`2026-07-19-intex-agent-matrix-control-plane-implementation.md`](./2026-07-19-intex-agent-matrix-control-plane-implementation.md)
- Steps 9–10:
  [`2026-07-19-intex-agent-test-runs-implementation.md`](./2026-07-19-intex-agent-test-runs-implementation.md)
- Steps 11–12:
  [`2026-07-19-intex-agent-matrix-corpus-runner-implementation.md`](./2026-07-19-intex-agent-matrix-corpus-runner-implementation.md)
- Steps 13–15:
  [`2026-07-19-intex-agent-verification-release-implementation.md`](./2026-07-19-intex-agent-verification-release-implementation.md)

The user's latest instruction overrides the earlier absent-preference default:

- `or:deepseek/deepseek-v4-flash` is the default Intex Agent model;
- every endpoint and Matrix-corpus evaluation scenario runs the agent on DeepSeek V4
  Flash;
- `or:minimax/minimax-m3` is used only as the semantic evaluator during acceptance;
- `or:google/gemini-3-flash-preview` remains a supported user-selectable Intex Agent
  model but is not used by automated endpoint or Matrix acceptance runs;
- there is no Sonnet evaluator and no evaluator fallback.

## Step Completion and WhatsApp Protocol

Every step below is a hard gate. A step is complete only when all of the following are
true:

1. its declared deliverable exists;
2. its focused tests and required repository checks pass with fresh evidence;
3. its implementation artifacts receive the declared independent review;
4. every actionable Critical or Important finding is resolved;
5. one progress message is delivered to the operator through the verified
   Matrix-to-WhatsApp account route.

The completion message format is exact:

```text
Krok N z 15 wykonany — <krótki opis wyniku>. Kolejny: krok N+1 — <krótki opis kolejnego kroku>.
```

For step 15:

```text
Krok 15 z 15 wykonany — pełny Intex Agent Matrix Corpus przeszedł automatyczną i live acceptance. Goal zakończony.
```

Rules:

- exactly one completion message is sent per completed step;
- a message is sent only after verification, never at step start;
- the delivery must be machine-confirmed through the bound Matrix/WhatsApp route;
- a failed or ambiguous send is not retried blindly; it is reconciled by idempotency key;
- if delivery cannot be confirmed, the step stays incomplete and the user receives a
  blocker report in the active Codex task;
- account identifiers, addresses, phone numbers, room IDs, tokens, and credentials stay
  in protected machine-local Home Dev configuration and never enter this repository or
  completion messages.

## Execution Steps

### 1. Freeze the executable plan, defaults, and notification channel

**Deliverable:** Reviewed implementation plans covering all remaining steps, with the
three approved specifications updated so DeepSeek V4 Flash is the default Intex Agent
model and mandatory agent model for all evaluation scenarios.

**Complete when:**

- the implementation work is decomposed into exact files, interfaces, RED/GREEN tests,
  commands, dependencies, checkpoint boundaries, and the final tested-tree commit;
- every implementation plan records the Ultra-only planning boundary and the Extra High
  primary-agent execution/review-only delegation policy for steps 2–15;
- all three specifications consistently declare the new DeepSeek default;
- the machine-local operator account alias and Matrix-to-WhatsApp progress-notification
  route pass read-only identity and delivery-readiness preflight;
- no private account data is added to tracked files;
- documentation formatting, link/consistency checks, and `git diff --check` pass;
- the plan/spec content hashes are recorded in the active goal and independently reviewed;
  no Git commit is created before the step-13 Commit Gate.

**WhatsApp message:**

```text
Krok 1 z 15 wykonany — plan wykonawczy, domyślny DeepSeek V4 Flash i kanał powiadomień są zweryfikowane. Kolejny: krok 2 — wspólny katalog modeli i obsługa DeepSeek.
```

### 2. Implement the shared Intex Agent model catalog and DeepSeek default

**Deliverable:** One typed model contract shared by backend and web, with DeepSeek V4
Flash as `DEFAULT_INTEX_AGENT_MODEL` and exact support for DeepSeek V4 Flash, MiniMax M3,
and Gemini 3 Flash Preview.

**Complete when:**

- the shared model union, guards, display names, ordered selector options, raw adapter
  IDs, and tool-calling eligibility are implemented;
- DeepSeek is present in OpenRouter allowlists, live-catalog conformance, tracked fallback
  pricing/context metadata, factories, and usage/cost accounting;
- every Intex Agent classifier, generation, tool-calling, and repair factory accepts
  DeepSeek;
- absent preference resolves to DeepSeek, never Gemini;
- focused contract, allowlist, pricing, and factory tests pass and receive review.

**WhatsApp message:**

```text
Krok 2 z 15 wykonany — wspólny katalog modeli działa, a DeepSeek V4 Flash jest domyślnym modelem Intex Agenta. Kolejny: krok 3 — zapis ustawień użytkownika i resolver runtime.
```

### 3. Implement per-user model persistence and runtime resolution

**Deliverable:** Independent `intexAgentModel` preference with revision-safe User Service
storage and an internal Intex Agent runtime-settings contract.

**Complete when:**

- authenticated self-only read, set, reset, CAS conflict, retry, and revision-exhaustion
  behavior is implemented;
- general `defaultModel` and `fallbackModel` remain byte-for-byte independent;
- the Intex Agent internal resolver uses the platform OpenRouter key and resolves
  DeepSeek when the preference is absent;
- the configured Home Dev evaluator user receives the available selector/runtime arm;
- unconfigured and production users remain fail-closed according to the reviewed rollout
  contract;
- route, repository, concurrency, privacy, and runtime-resolver tests pass and receive
  review.

**WhatsApp message:**

```text
Krok 3 z 15 wykonany — ustawienie modelu per użytkownik i resolver runtime działają z domyślnym DeepSeek. Kolejny: krok 4 — karta ustawień modelu w UI.
```

### 4. Implement the Intex Agent model settings UX

**Deliverable:** An **Intex Agent model** card in the existing LLM Settings experience,
using the same authenticated client-contract and save/reload/error interaction as the
general default-model control.

**Complete when:**

- exactly DeepSeek V4 Flash, MiniMax M3, and Gemini 3 Flash Preview are rendered;
- DeepSeek is selected when no explicit preference exists;
- immediate save, reset, optimistic rollback, rapid-choice serialization, stale revision,
  reload, unmount, and user-switch behavior are tested;
- the control remains independent from BYOK and general default/fallback settings;
- the card is absent for unavailable users/runtimes and exposes no test-mode controls;
- component, API-client, accessibility, and responsive tests pass and receive UX review.

**WhatsApp message:**

```text
Krok 4 z 15 wykonany — ustawienia Intex Agenta pozwalają wybrać trzy modele i domyślnie pokazują DeepSeek. Kolejny: krok 5 — bezpieczny control plane Matrix/WhatsApp.
```

### 5. Implement the Matrix/WhatsApp test control plane

**Deliverable:** Home Dev-only capability, attestation, lease, fencing, outbox, activation,
quiescence, release, and abandoned-run recovery contracts.

**Complete when:**

- the visible versioned header is parsed and stripped before natural-message persistence
  and LLM input;
- one-use capabilities bind the exact run, user, transport, scenario, turn, prompt,
  session, confirmation, and lease fence;
- capability consumption and ingest outbox creation are atomic and idempotent;
- signed attestations are verified by Intex Agent without cross-service Firestore reads;
- provisioning is non-authorizing and every crash boundary has deterministic recovery;
- incomplete downstream gates remain explicitly not-ready until later steps integrate;
  no partial step can make the live corpus operator-runnable;
- quiesce/drain, terminal-event first-wins control, and stale-worker rejection are
  implemented; applying Test Run terminal/artifact recovery remains closed `not_ready`
  until the private lifecycle foundation in step 6 and full artifact lifecycle in step 9;
- control-plane route, repository, signature, race, replay, expiry, privacy, and recovery
  tests pass and receive security review.

**WhatsApp message:**

```text
Krok 5 z 15 wykonany — bezpieczny control plane Matrix/WhatsApp blokuje replay, stale workery i nieautoryzowany test mode. Kolejny: krok 6 — izolowane sesje i prywatny kontekst testowy.
```

### 6. Implement isolated test sessions and encrypted run context

**Deliverable:** A separate Matrix-corpus session/confirmation lane with immutable
execution profiles and encrypted run/scenario prompt context.

**Complete when:**

- test sessions never read, close, supersede, or mutate the ordinary active-session lane;
- continuation addresses the exact run, scenario, session, profile, and fence;
- confirmations cannot cross between ordinary and test lanes;
- prompt preferences, user time zone, model, catalog, and scenario overlay are snapshotted
  once and encrypted with authenticated associated data;
- context finalization deletes ciphertext and writes the durable tombstone while retained
  safe evidence remains intact;
- minimal run/scenario revisions, event sequencing, and committed watermarks are
  transactionally monotonic and are extended—not recreated—by step 9;
- repository, encryption, TTL, isolation, concurrency, finalization, and recovery tests
  pass and receive review.

**WhatsApp message:**

```text
Krok 6 z 15 wykonany — sesje testowe są odseparowane, a kontekst runu jest szyfrowany i bezpiecznie finalizowany. Kolejny: krok 7 — ścisłe mocki wszystkich narzędzi.
```

### 7. Implement strict mocks for all 11 tools and confirmations

**Deliverable:** A closed strict-mock executor selected exclusively from the immutable
test-session profile for normal execution and confirmation continuation.

**Complete when:**

- all 11 canonical tools have bounded typed mock results and explicit per-turn schedules;
- the expected schedule is independently catalog-derived, signed, persisted, and compared with
  the mock profile before construction of any executor;
- missing/malformed expected mock configuration stops the run as a safety failure;
- known unexpected or forbidden tool selection records a behavioral failure and executes
  neither mock nor production code;
- accepted confirmations use the strict mock; rejected confirmations execute no tool;
- an exact confirmation retry resumes across the resolution/event boundary, while any changed
  decision, message, timestamp, identity, or expired authority fails closed;
- confirmation handling makes zero LLM calls and emits zero LLM usage records;
- throwing production-client sentinels prove zero construction, resolution, admission,
  and calls from the test branch;
- strict-mock, repeated-call, ordinal, failure, confirmation, and ordinary-session
  regression tests pass and receive security review.

**WhatsApp message:**

```text
Krok 7 z 15 wykonany — wszystkie 11 narzędzi działa w ścisłych mockach, także po potwierdzeniu, bez fallbacku produkcyjnego. Kolejny: krok 8 — korelacja, evidence i usage.
```

### 8. Implement correlation, completion markers, and safe evidence

**Deliverable:** End-to-end run/scenario/turn/session correlation with deterministic
completion/failure markers, bounded reply sets, tool evidence, and per-call usage/cost.

**Complete when:**

- Matrix idempotency/event, WhatsApp ingress/delivery, Intex message/session, capability,
  tool, and assistant-reply slots reconcile to one exact turn; the closed MiniMax-result
  slot remains unpopulated until the evaluator in step 11;
- `turn_processing_completed` and catchable `turn_processing_failed` close reply windows
  without quiet-period guessing;
- up to five correlated replies per turn are indexed and evaluated; a sixth or unbound
  reply fails safely;
- selected-tool and mock-execution evidence are distinct and expose only allowlisted
  facts;
- classifier/generation/repair usage and provider-reported cost reconcile per run;
- private evidence projections, logs, and Sentry reject raw identifiers, arguments,
  results, prompts, capabilities, and reasoning; public DTO and report surfaces remain
  fail-closed until steps 9 and 12 add and reverify them;
- correlation, ordering, duplicate, race, timeout, usage, and leakage tests pass and
  receive review.

**WhatsApp message:**

```text
Krok 8 z 15 wykonany — transport, sesje, narzędzia, odpowiedzi, usage i koszty mają pełną bezpieczną korelację. Kolejny: krok 9 — backend Test Runs i lifecycle raportów.
```

### 9. Implement the Test Runs backend and artifact lifecycle

**Deliverable:** Owner-only bounded Test Runs read models, internal CAS writers, public
DTOs/APIs, retention selection, terminal candidate handling, and artifact-delivery state.

**Complete when:**

- run and scenario Firestore collections, manifests, indexes, size bounds, revisions, and
  exact ownership rules are implemented;
- lifecycle, verdict, and artifact delivery are independent monotonic dimensions;
- signed terminal control is the only path from finalizing to completed/stopped;
- report staging, ready/failed/unknown transitions, abandoned recovery, and deadline
  sweeper cannot leave infinite polling;
- public list/run/scenario routes return only closed field-by-field owner DTOs and static
  foreign/missing `404` responses;
- ordinary session routes exclude test sessions and cannot bypass the safe mapper;
- state-machine, CAS, retention, index, DTO, auth, privacy, and sweeper tests pass and
  receive review.

**WhatsApp message:**

```text
Krok 9 z 15 wykonany — backend Test Runs przechowuje bezpieczny lifecycle, evidence i status raportu. Kolejny: krok 10 — frontend Test Runs.
```

### 10. Implement the Test Runs web experience

**Deliverable:** A separate authenticated **Test Runs** tab on Assistant Sessions with
live run progress, a 20-scenario rail, safe timeline cards, evaluation results, and
artifact status.

**Complete when:**

- **Regular** remains the default and contains no test sessions;
- unavailable users/runtimes construct no Test Runs tab, client, request, or deep-link
  state;
- current acceptance, latest successful run, and latest failed acceptance are selected
  deterministically without duplicates;
- active/finalizing/terminal-staged states poll correctly and stop only when both run and
  artifact delivery are terminal;
- every scenario shows natural messages, tool selected, mock completed/failed,
  confirmation, deterministic evaluation, MiniMax evaluation, model, usage, and cost;
- stale responses cannot regress state and no private field is rendered;
- desktop/mobile component, polling, deep-link, accessibility, and overflow tests pass
  and receive UX/security review.

**WhatsApp message:**

```text
Krok 10 z 15 wykonany — Test Runs pokazuje na desktopie i mobile pełny, bezpieczny przebieg 20 scenariuszy. Kolejny: krok 11 — kanoniczny runner matrix-corpus.
```

### 11. Implement the canonical `matrix-corpus` evaluator

**Deliverable:** The canonical dependency-injected Matrix-corpus evaluator can execute the
tracked corpus exactly once through real Matrix and WhatsApp, while its public CLI/wrapper
selector remains unavailable until step 12 installs the zero-side-effect preflight.

**Complete when:**

- the catalog validates exactly 20 scenarios, currently 59 turns, and up to 20 turns per
  scenario without the former five-turn compatibility limit;
- every first turn creates a labelled session and every later turn continues its exact
  session;
- catalog confirmation turns are converted automatically to canonical accept/reject
  controls;
- every agent call in endpoint and Matrix evaluation uses DeepSeek V4 Flash;
- every correlated assistant reply is judged by MiniMax M3 with no Sonnet/fallback;
- behavioral failures continue through scenario 20 while infrastructure/safety failures
  stop immediately;
- `endpoint`, targeted `scenario`, legacy `full`, and `matrix-smoke` retain their declared
  meanings;
- catalog, sequencing, confirmation, correlation, model, and exit-precedence tests pass
  and receive review; the public CLI selector remains unavailable until step 12 installs
  the zero-side-effect preflight.

**WhatsApp message:**

```text
Krok 11 z 15 wykonany — matrix-corpus obsługuje 20 scenariuszy, 59 tur, automatyczne potwierdzenia i DeepSeek. Kolejny: krok 12 — raporty, retention i Home Dev wiring.
```

### 12. Implement reports, retention, wrapper, and Home Dev wiring

**Deliverable:** Privacy-safe staged/final JSON and Markdown reports, exact-ID retention,
canonical wrapper behavior, the now-enabled `matrix-corpus` selector, and fail-closed Home
Dev configuration.

**Complete when:**

- safe report candidates are validated and staged before terminalization, then finalized
  only from authoritative terminal status;
- artifact delivery failure/unknown produces exit `2` without rewriting agent verdict;
- wrapper outputs only framed safe statuses and prints a report path only for `ready`;
- exact-ID cleanup preserves ordinary account data and never selects by user alone;
- collections, indexes, env vars, secrets, signing/encryption keys, service URLs, feature
  flags, and production-off assertions are fully wired;
- machine-local operator configuration contains all account/Matrix identifiers without
  repository leakage;
- report, privacy, retention, wrapper, config, migration, and deployment-wiring tests pass
  and receive review.

**WhatsApp message:**

```text
Krok 12 z 15 wykonany — raporty, retention, wrapper i konfiguracja Home Dev są gotowe i fail-closed. Kolejny: krok 13 — pełna automatyczna weryfikacja i review.
```

**Completed checkpoint — 2026-07-20:**

- workspace checkpoint SHA-256 (all tracked diffs and untracked artifacts, excluding this
  self-referential goal file):
  `97edd7b34d63b04a35e92e48faf84b7b522dcb505ff9d5baeaf6195cf1a65882`;
- step-12 focused suite: 546/546 passed, including 89/89 wrapper tests;
- evaluator validation: 901/901 passed, followed by the corrected canonical-report test
  24/24, typecheck, and lint;
- Matrix-corpus service suites: Intex Agent 521/521, WhatsApp 469/469, internal clients
  15/15;
- Intex Agent, WhatsApp Service, evaluator, and internal-client typechecks passed; all
  four focused lints passed;
- Firestore ownership/artifacts, boundary, workspace-dependency, and `git diff --check`
  verification passed;
- independent fail-closed, report/privacy, and wrapper/Home Dev reviews returned `READY`
  with no unresolved Critical or Important finding;
- no repository-wide `pnpm run ci:tracked`, Git commit, deployment, preflight, or live
  corpus execution was performed; those remain gated by steps 13–15 and explicit live-run
  authorization.

### 13. Complete automated verification and cross-cutting review

**Deliverable:** All focused suites, real-composition integration tests, browser tests,
privacy/security review, and the complete tracked repository CI pass on the implementation
revision.

**Complete when:**

- every task's RED test was observed failing before its implementation and passes after
  the change;
- integration tests use fake Matrix, WhatsApp, Firestore, Pub/Sub, DeepSeek, and MiniMax,
  plus throwing production clients;
- code, architecture, security/privacy, test-completeness, and UX reviewers return no
  unresolved Critical or Important findings;
- all focused tests, typechecks, lint, static validation, build, format, and
  `pnpm run ci:tracked` pass with fresh evidence;
- the implementation SHA and safe verification summary are recorded.

**WhatsApp message:**

```text
Krok 13 z 15 wykonany — implementacja przeszła pełne testy, review bezpieczeństwa i CI. Kolejny: krok 14 — PR, wdrożenie i preflight Home Dev.
```

### 14. Merge, deploy, and pass Home Dev preflight

**Deliverable:** Reviewed implementation merged to `development`, the exact merged SHA
deployed on Home Dev, and a zero-message preflight passed for the bound operator account.

**Complete when:**

- the branch is committed, pushed, reviewed through PR, and all required GitHub checks
  pass;
- no ticket number is required; branch, commit, and PR naming must not block on one;
- the PR is approved and merged without bypassing protected checks;
- Home Dev reports the exact reviewed merged SHA and implementation-critical paths are
  clean;
- Intex Agent, WhatsApp, Matrix adapter, User Service, web backend, Firestore indexes,
  secrets, clocks, and feature flags pass health/readiness checks;
- the existing operator account tuple is uniquely mapped without printing identifiers;
- the effective Intex Agent model is DeepSeek V4 Flash through an explicit value or the
  absent-value default and remains unchanged after a read-only reload;
- preflight sends zero Matrix/WhatsApp messages and calls zero LLMs.
- preflight invokes no mutating service port and performs no Firestore, Pub/Sub, or
  filesystem write, including temporary create/delete probes.

**WhatsApp message:**

```text
Krok 14 z 15 wykonany — zatwierdzony SHA działa na Home Dev, konto i DeepSeek przeszły preflight. Kolejny: krok 15 — pełny live run i browser acceptance.
```

### 15. Execute and verify full live acceptance

**Deliverable:** One fresh canonical Matrix-corpus run on the existing operator account,
with complete automated transport/tool/evaluation evidence and authenticated browser
acceptance.

**Complete when:**

- explicit user authorization to run the live paid corpus is present;
- all 20 scenarios and 59 turns execute sequentially with DeepSeek V4 Flash;
- every message and assistant reply is machine-confirmed in Matrix and WhatsApp;
- every tool result is strict-mock evidence and production resolution/admission counts
  are zero;
- MiniMax M3 evaluates every correlated assistant reply and usage/cost totals reconcile;
- artifact delivery is `ready`, reports pass schema/privacy review, and command exit is
  `0`;
- authenticated Test Runs desktop/mobile audits show the same run with no unsafe console,
  network, privacy, accessibility, or overflow issue;
- ordinary account sessions and data remain intact;
- the final WhatsApp completion message is delivered and the goal is marked complete.

**WhatsApp message:**

```text
Krok 15 z 15 wykonany — pełny Intex Agent Matrix Corpus przeszedł automatyczną i live acceptance. Goal zakończony.
```

## Goal Success Criterion

The goal is complete only when all 15 steps are complete in order, all 15 progress
messages have machine-confirmed WhatsApp delivery, the final deployed Matrix-corpus run
passes with DeepSeek V4 Flash and MiniMax M3, strict mocks prove zero production tool
admission, the authenticated browser acceptance passes, privacy review passes, and no
required work from the current delivery remains.

## Deferred Follow-Up Goals

These remain separate goals and do not block this 15-step execution goal:

1. a dedicated integration user, WhatsApp number, Matrix source account, and isolated
   room;
2. portable secure setup across multiple machines;
3. hidden authenticated bridge metadata replacing the visible one-use header;
4. automatic conversion of a debugged session into “what happened / what should happen /
   reviewed regression scenario” through the debug-session skill;
5. corpus expansion beyond the current 20-scenario, 59-turn baseline and targeted live
   scenario execution.

## Estimate

This is a cross-service feature, not a single endpoint change. With four-agent parallelism
and no external Home Dev, Matrix, WhatsApp, provider, authentication, review, or deployment
blockers, the current 15-step goal is estimated at **2–4 focused working days**. A
realistic contingency range is **3–6 working days** when live transport, deployment, or
account-state debugging is required. The estimate is not a completion shortcut: no step
is collapsed or marked complete without its tests, review, and WhatsApp notification.
