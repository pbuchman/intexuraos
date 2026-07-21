# Intex Agent Matrix Corpus Live Acceptance Design

**Date:** 2026-07-19
**Status:** Written review pending; design direction approved by the user on 2026-07-19
**Companion specifications:**

- [`2026-07-19-intex-agent-matrix-corpus-design.md`](./2026-07-19-intex-agent-matrix-corpus-design.md)
- [`2026-07-19-intex-agent-test-runs-ux-design.md`](./2026-07-19-intex-agent-test-runs-ux-design.md)

## Purpose

Define the single repeatable live-acceptance workflow for the Intex Agent corpus on
Home Dev. The workflow sends every tracked scenario through the real Matrix and
WhatsApp transport, runs every agent call on DeepSeek V4 Flash, executes every product
tool through the strict mock boundary, evaluates deterministic behavior and response
semantics with MiniMax M3, and leaves privacy-safe evidence that can be reviewed in the
authenticated product UI.

This specification is the operator contract for the instruction “odpal testy”. It is
not a second execution architecture. Capability authorization, strict mock selection,
session metadata, confirmation conversion, and exact-ID cleanup follow the core Matrix
corpus design.

## Success Criterion

One invocation of:

```bash
scripts/run-intex-agent-evals-home-dev.sh matrix-corpus
```

must execute the canonical 20 scenarios, currently 59 catalog turns, sequentially on
the configured existing operator account and produce all of the following:

1. twenty separately labelled Intex Agent test sessions;
2. every scenario turn and assistant reply observable through Matrix and WhatsApp;
3. automatic handling of catalog confirmation turns through the canonical
   confirmation path;
4. deterministic tool and lifecycle evidence for every scenario;
5. MiniMax M3 evaluation for every correlated assistant reply, including an unexpected
   extra reply that will also fail deterministic checks, with no eligible reply silently
   ignored;
6. live proof that all tool execution used strict mocks and that production tool
   executor admission remained zero;
7. an authenticated `Test Runs` view that presents the same run without credentials,
   private identifiers, or raw technical payloads while still showing the owner's
   natural conversation messages;
8. privacy-safe `report.json` and `report.md` artifacts on Home Dev;
9. exit `0` only when all 20 scenarios pass every required check.

## Command Semantics

### Canonical command

`matrix-corpus` is the only canonical full live-acceptance command after this design is
implemented. It performs its own read-only preflight, acquires one run lease, executes
the Matrix corpus exactly once, evaluates it, applies exact-ID retention, and writes
the safe report.

The following natural-language instruction has one unambiguous operational meaning:

> “Odpal testy” means run
> `scripts/run-intex-agent-evals-home-dev.sh matrix-corpus` exactly once.

It does not mean `endpoint`, `full`, `matrix-smoke`, or a sequence combining those
commands. The command is live, sends real Matrix/WhatsApp messages, and incurs agent
and MiniMax provider cost, so it still requires explicit authorization such as “odpal
testy”. Once that authorization is present, the operator does not ask for an additional
confirmation before execution.

### Endpoint lane remains available

`scripts/run-intex-agent-evals-home-dev.sh endpoint` remains a focused diagnostic lane.
It uses synthetic endpoint conversations and mocked tools, sends no Matrix/WhatsApp
messages, runs every agent call on DeepSeek V4 Flash, and writes its own report. It is
useful for isolating agent behavior from transport, but it is not a substitute for
`matrix-corpus` acceptance and is not run silently before it.

`scenario intex-eval-NNN` remains the targeted endpoint diagnostic. A future targeted
live-Matrix scenario command may be designed separately; this specification does not
make the existing `scenario` selector live.

### Legacy `full` remains explicit

The existing `full` selector retains its current legacy meaning until a separate,
reviewed migration deliberately removes or renames it:

- run the endpoint corpus;
- only after an endpoint pass, send one safe `matrix-smoke` message;
- never run the 20-scenario Matrix corpus.

`full` is no longer described as final acceptance. An explicit instruction “odpal
legacy full” or the exact shell command may invoke it; the generic phrase “odpal testy”
must never select it. Keeping this behavior stable avoids silently changing an existing
live command while removing the ambiguity from normal operation.

`matrix-smoke` remains a one-message transport diagnostic and continues to report that
hidden tool audit is unavailable for that legacy smoke. It is not run before or after a
successful `matrix-corpus` unless explicitly requested as a separate diagnostic.

## Fixed Environment and Account Boundary

The canonical workflow runs only:

- on the Linux host addressed by SSH alias `home-dev`;
- from `$HOME/deploy/intexuraos`;
- against `https://dev.intexuraos.cloud` and Home Dev host-local services;
- with the machine-local configuration under
  `~/.config/intexuraos/intex-agent-evals.json`;
- for the exact canonical user mapped from that protected configuration;
- through the exact Matrix source account and `intex_agent` target room validated by
  the Matrix adapter;
- with the WhatsApp sender mapped back to the same canonical user.

The repository contains only aliases, schema, commands, and safe expected model IDs.
It never contains the operator email address, Firebase UID, phone number, Matrix user
ID, room ID, access token, WhatsApp identifier, password, or protected absolute path.
The report may include the configured safe `accountAlias`; it may not include any of
the underlying identifiers.

Every accepted endpoint and live run uses the existing configured account and mandatory
agent model `or:deepseek/deepseek-v4-flash`. The product selector still supports all
three Intex Agent models, but evaluation runs reject another effective model and record
one immutable DeepSeek snapshot.

## Preflight Contract

`matrix-corpus` performs all preflight checks before issuing a message capability,
creating a run session, sending a Matrix event, or calling an LLM. A failed check exits
`2`, sends zero messages, and reports a closed safe failure code.

Preflight is entirely read-only: it calls no mutating service port and creates no lease,
context, projection, outbox, receipt, capability, probe, artifact directory, Firestore or
Pub/Sub write, or filesystem mutation—including temporary create/delete probes.

Before run creation there is intentionally no artifact directory. Stdout remains empty
and stderr contains exactly `preflight result FAIL <CLOSED_CODE>` followed by the
wrapper's existing framed terminal result; neither line contains identifiers. After run
activation, failures additionally attempt the staged/final safe report described below.
A provisioning rollback before activation may deliberately leave no run projection or
artifact and reports only its closed safe failure code.

### Revision and runtime

Preflight proves:

- the workstation implementation paths guarded by the wrapper are clean;
- the wrapper records a 40-character `requestedRevision` equal to the reviewed merged
  `development` SHA and Home Dev reports a 40-character `deployedRevision`;
- `deployedRevision` equals `requestedRevision` exactly; ancestor-only proof is not
  sufficient, and a newer deployment requires a new review/check decision before the
  run;
- the same implementation-critical paths are clean in the Home Dev checkout, with no
  tracked or untracked override of deployed code;
- the remote repository, `direnv`, Node runtime, and required service configuration are
  available;
- the runtime audience is exactly `home-dev`, the corpus enable flag and dev-only
  attestation verification key are present, and local macOS/other dev/prod runtimes are
  rejected;
- Intex Agent, WhatsApp service, Matrix adapter, and the authenticated web backend are
  healthy on their configured Home Dev boundaries;
- the existing ignored artifact root has the required owner, mode, mount, and free-capacity
  metadata for later mode-`0700` run directories and mode-`0600` files; this readiness
  check uses only stat/access-style reads and creates or deletes nothing;
- clocks used for capability expiry are within the accepted skew bound.

The wrapper does not deploy, pull, copy files, bypass revision proof, or restart a
service. Deployment must already contain the reviewed revision and the report records
both revision fields even though they must match.

### User and transport

Preflight proves without printing identifiers:

- the protected config is owned by the current UID, is not a symlink, and has the
  required exact permissions;
- the configured canonical user exists and is enabled;
- the safe account alias resolves to exactly one canonical user;
- the configured Matrix access token is valid for the configured Matrix user;
- Matrix sync reaches exactly one non-limited target room selected from the adapter's
  current `sourceAccountId`;
- the Matrix user may send to that room and may observe the WhatsApp puppet;
- the Matrix source account, WhatsApp sender mapping, and canonical IntexuraOS user form
  one exact account tuple;
- the Intex-owned prompt-preference repository and User Service runtime contract can
  resolve the user's effective preference version/content, model, and time zone without
  fallback; the later leased run-context registration will freeze that state and return
  only version/digest/time zone to the evaluator;
- the user's time zone matches the baseline catalog's `Europe/Warsaw` contract;
- the WhatsApp bridge is connected and can provide correlated ingress and egress
  evidence;
- no second active Matrix-corpus lease or Intex current acceptance exists for the same
  canonical user; this includes a terminal run whose artifact delivery is still
  `pending`/`staged`.

Preflight is read-only with respect to chat. It must not send a probe message. Bridge
readiness is established from authenticated health, room membership, sync, and account
mapping contracts.

### Capability and safety boundary

Preflight proves:

- the dev-only capability issuer is enabled only in the Home Dev/dev runtime;
- the caller has internal authorization to issue capabilities, inspect safe status,
  quiesce/drain work, and request release;
- capability storage can atomically consume together with a durable, idempotent ingest
  outbox intent and can safely resume the same transport-message retry after a crash;
- WhatsApp service can sign and Intex Agent can verify the exact Home Dev ingest
  attestation without direct cross-service Firestore reads;
- the run lease and capability repository agree on the canonical user and environment;
- provisioning lease activation requires exact Intex context/manifest/preflight
  projection readiness, and lease-only/partial provisioning abandonment is recoverable
  without a capability, session, or message;
- no unexpired capability exists outside an active exact run;
- an existing ordinary active session and confirmation lane are not selected,
  superseded, closed, or mutated by test-session creation;
- strict mock execution implements all 11 canonical product tools;
- every tracked scenario has a closed mock profile for every turn;
- no scenario relies on the permissive endpoint mock default;
- both ordinary continuation and confirmed continuation resolve the strict executor
  from immutable test-session metadata;
- the Intex-owned private run-context endpoint, encryption key, AEAD implementation, and
  separate context-finalization and retention-cleanup paths pass a non-authorizing
  readiness check; no context or scenario overlay is created before the lease is acquired;
- the evaluation branch has no reachable production product-tool executor.

A capability health check uses only dedicated read-only health/status operations. It
creates no lease, context, projection, outbox, receipt, capability, or probe record and
  performs no Firestore, Pub/Sub, or filesystem mutation, including temporary
  create/delete probes.

### Catalog and models

Preflight loads the tracked catalog once and validates:

- exactly 20 unique canonical scenarios;
- currently exactly 59 ordered turns in total;
- one scenario identifier, safe title, time zone, fixed scenario time, expected session
  transition, expected timeline, expected tool assertions, mock behavior, and semantic
  criteria for every turn;
- confirmation turns reference an earlier pending confirmation in the same scenario;
- the catalog digest and per-scenario digests are stable for the complete run;
- every scenario fits the supported limit of up to 20 turns;
- no prompt, reply, capability, credential, or real identifier is projected into safe
  report metadata.

The user-selected Intex Agent model must resolve to exactly one supported ID:

- `or:deepseek/deepseek-v4-flash`;
- `or:minimax/minimax-m3`;
- `or:google/gemini-3-flash-preview`.

The semantic evaluator must resolve to exactly
`or:minimax/minimax-m3`. There is no Sonnet evaluator and no fallback judge. A missing
provider key, unsupported model, mismatch between the backend setting and resolved
model, or unavailable provider boundary is infrastructure failure. The selected agent
model and evaluator model are snapshotted before the first scenario and cannot change
mid-run.

Preflight also proves that classifier, agent generation/tool calling, and schema repair
propagate run/scenario/session/turn/stage/call-ordinal usage correlation and
provider-reported cost. Accepted and rejected confirmation controls must invoke no LLM
and emit no agent-usage record; any provider call or usage record for the confirmation
phase is a safety failure. No run cost may be derived from user-wide usage.

Every automated endpoint and Matrix-corpus evaluation requires the agent snapshot to
equal `or:deepseek/deepseek-v4-flash`. DeepSeek is also the declared product default;
this evaluation invariant is not a runtime provider fallback.

## Run Lifecycle

### Run creation and lease

After preflight, the evaluator creates one opaque `runId`, atomically acquires a single
non-authorizing `provisioning` lease for the configured user, and registers that signed
lease with Intex Agent's private run-context endpoint. Intex Agent freezes the catalog,
model, prompt-preference, and time-zone context, creates the exact run manifest plus safe
`preflight` projection, and returns only its safe version/digest metadata. The evaluator
then performs any required exact-ID cleanup of already superseded prior terminal runs and
calls `activate`; WhatsApp verifies cleanup completion plus all exact Intex provisioning
records through the control-status contract before changing the lease to `active`. Only
that state may issue the first capability. The lease prevents overlapping corpus runs
and is renewed only while the owner process remains healthy.

The run starts with 20 planned scenarios and 59 planned turns. It exposes only safe
progress in the authenticated `Test Runs` UI. A stale lease may be recovered only after
its bounded expiry and exact owner verification; recovery never reuses an old run ID or
capability.

On runner death, the WhatsApp-owned lease sweeper revokes capabilities/outbox work and
durably emits the signed abandoned-run control event. Intex Agent transitions a
`running` or `finalizing` run to `stopped/not_evaluated` only after its fenced recovery
transaction has deleted private scenario ciphertext and replaced the encrypted run
context with the durable finalization tombstone. It preserves retained run/session
projections and never rewrites an already terminal run. In the same transaction it moves
a `pending` report to `failed/REPORT_STAGING_INTERRUPTED` or a `staged` report to
`unknown/REPORT_DELIVERY_STATUS_TIMEOUT`; an already terminal delivery value is
preserved. The handler acknowledgement terminalizes the abandoned lease record, and the
UI therefore cannot poll a terminal orphan forever. The next invocation must verify that
reconciliation before acquiring a new run.

If the runner dies before activation, the same signed abandoned event is a safe no-op
when no Intex record exists, or ownership-checks and removes only the exact partial
context/manifest/preflight projection when a strict subset exists. Provisioning can never
contain a capability, session, or message; evidence to the contrary is corruption and
blocks automatic cleanup. Every lease-only/context/manifest/projection/activation-response
crash boundary is idempotently recoverable.

On every normal terminal result, the evaluator stops all agent/tool work and assembles
the terminal candidate in memory. It then quiesces the lease, waits for `drained=true`,
stages and validates the safe artifact candidates, finalizes the exact private context,
verifies the durable tombstone, and CASes the safe projection from `running` to
`finalizing` with verdict `pending`; the private candidate binds the staged artifact
digest. The evaluator requests release only from that state. WhatsApp moves the lease
to `release_pending` and durably delivers the signed terminal event. Intex applies the
candidate to `completed/passed`, `completed/failed`, or `stopped/not_evaluated`; only its
acknowledgement marks the lease released. The evaluator waits for both terminal
projection and released lease before returning.

If quiescence, drain, context finalization, the `finalizing` CAS, release delivery, or
terminal acknowledgement fails, no completed projection is published and the lease is
not released early. Bounded expiry plus the abandoned-run handler transitions any
remaining `running`/`finalizing` projection to `stopped/not_evaluated`. A second run is
rejected while either the lease/Intex lifecycle remains nonterminal or a terminal Intex
run still has artifact delivery `pending`/`staged`.

### Sequential execution

Concurrency is exactly one at all levels:

- one active scenario;
- one active user turn;
- one outstanding capability;
- one bounded correlated assistant-reply set;
- one MiniMax evaluation request or bounded schema-repair request.

Scenarios execute in canonical catalog order from `intex-eval-001` through
`intex-eval-020`. Each scenario starts one new session. Later turns bind to that exact
test-lane session and cannot create or continue another session. Test sessions never
change the user's ordinary active-session pointer; ordinary messages and confirmations
ignore the test lane, while test continuation uses only run, scenario, and exact session
binding.

For the first turn, the evaluator:

1. captures the Matrix cursor;
2. issues a one-use start capability bound to run, user, scenario, turn, prompt digest,
   strict mock profile, model snapshot, and expiry;
3. sends the approved visible header plus `new session:` and the natural scenario text
   with a unique idempotency key;
4. waits for exact WhatsApp ingress, header stripping, session creation, the complete
   bounded assistant-reply set, its `turn_processing_completed` marker, and every
   corresponding WhatsApp delivery/Matrix mirror receipt;
5. verifies that the LLM and persisted Intex event received only the natural content;
6. collects safe deterministic, transport, and tool-selection evidence;
7. evaluates every correlated assistant reply with MiniMax M3 and separately checks the
   catalog-declared reply count.

Subsequent natural-message turns repeat the same flow with a turn capability bound to
the existing exact session. The visible header identifies `Scenario NNN/020` and the
step number, while the LLM sees neither the header nor capability.

### Confirmation turns

Catalog `confirmation_button` turns are automatic. The evaluator waits for the exact
pending confirmation identifier, issues a confirmation capability bound to that
identifier and expected accept/reject decision, and sends the approved visible Matrix
confirmation message.

WhatsApp service validates the capability and converts the message server-side into
the canonical button-response shape. The confirmation text is visible in Matrix and
WhatsApp but is not interpreted by the LLM. Accepted confirmations call
`executeConfirmed()` with the session's strict mock executor; rejected confirmations
follow the ordinary rejection path and execute no tool.

Both decisions make zero provider calls and produce zero agent-usage records. The
accepted path may update the encrypted scenario-only preference overlay when the strict
mock is a preference mutation; rejection leaves the overlay unchanged. An LLM call,
usage record, real-preference read/write, or overlay mutation after rejection is a safety
failure.

A missing, stale, duplicated, wrong-decision, out-of-order, or cross-session
confirmation is a safety failure. The runner never falls back to a natural-language
confirmation prompt or production executor.

### Correlation

Each turn must correlate all of the following to the same run, scenario, turn, and
session before advancing:

- one consumed capability;
- one Matrix outbound event acknowledgement;
- one WhatsApp ingress record after canonical user mapping;
- for a `message` turn, one natural Intex `user_message`; for a `confirmation_button`
  turn, one canonical button-response/`confirmation_resolved` event and no natural LLM
  user message;
- the catalog-expected session transition;
- zero or more expected tool-selection/mock-execution events;
- the expected assistant reply set;
- one `turn_processing_completed` marker whose reply count/digests match that set;
- WhatsApp outbound delivery evidence for each reply;
- one Matrix puppet mirror for each reply;
- deterministic and MiniMax results.

Distinct replies that carry the complete run/scenario/turn/session chain receive
contiguous `replyIndex` values and are all judged, up to the shared maximum of five per
turn. An extra correlated reply within that bound is a behavioral reply-count failure.
A replayed transport event is idempotently ignored; an unbound/contradictory reply or a
sixth reply is a safety failure.

Raw Matrix event IDs, WhatsApp message IDs, session IDs, phone identifiers, and message
bodies remain in their owning private stores. The evaluator stores exact identifiers in
its private run-owned correlation and cleanup registry but projects only counts,
closed statuses, safe scenario IDs, and digests into reports.

Ambiguous send state is not retried. The evaluator may query status by the original
idempotency key, but it must not resend the message. Matrix sync polling and read-only
status polling are allowed while waiting; they do not create a second user turn.

## Failure Policy

### Safety and infrastructure failures stop the run

The evaluator enters quiescence, revokes unconsumed capabilities, and drains already
consumed work without releasing the lease. It marks the active scenario incomplete,
marks later scenarios `not_run`, assembles the safest stopped candidate, finalizes private
context after drain, and CASes to `finalizing` only after the tombstone exists. The signed
terminal-request event applies `stopped/not_evaluated`; only its acknowledgement releases the
lease. If any phase cannot complete, the lease stays fenced until the abandoned-run
handler performs the same stopped recovery. The partial safe report records the last
closed phase, and the runner exits `2` for any of these classes:

If artifact staging/validation itself fails, the evaluator records the closed delivery
failure but cannot satisfy the staged-artifact gate. It therefore never enters
`finalizing` or requests release; lease expiry and the abandoned handler apply the
stopped recovery. No invalid report is published.

- authorization, environment, account mapping, revision, or model mismatch;
- run-lease fence, capability, signed attestation, transactional outbox, replay, expiry,
  phase, prompt, user, session, or turn mismatch;
- malformed strict-mock profile, a catalog-expected call lacking its configured mock
  result, an unknown tool name, profile-digest mismatch, or any production executor
  admission;
- extra/missing session, cross-run evidence, unbound/contradictory reply, reply-bound
  overflow, or correlation failure;
- Matrix sync limitation, send ambiguity, bridge disconnect, WhatsApp delivery
  failure, timeout, or duplicate transport evidence;
- MiniMax credential, timeout, provider, protocol, or usage-accounting failure;
- private-data projection, pre-finalizing report staging/validation, or pre-finalizing
  exact-ID retention failure;
- any unexpected exception.

There is no fallback model, fallback evaluator, fallback transport, fallback mock, or
fallback production execution.

### Post-terminal artifact delivery failures preserve run outcome

After the signed terminal acknowledgement, lifecycle and verdict are immutable. A known
final report validation/publication failure writes `artifactDelivery=failed` with its
closed code; loss of the evaluator before that update becomes `unknown` through the
deadline sweeper. Either condition exits `2` and fails live acceptance, but does not
mislabel passed/failed agent behavior as `stopped`. Retention and UI treat failed/unknown
delivery as the latest failed acceptance dimension. Exact-ID retention work required by
the invocation must therefore complete before `finalizing`; no destructive cleanup is
deferred beyond terminal acknowledgement.

### Behavioral failures continue

The evaluator marks only the affected scenario failed and continues to the next
scenario when correlation and safety remain intact but behavior violates the catalog:

- response semantics fail MiniMax criteria;
- a distinct, fully correlated extra reply occurs within the five-reply safety bound;
- an expected tool is missing;
- a known tool is selected at an unexpected/forbidden turn or with an extra ordinal; it
  is recorded but neither mock nor production execution occurs;
- an expected tool count, turn, sanitized argument fact, lifecycle event, session
  status, or transition is wrong;
- a required reply is semantically wrong while transport remains complete.

The scenario is never rerun in the same invocation. A behavioral failure does not
resend a turn, restart a scenario, change the model, or ask MiniMax for a different
verdict. A bounded MiniMax schema-repair call for an invalid first response is part of
the existing judge protocol and is recorded as repair usage; it is not a scenario
retry. Provider/protocol failure after the allowed repair is infrastructure failure.

If all 20 scenarios complete and at least one has a behavioral failure, the run exits
`1`. If a later safety or infrastructure failure occurs after earlier behavioral
failures, the final exit remains `2`.

## Exit Codes

| Exit | Required meaning | Corpus state |
| --- | --- | --- |
| `0` | Complete pass | All 20 scenarios and all 59 planned turns completed; deterministic, MiniMax, transport, strict-mock, privacy, cleanup, released lease, and artifact-delivery checks passed. |
| `1` | Complete behavioral result | All 20 scenarios completed safely; at least one deterministic or semantic behavioral assertion failed; artifact delivery is ready and no infrastructure/safety failure occurred. |
| `2` | Infrastructure or safety failure | Preflight failed; the run stopped at a preterminal boundary with later scenarios `not_run`; or a terminal run preserved its outcome but artifact delivery is failed/unknown. |

No other normal process exit code may cross the wrapper. Catchable `HUP`, `INT`, and
`TERM`, SSH failure, and malformed remote framing are normalized to exit `2` with a safe
wrapper code. `SIGKILL` and complete host loss cannot return an exit code; the backend
lease sweeper marks the orphan stopped, and the next preflight must reconcile that
exit-2 evidence before acquiring another run.

## Zero Real Downstream Call Proof

Passing acceptance requires both structural and live evidence. A claim based only on
the mock return value is insufficient.

### Structural proof

Automated tests instantiate the real application composition for Matrix-corpus
sessions with throwing sentinels for every production Notes, Calendar, Research,
Bookmarks, Code, External Save, and preference client. They exercise:

- every one of the 11 tool methods;
- normal session execution;
- accepted and rejected confirmation continuation;
- configured mock failures;
- malformed/missing expected mock configuration and known forbidden selections;
- multi-turn session continuation;
- cleanup and error paths.

Every sentinel invocation count must remain zero. The strict executor branch must not
construct, receive, or resolve a production product-tool executor. Tests also prove
that ordinary non-test sessions still resolve the existing production executor.

### Live proof

The live run records a closed safe proof projection for every test session:

- immutable execution mode equals `strict_mock_tools`;
- executor source equals the strict Matrix-corpus mock implementation;
- every selected expected tool has a matching mock completion/failure event;
- production product-tool executor resolution count equals zero;
- production product-tool admission count equals zero;
- no tool event exists without the same run/scenario/turn/session binding;
- the strict mock profile digest equals the immutable per-scenario mock-profile digest
  computed during preflight, while the complete catalog digest is verified separately.

Any nonzero production resolution/admission count or missing proof field stops the run
with exit `2`. The report contains counts and proof-version/digest fields only, never
raw arguments, results, client URLs, tokens, or production data.

## Safe Report Contract

Before entering `finalizing`, the evaluator renders and schema-validates private staged
JSON/Markdown candidates in the run directory. Their immutable evidence body contains no
guessed terminal state; a reserved closed envelope remains pending. The SHA-256 digests
of the validated safe candidates are recorded through the artifact-delivery contract and
stored separately in the private manifest. The terminal candidate binds the SHA-256
digest of their canonical ordered digest pair. Staged files are mode `0600`, are never
printed as a report, and cannot satisfy acceptance.

After signed terminal acknowledgement and lease release, the evaluator fills only the
reserved lifecycle/verdict/control/exit fields from authoritative safe status, validates
the complete JSON, derives Markdown from that JSON, and atomically renames both final
files. It then marks artifact delivery `ready`. Validation or publication failure marks
delivery `failed` with a closed code and exits `2` without rewriting the terminal run
outcome. If the process dies before the update, the Intex delivery-deadline sweeper marks
delivery `unknown/REPORT_DELIVERY_STATUS_TIMEOUT` rather than guessing whether the rename
succeeded. Test Runs therefore shows **Run passed · Report failed** or **Run passed ·
Report status unknown**, rather than contradicting the backend verdict.

Every `matrix-corpus` invocation that reaches activation attempts to atomically write:

```text
$HOME/deploy/intexuraos/.artifacts/intex-agent-evals/<runId>/report.json
$HOME/deploy/intexuraos/.artifacts/intex-agent-evals/<runId>/report.md
```

The run directory is mode `0700`; both final files are mode `0600`. Only after artifact
delivery is `ready` does the wrapper print:

```text
evaluation report .artifacts/intex-agent-evals/<runId>
```

For failed/unknown delivery it prints no report-path line and returns only the existing
safe framed failure code on stderr. It never copies the report to the workstation. Report schemas are strict, versioned,
reject unknown fields, and contain only the following safe projections.

### Run identity and configuration

- canonical safe `runId` in format `eval-<uuid>`, command `matrix-corpus`, schema
  version, requested revision, and deployed revision;
- safe account alias and environment alias `home-dev`/`dev`;
- catalog digest, planned scenario count, and planned turn count;
- immutable agent model ID and evaluator model ID;
- execution mode `real_matrix_whatsapp_strict_mock_tools`;
- started/completed timestamps and duration;
- terminal lifecycle (`completed` or `stopped`), verdict, control-plane
  acknowledgement/release status, and `runOutcomeCode`. The latter describes the
  immutable run outcome before artifact delivery; it is not the final wrapper exit, which
  can still become `2` if publication or delivery confirmation fails.

### Preflight and totals

- closed pass/fail status for revision, services, user existence, account tuple,
  Matrix, WhatsApp, capability, catalog, models, run lease, and artifact checks;
- scenarios planned/executed/passed/failed/not-run;
- turns planned/sent/correlated/completed;
- sessions expected/created/continued/closed;
- confirmations requested/accepted/rejected/completed;
- assistant replies expected/observed/judged;
- tool selections/mock completions/mock failures;
- production executor resolutions/admissions, both required to equal zero;
- elapsed time and aggregate safe provider usage/cost.

Agent and evaluator costs use non-negative integer nano-USD. Missing one component keeps
the total unavailable and prevents exit `0`; missing cost is never rendered as zero.

### Per-scenario evidence

- scenario ID, ordinal, safe title, catalog digest, lifecycle status, and verdict;
- planned/completed turn counts and a safe session-reference digest;
- Matrix send, WhatsApp ingress/egress, assistant reply, and Matrix mirror counts;
- expected/selected/completed tool names, counts, turn indexes, statuses, and only the
  catalog-approved sanitized argument/result facts;
- deterministic assertion totals and closed failure codes;
- MiniMax pass/score/criteria values without rationale;
- MiniMax logical calls, repair count, input/output/total tokens, provider-reported
  nano-USD, and whether cost accounting is complete;
- every actual agent LLM call's closed classifier/generation/repair stage and call
  ordinal, input/output/total tokens, and provider-reported nano-USD, correlated only to
  this run/scenario/turn; confirmation controls have no usage row;
- strict-mock proof version/status and zero production-admission counts.

### Cleanup and failures

- private context-finalization status and bounded run/scenario ciphertext deletion
  counts, with retained session/projection counts required to remain unchanged;
- closed quiesce/drain, finalizing-candidate, release-pending event, terminal
  acknowledgement, and lease-release statuses;
- exact-run retention status and counts of exact run/session/capability/artifact records
  considered, retained, removed, missing, and failed;
- only closed safe failure stage/code/scenario/turn/reply projections;
- no raw exception, provider body, HTTP body, prompt, reply, rationale, tool argument,
  tool result, identifier, credential, path, or message content.

`report.md` is a rendering of the validated JSON projection, not an independent source
of evidence. It may not introduce fields or prose derived from raw data.

## Retention and Exact-ID Cleanup

The evaluator maintains a private run-owned correlation registry, Intex Agent
atomically records every created test session in its owned run manifest, and WhatsApp
service owns capability/outbox/lease records. Cleanup is requested through each
collection owner's authenticated exact-run/fence endpoint; the evaluator never deletes
another service's Firestore data directly.

Context finalization is not retention cleanup. Every terminal candidate first reaches
quiesced/drained transport, then invokes the Intex-owned exact-run context-finalization
path, enters `finalizing`, and completes through the release outbox/acknowledgement saga.
Context finalization removes only encrypted private run/scenario content and preserves
all retained Test Runs/session evidence. Full Intex session/event/projection cleanup is
permitted only during a later non-authorizing provisioning phase for a terminal run
selected for retention eviction below.

Retention keeps:

- the current acceptance while its lifecycle is nonterminal or its terminal lifecycle
  still has artifact delivery `pending`/`staged`;
- the latest artifact-ready successful completed Matrix-corpus run;
- the current failed acceptance, or latest failed acceptance when no run is active;
  stopped, behavioral failure, and artifact failed/unknown all qualify.

After acquiring the next invocation's `provisioning` fence and before activation, the
evaluator may remove only already superseded prior terminal runs by exact `runId` and
recorded exact session/capability IDs. It never deletes retention records after the
current invocation's terminal acknowledgement. Cleanup failure abandons provisioning,
sends zero messages, and exits `2`; until the next invocation, one superseded stored run
may remain hidden beyond the bounded two-run public view. An infrastructure-stopped or
artifact-failed/unknown run becomes the latest failed acceptance and remains available
for safe review.

Before deleting a session and its owned events/confirmations/projections, Intex Agent
rereads it and requires matching test kind, runtime audience, run, scenario, user, and
session ID. WhatsApp service likewise requires the matching run and current/terminal
fence for its records. Any ownership mismatch stops cleanup without broadening a query.

Cleanup must never:

- query or delete by `userId` alone;
- call the synthetic-user cleanup against the operator account;
- infer sessions from timestamps, summary text, labels, or message bodies;
- delete an ordinary session;
- delete a run or session absent from the exact private registry;
- expose exact IDs in terminal output or reports.

Expired capability records are removed by exact digest and run binding after bounded
retention. Raw Matrix/WhatsApp chat history is not broadly deleted by this workflow;
the visible synthetic messages remain available to the operator subject to the
transport's own retention. The evaluator reports only cleanup of records it owns and
can identify exactly.

Any missing registry entry, identifier mismatch, attempted broad selector, partial
cleanup, or inability to prove preservation of ordinary sessions is infrastructure
failure. Cleanup failure cannot be downgraded to a behavioral result.

## Automated Matrix and WhatsApp Verification

The runner verifies transport without relying on the operator watching the phone:

1. every outbound user turn receives one Matrix acknowledgement for its idempotency
   key;
2. WhatsApp service records exactly one mapped ingress for the same capability/run
   binding;
3. the first turn creates one test-labelled session and later turns keep its exact ID;
4. every assistant response obtains WhatsApp outbound/delivery evidence;
5. every expected response appears once as a WhatsApp puppet event after the captured
   Matrix cursor;
6. event ordering matches the scenario and no eligible event belongs to another run;
7. the final transport totals reconcile with the deterministic session timeline.

The user may simultaneously observe the messages on the phone, but human observation
is corroboration, not a prerequisite for automated PASS. Missing machine-verifiable
WhatsApp evidence is exit `2`, even if a message appears visually.

## Authenticated UI and Chrome Acceptance

After the command completes, the same run is inspected at
`https://dev.intexuraos.cloud` using the existing authenticated operator account. The
browser uses an existing logged-in session when available. If login is required, it
uses credentials from the protected machine-local login store and never prints, saves,
or commits them. Captcha, MFA, expired credentials, or account lock is reported as the
exact required user intervention and blocks browser acceptance.

### Desktop audit

At a standard desktop viewport, automated Chrome inspection verifies:

- the normal Sessions tab remains the default;
- `Test Runs` is a separate tab and lists the exact run ID;
- the run header shows progress/result, real Matrix transport, mocked tools, agent
  model, MiniMax M3 evaluator, duration, usage, and provider-reported cost;
- the rail contains exactly 20 scenario rows in canonical order;
- each row uses the authoritative `Scenario NNN — title` label and distinct
  `TEST`, `MATRIX`, and `MOCKED` badges;
- lifecycle state and evaluation verdict are visually distinct;
- each scenario opens the correct natural timeline, confirmation events, tool-selected
  and mock-executed evidence, deterministic card, and MiniMax card;
- no capability, raw tool payload, provider body, private identifier, technical stack,
  unsafe fallback title, or structured internal object is rendered;
- the completed successful run, retained-run switching, reload, and safe report-linked
  state remain understandable;
- page reload preserves the selected run and does not mix ordinary sessions into the
  test view;
- console, failed network requests, route errors, and horizontal overflow are absent.

Loading, active polling, empty, behavioral-failure, infrastructure-stopped, stale, and
report-unavailable states are covered by deterministic web component/integration tests;
one exit-0 live run is not misrepresented as visual proof of mutually exclusive states.

### Mobile audit

At a representative phone viewport, automated Chrome inspection repeats the privacy
and data assertions and verifies:

- tabs, run header, filters, scenario rail/drawer, timeline, and evaluation cards remain
  reachable without horizontal page overflow;
- the current scenario and verdict remain identifiable;
- long safe labels wrap or truncate intentionally;
- touch targets, focus order, keyboard navigation, and accessible names remain usable;
- no desktop-only interaction is required to inspect all 20 scenarios.

### Settings audit

The same authenticated account's LLM settings verify the Intex Agent model control has
the same save/reload/error UX and client-contract path as the user's general default
model control. It must expose exactly:

- DeepSeek V4 Flash — `or:deepseek/deepseek-v4-flash`;
- MiniMax M3 — `or:minimax/minimax-m3`;
- Gemini 3 Flash Preview — `or:google/gemini-3-flash-preview`.

For acceptance, DeepSeek V4 Flash is selected or resolved by the declared absent-value
default, survives a reload, and matches the immutable run/report snapshot. MiniMax M3 is
shown separately as the fixed evaluator. The UI contains no test-mode toggle, capability
input, or way for an ordinary user to activate strict mocks.

Browser automation records only pass/fail assertions, safe counts, route, viewport,
and run ID in the final handoff. Screenshots or DOM dumps containing conversation text,
identifiers, or credentials are not committed or attached as public evidence.

## Deferred “Perfect Later” Improvements — Not in This Delivery

The following improvements remain explicitly documented but do not block or expand the
approved first delivery:

1. **Dedicated integration account and WhatsApp identity.** Introduce a separately
   registered test user, dedicated WhatsApp number, dedicated Matrix source account,
   and isolated target room. The current phase deliberately uses the existing Home Dev
   operator account selected by machine-local configuration.
2. **Portable multi-machine setup.** Add secure provisioning and discovery so the same
   evaluator can be moved between authorized machines. The current phase is fixed to
   Home Dev, its SSH alias, deployed checkout, service ports, and protected local
   configuration.
3. **Hidden bridge metadata.** Extend the Matrix/WhatsApp bridge with an authenticated
   hidden metadata channel so test authorization no longer needs to be visible in the
   one-use capability header. The current visible capability remains short-lived,
   single-use, bound to the exact run/user/scenario/turn/prompt/session, stripped before
   natural-message persistence and LLM input, and unavailable to reports or UI. As
   documented by the core design, it may remain only in the signed raw Meta webhook
   persisted before canonical user mapping, where consumption/expiry makes it
   non-authorizing.
4. **Automatic debug-session regression conversion.** Extend the existing session-debug
   skill so a debug request automatically captures a safe “what happened” versus “what
   should have happened” comparison, proposes a tracked regression scenario, validates
   it, adds it through the reviewed catalog pipeline, and links the resulting evidence.
   The current delivery executes the already tracked canonical corpus; it does not
   automate creation or promotion of a new scenario from a debugged user session.
5. **Corpus expansion.** Add new reviewed scenarios, larger catalog manifests, targeted
   live scenario selection, and promotion/versioning policy after the 20-scenario,
   59-turn baseline is stable. The current cardinality is an intentional acceptance
   contract, not a permanent upper limit on future quality coverage.

None of these items permits storing account-specific data in the repository. Both the
current existing account and any future dedicated account keep email, canonical user
ID, phone number, Matrix identity/room, access token, password, and credentials only in
protected machine-local configuration. Repository files and reports contain only a safe
alias and privacy-safe counts/digests.

## Endpoint Changes

This live-acceptance companion introduces no acceptance-only product endpoint.

### Created

- None by this companion. Capability issuance/consumption and authenticated Test Runs
  APIs are defined by the core and UX designs and are consumed here as reviewed
  dependencies.

### Modified

- None beyond the contracts required by the companion core and UX designs.

### Removed

- None.

### Unchanged

- The existing internal endpoint conversation API remains available to `endpoint` and
  targeted endpoint diagnostics.
- The real Matrix outbound and WhatsApp bridge remain the transport path; the
  evaluator does not introduce a bypass transport.
- Production user endpoints never accept a prompt or setting that enables test mode.

## Implementation and Release Verification Sequence

Implementation follows test-driven development and sub-agent-driven review. The
required order is:

1. write RED unit and contract tests for command parsing, preflight, catalog validation,
   sequencing, capabilities, strict mocks, confirmations, correlation, failures,
   reporting, and exact-ID cleanup;
2. confirm the tests fail for the intended missing behavior;
3. implement the smallest vertical slices until those tests pass;
4. add integration tests using real application composition with fake Matrix,
   WhatsApp, Firestore, Pub/Sub, LLM, MiniMax, and throwing production clients;
5. add browser component/integration coverage for Test Runs and model settings;
6. obtain independent code, security/privacy, test-completeness, and UX review;
7. resolve every actionable review finding and rerun focused tests;
8. run the required workspace verification and complete `pnpm run ci:tracked`;
9. open a reviewed PR against `development`, allow required GitHub checks to pass, and
   merge only after approval;
10. wait for Home Dev auto-deployment and prove the merged revision is deployed and all
    required services are healthy;
11. verify the operator's effective Intex model is DeepSeek V4 Flash for every evaluation;
12. after the user's explicit “odpal testy”, run the canonical `matrix-corpus` command
    exactly once;
13. inspect its safe report and authenticated Test Runs UI;
14. perform desktop, mobile, and settings Chrome audits on the same run and account;
15. review the final artifacts for completeness, privacy, and consistency before
    reporting acceptance.

The implementation PR may not be accepted from unit tests alone. The first complete
live run, browser audit, and Matrix/WhatsApp evidence occur only after the reviewed
revision is deployed to Home Dev.

## Required Automated Tests

At minimum, the implementation starts with tests for:

- `matrix-corpus` wrapper/CLI parsing and rejection of extra arguments;
- generic “odpal testy” runbook mapping and unchanged legacy `full` semantics;
- preflight zero-message guarantee and every closed failure boundary;
- exact requested/deployed revision equality and clean remote implementation paths;
- exact configured user/Matrix/WhatsApp tuple and duplicate/missing mappings;
- catalog cardinality of 20, current total of 59 turns, max 20 turns per scenario, and
  stable digests;
- exact supported agent model list, immutable snapshot, MiniMax-only judge, and no
  fallback;
- private run-context registration, encryption/TTL/fence checks, immutable
  prompt-preference/time-zone snapshot, idempotent scenario overlays, and run-only
  per-stage agent usage/cost reconciliation;
- context-only normal/abandoned finalization preserving retained sessions/projections,
  durable tombstone, immutable finalizing candidate, exact idempotency, and
  retention-only full-cleanup separation;
- provisioning lease non-authority, exact activation readiness, and crash recovery at
  lease-only/context/manifest/projection/activation-response boundaries;
- quiesce/drain without early release, release-pending durable outbox, signed terminal
  acknowledgement, failure/retry at every saga boundary, and abandoned recovery from
  `running`, `finalizing`, and `release_pending`, including atomic
  `pending -> failed`/`staged -> unknown` artifact terminalization;
- accepted/rejected confirmation controls making zero LLM calls and emitting zero
  agent-usage records;
- one active lease, concurrency one, canonical ordering, one session per scenario, and
  exact continuation;
- rejection of a second run during a prior nonterminal lifecycle or terminal
  artifact-delivery `pending`/`staged` window;
- lease-expiry orphan reconciliation, UI terminalization, and stale-fence rejection;
- one-use capability issue/consume/quiesce, expiry, replay, wrong
  user/session/turn/prompt, and zero-send failure behavior;
- signed Home Dev attestation plus transactional outbox crash/retry idempotency at every
  consume-to-publish boundary;
- test/ordinary session and confirmation lane isolation with interleaved account traffic;
- visible header presence in transport and absence from persisted/LLM natural content;
- all 11 strict mock tools, confirmation continuation, and throwing production-client
  sentinels with zero calls;
- known unexpected/forbidden selections as no-execution behavioral failures versus
  malformed/missing expected mock configuration as an immediate safety stop;
- transport idempotency, ambiguous sends, no resend, reply correlation, duplicate/extra
  events, sync limitation, timeout, and bridge disconnect;
- five-reply bound with correlated extras as behavior and unbound/overflow replies as
  safety failures;
- behavioral-continue through scenario 020 and safety/infra immediate stop;
- no scenario retry after behavioral failure;
- exit `0`, `1`, and `2` precedence and wrapper propagation;
- MiniMax evaluation and usage/cost aggregation for every correlated reply plus exact
  deterministic reconciliation with the declared reply count;
- strict report schemas, atomic mode-`0600` publication, Markdown parity, and privacy
  rejection tests seeded with every forbidden data class;
- pre-finalizing staged candidate/digest binding, staged-artifact gate, post-terminal
  ready/failed updates, terminal-staged list visibility, crash-after-rename unknown
  timeout, abandoned-before-staging failure, separate UI outcome, and exit `2` without
  terminal lifecycle/verdict rewrite or confusing `runOutcomeCode` with final wrapper
  exit;
- exact-ID retention preserving ordinary sessions and rejecting broad user selectors;
- desktop/mobile Test Runs rendering and exact model settings contract.

## Final Acceptance Checklist

The project goal is complete only when one fresh deployed run proves:

- [ ] canonical command is `scripts/run-intex-agent-evals-home-dev.sh matrix-corpus`;
- [ ] command reports the reviewed deployed SHA and Home Dev/dev environment;
- [ ] safe account alias maps to one existing user and one Matrix/WhatsApp account tuple;
- [ ] agent model is `or:deepseek/deepseek-v4-flash` for every endpoint and Matrix-corpus
      evaluation call;
- [ ] evaluator model is exactly `or:minimax/minimax-m3`;
- [ ] prompt-preference version/digest and Europe/Warsaw time zone are immutable for the
      run without exposing preference content;
- [ ] catalog contains 20 scenarios and 59 planned turns;
- [ ] all 20 scenarios execute sequentially and create exactly 20 labelled sessions;
- [ ] the user's pre-existing ordinary session lane remains unchanged and usable;
- [ ] all catalog turns, confirmation decisions, and assistant replies are observable
      through Matrix and WhatsApp with complete correlation;
- [ ] every deterministic and MiniMax result is present;
- [ ] per-stage agent and per-reply evaluator usage/cost reconcile only to this run;
- [ ] all tool evidence is strict-mock evidence and production resolution/admission
      counts are zero;
- [ ] quiesce/drain, context tombstone, finalizing candidate, signed terminal
      acknowledgement, and released lease all reconcile for the same fence;
- [ ] artifact delivery is `ready`; failed/unknown delivery is a distinct exit-`2`
      acceptance failure without rewriting run outcome;
- [ ] no safety or infrastructure failure occurred;
- [ ] exit is `0` and totals reconcile across report, transport, session timeline, and UI;
- [ ] exact-ID retention preserves ordinary account data;
- [ ] desktop, mobile, and settings Chrome audits pass on the same authenticated account;
- [ ] full repository CI and required GitHub checks pass for the deployed revision;
- [ ] final artifact review finds no raw data, credentials, capabilities, identifiers,
      technical payloads, or contradictory status.

## Final Evidence Handoff

For a complete accepted run, the final handoff contains only:

- the reviewed implementation SHA and merged PR URL;
- required CI/check status;
- safe `runId`, exit code, and scenario/turn/reply/tool/confirmation totals;
- agent model, MiniMax evaluator model, duration, and provider-reported safe cost totals;
- relative Home Dev artifact directory
  `.artifacts/intex-agent-evals/<runId>` containing `report.json` and `report.md`;
- authenticated Test Runs route for the same safe run ID;
- desktop/mobile/settings audit results and any closed safe failure codes;
- confirmation that Matrix/WhatsApp messages remain visible to the operator.

For artifact delivery `failed` or `unknown`, the exit-`2` handoff omits the artifact
directory and reports only the safe delivery status/code plus Test Runs route; it never
claims a report exists.

It never contains report copies, raw prompts or replies, screenshots with conversation
content, Matrix or WhatsApp history, tool arguments/results, MiniMax rationale, Firebase
or session identifiers, email/phone values, protected paths, tokens, passwords, or
provider/internal error bodies.
