# Intex Agent Test Runs UX and Model Selection Design

**Date:** 2026-07-19
**Status:** Written review pending; design direction approved by the user on 2026-07-19
**Companion specifications:**

- [`2026-07-19-intex-agent-matrix-corpus-design.md`](./2026-07-19-intex-agent-matrix-corpus-design.md)
- [`2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md`](./2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md)

## Purpose

Add an authenticated, owner-only **Test Runs** view to the existing Intex Agent Sessions
page and add an independent per-user Intex Agent model selector to the existing LLM
settings experience. The UI must let the operator watch the real Matrix/WhatsApp corpus
progress, inspect all 20 labelled scenario sessions, distinguish LLM tool selection from
strict mock execution, and see deterministic plus MiniMax M3 evaluation without exposing
test capabilities, raw tool payloads, transport identifiers, or model reasoning.

This document is self-contained for the selector's security, persistence, revision,
runtime, rollout, and Matrix-corpus integration requirements.

## Current Gaps

- `IntexAgentSessionsPage` has one undifferentiated session list. A Matrix corpus would
  mix evaluation sessions with ordinary WhatsApp Assistant sessions.
- The current session DTO has lifecycle and summary fields only. It has no run,
  scenario, execution-mode, model, deterministic-verdict, or semantic-verdict
  projection.
- The current rail title is derived from mutable session summary/message data. A corpus
  requires an immutable `Scenario 001 — <catalog label>` title.
- The timeline safely displays ordinary session events but cannot display the distinction
  between LLM tool selection and completed mock execution or show evaluation cards.
- The web app has no authenticated test-run read model and no active-run polling.
- The UI cannot prove that Matrix transport was real while tools were mocked.
- Intex Agent still resolves one globally configured Gemini model. There is no
  independent per-user Intex Agent model preference.
- MiniMax M3 and Gemini 3 Flash Preview already exist in current OpenRouter surfaces,
  but DeepSeek V4 Flash is not yet represented in the shared Intex model contract or
  the `infra-openrouter` allowlist/pricing surfaces. A UI-only option would therefore be
  invalid and unusable.

## Goals

1. Keep ordinary sessions as the default view and isolate corpus sessions in a separate
   **Test Runs** tab on the same page.
2. Show the retained run list, live progress, all scenario sessions, tool evidence,
   confirmation evidence, deterministic results, and MiniMax M3 results.
3. Preserve the current owner-only authentication boundary and return no cross-user
   existence signal.
4. Poll only while useful, prevent stale responses from overwriting newer state, and
   remain usable on desktop and mobile.
5. Render only closed, field-by-field safe projections.
6. Add an independent Intex Agent model selector with the same interaction pattern and
   authenticated user-contract style as the general default-model selector.
7. Support exactly DeepSeek V4 Flash, MiniMax M3, and Gemini 3 Flash Preview through one
   shared typed catalog and the platform-owned OpenRouter credential.
8. Run every endpoint and Matrix-corpus evaluation with DeepSeek V4 Flash while keeping
   MiniMax M3 fixed as the evaluator.
9. Limit the first delivery to the one server-configured Home Dev evaluator user for both
   the selector and Test Runs; production remains fail-closed and unavailable.

## Non-Goals

- The UI does not start, stop, retry, delete, or configure a corpus run.
- The UI contains no test-mode toggle, capability input, hidden activation flag, or
  per-message model override.
- Ordinary users cannot place sessions into strict-mock mode through the browser,
  Matrix text, WhatsApp text, or a copied scenario header.
- The test-run UI is not a replacement for the JSON evaluation artifact or the
  command-line acceptance runner.
- Users cannot enter arbitrary OpenRouter model IDs, supply a separate Intex Agent key,
  or configure the evaluator model.
- The Intex Agent preference does not overwrite or inherit the user's general
  `defaultModel` or `fallbackModel`.
- This view does not expose raw LLM prompts, system prompts, reasoning, provider
  responses, tool arguments/results, capabilities, phone numbers, e-mail addresses,
  Matrix room/event IDs, or WhatsApp transport IDs.
- The first delivery is not a public or multi-user selector/Test Runs rollout. It does not
  enable either surface for an unconfigured Home Dev user or for any production user.

## Information Architecture

The existing canonical `/#/intex-agent/sessions` page gains two tabs controlled by the
URL query. The legacy `/#/whatsapp/sessions` redirect remains unchanged:

- `view=regular` — **Regular**, the default when `view` is missing or invalid;
- `view=test-runs` — **Test Runs**.

The regular tab retains the current search, rail, timeline, refresh behavior, and mobile
focus restoration. Test sessions carrying an immutable `matrix_corpus` profile are
excluded from this list. Switching tabs never mutates a run or session and does not
automatically expose a test capability.

The existing authenticated `GET /users/:uid/settings` response adds this required closed
projection inside its `data` object:

```ts
interface UserSettingsCapabilityProjectionV1 {
  intexAgentCapabilities: {
    testRuns:
      | { status: 'available'; runtimeAudience: 'home-dev' }
      | { status: 'unavailable' };
  };
}
```

The route derives availability only after authentication and exact self-authorization.
The available member requires runtime audience `home-dev`, the exact configured evaluator
user, and the fail-closed Test Runs read flag. Production and every other user always
receive only `{ status: 'unavailable' }`, without a reason, configured identity, runtime
details, run count, or existence signal.

The Sessions page resolves this already-authenticated settings capability before it
constructs its tabs. **Test Runs** is rendered only for `available`. For `unavailable`, the
tab, Test Runs API client construction, requests, queries, focus targets, and deep-link
state are absent. This is a server-controlled availability projection, not a browser
test-mode flag or hostname check.

The Test Runs tab uses `run=<runId>` and `scenario=<scenarioId>` for owner-only deep
links. Invalid, foreign, deleted, or expired identifiers are removed from the URL and
fall back to the newest visible run/scenario without revealing whether a foreign record
exists. The tab remembers no authorization decision in local storage.

## Persisted Safe Read Model

Intex Agent owns two bounded read-model collections registered in
`firestore-collections.json`: `intex_agent_test_runs` for headers and 20 compact scenario
summaries, and `intex_agent_test_run_scenarios` for one detailed safe projection per
scenario. Natural user/assistant messages remain in the existing owner-scoped session
event store and are mapped only up to the scenario's committed event watermark. No
service other than Intex Agent reads or writes either collection directly.

The run document is capped at 64 KiB and exactly 20 summaries; each scenario projection
is capped at 128 KiB and 20 turns. Arrays have explicit limits below. The internal writer
serializes and measures the worst-case candidate before its first write. Preflight also
validates a generated maximum-size fixture for the current catalog. Oversize is an
infrastructure failure; evidence is never truncated. Tests prove the maximum valid
fixture remains below its cap and one additional byte is rejected.

The internal record has an owner `userId`; no public response returns that field.
Lifecycle and verdict are deliberately separate:

```ts
type TestRunLifecycle = 'preflight' | 'running' | 'finalizing' | 'completed' | 'stopped';
type TestScenarioLifecycle = 'pending' | 'running' | 'completed' | 'stopped' | 'not_run';
type TestVerdict = 'pending' | 'passed' | 'failed' | 'not_evaluated';
type TestArtifactDeliveryV1 =
  | { status: 'pending' | 'staged' | 'ready'; failureCode: null; updatedAt: string }
  | {
      status: 'failed';
      failureCode:
        | 'REPORT_STAGING_INTERRUPTED'
        | 'REPORT_STAGING_FAILED'
        | 'REPORT_VALIDATION_FAILED'
        | 'REPORT_PUBLICATION_FAILED';
      updatedAt: string;
    }
  | {
      status: 'unknown';
      failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT';
      updatedAt: string;
    };

interface IntexAgentTestRunRecordV1 {
  schemaVersion: 1;
  runId: string;
  userId: string;
  revision: number;
  corpusId: string;
  corpusVersion: string;
  runtimeAudience: 'home-dev';
  transport: 'matrix_whatsapp';
  executionMode: 'strict_mock_tools';
  lifecycle: TestRunLifecycle;
  verdict: TestVerdict;
  artifactDelivery: TestArtifactDeliveryV1;
  agentModel: IntexAgentModel;
  evaluatorModel: 'or:minimax/minimax-m3';
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  currentScenarioNumber: number | null;
  totals: TestRunTotalsV1;
  cost: TestRunCostV1;
  scenarios: TestRunScenarioSummaryV1[];
}
```

The aggregate contracts are exact and contain non-negative safe integers only:

```ts
interface TestRunTotalsV1 {
  scenarios: {
    planned: number;
    started: number;
    running: 0 | 1;
    completed: number;
    passed: number;
    failed: number;
    notRun: number;
  };
  turns: { planned: number; completed: number };
  replies: { expected: number; observed: number; judged: number };
  tools: {
    selected: number;
    mockCompleted: number;
    mockFailed: number;
    unexpectedKnown: number;
  };
  evaluations: {
    deterministicPassed: number;
    deterministicFailed: number;
    minimaxPassed: number;
    minimaxFailed: number;
    pending: number;
  };
}

interface TestRunCostV1 {
  agentNanoUsd: number | null;
  evaluatorNanoUsd: number | null;
  totalNanoUsd: number | null;
}

interface TestRunScenarioSummaryV1 {
  scenarioId: string;
  scenarioNumber: number;
  scenarioLabel: string;
  scenarioRevision: number;
  lifecycle: TestScenarioLifecycle;
  verdict: TestVerdict;
  plannedTurns: number;
  completedTurns: number;
  expectedReplies: number;
  completedReplies: number;
  selectedTools: IntexAgentToolName[];
  deterministicVerdict: TestVerdict;
  semanticVerdict: TestVerdict;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}
```

`selectedTools` is unique and capped at the 11 canonical names. `running` is recomputed
from scenario lifecycle and cannot exceed one. Nano-USD values use exact decimal parsing
and round half-up only once to the nearest `10^-9` USD; UI formatting does not change
stored totals. `totalNanoUsd` is `null` unless both components are present, otherwise it
equals their exact integer sum. A terminal pass requires both components. No missing
cost becomes zero.

Each detailed scenario document has one immutable private `sessionId` plus a private
binding digest and the following closed payload:

```ts
interface TestRunScenarioProjectionV1 {
  schemaVersion: 1;
  runId: string;
  userId: string;
  sessionId: string;
  sessionBindingDigest: string;
  scenarioId: string;
  scenarioNumber: number;
  scenarioLabel: string;
  runRevision: number;
  scenarioRevision: number;
  eventWatermark: number;
  lifecycle: TestScenarioLifecycle;
  verdict: TestVerdict;
  plannedTurns: number;
  completedTurns: number;
  toolEvidence: SafeToolEvidenceV1[];
  deterministicChecks: SafeDeterministicCheckV1[];
  replyEvaluations: SafeReplyEvaluationV1[];
  agentUsage: SafeAgentUsageV1[];
}

interface SafeToolEvidenceV1 {
  event:
    | 'selected'
    | 'mock_completed'
    | 'mock_failed'
    | 'unexpected_known_no_execution';
  toolName: IntexAgentToolName;
  turnIndex: number;
  ordinal: number;
  facts: SafeToolFactV1[];
}

interface SafeToolFactV1 {
  name:
    | 'contentLength'
    | 'titleLength'
    | 'summaryLength'
    | 'promptLength'
    | 'queryLength'
    | 'originalMessageLength'
    | 'locationLength'
    | 'descriptionLength'
    | 'messageLength'
    | 'textLength'
    | 'tagsCount'
    | 'sourceMessageIdsCount'
    | 'attendeesCount'
    | 'resultCount'
    | 'maxResults'
    | 'expectedVersion'
    | 'currentVersion'
    | 'hasUrl'
    | 'hasSourceUrl'
    | 'hasCalendarId'
    | 'hasItemId'
    | 'hasLinearIssueId'
    | 'startMatchesCatalog'
    | 'endMatchesCatalog'
    | 'timeZoneMatchesCatalog'
    | 'mode'
    | 'workerType'
    | 'taskMode';
  value:
    | number
    | boolean
    | 'list'
    | 'count'
    | 'codex'
    | 'codex-xhigh'
    | 'minimax'
    | 'planning'
    | 'execution';
}

interface SafeDeterministicCheckV1 {
  code:
    | 'reply_count'
    | 'tool_name'
    | 'tool_count'
    | 'tool_turn'
    | 'tool_fact'
    | 'session_transition'
    | 'lifecycle_event'
    | 'transport';
  status: 'pending' | 'passed' | 'failed';
  turnIndex: number | null;
  replyIndex: number | null;
  evidence: SafeDeterministicEvidenceV1;
}

interface SafeExpectedToolFactV1 {
  name: SafeToolFactV1['name'];
  operator: 'exists' | 'absent' | 'equals';
  value: SafeToolFactV1['value'] | null;
}

interface SafeDeterministicEvidenceV1 {
  expectedToolName: IntexAgentToolName | null;
  actualToolName: IntexAgentToolName | null;
  expectedTurnIndex: number | null;
  actualTurnIndex: number | null;
  expectedCount: number | null;
  actualCount: number | null;
  expectedTransition: 'created' | 'continued' | 'completed' | 'failed' | null;
  actualTransition: 'created' | 'continued' | 'completed' | 'failed' | null;
  expectedFacts: SafeExpectedToolFactV1[];
  actualFacts: SafeToolFactV1[];
}

type SafeMiniMaxCriterionCodeV1 =
  | 'understoodIntent'
  | 'helpful'
  | 'conciseAndClear'
  | 'professionalTone'
  | 'noPassiveAggression';

interface SafeReplyEvaluationV1 {
  turnIndex: number;
  replyIndex: number;
  verdict: 'passed' | 'failed';
  score: 1 | 2 | 3 | 4 | 5;
  criteria: {
    understoodIntent: boolean;
    helpful: boolean;
    conciseAndClear: boolean;
    professionalTone: boolean;
    noPassiveAggression: boolean;
  };
  failureCodes: SafeMiniMaxCriterionCodeV1[];
  latencyMs: number;
  usage: {
    logicalCalls: 1;
    repairCount: 0 | 1;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costNanoUsd: number;
  };
}

interface SafeAgentUsageV1 {
  turnIndex: number;
  stage:
    | 'intent_classification'
    | 'agent_generation'
    | 'response_schema_repair';
  callOrdinal: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costNanoUsd: number;
}
```

Per scenario, `toolEvidence` is capped at 100 entries with at most 16 facts each,
`deterministicChecks` at 128, `replyEvaluations` at 100 (20 turns times five replies),
and `agentUsage` at 60 (three closed provider stages per turn). Confirmation acceptance
and rejection make zero LLM calls and therefore add no usage row. Entries are ordered
and unique by their typed indexes. Preflight rejects a catalog/profile whose worst-case
evidence would exceed those bounds.

### Event sequence and committed watermark

Every newly appended session event receives an immutable positive safe-integer
`eventSequence`. The private session document stores `lastEventSequence`, initialized to
zero. `SessionRepository.appendEvent()` uses one Firestore transaction that reads the
session and proposed event ID, returns the already committed sequence for a byte-identical
idempotent retry, or otherwise writes the event with `lastEventSequence + 1` and advances
the session counter in the same transaction. A reused event ID with different bytes,
counter exhaustion, a gap, or a duplicate sequence fails closed. No timestamp, event
type, or random event ID participates in ordering.

Existing ordinary historical events may lack `eventSequence` and retain their current
legacy timestamp/type/ID ordering. Every event in a newly created `matrix_corpus` session
must have a sequence; a missing or malformed sequence is an infrastructure failure. For
sequenced sessions, `eventSequence` is the sole source-event order, so events with equal
timestamps have an unambiguous durable order without a secondary tie-break.

`eventWatermark` is the highest contiguous committed `eventSequence` included in the
scenario projection, or zero before the first event. The projection CAS reads the bound
session counter and the required event range in its transaction, rejects a watermark
above `lastEventSequence` or a non-contiguous range, and commits the run summary and
scenario projection together. An event appended after that transaction necessarily has a
higher sequence and remains invisible until a later CAS advances the watermark.

The public scenario reader first reads the owner-authorized projection, then reads exactly
the bound events with `eventSequence <= eventWatermark`, and finally rereads the projection.
It returns data only when run revision, scenario revision, watermark, event count, and
contiguous sequence range still match. A changed projection is retried once from its new
revision; a missing/delayed event or second race returns the static retryable
stale-projection response without a partial timeline.

The event collection adds the registered composite index `(sessionId, eventSequence ASC)`;
the sequenced reader always binds the authorized private session before using that index.

The run list uses the registered composite index `(userId, runtimeAudience, startedAt
DESC)` with an internal limit of four, covering the current acceptance plus at most one
superseded prior record before the next cleanup. “Current acceptance” is the newest run
whose lifecycle is nonterminal or whose lifecycle is terminal while artifact delivery is
still `pending`/`staged`. The service deterministically returns at most two visible slots:
current acceptance plus latest artifact-ready success, or, when no current acceptance
exists, latest artifact-ready success plus latest failed acceptance. The same run never
occupies two slots. A superseded hidden run also returns the static `404` by direct
run/scenario ID. Scenario documents use an opaque internal document key derived from
run/scenario and are fetched only after the owner run has been authorized; no public
query accepts or searches on `userId` or private `sessionId`.

The artifact deadline sweeper uses the registered composite index
`(artifactDelivery.status, finishedAt ASC)` and considers only `staged` terminal runs
whose non-null `finishedAt` is at least ten minutes old. It performs the exact revision-
checked `staged -> unknown` transition and never scans session/message collections.

For retention, “successful” means `completed/passed` with artifact delivery `ready`.
`stopped`, behavioral `failed`, or artifact-delivery `failed`/`unknown` occupies the
current/latest failed slot even when the underlying agent verdict is passed.

Scenario number is unique within a run and exactly covers the canonical ordered range
`1..20`. `scenarioLabel` is the tracked scenario's natural catalog `title`, never the
technical `Scenario NNN/020` marker, message text, or an LLM-generated session summary.
The private `sessionId` becomes immutable when created
and is never in a public DTO. A terminal
safety/infrastructure stop uses run lifecycle `stopped`, run verdict `not_evaluated`,
the active scenario lifecycle `stopped`, and remaining scenarios `not_run`; an ordinary
behavioral mismatch uses scenario verdict `failed` and allows later scenarios to run.
`finalizing` is nonterminal: transport is quiesced/drained, private context has a
matching tombstone, the public run verdict remains `pending`, and one immutable private
terminal candidate awaits the signed WhatsApp terminal-request event.

Artifact delivery is a separate monotonic dimension. Before `finalizing`, the evaluator
must validate and stage both report candidates and move `artifactDelivery` from `pending`
to `staged`. After terminal acknowledgement it moves `staged` to `ready` or `failed`; if
no authoritative update arrives before the deadline, the sweeper records `unknown`
rather than guessing whether filesystem publication succeeded. Neither transition may
change a terminal lifecycle or verdict. A completed/passed run with failed or unknown
artifact delivery is displayed as a passed agent outcome but failed live acceptance and
requires process exit `2`; those statuses are complementary, not aliases.

The signed abandoned-run recovery transaction terminalizes both dimensions atomically.
When it wins for an existing `running`/`finalizing` run, `pending` becomes
`failed/REPORT_STAGING_INTERRUPTED`, `staged` becomes
`unknown/REPORT_DELIVERY_STATUS_TIMEOUT`, and an already terminal delivery state remains
unchanged. It then applies `stopped/not_evaluated`. A persisted terminal run is therefore
never left with `pending` or `staged` solely because its runner disappeared.

The evaluator publishes the complete safe projection through one Home Dev-only internal
compare-and-set route. It supplies `expectedRevision` and the affected
`expectedScenarioRevision`; Intex Agent validates the exact
Home Dev evaluator authorization, immutable fields, state transition, derived totals,
scenario ordering, known models/tools, bounded text, timestamps, and owner/session
relationships before atomically writing both revisions plus an event watermark. A
`running -> finalizing` transition additionally requires the exact matching private
context-finalization tombstone, `artifactDelivery.status === 'staged'`, and stores the
validated immutable terminal candidate defined by the core Matrix-corpus contract. The evaluator cannot write `completed` or
`stopped`; only the idempotent signed terminal-control handler can transition
`finalizing` to its candidate or recover `running/finalizing` to stopped. Stale writes
receive a conflict and must refetch; they never overwrite newer progress. The route
accepts no raw messages, raw tool payloads, model reasoning, Matrix/WhatsApp identifiers,
or capability values. The evaluator never writes the Intex-owned collection directly.

## Closed Public DTOs

All public response schemas use `additionalProperties: false` recursively. They contain
only the following payloads; the standard authenticated success/error envelope remains
unchanged:

```ts
interface PublicTestRunHeaderV1 {
  schemaVersion: 1;
  runId: string;
  revision: number;
  corpusId: string;
  corpusVersion: string;
  transport: 'matrix_whatsapp';
  executionMode: 'strict_mock_tools';
  lifecycle: TestRunLifecycle;
  verdict: TestVerdict;
  artifactDelivery: TestArtifactDeliveryV1;
  agentModel: IntexAgentModel;
  evaluatorModel: 'or:minimax/minimax-m3';
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  currentScenarioNumber: number | null;
  totals: TestRunTotalsV1;
  cost: TestRunCostV1;
}

interface PublicTestRunScenarioSummaryV1 {
  scenarioId: string;
  scenarioNumber: number;
  scenarioLabel: string;
  scenarioRevision: number;
  lifecycle: TestScenarioLifecycle;
  verdict: TestVerdict;
  plannedTurns: number;
  completedTurns: number;
  expectedReplies: number;
  completedReplies: number;
  selectedTools: IntexAgentToolName[];
  deterministicVerdict: TestVerdict;
  semanticVerdict: TestVerdict;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

interface TestRunListDtoV1 {
  runs: PublicTestRunHeaderV1[];
}

interface TestRunDtoV1 {
  run: PublicTestRunHeaderV1;
  scenarios: PublicTestRunScenarioSummaryV1[];
}

interface TestScenarioDtoV1 {
  schemaVersion: 1;
  runId: string;
  runRevision: number;
  agentModel: IntexAgentModel;
  evaluatorModel: 'or:minimax/minimax-m3';
  scenario: PublicTestRunScenarioSummaryV1;
  eventWatermark: number;
  timeline: PublicTestTimelineEventV1[];
}

type PublicTestTimelineEventV1 =
  | {
      type: 'user_message';
      timelineIndex: number;
      eventSequence: number;
      turnIndex: number;
      text: string;
      createdAt: string;
    }
  | {
      type: 'assistant_message';
      timelineIndex: number;
      eventSequence: number;
      turnIndex: number;
      replyIndex: number;
      text: string;
      createdAt: string;
    }
  | {
      type: 'tool_selected' | 'mock_completed' | 'mock_failed' | 'unexpected_known_no_execution';
      timelineIndex: number;
      eventSequence: number;
      turnIndex: number;
      ordinal: number;
      toolName: IntexAgentToolName;
      facts: SafeToolFactV1[];
      createdAt: string;
    }
  | {
      type: 'confirmation_requested';
      timelineIndex: number;
      eventSequence: number;
      turnIndex: number;
      toolName: IntexAgentToolName;
      createdAt: string;
    }
  | {
      type: 'confirmation_resolved';
      timelineIndex: number;
      eventSequence: number;
      turnIndex: number;
      toolName: IntexAgentToolName;
      resolution: 'confirmed' | 'rejected';
      createdAt: string;
    }
  | {
      type: 'deterministic_evaluation';
      timelineIndex: number;
      verdict: TestVerdict;
      checks: SafeDeterministicCheckV1[];
    }
  | {
      type: 'minimax_evaluation';
      timelineIndex: number;
      evaluatorModel: 'or:minimax/minimax-m3';
      evaluation: SafeReplyEvaluationV1;
    };
```

`timelineIndex` is a zero-based contiguous display order generated by the safe mapper;
source events retain their positive `eventSequence`. Message text uses the existing
bounded natural-message limit after header removal. Every number is a bounded safe integer
with the domain limits declared above. The mapper constructs every member field by field.
It never copies `userId`, private `sessionId`, `sessionBindingDigest`, source event ID,
arbitrary `payload`, capability, transport identifier, provider identifier, raw arguments,
raw results, raw judge output, or an unknown source property into a public DTO.

## Authenticated Read API

All public routes use the existing bearer authentication. Ownership is derived only
from the token subject; no request body, query, or route parameter can select a user.
Missing/invalid authentication returns `401`. A missing, foreign, expired, or
retention-deleted run/scenario returns the same static `404` response. Every route uses
an explicit response schema, field-by-field mapper, canonical route logging, and
`Cache-Control: no-store`.

Before any collection query, every Test Runs route requires server runtime audience
`home-dev`, the fail-closed read feature flag, and token subject equality with the exact
configured evaluator user. Every unavailable runtime/user returns the same static `404`
and performs zero Firestore reads. Shared Auth0/Firestore infrastructure does not weaken
this runtime boundary.

### List retained runs

```http
GET /test-runs
```

Returns newest first, bounded by retention, with run header fields and aggregate totals
only. It does not include the scenario array or any session events.

### Read one run

```http
GET /test-runs/:runId
```

Returns the run header plus the ordered 20 scenario rail projections. The public DTO
omits `userId`, `sessionId`, internal revision history, evaluator transport state,
capability state, and cleanup internals. It includes a monotonic `revision` so the
browser can reject a stale poll response.

### Read one scenario

```http
GET /test-runs/:runId/scenarios/:scenarioId
```

Returns the scenario summary, its safe timeline, deterministic card, and MiniMax card.
The service verifies run ownership, scenario membership, and exact stored session
binding before reading session events. It never accepts an arbitrary `sessionId` from
the browser and never returns the bound `sessionId`.

The public timeline is a closed discriminated union containing only:

- natural `user_message` and `assistant_message` text after capability/header removal;
- `tool_selected` with tool name, turn index, and approved safe argument facts;
- `mock_completed` or `mock_failed` with tool name, turn index, and approved safe result
  summary;
- `confirmation_requested` and `confirmation_resolved` with closed resolution values;
- `deterministic_evaluation` and `minimax_evaluation` cards.

Safe facts are server-produced, bounded labels from a per-tool allowlist. Raw arguments,
raw results, serialized objects, URLs carrying credentials, and unknown event fields are
discarded. The MiniMax card contains the fixed evaluator ID, score, criterion verdicts,
and a server-generated sentence composed only from closed failing-criterion labels. No
free-form model rationale is persisted or returned; the raw judge response, chain of
thought, prompt, and provider metadata remain private.

### Internal projection writer

```http
PUT /internal/test-runs/:runId/projection
```

The route requires the existing internal-auth transport plus the same exact Home Dev
evaluator authorization used by the Matrix-corpus control plane. It is unavailable
outside runtime audience `home-dev`, rejects unknown fields, logs neither body nor
headers, and enforces the
compare-and-set and privacy rules above. There is no public write equivalent.

The signed `terminal-control` route defined by the core design is not an evaluator write
surface. Its handler invokes the same Intex-owned domain transition/CAS implementation
with the verified terminal event. These two paths are exhaustive: evaluator progression
may stop only at `finalizing`, and signed control may only apply the stored candidate or
abandoned recovery.

```http
PUT /internal/test-runs/:runId/artifact-delivery
```

This exact-run/fence route accepts only `pending -> staged | failed` before `finalizing`,
then `staged -> ready | failed` after terminal acknowledgement, with a closed failure code
and `expectedRevision`. Preterminal evaluator failure is restricted to
`REPORT_STAGING_FAILED`/`REPORT_VALIDATION_FAILED` and prevents `finalizing`; only signed
abandoned recovery may write `REPORT_STAGING_INTERRUPTED`. Staging supplies the schema
version plus SHA-256 digests of both validated safe candidate files. Intex stores both in
the private terminal manifest and computes the terminal candidate's composite digest from
their canonical ordered pair, while the public DTO exposes only delivery status. The
route accepts no path, report content, message, transport identifier, or raw error.
Preterminal updates require the current lease fence. Post-terminal ready/failed updates
require the immutable stored terminal fence plus terminal-control event ID; that
historical binding authorizes only delivery metadata and can never issue capabilities or
mutate session/run outcome.
Exact retries are idempotent; conflicting or backward transitions are `409`. An
Intex-owned deadline sweeper moves terminal `staged` records that receive no final update
to `unknown/REPORT_DELIVERY_STATUS_TIMEOUT`, so process death after lease release cannot
leave the UI pending forever or falsely claim whether filesystem publication succeeded.
The signed abandoned handler performs its atomic `pending -> failed` or
`staged -> unknown` rule without waiting for that deadline. Delivery updates increment
`revision` but never rewrite terminal lifecycle, verdict, scenario data, cost, or evidence.

## Test Runs Page

### Run selector and header

The newest retained run is selected initially. A compact run selector exposes at most
two entries: the current acceptance plus latest successful, or, when no acceptance is
running, finalizing, or awaiting artifact delivery, latest successful plus latest failed.
The selected run header shows:

- run lifecycle and a visually separate verdict;
- progress `completed / 20`, with an accessible progress element;
- counts for passed, failed, running, and not run;
- badges **REAL MATRIX**, **WHATSAPP**, and **MOCKED TOOLS**;
- exact agent model and fixed evaluator `MiniMax M3`;
- report delivery status **Pending**, **Staged**, **Ready**, **Failed**, or **Unknown**
  with only the closed failure label;
- start/finish time, elapsed duration, and agent/evaluator/total cost when available;
- a last-updated/stale indicator, without showing transport cursors or internal IDs.

Lifecycle answers whether work is still executing. Verdict answers whether evaluated
behavior passed. Color is supplementary; every state has visible text and an icon or
shape distinction. `finalizing` is shown as **Finalizing safely** with verdict **Pending**;
it is never rendered as completed or passed before signed release acknowledgement.
Artifact failure is shown separately as **Run passed · Report failed** or
**Run failed · Report failed**; timeout is **Report status unknown**. Neither collapses
into the agent verdict.

### Filtering and scenario rail

The rail is always ordered by canonical scenario number and labels rows as
`Scenario 001 — <label>` through `Scenario 020 — <label>`. Each row shows badges
`TEST · MATRIX · MOCKED`, lifecycle, verdict, completed/planned turns, and compact tool
names. It never uses the mutable session summary as its title.

The operator can combine:

- text search over scenario number, catalog label, and allowed tool display names;
- lifecycle filter;
- verdict filter;
- selected-tool filter over the 11 canonical tools.

Filtering is client-side over the bounded 20-item projection and never changes the run.
An empty filtered result preserves the run header and explains which filters are active.

### Scenario timeline

The selected scenario pane begins with its number, catalog label, session lifecycle,
verdict, turn/reply counts, and immutable model. The chronological timeline then shows
natural user/assistant messages, tool selected, confirmation, and strict-mock execution
as different card types. `Tool selected` is never labelled as executed until the
corresponding mock-completion evidence exists.

The final deterministic card shows every named assertion as passed, failed, or pending,
including expected/actual tool name, turn, count, session transition, and safe argument
facts. Every observed reply has its own `Turn N · Reply M` MiniMax card with semantic
criteria, verdict, fixed model, the closed server-generated failure-label sentence,
latency, usage, and evaluator cost; an aggregate card reconciles expected, observed, and
judged counts. Deterministic tool assertions remain authoritative; a MiniMax pass cannot
convert a deterministic tool failure into a pass.

## Live Refresh Behavior

On the Test Runs tab the browser fetches the run list, selected run, and selected
scenario. It polls the selected run every two seconds while its lifecycle is `preflight`,
`running`, or `finalizing`, or while artifact delivery is `pending`/`staged` regardless of
lifecycle. It refreshes the selected scenario only when its summary's `scenarioRevision`
advances. Run and scenario responses both carry `runRevision`;
scenario detail also carries `scenarioRevision` and `eventWatermark`. The internal CAS
writes the run summary and affected scenario projection in one Firestore transaction.
The public scenario read verifies matching revisions and reads only session events at or
below the committed watermark. If evidence has not reached that watermark, it returns a
static retryable stale-projection response and the browser retains its prior complete
view. It polls the bounded run list every five seconds while the tab is visible so a
newly started run appears without a page refresh.

The two-second selected-run/scenario polling stops only when lifecycle is `completed` or
`stopped` and artifact delivery is `ready`, `failed`, or `unknown`; five-second run
discovery continues while the Test Runs tab is visible. All polling stops when the
tab/component is hidden or unmounted and while an equivalent request is already in
flight. Returning to a visible tab performs one immediate refresh. Every request uses
`AbortController` and a local generation;
late responses from a previous tab, run, scenario, user, or lower revision are ignored.
There is no automatic resend, scenario retry, or mutation after a read error.

A transient poll failure keeps the last safe projection, marks it stale, announces
`Live updates paused`, and uses bounded backoff up to 15 seconds. Manual **Refresh**
retries immediately. Authentication/authorization failure clears owner data before
showing the error. A terminal run never returns to running due to a delayed response.

## Loading, Empty, and Error States

- Initial regular-session loading remains independent from Test Runs loading.
- Test Runs displays stable skeletons for run header, rail, and timeline rather than a
  blank page or layout jump.
- With no retained runs it shows `No test runs yet` and explains that runs are started by
  the protected Home Dev evaluator; it provides no start control.
- Scenario loading retains the selected row and labels the timeline region as busy.
- List, run, and scenario errors are distinct and have one safe retry action.
- A selected run removed by retention falls back to the newest retained owner run and
  removes stale URL parameters.
- An unavailable deterministic/MiniMax result is `Pending` or `Not evaluated`, never an
  inferred pass.

## Accessibility and Responsive Behavior

- The two views use an accessible tablist with `aria-selected`, `aria-controls`, focus
  visibility, and manual activation: Left/Right moves focus, Home/End moves to the first/
  last tab, and Enter/Space activates without changing view merely on focus.
- Run progress has a text label and native progress semantics. Poll updates use one
  polite live region only for meaningful lifecycle/verdict transitions, not every poll.
- Filters have programmatic labels; clearing filters is keyboard accessible.
- Rail rows are buttons with the scenario number and all state text in their accessible
  names. The selected row uses `aria-current="true"`; selection is not conveyed by color
  alone.
- Timeline cards use headings and lists in chronological DOM order. Tool and evaluation
  status icons are decorative when their text equivalent is present.
- On narrow screens badges and metrics wrap, long catalog labels break safely, and no
  320 px or 375 px viewport has horizontal document overflow.
- The existing mobile selection behavior is retained: selecting a different rail row
  moves focus to the selected timeline region without trapping focus or unexpectedly
  scrolling desktop users.
- Model selectors retain associated labels, focus after save, `aria-busy` while saving,
  and a programmatically associated safe error message.

## Per-User Intex Agent Model Contract

The shared `@intexuraos/llm-contract` package owns the only model IDs, guards, ordered
options, provider labels, and display names:

| Display name | Canonical model ID |
| --- | --- |
| DeepSeek V4 Flash | `or:deepseek/deepseek-v4-flash` |
| MiniMax M3 | `or:minimax/minimax-m3` |
| Gemini 3 Flash Preview | `or:google/gemini-3-flash-preview` |

`DEFAULT_INTEX_AGENT_MODEL` is DeepSeek V4 Flash. An absent persisted model resolves to
DeepSeek by intentional product default, not by provider fallback. Gemini 3 Flash
Preview remains an explicit supported option.

DeepSeek V4 Flash must be added at the same time to:

- the shared `IntexAgentModel` union, runtime guard, ordered option/display-name catalog,
  and tool-calling model contract;
- `infra-openrouter`'s model and tool-calling allowlists using the transport-local raw ID
  only at the adapter boundary;
- the tracked fallback pricing/context catalog and the live-catalog merge path;
- every exhaustive factory, allowlist, model-display, and pricing test.

The initial tracked OpenRouter snapshot is versioned `2026-07-19` and comes from the
official [`GET /api/v1/models`](https://openrouter.ai/api/v1/models) catalog. For raw ID
`deepseek/deepseek-v4-flash` it records canonical slug
`deepseek/deepseek-v4-flash-20260423`, text input/output, context length `1_048_576`,
prompt price `0.000000098` USD/token, completion price `0.000000196` USD/token, and cache-
read price `0.0000000196` USD/token. Required parameters are `tools`, `tool_choice`,
`response_format`, and `structured_outputs`; the official model page also identifies the
same raw API slug and one-million-token context.

The shared catalog keeps canonical `or:` ID and adapter-local raw ID as different typed
fields. Generation, tool-calling, classifier, and schema-repair client factories must all
admit the model. Confirmation handling uses no LLM client. Startup catalog conformance requires the live
entry to exist, retain at least `1_000_000` context tokens, advertise all four required
parameters, and contain positive finite per-token prompt/completion pricing. The tracked
snapshot is the versioned fallback pricing source for offline accounting tests, not
permission to expose a missing live model. Home Dev corpus preflight requires a fresh
live-catalog match; an unavailable catalog, regressed capability/context, or malformed
price makes the selector/run unavailable and never yields zero cost. The merged catalog
records `catalogFetchedAt`, canonical slug, and a digest of the exact model entry so a
report can identify the pricing/capability snapshot without embedding the raw payload.

MiniMax M3 and Gemini entries must be audited against those same surfaces so all three
options have one-to-one parity. Pricing values must come from the reviewed OpenRouter
catalog data used by the repository and retain provider-reported cost accounting. A
missing model or missing pricing admission fails closed; implementation must not invent
zero pricing or silently substitute another model merely to admit a corpus run.

The existing authenticated LLM-settings response adds this exact closed projection:

```ts
type IntexAgentModelSelectorV1 =
  | {
      status: 'available';
      explicitModel: IntexAgentModel | null;
      effectiveModel: IntexAgentModel;
      source: 'explicit' | 'default_absent';
      revision: number;
      options: readonly [
        { id: 'or:deepseek/deepseek-v4-flash'; label: 'DeepSeek V4 Flash' },
        { id: 'or:minimax/minimax-m3'; label: 'MiniMax M3' },
        { id: 'or:google/gemini-3-flash-preview'; label: 'Gemini 3 Flash Preview' },
      ];
    }
  | { status: 'unavailable' };
```

Availability is server-authoritative: the platform OpenRouter catalog must pass startup
conformance and the authenticated user must be included in the environment's rollout
allowlist. The first delivery enables only the configured Home Dev evaluator user and
keeps production off. Availability never depends on BYOK or a browser flag. The
`unavailable` arm contains no model, revision, options, or reason.

Route processing order is authentication, exact self-authorization (`uid` equals token
subject), rollout availability, then body/model/CAS validation. A foreign UID is rejected
before availability lookup and receives no signal about selector state. Corrupt persisted
model state is a repository/infrastructure error, never `default_absent` or
`unavailable`.

The preference is stored as independent `llmPreferences.intexAgentModel` state owned by
User Service. `llmPreferences.intexAgentModelRevision` is an independent non-negative
safe integer: absent means zero, and every state-changing set or reset increments it once.
It never aliases or rewrites `defaultModel`/`fallbackModel`. The read model
extends the existing authenticated LLM-settings response with an exact available/
unavailable selector discriminant. Update and reset use the same authenticated client
contract path as the general model setting:

```http
PATCH /users/:uid/settings
```

The route keeps its existing general-model request arm for backward compatibility and
adds a strict independent arm accepting only
`{ intexAgentModel: <canonical model ID> | null, expectedRevision }`. Mixed arms and
unknown fields are rejected. The Intex selector's client sends no `defaultModel` or
`fallbackModel`; `null` resets only the explicit Intex preference. The response returns
the effective Intex model, persisted explicit value, source (`explicit` or
`default_absent`), and new revision. Update and reset are authenticated,
self-authorized, revision-checked, preserve both general model fields byte-for-byte, and
remain independent from provider-key mutation.

User Service performs one Firestore transaction that checks the independent current
revision, updates or deletes only the Intex-model field path, increments only its
revision, and preserves all sibling settings written concurrently. A stale revision is
`409`; safe-integer exhaustion is a static `REVISION_EXHAUSTED` conflict and writes
nothing. Resetting an already absent value still requires the current revision and is an
idempotent success without increment, so a retried response cannot create revision drift.

Intex Agent resolves runtime state through
`GET /internal/users/:uid/settings/intex-agent-runtime`, never direct User Service
Firestore access. Its exact response is:

```ts
type IntexAgentRuntimeSettingsV1 =
  | {
      status: 'available';
      effectiveModel: IntexAgentModel;
      explicitModel: IntexAgentModel | null;
      source: 'explicit' | 'default_absent';
      revision: number;
      timeZone: string;
    }
  | {
      status: 'unavailable';
      effectiveModel: 'or:deepseek/deepseek-v4-flash';
      source: 'platform_default';
      timeZone: string;
    };
```

The resolver checks runtime audience and exact rollout membership before reading or
decoding either selector field. In production or for an unconfigured user it returns the
`unavailable` arm and the platform DeepSeek default even if a stored explicit selector is
present or malformed; that arm projects no explicit value or selector revision. In the
available arm, missing settings produce DeepSeek with `default_absent` and revision zero.
A settings/time-zone repository failure, or selector decode failure in the available
arm, returns a closed non-200 infrastructure error rather than an absent settings object.

Intex Agent uses the platform-owned OpenRouter API key for all three models. The selector
is available and functional without a user-owned OpenRouter key, and deleting or failing
a user's BYOK key cannot remove, disable, or change the Intex Agent preference.

## Model Selector Experience

The existing **LLM Settings** page adds an **Intex Agent model** card using the same
visual hierarchy and immediate-save interaction as **Default Model**, while retaining
an independent loading/saving/error state.

The card:

- renders exactly the three shared options above;
- displays DeepSeek when the persisted preference is absent while retaining `null` as
  the persisted reset identity;
- states that the choice affects the WhatsApp Assistant and uses the IntexuraOS platform
  key;
- remains enabled regardless of user BYOK/OpenRouter-key state;
- saves immediately, optimistically, and rolls back only to the highest confirmed
  independent Intex preference on failure;
- serializes rapid choices and applies only the newest intent under the revision contract;
- offers **Use default** only when an explicit preference exists;
- never sends, clears, or reconstructs general default/fallback settings during an
  Intex-model mutation;
- never displays internal model-resolution source, platform credentials, evaluator
  controls, or test-mode controls.

If selector availability is `unavailable`, the entire card is absent, with no disabled
control, hidden model value, focus target, or browser-side capability flag. This UI
behavior does not authorize the selector; User Service remains authoritative.

## Runtime Model Semantics

For an ordinary product message, Intex Agent resolves the authenticated user's runtime
contract exactly once and creates one immutable turn snapshot used by classification,
structured repair, tool selection, and response repair. The available arm uses its
effective preference; the unavailable arm uses its declared platform DeepSeek default. A
preference change can affect a later eligible turn but never changes a stage already
executing. A provider failure never silently switches that turn to another model.

Every endpoint and Matrix evaluator requires
`or:deepseek/deepseek-v4-flash` before its first provider call and freezes it in the run
plus every scenario's immutable test-session profile. Matrix preflight stops before
sending messages if another model resolves. A selector change during the run affects
only later ordinary product turns, not an active evaluation run.

Within the available arm, an absent preference resolves to DeepSeek with source
`default_absent`, while an explicit preference resolves with source `explicit`; there is
no third available-selector fallback source. The unavailable arm is deliberately
`platform_default` and never interprets persisted selector state. A live corpus for the
configured evaluator user accepts explicit or `default_absent` DeepSeek, but rejects an
unavailable runtime or any different effective model. User-settings, provider, or schema
failure produces an explicit infrastructure failure and never substitutes Gemini,
MiniMax, or another model inside an eligible run.

MiniMax M3 is fixed as the semantic evaluator for every run and cannot be changed in
settings or by a scenario. The evaluator's model identity is independent from the agent
model, including when the agent itself is configured to MiniMax M3.

## Security and Privacy

- Test-run public data is owner-only and contains no `userId` field.
- The scenario endpoint derives its session binding from the stored run record rather
  than accepting a session ID from the client.
- Evaluation capability values are removed before Intex persistence and never enter a
  public DTO, UI state, browser log, application log, Sentry event, or report card.
- Natural corpus messages are shown because they are the authenticated user's normal
  session content. They are never copied into run-list metadata, rail titles, logs, or
  free-form evaluation prose; they enter only the private approved MiniMax judge call.
- Public test timeline mapping is an explicit allowlist. Unknown event types/fields and
  object-shaped text are not rendered.
- Model IDs are public catalog values; provider request IDs, raw provider model values,
  API keys, usage transport payloads, and raw errors are private.
- New sensitive routes log canonical templates with body preview length zero and no
  headers. Error responses and Sentry events contain static messages and no route IDs,
  message content, model reasoning, capabilities, or tool payloads.
- There is no browser or public API operation that can activate strict mocks.

## Endpoint Changes

### Created

- `GET /test-runs`
- `GET /test-runs/:runId`
- `GET /test-runs/:runId/scenarios/:scenarioId`
- `PUT /internal/test-runs/:runId/projection`
- `PUT /internal/test-runs/:runId/artifact-delivery`
- `GET /internal/users/:uid/settings/intex-agent-runtime`

### Modified

- `GET /users/:uid/settings` adds the required closed
  `intexAgentCapabilities.testRuns` projection. The Sessions page consumes it before
  constructing Test Runs UI or API clients.
- `GET /sessions` excludes sessions with an immutable Matrix-corpus profile from the
  regular-session projection.
- `GET /sessions/:sessionId` and `GET /sessions/:sessionId/events` return the same static
  `404` used for missing sessions when the target has a Matrix-corpus profile. Test data
  is readable only through the closed Test Runs mapper, even by its owner.
- The session-event model and `SessionRepository.appendEvent()` add transactional
  `eventSequence` allocation plus the private session `lastEventSequence` counter. Public
  ordinary-session DTOs do not expose the counter; historical unsequenced ordinary events
  retain their current compatibility ordering.
- `GET /users/:uid/settings/llm-keys` adds the required discriminated
  `intexAgentModelSelector` projection without changing existing default/fallback fields.
- `PATCH /users/:uid/settings` adds the strict independent Intex-model request arm while
  preserving the existing general-model arm and route path.
- Intex Agent's internal user-settings resolution consumes the independent selector and
  returns one canonical model/source snapshot per turn.

### Removed

- None.

### Unchanged

- The existing general `PATCH /users/:uid/settings` default/fallback request arm remains
  backward compatible; the new Intex-model arm cannot mutate those fields.
- Existing session detail/event routes retain current behavior for ordinary sessions;
  test sessions are deliberately unavailable through those legacy DTOs.
- The existing endpoint-based conversation test lane remains available as a focused
  diagnostic path; it is not represented as a Matrix Test Run.

## Required Tests

Implementation starts with RED tests and covers:

### Shared model and pricing contract

- exact three-option ordering, IDs, display names, provider labels, default, guard, and
  rejection of every non-canonical/raw ID;
- DeepSeek V4 Flash parity in LLM contract, tool-calling types, OpenRouter allowlists,
  factory construction, context metadata, live-catalog merge, fallback pricing, and
  usage/cost projection;
- all three options using the platform OpenRouter key without consulting user BYOK;
- missing allowlist/pricing entries failing before provider admission;
- no provider/model substitution after runtime failure.

### Persistence and routes

- run-record strict parsing, state transitions, CAS conflicts, derived totals, 20-scenario
  ordering, immutable model/session bindings, and terminal-state monotonicity;
- `running -> finalizing` rejection before the exact context-finalization tombstone,
  staged-artifact precondition, immutable candidate persistence, evaluator terminal-write
  rejection, signed terminal-request/abandoned event idempotency, and no legal
  `completed -> stopped` rewrite;
- artifact-delivery `pending -> staged|failed` and `staged -> ready|failed` CAS,
  stage-gate rejection, invalid/backward transition rejection, post-terminal
  lifecycle/verdict immutability, registered deadline index and exact ten-minute sweeper
  `unknown`, signed abandoned recovery atomically mapping `pending -> failed` and
  `staged -> unknown`, and completed/pass plus report-failed/unknown projections;
- maximum 64 KiB run and 128 KiB scenario fixtures, one-byte overflow rejection, array
  bounds, ordered per-reply MiniMax/usage reconciliation, and exact nano-USD arithmetic;
- internal writer dev/evaluator authorization and rejection of raw/private/unknown fields;
- list/run/scenario authentication, self-only ownership, identical foreign/missing `404`,
  scenario-to-session binding, retention deletion, and field-by-field response schemas;
- four-record internal retention query, deterministic two-slot selection for nonterminal
  and terminal-`pending`/`staged` current acceptance, success, failed,
  artifact-failed/unknown, no duplicate slot, and static `404` for a superseded hidden run;
- exact closed list/run/scenario/timeline DTO schemas reject `userId`, private `sessionId`,
  `sessionBindingDigest`, source event IDs, arbitrary payloads, unknown nested fields, and
  every private sentinel before serialization;
- Home Dev guard before Firestore access and zero Test Runs API/UI/query surface in prod;
- test-session exclusion from `GET /sessions` while ordinary sessions remain unchanged;
- identical static `404` for direct legacy detail/event access to a test session and no
  raw-event bypass of the Test Runs mapper;
- logging/Sentry response privacy with capability, message, tool payload, Matrix,
  WhatsApp, phone, e-mail, token, and raw-error sentinels absent.

### Web API and page

- Regular tab default, invalid-view fallback, tab keyboard behavior, and owner deep links;
- no test-mode, start, retry, stop, delete, or capability control anywhere in Test Runs;
- retained-run selection and exact `Scenario 001` through `Scenario 020` ordering;
- lifecycle/verdict distinction, filters, empty states, badges, run metrics, and safe cost;
- visible/polled **Finalizing safely** state with pending verdict and no premature
  completed/pass rendering;
- report delivery status, continued terminal polling while staged, stop on
  ready/failed/unknown, and distinct **Run passed · Report failed** versus **Report status
  unknown** live-acceptance failures;
- reload/list visibility for terminal `staged` delivery and no terminal orphan left in
  `pending`/`staged` after signed abandoned recovery;
- natural message, tool-selected, mock-completed, confirmation, deterministic, and
  MiniMax card rendering with raw/unknown technical payloads omitted;
- two-second active polling, five-second run discovery, terminal/hidden/unmount stop,
  in-flight coalescing, abort, backoff, immediate visibility refresh, and stale-revision/
  stale-user/run/scenario response rejection;
- transactional run/scenario revision plus event-watermark consistency under writer/poll
  races;
- atomic gap-free `eventSequence` allocation, byte-identical append retry, changed-ID
  reuse rejection, equal-timestamp durable ordering, delayed append above the watermark,
  missing-range rejection, and projection reread/retry when revisions advance mid-read;
- authenticated settings capability available only to the configured Home Dev evaluator
  user, unavailable for every other user/runtime, and zero Test Runs client construction
  or request when unavailable;
- loading skeletons, stale/error retention, auth data clearing, manual refresh, and
  retention fallback;
- accessible names, focus movement, progress semantics, live-region restraint, visible
  non-color status, and 320 px/375 px no-overflow behavior.

### Model settings UI and contract

- exact available/unavailable projection and complete card omission when unavailable;
- auth-before-rollout ordering, no foreign-account availability signal, exact option
  tuple, absent revision zero, and corrupt-state hard failure;
- exactly three shared options, absent preference displayed as DeepSeek, and reset
  retaining persisted `null` identity;
- independent PATCH payload containing only `intexAgentModel`/revision and preserving general
  `defaultModel`/`fallbackModel` in both commit orders with sibling writes;
- field-path CAS set/reset/idempotent retry/stale conflict/revision exhaustion and the
  internal runtime resolver's absent-versus-repository-failure distinction;
- internal resolver availability before selector decoding: persisted explicit or
  malformed selector state in production/unconfigured-user requests still returns the
  closed `platform_default` DeepSeek arm, exposes no selector field/revision, and admits
  no stored Gemini/MiniMax override;
- selector enabled without user OpenRouter BYOK and unchanged after BYOK deletion;
- immediate optimistic save, independent saving state, newest-intent serialization,
  revision conflict recovery, rollback, user switch, unmount, and capability revocation;
- one immutable model snapshot per ordinary turn and one immutable DeepSeek model across
  all endpoint and Matrix evaluation scenarios;
- explicit `default_absent` versus `explicit` diagnostics and evaluation refusal on any
  effective model except DeepSeek.

## Acceptance Criteria

The feature is complete when all of the following are true:

1. Opening Assistant Sessions without query parameters shows only ordinary sessions in
   **Regular**.
2. **Test Runs** shows a live retained run with an accessible header, real-Matrix and
   mocked-tools badges, exact agent model, fixed MiniMax M3 evaluator, progress, duration,
   cost, and separate report-delivery status.
3. One complete run displays exactly 20 ordered rail entries titled
   `Scenario 001 — ...` through `Scenario 020 — ...`, each bound to one immutable session.
4. Every scenario timeline visibly distinguishes natural messages, LLM tool selection,
   strict mock completion, confirmation handling, deterministic evaluation, and MiniMax
   evaluation.
5. No public UI/API/log/artifact card exposes a capability, raw tool payload, transport
   identifier, private credential, or raw MiniMax reasoning.
6. Active, finalizing, and post-terminal staged-artifact progress appears without manual
   refresh; polling stops only after both run and delivery are terminal, and stale
   responses cannot regress state.
7. For the exact configured Home Dev evaluator user, the LLM Settings page offers exactly
   DeepSeek V4 Flash, MiniMax M3, and Gemini 3 Flash Preview for Intex Agent through the
   platform key, independently from general model and BYOK state.
8. An absent preference uses DeepSeek by declared default; no provider failure silently
   changes models.
9. Every endpoint and live 20-scenario evaluation snapshots DeepSeek V4 Flash for every
   agent call and MiniMax M3 for every semantic evaluation.
10. Every unconfigured user and every production user receives unavailable selector and
    Test Runs projections; neither card/tab nor any Test Runs API request exists in that
    state, and runtime resolution uses the declared platform DeepSeek default without
    interpreting a stored explicit selector.
11. A post-terminal report failure or unconfirmed delivery preserves lifecycle/verdict,
    records a closed failed/unknown artifact status, renders it separately, and causes
    live command exit `2`; signed abandoned recovery also atomically prevents a terminal
    orphan from retaining pending/staged delivery.
12. Route/domain/web tests, complete tracked CI, and logged-in Chrome verification pass
    on desktop and mobile with zero unsafe console/network output and zero horizontal
    overflow.
