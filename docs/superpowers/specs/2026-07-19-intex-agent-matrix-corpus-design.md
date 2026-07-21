# Intex Agent Matrix Corpus Design

**Date:** 2026-07-19
**Status:** Written review pending; design direction approved by the user on 2026-07-19
**Companion specifications:**

- [`2026-07-19-intex-agent-test-runs-ux-design.md`](./2026-07-19-intex-agent-test-runs-ux-design.md)
- [`2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md`](./2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md)

## Purpose

Run the canonical 20-scenario Intex Agent corpus through the real Matrix and WhatsApp
transport while guaranteeing that every product tool is executed only by a strict mock.
Each scenario creates a separately labelled session, remains visible in Matrix,
WhatsApp, and the authenticated Intex Agent UI, and produces deterministic plus MiniMax
M3 evidence.

The transport and LLM are real. Product-tool side effects are impossible by
construction. A prompt instruction never activates test mode.

## Current Boundary

The existing endpoint runner already uses the live Intex Agent LLM flow with
`createTestToolExecutor()` wired into both normal and confirmed execution. The current
Matrix smoke sends one safe message through the real bridge, but its result explicitly
reports `hiddenToolAudit: not_available`. The Matrix ingress has no trusted metadata
channel: the private outbound route sends only text and an optional idempotency key, and
`startNewSession` is encoded as the literal `new session:` prefix.

Production composition separately creates real tool executors for normal execution and
confirmation continuation. Therefore, simply adding a test marker to the prompt would
not prevent real reads or writes.

## Goals

1. Execute all 20 canonical scenarios sequentially through Matrix and WhatsApp.
2. Make each user message and assistant reply visible in both chats.
3. Create one independently labelled Intex Agent session per scenario.
4. Keep the visible label outside the LLM instruction and conversation context.
5. Prove the exact selected tool, turn, count, sanitized argument facts, and mock result.
6. Mock all 11 tools, including calendar and preference reads.
7. Preserve mock execution through confirmation continuation.
8. Fail closed on missing authorization, correlation, session profile, or mock behavior.
9. Leave ordinary user messages and production sessions unchanged.
10. Isolate corpus sessions and confirmations from the user's ordinary active-session
    lane, even when both use the same account at the same time.
11. Require `or:deepseek/deepseek-v4-flash` for every endpoint and Matrix-corpus
    evaluation agent call; MiniMax M3 remains the separate semantic evaluator.

## Non-Goals

- The corpus does not create real notes, calendar events, research, bookmarks, code
  tasks, external saves, or preference changes.
- The user cannot enable test mode from a setting or message.
- A scenario number, the words `test mode`, or a copied header never authorizes mocks.
- The first delivery does not require a dedicated WhatsApp account or a modified
  third-party Matrix bridge.
- The evaluator does not expose raw tool arguments, tokens, Matrix identifiers, phone
  numbers, email addresses, or model reasoning.
- This design does not replace the existing endpoint runner; it remains a focused
  diagnostic lane.

## Considered Approaches

### A. Visible one-use capability header — selected

The evaluator issues a short-lived, one-use capability and sends it in a visible test
header above the natural scenario message. The header is visible in Matrix and WhatsApp,
then atomically validated and removed after canonical user mapping and before the message
is saved or published to Intex Agent.

This is the only current approach that preserves real transport, gives the operator the
requested scenario number in chat, and establishes a trusted server-side execution
profile without changing the external bridge.

### B. Correlate only by user, message digest, and time window — rejected

This produces cleaner chat messages but permits an ambiguous race with an identical
user-authored message. It is insufficient for authoritative tool evidence.

### C. Add hidden metadata to a dedicated bridge/account — deferred

This provides stronger transport isolation but requires a dedicated WhatsApp account,
bridge changes, and more infrastructure. It remains a later hardening option, not a
prerequisite for the approved first delivery.

## Visible Message Contract

The first turn of a scenario is sent as one Matrix text message:

```text
new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · <capability>

<natural scenario message>
```

Subsequent turns use the compact equivalent `🧪 Scenario 001/020 · step N/M ·
<capability>`. The capability is an opaque, high-entropy, sensitive one-use bearer value.
It is not a reusable API credential and becomes useless immediately after atomic
consumption or expiry.

The parser accepts one versioned, anchored grammar with bounded header and body lengths.
Any message beginning with the reserved corpus prefix but containing a malformed,
unknown, expired, or invalid capability is rejected as evaluation traffic; it is never
reinterpreted as an ordinary user message.
To prevent a case/emoji typo from leaking a capability into the ordinary lane, the
parser also rejects one narrow header-shaped lookalike: optional case-variant
`new session: `, one Unicode pictographic code point, case-variant `Scenario`, a numeric
scenario fraction, a literal middle dot with flexible surrounding spacing, and at least
one remaining first-line corpus marker (`Matrix corpus`, `tools`, `step`, `confirmation`,
or a word-bounded `imc<numeric-version>_`, including zero). Classification does not require a valid
denominator, exact delimiter spacing, capability version value, or capability length;
strict parsing rejects those afterward. It does not reserve general `new session:` prose
or words merely followed by `Scenario`.

After canonical user mapping, WhatsApp service removes only the approved header and
retains `new session: <natural scenario message>` for the first turn. Existing Intex
session-command parsing removes `new session:` before the LLM call. Consequently:

- the operator sees the scenario number in Matrix and WhatsApp;
- Intex Agent creates a new session;
- the LLM receives only the natural corpus message;
- the persisted Intex `user_message` event contains only the natural message.

The signed raw Meta webhook is already persisted before user mapping. It may contain the
opaque capability. The capability's one-use and expiry semantics make that retained
value non-authorizing. The token is visible only in the Matrix and WhatsApp transport
chats and may remain in that signed raw transport record; no IntexuraOS product UI,
public API, application log, or evaluation report exposes it.

## Capability Model

WhatsApp service owns a private, dev-only capability repository. The canonical record is
closed and versioned:

```ts
interface MatrixCorpusCapabilityV1 {
  version: 1;
  capabilityDigest: string;
  runtimeAudience: 'home-dev';
  leaseFence: string;
  runId: string;
  scenarioId: string;
  scenarioNumber: number;
  scenarioLabel: string;
  userId: string;
  matrixIdempotencyKeyDigest: string;
  issueRequestDigest: string;
  matrixRoomBindingDigest: string;
  whatsappAccountBindingDigest: string;
  whatsappSenderBindingDigest: string;
  promptNormalizationVersion: 1;
  promptDigest: string;
  phase: 'start' | 'turn' | 'confirmation';
  turnIndex: number;
  expectedSessionId: string | null;
  pendingConfirmationId: string | null;
  expectedDecision: 'confirm' | 'reject' | null;
  mockProfile: StrictToolMockProfileV1;
  mockProfileDigest: string;
  currentDateTime: string;
  timeZone: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  consumedTransportMessageIdDigest: string | null;
  ingestOutboxId: string | null;
  revokedAt: string | null;
}
```

The raw capability is never stored in the capability repository; its keyed digest is the
lookup key. It is a sensitive bearer capability despite its short lifetime. Its format
is `imc1_` plus 32 CSPRNG bytes encoded as unpadded base64url. Maximum TTL is five
minutes, accepted clock skew is 30 seconds, and only one turn is issued at a time.
The trusted evaluator generates the raw value before the authenticated issuance call and
submits it as a write-only sensitive field. WhatsApp Service validates the canonical
format and persists only the keyed digest. Neither the issuance response nor any log,
report, exception, event, or safe projection returns the raw value. After response loss,
an exact idempotent retry resubmits the same caller-held raw value; a changed value or
request under the same issuance key conflicts.

Prompt normalization version 1 converts CRLF and CR to LF and normalizes Unicode to NFC.
It does not trim, collapse, or otherwise rewrite whitespace. The SHA-256 prompt digest
covers a canonical object containing the natural body and the boolean
`startNewSession`, after the reserved header has been parsed. Contract tests include
Unicode, CRLF, trailing whitespace, and Matrix-to-WhatsApp formatting behavior.

Issuance requires `X-Internal-Auth`, an explicit fail-closed Home Dev enable flag, the
exact runtime audience, the configured evaluator user, an active bound Matrix room and
WhatsApp account/sender, a canonical scenario, a valid per-user run lease, and a prompt
digest matching the registered turn. Account and room bindings are keyed digests rather
than raw identifiers.

The Matrix idempotency key is generated before capability issuance and is an issuance
binding. The Matrix event ID is known only after send and is then atomically attached to
the evaluator's private correlation record. The third-party bridge does not project the
key, event ID, or room into the WhatsApp webhook, so WhatsApp consumption does not
pretend to verify unavailable Matrix metadata. Before the run advances, the evaluator
must independently prove that the acknowledged Matrix event for the stored idempotency
key occurred in the bound room and carried the same capability-bearing text. Failure is
a transport safety stop; the already accepted message still remained in the strict-mock
lane and could not execute a production tool.

Consumption occurs after the WhatsApp sender has been mapped to the canonical
IntexuraOS user and before product-message persistence or Pub/Sub publish. One Firestore
transaction atomically records both capability consumption and a durable ingest-outbox
intent keyed by the transport message ID. The transaction requires:

- the exact digest and unconsumed record;
- non-expired capability;
- exact mapped `userId`;
- runtime audience, Home Dev enablement, current lease fence, and the WhatsApp account
  and sender bindings observable at ingress;
- exact normalized message digest;
- expected phase and turn index;
- exact expected session for non-start phases;
- exact pending confirmation and decision for confirmation phases, with both fields
  forbidden for ordinary turns;
- exact run and scenario currently controlled by the evaluator.

Retrying the same transport message ID resumes or acknowledges the existing outbox
intent without creating a second product message or Pub/Sub event. Reusing the same
token with another transport message ID is a replay and forces safety quiescence. A worker
publishes the outbox intent idempotently and marks it delivered; crash tests cover every
boundary from transaction start through publish acknowledgement.

Any mismatch consumes nothing and rejects the evaluation message with an acknowledged,
terminal, correlated evaluator failure so the transport cannot retry indefinitely. It
never falls back to ordinary production processing.

## Ingest Contract

After successful consumption, WhatsApp service publishes the natural text plus a typed,
closed evaluation context:

```ts
interface MatrixCorpusIngestContextV1 {
  version: 1;
  kind: 'matrix_corpus';
  runtimeAudience: 'home-dev';
  leaseFence: string;
  ingestReceiptId: string;
  runId: string;
  scenarioId: string;
  scenarioNumber: number;
  scenarioLabel: string;
  turnIndex: number;
  phase: 'start' | 'turn' | 'confirmation';
  expectedSessionId: string | null;
  pendingConfirmationId: string | null;
  expectedDecision: 'confirm' | 'reject' | null;
  mockProfile: StrictToolMockProfileV1;
  mockProfileDigest: string;
  currentDateTime: string;
  timeZone: string;
}
```

The context travels inside a signed, versioned attestation issued by WhatsApp service
with audience `intex-agent`, a bounded expiry, the outbox receipt ID, lease fence, and a
digest of the complete payload. A Home Dev-only signing key signs it; Intex Agent
verifies the signature against the configured public key, runtime audience, explicit
enable flag, issuer, audience, expiry, payload digest, lease fence, and idempotent receipt
before accepting test mode. The evaluation event is accepted only inside the existing
Pub/Sub push wrapper and only when the edge-preserved Pub/Sub marker, the valid
edge-injected `X-Internal-Auth`, and the valid WhatsApp JWS are all present. Any subset,
including a direct signed body, is rejected. Valid JSON without a valid attestation cannot
activate mocks. Outside Home Dev the evaluation consumer/verifier is not composed, while
the existing ordinary direct/PubSub ingress remains registered and byte-compatible.

The Pub/Sub decoder validates every field and rejects unknown properties. Evaluation
messages skip link-preview extraction and any other side pipeline that could fetch or
persist product data. Normal ingest events remain byte-compatible and unchanged. No
service directly reads another service's private Firestore collections.

The durable outbox retains one generation-numbered attestation window. Retries inside a
live window reuse the byte-identical JWS. After that window and its accepted skew expire,
WhatsApp Service may atomically advance the generation and issue a new time-bounded JWS
only for the same immutable event/receipt ID, lease fence, canonical payload, and payload
digest. A stale generation cannot complete or overwrite the new generation. This is a
transport re-attestation, not a new logical delivery: Intex Agent's exact receipt ledger
still admits the logical event once and returns the stored result for an exact replay.
Changing any logical correlation remains a terminal replay conflict.

`currentDateTime` is an RFC 3339 timestamp and `timeZone` is an IANA identifier. Both are
fixed by the scenario catalog for the complete scenario so a multi-turn test remains
deterministic.

## Session-Lane Isolation

Matrix-corpus sessions use a separate repository lane from ordinary sessions. Creating
a test session does not read, close, supersede, or update the user's ordinary active
session pointer. Ordinary ingest queries ignore every session with a test profile, so a
real message sent during a corpus run can only continue or create an ordinary session.

The first test turn always creates a new test session under the run and scenario. Later
test turns never perform a `userId`-only active-session lookup: they address exactly
`runId + scenarioId + expectedSessionId` and require the immutable profile to match.
Confirmations are partitioned the same way. A normal confirmation cannot resolve a test
pending action, and a test capability cannot resolve an ordinary pending action.

Repository tests start with an existing ordinary active session, run all test-session
transitions, and prove that the ordinary session and pointer remain byte-for-byte
unchanged. They also interleave an ordinary message with a test run and prove that each
message stays in its own lane.

## Immutable Session Execution Profile

The first evaluation turn creates the same Intex Agent session entity in the isolated
test lane with an additional immutable profile:

```ts
interface IntexAgentMatrixCorpusProfileV1 {
  version: 1;
  kind: 'matrix_corpus';
  runtimeAudience: 'home-dev';
  leaseFence: string;
  runId: string;
  scenarioId: string;
  scenarioNumber: number;
  scenarioLabel: string;
  executionMode: 'strict_mock_tools';
  agentModel: IntexAgentModel;
  evaluatorModel: 'or:minimax/minimax-m3';
  promptPreferencesVersion: number;
  promptPreferencesDigest: string;
  userTimeZone: string;
  mockProfile: StrictToolMockProfileV1;
  mockProfileDigest: string;
}
```

Later turns must match the profile version, runtime audience, lease fence, run,
scenario, expected session, execution mode, agent model, evaluator model, prompt
preference version/digest, user time zone, and mock profile digest. The repository
allows the profile only at creation and rejects any
subsequent write that adds, changes, or removes it. Evaluation metadata cannot be added
to an existing production session. Ordinary sessions have no profile.

The scenario label is authoritative and independent from the mutable conversation
summary. It is never constructed from private message content.

Every Matrix-corpus profile must snapshot
`agentModel: 'or:deepseek/deepseek-v4-flash'`. The private context endpoint, session
repository, evaluator projection, and preflight reject another agent model before a
capability or provider call. The existing endpoint-evaluation lane applies the same
DeepSeek requirement through its immutable test execution context. This test invariant
is independent from the three-option product selector; MiniMax M3 remains the evaluator
and Gemini remains a supported product choice outside evaluation runs.

## Prompt Context and Provider Usage Snapshots

Before the first capability is issued, the evaluator registers the leased run through
Intex Agent's private run-context endpoint. The request carries the WhatsApp-signed lease
attestation, expected configured user, fence, catalog digest, agent/evaluator models, and
expected time zone; it never carries prompt-preference content. Intex Agent verifies the
attestation and then, as the collection owner, reads its own prompt-preference repository
and the User Service runtime contract exactly once. It normalizes the exact rendered
preference context used by the system prompt, verifies the expected model/time zone, and
creates this private record:

```ts
interface MatrixCorpusPrivateRunContextV1 {
  version: 1;
  runtimeAudience: 'home-dev';
  runId: string;
  userId: string;
  leaseFence: string;
  catalogDigest: string;
  agentModel: IntexAgentModel;
  evaluatorModel: 'or:minimax/minimax-m3';
  promptPreferencesVersion: number;
  promptPreferencesDigest: string;
  encryptedPromptContext: MatrixCorpusEncryptedValueV1;
  userTimeZone: string;
  createdAt: string;
  expiresAt: string;
  invalidatedAt: string | null;
}

interface MatrixCorpusPrivateScenarioContextV1 {
  version: 1;
  runtimeAudience: 'home-dev';
  runId: string;
  scenarioId: string;
  userId: string;
  leaseFence: string;
  baselinePromptPreferencesDigest: string;
  overlayVersion: number;
  overlayDigest: string;
  encryptedEffectivePromptContext: MatrixCorpusEncryptedValueV1;
  lastAppliedMutationReceipt: string | null;
  expiresAt: string;
  invalidatedAt: string | null;
}

interface MatrixCorpusEncryptedValueV1 {
  algorithm: 'aes-256-gcm';
  keyVersion: string;
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
}

interface MatrixCorpusContextFinalizationV1 {
  version: 1;
  status: 'finalized';
  runtimeAudience: 'home-dev';
  runId: string;
  userId: string;
  leaseFence: string;
  scenarioContextCount: number;
  finalizedAt: string;
}

interface MatrixCorpusTerminalCandidateV1 {
  version: 1;
  runId: string;
  userId: string;
  leaseFence: string;
  outcome: 'completed_passed' | 'completed_failed' | 'stopped_not_evaluated';
  projectionDigest: string;
  artifactStageRevision: number;
  artifactCandidateDigest: string;
  createdAt: string;
}
```

`artifactCandidateDigest` is the SHA-256 digest of one canonical closed object containing
the staged JSON candidate digest and staged Markdown candidate digest in that order. The
private manifest retains both component digests; the public projection exposes neither.

Intex Agent alone owns `intex_agent_matrix_corpus_run_contexts` and
`intex_agent_matrix_corpus_scenario_contexts`. It encrypts with the Home Dev-only
`INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY` Secret Manager value. AEAD associated
data binds record version/kind, runtime audience, run, configured user, fence, and, for a
scenario record, scenario ID. The key never enters the repository, evaluator, report,
session profile, or public projection; `keyVersion` supports fail-closed rotation.

Registration is idempotent only for the byte-identical immutable metadata and current
fence. It returns only prompt-preference version/digest, effective model, time zone, and
context expiry. Conflicting registration is `409`. The absolute context TTL is 24 hours
from registration and cannot be extended. Expiry, close, abandonment, fence mismatch,
decryption/authentication failure, or missing context is an infrastructure stop.

The first turn loads the run context by exact `runId + userId + leaseFence`, creates one
scenario context by exact `runId + scenarioId + userId + leaseFence`, and writes only the
version/digest into the immutable session profile. Later natural and confirmation turns
load the exact scenario context plus the matching session profile; no user-only lookup is
permitted. The signed ingest attestation proves the current fence for each load, so Intex
Agent never reads WhatsApp-owned lease storage directly.

Every scenario starts from the same immutable baseline. `get_user_preferences` reads only
the decrypted scenario overlay. Successful mocked add/update/delete preference calls
update only that encrypted overlay in an Intex-owned transaction keyed by ingest receipt,
tool name, turn, and ordinal; an exact retry returns the prior overlay version, while an
out-of-order or conflicting mutation fails closed. Rejected confirmations do not mutate
the overlay. The runner never rereads or writes the real preference repository during
corpus execution.

Exact-run context finalization is one fenced Intex-owned transaction: it verifies the run
context and the run-manifest-recorded closed set of at most 20 scenario contexts, deletes
every recorded scenario ciphertext document, and replaces the encrypted run-context
document with the non-secret `MatrixCorpusContextFinalizationV1` tombstone. An exact
retry returns the same tombstone; wrong fence, missing/extra scenario context relative to
the manifest, or changed ownership fails closed. A transition from `running` to
`finalizing` is rejected unless this tombstone already exists and matches the
run/user/fence. That transition also stores one immutable private
`MatrixCorpusTerminalCandidateV1` in the Intex-owned run manifest while the public
verdict remains pending. The transition also requires artifact delivery `staged` and
binds the validated artifact-candidate revision/digest into the private candidate. The
evaluator cannot write `completed` or `stopped` directly; only the signed terminal-control
handler may apply the stored candidate. Retained
sessions and public evidence remain intact and keep only version/digest. Retention-only
full cleanup eventually removes the tombstone and candidate with the run.

The baseline catalog declares `Europe/Warsaw`; first-run preflight requires the user's
snapshotted time zone to match. Each scenario's fixed RFC 3339 time remains synthetic and
deterministic. Future catalogs may introduce an explicit reviewed synthetic-time-zone
override, but an implicit account/catalog mismatch is infrastructure failure.

Every agent-provider call carries a closed correlation context:

```ts
interface MatrixCorpusLlmCallContextV1 {
  version: 1;
  runId: string;
  scenarioId: string;
  sessionId: string;
  turnIndex: number;
  stage:
    | 'intent_classification'
    | 'agent_generation'
    | 'response_schema_repair';
  callOrdinal: number;
}
```

Tool-calling, structured-generation, classifier, and repair adapters must return provider
usage and provider-reported cost together with this context. Intex Agent persists only
bounded token counts, model ID, stage, ordinal, and USD cost in the run-owned safe usage
projection. Agent totals reconcile exactly from these per-call records; a user-wide usage
query is forbidden because ordinary traffic may occur concurrently. Missing, duplicated,
uncorrelated, wrong-model, or incomplete provider usage/cost is an infrastructure failure
and can never be treated as zero.

Confirmation controls are deliberately outside provider usage. Accept and reject phases
must make zero LLM calls and emit zero agent-usage records; `executeConfirmed()` keeps a
rejecting LLM client and either executes the strict mock or follows the rejection path.
Any provider invocation or usage record correlated to a confirmation phase is a safety
failure. The absence of a provider call contributes no cost and is proved by the zero-call
assertion; it is not represented by a synthetic zero-usage event.

## Strict Mock Execution

The mock profile is a closed, digestible schedule rather than a permissive partial map:

```ts
interface StrictToolMockProfileV1 {
  version: 1;
  calls: Array<{
    turnIndex: number;
    toolName: IntexAgentToolName;
    ordinal: number;
    outcome:
      | { kind: 'success'; result: StrictMockResultV1 }
      | { kind: 'failure'; code: 'MOCK_TOOL_FAILURE' };
  }>;
  forbiddenSelections: Array<{
    turnIndex: number;
    toolName: IntexAgentToolName;
  }>;
  unexpectedKnownToolPolicy: 'behavioral_failure_no_execution';
}
```

`ordinal` is scoped to `(turnIndex, toolName)` and starts at one, so repeated calls are
ordered and independently evidenced. `StrictMockResultV1` is a discriminated union of
the 11 bounded synthetic tool-result schemas; arbitrary records, real resource IDs,
external URLs, and private content are invalid. Catalog preflight proves unique keys,
valid turn indexes from zero through 19, explicit outcomes for every deterministically
expected call, and a stable profile digest before any transport message is sent.

The catalog also derives `MatrixCorpusExpectedToolScheduleV1` independently from the mock
profile. This closed array of `(turnIndex, toolName, ordinal)` keys is signed in the Matrix
ingest capability, persisted in the immutable test-session profile, and passed as a required
argument to the strict-profile decoder. Before constructing the strict executor or runner,
Intex Agent requires exact key-set parity between this independently signed schedule and the
digest-verified mock profile. The mock profile therefore cannot authorize its own extra call;
missing, extra, or mismatched schedule entries are safety failures before any executor exists.

Service composition resolves an executor from the immutable session profile:

- ordinary session: existing production executor;
- `matrix_corpus` session: strict test executor only.

Resolution is applied independently to both `run()` and `executeConfirmed()`. For an
evaluation invocation, the executor resolver must not construct, resolve, receive, or
call any production Notes, Calendar, Research, Bookmarks, Code, External Save, or
preference executor. Production clients may exist elsewhere in the ordinary application
composition, but no reference to them is reachable from the evaluation branch.

The strict executor implements the closed set of all 11 canonical tools:
`create_note`, `create_calendar_event`, `query_calendar_events`, `create_research`,
`create_link`, `create_code_task`, `save_external`, `get_user_preferences`,
`add_user_preference`, `update_user_preference`, and `delete_user_preference`. The
profile decoder rejects unknown tool keys, and every tool permitted in a scenario must
have an explicit success or failure result. Each method:

1. validates that the tool is allowed by the scenario's closed mock profile;
2. records a sanitized call with tool name, turn index, status, and safe argument facts;
3. returns the configured deterministic mock result or configured failure;
4. never delegates to a production executor.

Unlike the existing permissive endpoint default, there is no default mock result. A
known tool selected at an unexpected turn, with an unexpected ordinal, or explicitly
forbidden is model behavior: it is recorded as `unexpected_tool_selected`, nothing is
executed, the scenario fails, and the runner proceeds to the next scenario. A malformed
profile, missing result for a call that catalog preflight declared expected, digest
mismatch, tool outside the closed catalog, or any production-executor admission is a
safety failure that stops the complete run. Neither path falls back to a production
executor. Read-only tools are subject to the same rules.

This distinction is implemented by a policy gate in orchestration after tool-call schema
validation and `tool_call_started`, but before confirmation preview, tool-definition
callback, executor lookup, or response repair. An unexpected known selection returns a
typed terminal behavioral result to the scenario runner; it neither throws an LLM/tool
infrastructure error nor fabricates a tool-result string. Any natural assistant reply
already produced remains eligible for MiniMax; if none exists, deterministic reply
expectations fail. The runner then closes only that scenario and advances.

## Tool-Selection Evidence

The system distinguishes selection from simulated execution:

- `tool_call_started`: the orchestration layer validated the LLM tool-call schema and
  recorded the selection before confirmation and before any executor invocation;
- `confirmation_requested`: a mutating tool was proposed and awaits user confirmation;
- `confirmation_resolved`: the expected test confirmation was accepted or rejected;
- `tool_call_completed` / `tool_call_failed`: the mock returned its configured outcome.

An accepted confirmation is the boundary after which the strict mock executor may emit
completion or failure. A rejected confirmation still has `tool_call_started` and
confirmation evidence but never has `tool_call_completed` or `tool_call_failed`.

Evaluation payloads contain only `toolName`, `runId`, `scenarioId`, `turnIndex`, status,
and the existing sanitized argument/result summaries. Raw arguments remain internal to
the pending confirmation mechanism and are never projected to the evaluator or UI. The
confirmation repository persists those arguments only as AES-256-GCM ciphertext under the
Home Dev context key, with associated data binding the confirmation, run, scenario,
session, user, lease fence, tool selection, TTL, and resolution state. Resolving a pending
confirmation writes a fresh ciphertext authenticated against the resolved metadata;
plaintext exists only in memory after an exact bound read.

Deterministic assertions remain authoritative for expected tools, forbidden tools,
counts, turns, sanitized argument facts, session transitions, and lifecycle events.
MiniMax M3 evaluates only response semantics.

## Confirmation Flow

When the agent requests confirmation, the evaluator observes the correlated pending
confirmation and issues a new one-use capability bound to:

- the same run, scenario, and session;
- the next turn index;
- phase `confirmation`;
- the exact pending confirmation identifier and expected decision.

The evaluator then sends a visible Matrix message such as:

```text
🧪 Scenario 001/020 · confirmation · <capability>

Tak, wykonaj.
```

After validation, WhatsApp service converts this test control into the same canonical
button-response shape used by normal confirmation handling. It does not ask the LLM to
interpret the text. Accepted confirmation calls `executeConfirmed()` with the session's
strict mock executor. Rejection follows the normal rejection path without executing a
tool. A byte-equivalent transport retry may resume after the durable resolution boundary:
the same decision, resolution message ID, and resolution timestamp returns the prior
resolution and idempotently appends the deterministic session event. Any changed decision,
message ID, timestamp, lane identity, expired capability, or out-of-order confirmation fails
closed.

## Run Lease and Fencing

WhatsApp service owns a transactional lease keyed only by `runtimeAudience + canonical
userId`. The Matrix room and WhatsApp account/sender tuple is an immutable lease binding,
not part of the uniqueness key. Therefore only one Matrix-corpus run for that user may
exist even if another evaluator proposes a different transport tuple. Acquisition returns
a monotonically unique fencing token, the runner renews it with a bounded TTL, and every
capability, outbox intent, attestation, session profile, and control request must carry
the current fence.

A second evaluator receives a terminal `RUN_ALREADY_ACTIVE` infrastructure failure.
After expiry, a new holder gets a new fence; delayed messages or workers from the old
holder cannot issue, consume, publish, confirm, clean up, or mutate sessions. The lease
phase is a closed state machine:
`provisioning -> active -> quiescing -> release_pending -> released`, with every
nonterminal phase able to expire to `abandoned`.

Acquisition creates only a `provisioning` lease and permits no capability issuance. The
evaluator then registers the Intex private context, run manifest, and safe `preflight`
projection and completes any required exact-ID cleanup of already superseded prior runs.
It calls `activate` only after WhatsApp verifies through Intex control status that all
three exact run/user/fence records and provisioning cleanup are ready and consistent.
Activation is idempotent and is the sole `provisioning -> active` transition. A crash
before or during registration therefore cannot create executable test authority.

Quiescence and release are deliberately separate. `quiesce` atomically retains the
current lease/fence, blocks new capability issuance and first-time consumption, revokes
unconsumed capabilities, and closes work that was never published. Exact idempotent
retries may still drain already consumed outbox work. The control plane reports
`drained=true` only when every consumed turn has a terminal Intex completion/failure
marker, every outbox intent is terminal, and no reply/delivery correlation remains in
flight. The evaluator may finalize context only after that proof. A bounded drain timeout
does not release the lease; it falls through to orphan recovery.

After context finalization, Intex Agent CASes the safe run to `finalizing` and stores the
private terminal candidate. The evaluator then calls `release`. WhatsApp service verifies
through Intex Agent's authenticated control-status endpoint that the same run/user/fence
is `finalizing`, the tombstone/candidate/artifact-stage digests match, and the lease is
quiesced/drained.
It atomically moves the lease to `release_pending` and writes a durable signed terminal
control outbox event. Intex Agent idempotently applies the stored candidate to
`completed` or `stopped` and acknowledges the event; only that acknowledgement lets the
WhatsApp outbox transaction mark the lease `released`. A lost response is an exact
idempotent retry. Acquisition also rejects any Intex current acceptance: a `preflight`,
`running`, or `finalizing` lifecycle, or a terminal lifecycle whose artifact delivery is
still `pending`/`staged`. Thus no second run can enter during control reconciliation or
the bounded post-terminal report-publication window.

The terminal control-status response exposes its opaque event ID only over internal auth
so the evaluator can bind the post-terminal artifact-delivery update. That ID and the
stored fence are historical delivery authority only; they never authorize a capability,
session mutation, or tool execution and never enter public/report output.

The terminal-control transaction gives the first valid terminal-request or abandoned
event for the current fence exclusive terminal authority. Exact duplicates return the
stored result; a later opposite event returns that same terminal result without rewriting
it. Thus a release-pending expiry race can resolve to the candidate or to
`stopped/not_evaluated`, but never both and never by `completed -> stopped`.

WhatsApp service's lease sweeper owns orphan recovery. When a nonterminal lease expires, it
atomically revokes outstanding capabilities, closes undelivered outbox intents, marks
the lease abandoned, and durably publishes a signed `matrix_corpus_run_abandoned`
control event. Intex Agent verifies it and runs one idempotent fenced recovery
transaction. For `active`, `quiescing`, or `release_pending`, it performs or verifies
context-only finalization, writes the matching tombstone, then transitions an existing
`running` or `finalizing` Test Run to `stopped/not_evaluated`; remaining scenarios become
`not_run`. In that same Intex transaction, a still-`pending` artifact becomes
`failed/REPORT_STAGING_INTERRUPTED`, while a `staged` artifact becomes
`unknown/REPORT_DELIVERY_STATUS_TIMEOUT`; an already terminal artifact-delivery value is
preserved. Consequently abandoned recovery cannot leave a terminal run with
`pending`/`staged` delivery or infinite UI polling. It never rewrites an already terminal
run.

For `provisioning`, recovery accepts all exact crash boundaries: if context, manifest,
and projection are all absent, it returns a signed safe no-op acknowledgement; if only a
strict subset exists and no capability/session/message could have been created, it
ownership-checks and deletes only those exact provisional records; if all records exist
but activation was not committed, it applies the same exact provisional rollback. Any
session/message/capability evidence in provisioning is corruption and fails closed for
manual investigation. The acknowledgement terminalizes the abandoned lease record. The
UI therefore cannot poll an orphan forever. A later preflight must observe completed
reconciliation before acquiring a new fence. Hard process/host loss is recovered by this
path rather than by pretending that an uncatchable signal returned an exit code.

## Correlation and Sequencing

The corpus runs with concurrency one. Before each outbound turn, the evaluator captures
the Matrix cursor, issues one capability, sends one message with a unique idempotency
key, and waits for the complete bounded correlated reply set plus expected Intex session
evidence. Intex Agent emits a safe `turn_processing_completed` marker only after all
reply-publisher calls for that turn have been durably accepted; it contains the bounded
reply count and safe reply digests. The evaluator closes the reply window only when that
marker and every corresponding WhatsApp delivery/Matrix mirror receipt reconcile, or a
bounded timeout fails the turn. It never guesses completion from a quiet sync interval.
On a catchable terminal processing failure, Intex Agent instead emits one safe
`turn_processing_failed` marker only after preventing further tool/reply publication; it
contains only the same correlation fields and a closed failure code. Quiescence may drain
against either marker. Process/host loss emits neither and therefore reaches abandoned
recovery after timeout.

The internal correlation chain binds the Matrix idempotency key and event ID, bound room
and account/sender digests, WhatsApp/Meta message and delivery IDs, outbox receipt,
Intex message ID, session ID, and a safe digest of the assistant response. Raw transport
identifiers remain internal; the report exposes only per-link booleans and counts. A turn
passes transport checks only when automation proves both the user message and assistant
reply were observed in Matrix and in WhatsApp, not merely inferred from a post-cursor
reply.

Every distinct, fully correlated assistant reply receives a contiguous `replyIndex` and
MiniMax evaluation. The shared bound is five replies per turn and catalog preflight
requires no more than five expected replies. An additional correlated reply within that
bound is a behavioral count failure, not transport ambiguity. A duplicate transport
event is idempotently ignored; a contradictory/unbound reply or a sixth reply exceeds
the safety bound and stops the run.

Each scenario starts a new session. Later turns must retain the exact session ID. The
evaluator rejects:

- an extra or missing session;
- an assistant reply from another scenario;
- a session label mismatch;
- a tool event belonging to another run, scenario, or turn;
- a missing, duplicate, or contradictory link in the transport correlation chain;
- out-of-order, replayed, or overlapping capabilities.

## Identifier and Visibility Contract

| Identifier | Owner/source | Purpose | Public/report visibility |
| --- | --- | --- | --- |
| `runId` (`eval-<uuid>`) | Evaluator | Canonical run, UI selection, and artifact directory name | Safe and visible |
| `scenarioId` / scenario number | Tracked catalog | Stable scenario correlation and label | Safe and visible |
| Matrix idempotency key / event ID | Evaluator / Matrix | Send deduplication and transport proof | Private; report booleans/counts only |
| WhatsApp/Meta message and delivery IDs | WhatsApp service | Ingress/egress idempotency and proof | Private; report booleans/counts only |
| Capability / capability digest | Evaluator / WhatsApp service | One-turn authorization / repository lookup | Raw only in transport chat/raw webhook; digest private |
| Lease fence | WhatsApp service | Reject stale owners and workers | Private |
| `ingestReceiptId` | WhatsApp service | Outbox and attestation idempotency | Private |
| Intex message ID / `sessionId` | Intex Agent | Exact message, session, retention, and ownership binding | Private; safe digest only |
| `turnIndex` / `replyIndex` | Catalog / evaluator | Ordered behavioral and semantic evidence | Safe and visible |

There is no separate evaluation-run identifier: report paths, Test Runs, control APIs,
and manifests use the same `runId`. Each service stores only the raw identifiers it owns
or receives through an authenticated contract; safe projections contain no accidental
aliases.

## Failure Policy

Safety and infrastructure failures stop the complete run immediately. These include
authorization, runtime audience, account mapping, lease/fence, capability, attestation,
outbox, replay, correlation, immutable-profile or mock-profile corruption, a tool name
outside the closed catalog, production-executor admission, Matrix or WhatsApp transport,
timeout, and evaluator infrastructure failures.

A behavioral failure does not stop the run. Wrong response semantics, wrong expected
tool, a known but unexpected/forbidden/extra tool selection, missing expected tool, or
lifecycle mismatch marks that scenario failed and the runner continues so the final
artifact covers all 20 scenarios.

Every terminal failure enters fenced quiescence, revokes unconsumed capabilities, and
drains or abandons already consumed work without releasing the lease early. No failure
path retries a user message automatically or switches to production execution.

## Retention and Cleanup

The authenticated user may retain the current acceptance, the latest delivery-ready
successful run, and the latest failed acceptance. “Current acceptance” means either a
nonterminal lifecycle or a terminal lifecycle whose artifact delivery is still
`pending`/`staged`; it occupies the current public slot until delivery becomes
`ready`/`failed`/`unknown`. Artifact delivery `failed`/`unknown` occupies the failed slot
regardless of agent verdict. Retention deletion never runs after the current run's
terminal acknowledgement. Instead, the next invocation acquires its non-authorizing
provisioning fence, computes superseded runs only from already terminal prior records,
and completes ownership-guarded exact-ID cleanup before activation. Cleanup failure
abandons provisioning with zero capabilities/messages and exit `2`. Until another
invocation, at most one superseded record may remain stored but is omitted by the bounded
two-run public query.

Terminalization and retention deletion are separate operations. After all evidence is
collected and no more agent/tool work is possible, the evaluator proves quiescence/drain,
finalizes private context, and CASes the safe run to `finalizing` with one immutable
private terminal candidate. WhatsApp release then delivers the durable signed terminal
event; Intex applies the candidate, and only its acknowledgement releases the lease. If
quiescence, finalization, the `finalizing` CAS, release delivery, or acknowledgement
fails, no `completed` projection is published and the nonterminal lease remains fenced
until retry or abandoned-run recovery. Context finalization does not delete test
sessions, events, confirmations, run manifests, or safe Test Runs projections. The full
exact-run cleanup below is used only during a later provisioning phase for a terminal run
explicitly evicted by the retention policy.

Intex Agent atomically appends each created session ID and scenario ID to its owned run
manifest. Before deletion, the collection owner rereads every session and requires the
same `kind`, `runtimeAudience`, `runId`, `scenarioId`, `userId`, and recorded session ID.
It then deletes that session's owned events, test confirmations, evaluator projections,
and any partially created test artifacts. A missing or mismatched ownership guard stops
cleanup; it never broadens the query.

WhatsApp service cleans its owned capabilities, ingest outbox records, and expired lease
through an authenticated exact-run operation. A current lease holder may request cleanup
of an older terminal run by presenting its current caller fence plus the old `runId` and
old record fence stored in the retention manifest. The old fence is an ownership guard,
never authority to initiate work; stale workers remain rejected. Normal signed raw
webhooks follow their existing retention and are not selected by corpus cleanup.
Cleanup never selects by `userId` alone, never deletes ordinary sessions or
confirmations, never performs
cross-service Firestore access, and never uses the existing synthetic-user cleanup
script against the operator account.

## Safe Evidence Contract

Tool evidence uses a per-tool allowlist. Allowed values are the tool-name enum, bounded
turn/ordinal/count/length/version numbers, known mode/status/worker enums, and booleans
such as `hasUrl`, `hasCalendarId`, or `hasLinearIssueId`. Dates become presence or valid
range facts; URLs, IDs, names, titles, prompts, descriptions, messages, preference text,
attendees, locations, and query text are never projected. Mock results expose only
bounded status/count/version values and presence booleans.

Scenario labels come from the tracked catalog and have a fixed maximum length. Evidence
decoders reject unknown keys, overlong strings, raw upstream failure messages, raw
arguments/results, message previews, capabilities, access tokens, emails, phone numbers,
Matrix/WhatsApp identifiers, user IDs, and resource URLs. Logs apply the same contract,
including issuance, consumption, replay/reject, outbox, signature, executor, cleanup,
and error paths. Tests capture logs from every path and assert that neither the natural
prompt nor the capability appears.

## Endpoint Changes and Data Ownership

### Created

| Owner | Method and path | Purpose | Idempotency/guard |
| --- | --- | --- | --- |
| WhatsApp service | `POST /internal/matrix-corpus/runs` | Acquire a non-authorizing provisioning lease and immutable transport binding | Required request idempotency key; configured evaluator user; no live lease or Intex current acceptance, including terminal artifact `pending`/`staged` |
| WhatsApp service | `POST /internal/matrix-corpus/runs/:runId/activate` | Activate capability authority after exact Intex provisioning is ready | Current fence; Intex control-status proves context/manifest/preflight projection plus retention reconciliation; exact idempotent replay |
| WhatsApp service | `POST /internal/matrix-corpus/runs/:runId/lease/renew` | Renew the current lease | Current caller fence |
| WhatsApp service | `POST /internal/matrix-corpus/runs/:runId/capabilities` | Validate and register exactly the next evaluator-generated write-only start/turn/confirmation capability | Current fence plus scenario/turn/idempotency key and caller-held raw capability; response never echoes raw value or digest |
| WhatsApp service | `GET /internal/matrix-corpus/runs/:runId/transport-status` | Return safe correlation plus lease-phase/drain status | Current fence; bounded scenario/turn query |
| WhatsApp service | `POST /internal/matrix-corpus/runs/:runId/quiesce` | Retain the lease while blocking new work, revoking unconsumed capabilities, and draining consumed work | Current fence; exact idempotent replay |
| WhatsApp service | `POST /internal/matrix-corpus/runs/:runId/release` | Move a quiesced/drained lease to release-pending and enqueue the signed terminal event | Current fence plus matching Intex `finalizing` candidate/tombstone status |
| WhatsApp service | `POST /internal/matrix-corpus/runs/:runId/cleanup` | Delete owned exact-run records | Current caller fence plus target run's manifest fence |
| Intex Agent | `POST /internal/matrix-corpus/runs/:runId/context` | Verify the signed lease and freeze the private prompt/model/time-zone run context | Current lease attestation; configured evaluator user; byte-identical idempotent replay only |
| Intex Agent | `POST /internal/matrix-corpus/runs/:runId/context/finalize` | Transactionally delete private scenario ciphertext and replace encrypted run context with a finalization tombstone while preserving retained evidence | Current run/fence; exact idempotent replay; signed abandoned-run handler uses its verified old fence |
| Intex Agent | `GET /internal/matrix-corpus/runs/:runId/control-status` | Return closed lease-correlated run phase plus tombstone/candidate digests to WhatsApp service | Exact run/user/fence; no public/private content |
| Intex Agent | `POST /internal/matrix-corpus/runs/:runId/terminal-control` | Consume signed terminal-request/abandoned outbox events and apply the stored terminal candidate or stopped recovery | Signed event, exact fence/digests, idempotent event ID |
| Intex Agent | `PUT /internal/test-runs/:runId/projection` | Create/update the safe run projection by CAS | `expectedRevision`, current fence, immutable owner/model/catalog fields; `running -> finalizing` requires matching tombstone and terminal candidate |
| Intex Agent | `GET /internal/matrix-corpus/runs/:runId/scenarios/:scenarioId/evidence` | Return safe session/tool/usage evidence to the evaluator | Exact run/scenario/fence binding and bounded revision cursor |
| Intex Agent | `POST /internal/matrix-corpus/runs/:runId/cleanup` | Retention-only ownership-check and deletion of an evicted run's exact sessions/events/confirmations/projections | Current caller fence plus terminal target manifest and record fence |

WhatsApp service owns `matrix_corpus_run_leases`, `matrix_corpus_capabilities`,
`matrix_corpus_ingest_outbox`, `matrix_corpus_terminal_control_outbox`, and
`matrix_corpus_transport_receipts`. Intex Agent owns `intex_agent_test_runs`,
`intex_agent_test_run_scenarios`, its ingest-receipt replay ledger, existing session/event
data, test confirmations, immutable profiles, run manifests,
`intex_agent_matrix_corpus_run_contexts`, and
`intex_agent_matrix_corpus_scenario_contexts`. New collections are declared
in `firestore-collections.json` with exactly one owner; no other service reads them
directly.

Every private route requires `X-Internal-Auth`, calls `logIncomingRequest()` with body
preview disabled for authority-bearing requests, uses strict request and response schemas,
checks the current fence, and is absent when the Home Dev feature flag is off. No endpoint
accepts an arbitrary user ID without matching the locally configured evaluator identity
and bound transport account. Provision returns its opaque lease fence only to the
authenticated evaluator with `Cache-Control: no-store`; subsequent authority inputs are
sensitive and redacted. Route responses otherwise follow the safe evidence contract and
never return capability records, raw capability material, binding values, or raw content.

Mutations return success for an exact idempotent replay, `409` for CAS/fence/order
conflicts, and a closed `410` for expired capability/lease state. Authentication and
runtime failures use the existing static `401`/`403`/`404` conventions without an
account-existence signal; invalid closed schemas use the existing `400` contract.

### Configuration and wiring

Both services add a fail-closed `matrixCorpus.enabled` setting whose deployed value is
true only on Home Dev, plus runtime audience `home-dev`. WhatsApp service receives the
dev-only attestation signing-key reference and configured evaluator identity/transport
binding; Intex Agent receives the verification-key reference and the
`INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY` Secret Manager reference. Values, user
IDs, room/account identifiers, and keys remain in protected Home Dev configuration,
while schemas and empty/example variable names are wired through each service's
`config.ts`, deployment configuration, startup validation, and config tests. Production
startup rejects enablement even if a flag is accidentally supplied.

### Modified

- `POST /internal/whatsapp/pubsub/process-webhook` and
  `POST /internal/whatsapp/webhooks/retry-pending` use the same reserved-header parser,
  capability consumption, durable outbox, and confirmation conversion path.
- `POST /internal/intex-agent/messages` retains its existing ordinary-direct/PubSub-
  wrapper top-level shape. Its bounded inner Pub/Sub decoder recognizes the signed
  Matrix-corpus variant, requires the Pub/Sub marker plus valid internal auth plus JWS,
  loads the exact private run/scenario context, and dispatches to the isolated session
  lane. Direct signed bodies are rejected; ordinary events retain their existing decoder,
  status, response, and behavior.
- Intex Agent's session repository operations add exact test-lane/profile/context guards;
  the companion UX specification defines the public session-route projections.

### Removed

- None.

### Unchanged

The existing authenticated test-conversation endpoint and endpoint-runner lane remain
available and unchanged. `POST /webhooks` keeps signed raw Meta payload persistence and
its existing acknowledgement/retry contract; reserved evaluation processing starts only
in the owned async processing routes above. The existing private Matrix outbound route
and third-party bridge remain the real transport. Ordinary public WhatsApp, confirmation,
and UI routes remain compatible, and no existing public route can issue capabilities or
activate mocks. Public owner-only Test Runs and legacy-session API behavior are specified
in the companion UX document.

## Required Tests

Implementation starts with RED tests for:

- issuance, atomic single-use consumption, Home Dev audience, signature, and attestation;
- wrong user, transport binding, lease fence, digest, environment, phase, session, turn,
  expiry, and replay;
- transactional outbox crash/retry behavior at every consume/publish boundary;
- header stripping before message persistence, link-preview publish, and LLM input;
- isolated ordinary/test session and confirmation lanes under interleaved messages;
- confirmation-argument AEAD round-trip, complete identity binding, tamper rejection, and
  zero plaintext leakage in Firestore;
- immutable session profile creation, continuation, and repository write guards;
- private run-context registration, AEAD/TTL/fence guards, immutable
  prompt-preference/time-zone snapshots, and idempotent scenario-local preference
  overlays;
- mandatory DeepSeek V4 Flash snapshots for every endpoint/Matrix evaluation agent call
  and MiniMax M3-only semantic evaluation;
- context-only terminal finalization preserving retained sessions/projections, abandoned
  finalization, tombstone/idempotent replay, `finalizing` candidate precondition, and
  separation from retention-only full cleanup;
- per-call agent usage/cost correlation and rejection of missing, duplicate, or
  user-wide accounting;
- zero provider calls and zero usage records for accepted/rejected confirmation controls;
- strict executor selection for both normal and confirmed paths;
- all 11 mock methods and absence of production client construction;
- strict call ordinals, repeated calls, malformed/missing expected mocks as safety failures,
  and known unexpected selections as behavioral failures, always without fallback;
- selection versus mock-execution evidence;
- confirmation conversion, stale confirmation, and rejection;
- fenced single-run lease acquisition, renewal, quiesce/drain, release-pending outbox,
  signed terminal acknowledgement, abandoned recovery from every nonterminal phase,
  atomic `pending -> failed`/`staged -> unknown` artifact terminalization, opposing
  terminal-event race, duplicate/lost responses, takeover, stale worker, no early lease
  release, and no recovered/deadline-expired orphan remaining `pending`/`staged`;
- acquisition rejection while an earlier Intex current acceptance is nonterminal or is
  terminal with artifact delivery `pending`/`staged`;
- every provisioning crash boundary from lease-only through context/manifest/projection
  readiness, safe no-op or exact provisional rollback, activation idempotency, and zero
  capability/session/message authority before active;
- complete Matrix/WhatsApp/Intex correlation, ordering, idempotency, timeout, and extra
  reply/session contamination;
- bounded distinct extra replies as behavior versus duplicate/unbound/overflow replies
  as transport safety failures;
- safety-stop versus behavioral-continue policy;
- one canonical scenario with 20 turns, confirmations, and repeated tool selections;
- safe-evidence schema and captured-log leakage checks on every success/error path;
- ownership-guarded exact-ID retention cleanup that preserves every ordinary user record;
- lease-expiry orphan reconciliation, terminal artifact status, and stale-fence cleanup
  authorization;
- Home Dev-only endpoint/config wiring, identifier mapping, and zero cross-owner reads.

Contract tests cover Pub/Sub schema evolution and backward compatibility. Integration
tests use real service composition with fake Matrix, Firestore, Pub/Sub, LLM, and
downstream clients whose calls must remain zero. Live acceptance is defined in the
companion acceptance specification.

## Acceptance

This design is implemented only when a 20-scenario Matrix corpus can prove all of the
following simultaneously:

- real Matrix and WhatsApp messages are visible;
- the LLM receives only natural scenario content;
- each scenario has one labelled session;
- the existing ordinary session lane remains unchanged and usable during the run;
- the 20-turn scenario completes without a five-turn compatibility limit;
- every endpoint and Matrix-corpus agent call uses DeepSeek V4 Flash;
- deterministic tool evidence matches the catalog;
- every tool result comes from the strict mock executor;
- production downstream calls remain impossible and observed count is zero;
- MiniMax M3 evaluates every available assistant reply;
- the safe report and authenticated UI contain no private or technical secret data.
