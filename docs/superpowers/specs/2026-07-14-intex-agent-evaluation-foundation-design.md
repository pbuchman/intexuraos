# Intex Agent Evaluation Foundation Design

**Date:** 2026-07-14
**Status:** Proposed for user review
**Program order:** 1 of 4

## Purpose

Build a repeatable, privacy-safe evaluation system for Intex Agent that runs real LLM calls against mocked downstream tools, supports conversations of up to 20 product turns, compares three selectable models, and produces deterministic and semantic quality verdicts in local development and trusted CI.

This specification is the foundation for:

1. [Per-user model selection](./2026-07-14-intex-agent-user-model-selection-design.md).
2. [Session-debug to regression skills](./2026-07-14-intex-session-regression-skills-design.md).
3. [Dedicated-account WhatsApp live canary](./2026-07-14-intex-agent-whatsapp-live-canary-design.md).

## Program Requirement Traceability

| Approved requirement | Owning specification | Verification evidence |
| --- | --- | --- |
| Conversations longer than five, including exactly 20 turns | Evaluation foundation and live canary | Route boundary tests, emulator-backed 20-turn scenarios, weekly real WhatsApp 20-turn run |
| Real LLM with mocked downstream tools | Evaluation foundation | Protected three-model endpoint matrix with deterministic and UX verdicts |
| DeepSeek V4 Flash, MiniMax M3, and current Gemini | Per-user model selection | Shared allowlist, conformance suite, settings contract, per-stage resolved-model diagnostics |
| Same settings experience as the user's base model | Per-user model selection | Authenticated settings API, optimistic UI save/rollback, browser persistence test |
| Session debug automatically becomes a regression | Session-debug regression skills | Ordered five-section output, synthetic private draft, authorized candidate registration, discovery/promotion tests |
| Dedicated Auth0 and WhatsApp integration identity | WhatsApp live canary | Idempotent account ensure, permanent phone/private mapping, Matrix/Meta round trip |
| No user-specific fixture data in Git | All four specifications | Privacy lint, secret-only fixture values, repository denylist scan |
| Automatic real-browser validation | WhatsApp live canary | Protected Universal Login/settings/session Playwright run; optional human-authenticated interactive inspection |
| Explicit blockers instead of substituted simulations | Session skills and live canary | Named blocker taxonomy; synthetic webhook cannot satisfy live verdict |

## Current State

The repository has a local/dev-only endpoint, `POST /internal/intex-agent/test/conversation`, that:

- requires internal authentication;
- rejects production requests with `404`;
- requires `userId = test-intex-agent-<runId>`;
- runs the real intent classifier, response repair, tool-calling runner, session lifecycle, and prompt-preference lookup;
- persists sessions and events in the configured Firestore project;
- captures assistant replies instead of publishing them to WhatsApp;
- replaces every downstream tool with a bounded mock.

The endpoint currently accepts at most five turns. That value is an initial transport guard, not a domain constraint. It appears in both `turns.maxItems = 5` and `confirmation_button.previousTurnIndex.maximum = 4`. The route also has a 64 KiB body limit. These limits prevent valid 20-turn scenarios.

The repository has ten narrative scenarios in `docs/superpowers/specs/2026-06-24-intex-agent-dev-api-test-scenarios.md`, but no machine-readable corpus, runner CLI, deterministic oracle, UX judge, baseline store, cost guard, or live-evaluation workflow.

## Goals

1. Accept and execute conversations containing 1-20 product turns.
2. Preserve the separate five-iteration limit of a single tool-calling agent loop.
3. Run the same scenario against these exact models:
   - `or:deepseek/deepseek-v4-flash`
   - `or:minimax/minimax-m3`
   - `or:google/gemini-3-flash-preview`
4. Represent every scenario as validated, versioned data.
5. Make deterministic violations authoritative hard failures.
6. Evaluate variable human-facing language with an independent, versioned semantic judge.
7. Record model, duration, token, cost, retry, repair, and iteration diagnostics without exposing prompts or private content.
8. Run against Firestore and Pub/Sub emulators in CI so evaluation data never reaches shared dev collections.
9. Enforce explicit per-scenario and per-workflow cost and duration ceilings.
10. Convert the existing narrative suite into generated documentation backed by executable scenarios.

## Non-Goals

- This foundation does not exercise the Meta/WhatsApp transport, Auth0 login, or real downstream resources.
- It does not automatically modify prompts or production code after a failure.
- It does not use raw production conversations as test inputs.
- It does not make live LLM calls from untrusted pull-request code.
- It does not change the five-iteration agent loop used for one product message.
- It does not guarantee deterministic wording from a generative model.

## Considered Approaches

### A. Keep the endpoint and add a data-driven harness — selected

The harness starts the checked-out Intex service locally, uses emulators, calls the existing internal endpoint, and evaluates its structured response. This preserves production-domain behavior while keeping tools and external resources isolated.

Advantages:

- reuses the established security and side-effect boundary;
- tests the same session and runner path as production;
- is callable locally, from CI, and by skills;
- requires no new persistent job service.

Trade-off: a 20-turn conversation is one long synchronous request, so explicit deadlines and provider timeouts are mandatory.

### B. Add an asynchronous evaluation-job API

This would create a run resource and expose polling endpoints. It is more resilient to very long jobs but introduces job persistence, cancellation, recovery, and cleanup before the first useful corpus exists.

Decision: defer. Revisit only if measured P95 scenario duration exceeds the synchronous 15-minute ceiling.

### C. Bypass HTTP and call domain use cases directly

This is fast and easy to unit test, but it skips route validation, service wiring, authentication, sanitization, and the actual local runtime boundary.

Decision: use direct calls only in unit tests for the evaluator and runner internals, never as the live behavioral oracle.

## Workspace Layout

Create a private workspace package:

```text
tools/intex-agent-evals/
  package.json
  tsconfig.json
  src/
    cli.ts
    config.ts
    contracts.ts
    discoverScenarios.ts
    runScenario.ts
    runMatrix.ts
    endpointClient.ts
    deterministicOracle.ts
    uxJudge.ts
    aggregateVerdict.ts
    privacyLint.ts
    fingerprints.ts
    reportWriter.ts
    usageCollector.ts
  scenarios/
    gold/
    extended/
    regressions/
  generated/
    scenario-catalog.md
  __tests__/

apps/intex-eval-gateway/
  src/
    routes/runCredentials.ts
    routes/openRouterProxy.ts
    domain/runBudget.ts
    infra/openRouterClient.ts
  __tests__/
```

The package is the single implementation of schema validation, scenario discovery, privacy linting, endpoint execution, verdict aggregation, reporting, and cost enforcement. Skills and workflows invoke its CLI rather than reimplementing these rules.

## Test Conversation Contract v2026-07-14

Replace the internal contract version `2026-07-01` with `2026-07-14`. There is no external consumer and no automated runner for the old version, so dual-version support would add unneeded branches.

### Request changes

```ts
export const TEST_CONVERSATION_CONTRACT_VERSION = '2026-07-14';
export const MAX_TEST_CONVERSATION_TURNS = 20;
export const MAX_TEST_CONVERSATION_BODY_BYTES = 1024 * 1024;

export interface TestConversationHttpRequest {
  contractVersion: '2026-07-14';
  mode: 'live_llm_mock_tools';
  userId: `test-intex-agent-${string}`;
  runId: string;
  scenarioId: string;
  currentDateTime: string;
  timeZone: string;
  model?: IntexAgentModel;
  turns: TestConversationTurnInput[];
  toolMocks?: TestToolMocks;
}
```

Requirements:

- `turns.minItems = 1` and `turns.maxItems = 20`.
- `confirmation_button.previousTurnIndex` accepts `0-18` and must be lower than the confirmation turn's own index. With a 20-turn maximum, index `18` is the latest prior turn that a final turn can reference.
- `bodyLimit = 1 MiB`.
- `scenarioId` becomes required so every run is attributable to a corpus entry.
- `timeZone` becomes required, must be a supported IANA timezone, and is added to the agent system context; accepting and ignoring it is not allowed. This semantic PromptBuilder change requires a prompt version bump and snapshot update.
- `model` is optional and accepted only on this local/dev test endpoint. It is validated by `isIntexAgentModel()` and never mutates global service configuration.
- Omitting `model` exercises normal per-user model resolution and defaulting.
- Tool mock arrays and strings receive explicit nested size bounds so the larger body limit cannot be used for unbounded mock payloads.

### Response changes

```ts
export interface TestConversationExecutionCall {
  callId: string;
  parentCallId?: string;
  productTurnIndex: number;
  stage: 'classifier' | 'classifier_repair' | 'runner' | 'runner_repair';
  providerCallIndex: number;
  retryAttempt: number;
  toolLoopIteration?: number;
  model: IntexAgentModel;
  success: boolean;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  iterationCount?: number;
  toolCallsMade?: number;
  errorCode?: string;
}

export interface TestConversationExecutionSummary {
  requestedModel: IntexAgentModel | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  turns: Array<{
    productTurnIndex: number;
    resolvedModel: IntexAgentModel | null;
    resolutionSource: 'test_override' | 'user_setting' | 'default' | 'fallback' | 'not_used';
  }>;
  calls: TestConversationExecutionCall[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}
```

`TestConversationResponse` adds `execution: TestConversationExecutionSummary`. Model resolution is reported per product turn because a user setting can change during a long request; `not_used` is explicit for a confirmation-only turn with no LLM. A test override must appear on every LLM-backed turn, but the response never pretends one session-wide resolved model exists. The response continues to expose only sanitized replies, sessions, event summaries, tool summaries, and behavioral transcript.

### Instrumentation

Evaluation clients are wrapped at creation time. The wrapper observes `generate()` and `run()` results, aggregates returned usage, and records duration and result status. It never records prompt text, message content, headers, API keys, or raw provider responses.

The request-scoped collector is the source for response diagnostics. A request budget/deadline context is passed through `generateStructured`, retry/repair helpers, `ToolCallingClient.run()`, and every provider client. A `beforeProviderAttempt` hook runs before every retry, repair, and hidden tool-loop provider call; usage is recorded per attempt rather than only when an aggregate `run()` returns. This is required because one tool-calling run may contain up to five provider calls. The existing usage sink remains responsible for platform billing telemetry, but CI must point it to a local collector and never to shared dev.

The endpoint's `execution.calls` contains agent calls only. The evaluator report adds a separate judge-call diagnostic with the same call/attempt/usage/cost fields. Scenario and workflow budgets include classifier, every retry/repair/tool-loop attempt, and UX judge calls.

## Duration and Cost Guards

Long scenarios need bounded failure behavior.

### Provider-call timeout

Extend `LlmClientConfig` and `ToolCallingClientConfig` with `timeoutMs?: number` and forward it to OpenRouter clients. Intex configuration adds:

```text
INTEXURAOS_INTEX_AGENT_LLM_TIMEOUT_MS=120000
```

The same 120-second value applies to classifier, repair, and tool-calling requests. Provider retries remain inside this bound per attempt.

### Scenario deadline

The test runner enforces a 15-minute wall-clock deadline per scenario. It checks the deadline before every product turn and every repair/retry-capable stage. Each provider call receives an `AbortSignal` whose deadline is `min(120 seconds, remaining scenario budget)`, so a call cannot begin near the boundary and overrun the scenario deadline.

The CLI uses an 18-minute HTTP timeout, leaving a controlled reporting/cleanup margin beyond the 15-minute behavioral deadline. CI keeps a 30-minute job timeout for smoke jobs and a 180-minute timeout for the serialized nightly matrix. The 15-minute gate is provisional until the initial 20-turn pilot records P95; changing it requires a reviewed baseline change, not an implicit retry extension.

### Cost limits and credential boundary

- Default hard limit per scenario/model run: USD `0.50`.
- Protected/local smoke workflow total limit: USD `5.00`.
- Nightly full-matrix workflow total limit: USD `25.00`.

The collector checks the accumulated cost before starting the next stage. A call may cross a ceiling once because its final usage is known only after completion; no further LLM call may start after the ceiling is reached. The run then fails with `cost_budget_exceeded`.

Application-side accounting is diagnostic, not a security boundary. Evaluations use a dedicated evaluation-only OpenRouter key, never the platform production key. The key has provider-side spend/rate limits and is held by an egress-restricted evaluation gateway. The checked-out service receives only a short-lived, run-bound gateway credential and proxy URL; it receives neither the OpenRouter key nor a Google credential. The gateway allowlists the three agent models plus the fixed judge model, enforces per-run/workflow budgets independently, redacts payloads, and expires the credential when the run ends. A leaked run credential therefore cannot reach another origin or spend beyond its small ceiling.

No limit may be raised through an endpoint request. Workflow-level values are trusted configuration with repository defaults and optional lower CLI overrides. The lower of application, gateway, and provider-key limits always wins.

### Evaluation gateway contract

`apps/intex-eval-gateway` is a minimal private service, not a general LLM proxy. A dedicated protected-workflow identity may create a run credential by supplying immutable server-side policy inputs: run ID, allowed scenario IDs, allowed model set, absolute USD ceiling, and expiry no longer than 180 minutes. Repository code cannot choose a higher ceiling. The returned opaque credential is accepted only on the gateway's OpenAI-compatible completion route and is bound to that run.

The gateway:

- permits only the three exact Intex models and fixed UX judge model;
- validates request/response size and the expected OpenRouter API shape;
- overwrites/clamps provider output limits to a server-owned per-stage maximum and rejects any request without an enforceable `max_tokens`/equivalent bound;
- computes a conservative worst-case input-token bound from request bytes plus the forced output-token cap, prices it using a versioned model price table checked against the current provider catalog, and fails closed on unknown/increased pricing;
- atomically reserves that worst-case cost from both run and workflow allowances before every concurrent attempt, then reconciles the reservation to actual returned usage afterward; no attempt starts unless the full reservation fits;
- applies rate and concurrent-request limits;
- can egress only to the configured OpenRouter origin;
- never logs authorization, prompts, messages, or provider bodies;
- exposes sanitized usage totals and explicit exhausted/expired/revoked states;
- revokes the run credential during finalization and relies on the provider-key hard cap as the outermost bound.

The protected workflow identity may call credential creation/revocation but cannot read the OpenRouter secret. Local maintainers obtain the same short-lived credential through a protected command. Intex Agent and the UX judge receive a test-only base URL plus the run credential; production configuration continues to use the normal platform OpenRouter path.

Exact gateway routes:

```http
POST /internal/evaluation/runs
GET /internal/evaluation/runs/:runId
DELETE /internal/evaluation/runs/:runId
POST /v1/chat/completions
```

The internal routes require the dedicated protected-evaluation Google identity plus internal auth. Create accepts a strict `{ runId, scenarioIds, models, requestedBudgetUsd, expiresInSeconds }`; the server validates scenario/model membership from the immutable protected commit, permits only a lower-than-policy requested budget/expiry, and returns `{ credential, expiresAt, budgetUsd }` exactly once without logging it. Get returns sanitized reserved/actual cost, attempts, state, and expiry but no prompts or credential. Delete revokes idempotently. The completion route accepts only the run credential, the strict OpenAI-compatible subset, and the server-enforced model/token policy.

Gateway run records live in registered `intex_eval_gateway_runs`; active records use `leaseExpiresAt`, and only revoked/completed records receive the repository-standard Firestore `Timestamp expireAt` for TTL. Workflow/job loss is recovered by a gateway janitor that releases stale reservations, revokes the credential, and finalizes sanitized totals.

## Scenario Contract

Scenarios are inert `.scenario.json` files validated with a strict Zod schema that rejects unknown fields. A generated TypeScript catalog gives authors typed IDs and model/tool names without executing scenario-controlled code. Secret-bearing jobs never import TypeScript or JavaScript from a scenario directory. If an authoring helper is used, it runs without secrets and network access and must emit canonical JSON that is validated again by the consumer.

```ts
export interface IntexEvalScenario {
  schemaVersion: '1.0.0';
  scenarioVersion: string;
  scenarioId: string;
  title: string;
  tier: 'gold' | 'extended' | 'regression';
  maturity: 'candidate' | 'blocking';
  priority: 'p0' | 'p1' | 'p2';
  tags: string[];
  given: {
    currentDateTime: string;
    timeZone: string;
    turns: TestConversationTurnInput[];
    toolMocks?: TestToolMocks;
  };
  expected: {
    deterministic: DeterministicExpectation;
    ux: UxExpectation;
  };
  execution: {
    models: IntexAgentModel[];
    maxDurationMs: number;
    maxCostUsd: number;
    minimumRepetitions: 1 | 3;
  };
  provenance: {
    origin: 'authored' | 'session_debug';
    privacyReview: 'unreviewed' | 'approved_synthetic';
    authoredOn: string;
  };
}
```

Every turn uses synthetic content and a `${RUN_MARKER}` token injected at execution. Fixed time and timezone make relative-date behavior reproducible.

`scenarioId` matches `^[a-z][a-z0-9.-]{2,119}$`. Each concrete scenario/model/repetition invocation receives a distinct random `runId`; neither reports nor cleanup may aggregate different repetitions under one run identity.

Gold and Extended scenarios are always `blocking` and `approved_synthetic`. Authored regressions may be blocking; session-debug regressions enter as `candidate` only after explicit change authorization and human privacy approval, then follow the promotion gate in the session-regression specification. Candidate scenarios receive the same schema, privacy, fingerprint, and catalog enforcement as blocking scenarios. Their live behavioral result is advisory until promotion. Candidate age is reported by a scheduled governance job; after 30 days it fails the owned remediation report but does not make unrelated pull requests fail merely because wall-clock time advanced.

### Deterministic expectations

The deterministic oracle supports:

- exact executed turn count;
- required and forbidden session transitions per turn;
- same-session and different-session relationships;
- final session status and end reason;
- required and forbidden event types;
- exact tool name, status, and count;
- required and forbidden bounded tool-argument fields;
- confirmation accepted, rejected, stale, and missing-button outcomes;
- assistant reply presence or deliberate absence;
- expected fallback reason or prohibition of every fallback;
- exact side-effect boundary;
- resolved model and resolution source per LLM-backed product turn;
- maximum duration, tokens, and cost.

Any deterministic failure makes the scenario fail. A UX judge cannot override it.

### UX expectations

UX expectations reference versioned criterion IDs rather than exact output text:

- `intent_fidelity`
- `clarification_quality`
- `action_transparency`
- `session_transparency`
- `confirmation_clarity`
- `result_helpfulness`
- `language_consistency`

Each criterion specifies applicable turn indexes, required meaning, forbidden meaning, expected language, and whether ambiguity is acceptable.

## UX Judge

The judge is a separate OpenRouter call using `or:anthropic/claude-sonnet-5`. It receives only:

- synthetic scenario turns;
- sanitized captured assistant replies;
- deterministic tool/session summaries;
- the applicable versioned rubric.

It never receives production incident data, user identifiers, URLs, prompt preferences, full internal prompts, or raw tool arguments.

The judge returns a strict schema:

```ts
type CriterionVerdict = 'pass' | 'fail' | 'uncertain';

interface UxJudgeResult {
  rubricVersion: string;
  criteria: Array<{
    criterionId: string;
    verdict: CriterionVerdict;
    evidenceTurnIndexes: number[];
    reason: string;
  }>;
  finalVerdict: CriterionVerdict;
}
```

`uncertain` never silently passes. In a blocking run it requires review and produces a non-zero exit code.

The judge prompt is built through PromptBuilder. Any semantic prompt change requires a rubric/prompt version bump and snapshot tests.

## Repetition and Flake Policy

- Static validation and deterministic unit tests run once.
- `minimumRepetitions` is the normal count; P0 smoke scenarios normally specify one.
- A live failure caused by provider/network errors is retried once and remains reported as infrastructure failure if the retry fails.
- Behavioral `fail` or `uncertain` results override a configured minimum of one and run three total repetitions.
- A scenario passes only when at least two of three repetitions pass and no deterministic safety invariant fails in any repetition.
- A deterministic safety violation is immediately blocking and is never converted into flakiness.
- Reports retain every repetition so a majority result cannot hide a bad sample.

## Corpus

### Initial migration

Convert all ten narrative scenarios into executable Gold scenarios without changing their documented behavior. Generate the narrative document from scenario metadata after migration so prose and executable expectations cannot drift.

### Target composition

- Gold: 64 stable archetypes covering supported product behavior.
- Extended: 36 ambiguity, adversarial, failure, long-context, and boundary archetypes.
- Regressions: incident-derived scenarios added over time.

The initial implementation is complete when the existing ten are executable; expansion to 64+36 is a follow-on corpus-authoring task performed through the same schema and review gates. The pipeline itself must not depend on reaching 100 scenarios.

### Required long-conversation coverage

At least these executable cases must exercise the raised limit:

1. Exactly 20 text turns continuing one session.
2. Twenty mixed text and confirmation-button turns.
3. Multiple session supersedes inside one 20-turn request.
4. A timestamp gap that expires a session mid-request.
5. Final turn index 19 validly referencing prior turn index 18.
6. Rejection of 21 turns.
7. Rejection of self/forward reference index 19 and out-of-range index 20.
8. A near-limit Unicode payload below 1 MiB.
9. Rejection of a payload above 1 MiB.
10. Mid-request LLM failure followed by guaranteed cleanup.

## Privacy and Provenance

Mechanical privacy lint rejects:

- `intex_session_*`, real Auth0 IDs, phone-like values, and real e-mail addresses;
- `http://` or `https://` values except explicit synthetic fixture domains;
- raw WhatsApp IDs, confirmation IDs, API tokens, and credentials;
- unapproved high-entropy strings;
- provenance fields other than `origin`, `privacyReview`, and date-only `authoredOn`.

Static validation cannot prove that prose was not copied or paraphrased from production. New session-derived drafts therefore start as `privacyReview = unreviewed` and cannot enter the tracked corpus until a human reviewer confirms the text is newly synthetic and changes the field to `approved_synthetic`. Incident references remain in a private artifact outside the repository. The committed corpus stores neither source session IDs nor hashes derived from source session IDs.

## Reports

Reports are written under `tools/intex-agent-evals/.artifacts/<runId>/` and ignored by Git. Each run produces:

- `manifest.json` — git SHA, prompt versions, evaluator versions, selected models, clock, and workflow identity;
- `results.json` — machine-readable per-scenario/per-repetition verdicts;
- `summary.md` — human-readable failures and comparisons;
- `transcripts/` — synthetic inputs and sanitized replies only.

Tracked baseline files contain only aggregate pass rates, latency percentiles, token/cost percentiles, and evaluator versions. They never contain transcripts or user-level data.

## CI Workflows

### Pull request: `intex-agent-evals-static`

Runs without external secrets:

- typecheck and unit tests;
- scenario schema validation;
- privacy lint;
- stable ID, version, and fingerprint checks;
- generated catalog drift check;
- deterministic oracle fixtures;
- workflow/configuration tests.

This is a required blocking check.

### Trusted smoke: `intex-agent-evals-smoke`

Runs only from an immutable commit already present on protected `development`, through protected `workflow_dispatch` or a protected environment. It must not accept an arbitrary SHA, use `pull_request_target`, or expose a credential to pull-request code. Pre-merge live checks are maintainer-local and use the same short-lived, tightly capped evaluation gateway; ordinary PR CI remains secret-free.

It:

- verifies and checks out the triggering protected `development` commit;
- starts Firestore and Pub/Sub emulators with fatal readiness checks;
- starts local usage and downstream stubs;
- starts user-service and Intex Agent from the checked-out code;
- obtains a short-lived run credential for the evaluation gateway without receiving its OpenRouter key;
- runs selected registered regressions and P0 smoke scenarios across all three models;
- reports candidate behavioral failures as advisory while keeping their schema/privacy/catalog failures blocking;
- enforces the USD `5.00` workflow ceiling;
- uploads reports for 14 days;
- executes cleanup and process shutdown under `if: always()`.

### Nightly: `intex-agent-evals-nightly`

Runs serialized from the current immutable `development` commit and uses the same evaluation gateway boundary:

- Gold and Extended suites across all three models;
- every regression candidate as an advisory result and every promoted regression as a blocking result;
- failed/uncertain repetition policy;
- baseline comparison;
- USD `25.00` ceiling;
- 180-minute timeout;
- reports retained for 30 days.

Quality regressions are advisory until a manually approved baseline exists for a model. Deterministic safety failures are blocking from the first run.

### Verdict matrix

| Check | Candidate | Blocking before approved baseline | Blocking after approved baseline |
| --- | --- | --- | --- |
| Schema, privacy approval, catalog integrity | blocking | blocking | blocking |
| Deterministic safety invariant | blocking | blocking | blocking |
| Absolute UX criterion `fail`/`uncertain` | advisory | blocking | blocking |
| Baseline quality delta | advisory | advisory | blocking |
| Provider/infrastructure failure | infrastructure failure, never a behavioral pass | same | same |

“Advisory” means visible and non-green in the evaluation report but does not block an unrelated merge. It never converts a deterministic violation into a pass.

## Local Runtime Isolation

The harness must never depend on shared dev Firestore.

Required local services:

- Firestore Emulator;
- Pub/Sub Emulator;
- local no-op/capturing usage endpoint;
- local no-op downstream service URLs for required Intex configuration;
- Intex Agent;
- user-service only for model-resolution integration tests;
- the restricted evaluation gateway, or an explicitly configured local-only fake for non-live tests.

The harness sets all emulator variables explicitly and fails startup if either emulator is unavailable. It never falls back to Application Default Credentials and never reads the production OpenRouter key.

## Cleanup

Emulator workflows flush the emulator project after each job and terminate all child processes in `finally`/`if: always()`.

Emulators are the default for every local run. An explicit shared-dev diagnostic run retains the guarded `test-intex-agent-*` namespace and gains:

- deletion of request-owned sessions and events after every scenario;
- deletion of prompt preferences/versions for the test user;
- owner-specific cleanup by exact `runId`; a service never deletes another service's collection directly;
- Firestore `Timestamp expireAt` on every run-owned document, a scheduled TTL/janitor, and an orphan sweep at the start and end of every run so runner loss or `SIGKILL` cannot leave data indefinitely;
- a dry-run default only for the standalone manual cleanup command; harness cleanup always executes;
- tests for target discovery and deletion, not only argument validation.

The service does not attempt transaction-style rollback across 20 turns. Cleanup is explicit and idempotent after success, failure, timeout, or cancellation.

## Error Handling

The CLI classifies failures as:

- `invalid_scenario`
- `privacy_violation`
- `service_startup_failed`
- `endpoint_contract_failed`
- `provider_unavailable`
- `scenario_deadline_exceeded`
- `cost_budget_exceeded`
- `deterministic_failure`
- `ux_failure`
- `ux_uncertain`
- `cleanup_failed`

Cleanup failure is always reported separately and causes a non-zero exit. It must not overwrite the original behavioral failure.

An HTTP `200` is not sufficient for a pass. `agent_fallback`, `llm_call_failed`, malformed output, forbidden tool activity, missing replies, and wrong session transitions are evaluated explicitly.

## Endpoint Changes

### Modified

- `POST /internal/intex-agent/test/conversation`
  - contract version `2026-07-14`;
  - 1-20 turns;
  - 1 MiB body limit;
  - required `scenarioId` and `timeZone`;
  - optional validated `model` override;
  - execution/model/usage diagnostics in the response.

### Created

- `POST /internal/evaluation/runs`
- `GET /internal/evaluation/runs/:runId`
- `DELETE /internal/evaluation/runs/:runId`
- `POST /v1/chat/completions` on the private evaluation gateway only.

### Removed

- Support for request contract `2026-07-01`.

### Unchanged

- Production continues to return `404` for the test endpoint.
- `POST /internal/intex-agent/messages` remains the real inbound service route.
- All test endpoint tools remain mocked.

## Testing Strategy

Implementation follows test-first development. Minimum test groups:

1. Route contract: 20 accepted, 21 rejected, final-turn reference index 18 accepted, self-reference index 19 rejected, index 20 rejected, new body limit, model allowlist, production `404`.
2. Runner: 20 sequential turns, session continuation, supersede, expiry, partial failure, instrumentation, and deadline.
3. LLM factory: timeout forwarding and all three tool-calling model IDs.
4. Scenario loader: schema versions, discovery, duplicates, and malformed data.
5. Privacy linter: every forbidden identifier class and safe synthetic controls.
6. Deterministic oracle: every expectation operator and hard-fail precedence.
7. UX judge: prompt snapshot, strict response parsing, `uncertain`, and judge failure.
8. Verdict aggregation: repetition quorum and safety override.
9. Cost/deadline enforcement.
10. Report redaction and ignored artifact paths.
11. Workflow static tests for triggers, secret boundaries, emulators, cleanup, and budgets.
12. One opt-in live conformance test per model plus an all-model smoke.
13. Budget-context tests proving every retry, repair, judge call, and hidden tool-loop attempt calls `beforeProviderAttempt`, receives the remaining-budget abort signal, and cannot start after exhaustion.
14. Gateway tests for exact route auth/schema, model/token clamping, conservative price reservations, concurrent exhaustion, price drift, one-time credential handling, status redaction, revoke, TTL, and orphan recovery.

## Required Implementation Surfaces

Every implementation slice must update and test the applicable inventory, not only application code:

- shared schemas/types, generated catalog, and API contract documentation;
- service `REQUIRED_ENV`, `ServiceConfig`, startup validation, local `.env.example`, and `ecosystem.config.cjs`;
- Terraform environment/secrets/IAM/WIF plus Nginx/Lua route policy;
- Firestore collection registry, Timestamp TTL policies, composite indexes, and migrations where required;
- `docs/services/<service>/technical.md`, `docs/architecture/api-contracts.md`, and relevant testing/runbook documentation;
- workflow static tests and secret/redaction scans.

## Acceptance Criteria

The foundation is accepted when:

- a 20-turn scenario completes through the real local endpoint;
- a 21-turn scenario is rejected before execution;
- the same scenario can run against each of the three exact models without global configuration mutation;
- all deterministic violations produce a non-zero exit regardless of UX result;
- UX `uncertain` is visible and non-passing;
- reports include model, usage, duration, iterations, and cost but no prompt/private content;
- every stateful product/downstream dependency is emulated or stubbed in CI; OpenRouter through the restricted evaluation gateway is the sole live external dependency in protected runs;
- live secrets are unavailable to ordinary pull-request jobs;
- the existing ten scenarios execute from the corpus and generate their human documentation;
- cleanup runs and is verified after success and forced failure;
- DeepSeek V4 Flash has a recorded baseline rather than being presumed compatible.

## Rollout

1. Land endpoint limits, diagnostics, and model conformance support behind the existing local/dev route boundary.
2. Land the eval package with static validation and the ten migrated scenarios.
3. Run protected smoke manually and approve initial per-model baselines.
4. Enable nightly full matrix.
5. Allow regression skills to add scenarios only after this schema and privacy lint are stable.
