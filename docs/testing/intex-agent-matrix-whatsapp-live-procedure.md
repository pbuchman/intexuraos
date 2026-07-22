# Intex Agent Matrix/WhatsApp Live Test Execution Procedure

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to
> execute this procedure sequentially. Do not delegate live execution and never start a
> second run until the prior run has reached a terminal state and its failure is corrected.

**Goal:** Execute one complete 20-scenario Intex Agent acceptance run through the real
Matrix-to-WhatsApp path, make every user turn and assistant reply visible in the
operator's WhatsApp conversation, prove that product tools were replaced by strict
mocks, evaluate every correlated reply, and verify the same run in the authenticated
production UI.

**Architecture:** The runner and protected Matrix credentials stay on Home Dev, while the
system under test is exclusively `https://intexuraos.cloud` on Hetzner. Matrix is the only
injection and observation transport for the 59 agent turns. The production WhatsApp
bridge mirrors those user-authored Matrix events into the operator's Intex Agent WhatsApp
conversation and mirrors production assistant replies back to Matrix. Google OIDC opens
only the corpus control endpoints. Durable production evidence, not visual observation
alone, binds each event to its run, scenario, turn, and isolated session.

**Tech Stack:** Home Dev runner, Hetzner production, Google OIDC, Matrix Client-Server
API, WhatsApp bridge, Intex Agent, DeepSeek V4 Flash, MiniMax M3, strict tool mocks,
Firestore-backed production Test Runs, authenticated production web UI.

## Global constraints

- Do not run this procedure while preparing or reviewing it.
- The instruction `odpal testy` authorizes exactly one invocation of
  `scripts/run-intex-agent-evals-prod.sh matrix-corpus`.
- Do not prepend `preflight`, `endpoint`, `scenario`, `matrix-smoke`, or `full`.
- Never retry an ambiguously sent turn. Under an active end-to-end goal, a terminal failed
  run is diagnosed, corrected, reviewed, deployed, and then replaced by one fresh run.
- All 59 agent turns use the real Matrix/WhatsApp transport.
- The agent model is exactly `or:deepseek/deepseek-v4-flash`.
- The semantic evaluator is exactly `or:minimax/minimax-m3`.
- Sonnet and model fallbacks are forbidden.
- Product tools must never be constructed, admitted, or executed by this run.
- All tool outcomes come from the signed per-scenario strict-mock profile.
- The 20 scenarios run sequentially with concurrency one.
- Every scenario owns a distinct isolated test session; later turns address that exact
  session.
- The protected Home Dev configuration is authoritative for the existing operator
  account. Never ask the user for the Firebase UID, Matrix user, room, token, phone
  number, or WhatsApp binding when the configuration is valid.
- The tracked repository must not contain the operator's email address, UID, Matrix
  identifiers, room, phone number, access token, password, or protected absolute paths.
- No final completion message is sent unless the corpus exits `0`, artifacts are ready,
  and browser acceptance passes for the same run.

## Account and environment contract

The human account selected for this procedure is the existing operator account already
bound to the protected Home Dev evaluator configuration. The human-readable email is not
stored in Git. The canonical UID and Matrix details are read from:

```text
~/.config/intexuraos/intex-agent-evals.json
```

The configuration must remain a current-UID-owned regular file with mode `0600` inside
a current-UID-owned directory with mode `0700`. Its Matrix token and targets references
must remain absolute, non-symlink regular files with mode `0600`.

Preparation performed on 2026-07-22 established all of the following without sending a
message or invoking an LLM:

- the protected directory exists with mode `0700`;
- the evaluator configuration exists with mode `0600`;
- schema version, UID, Matrix user, token-file path, and targets-file path are present;
- the referenced token and targets files exist with mode `0600`;
- the safe machine-local account alias is configured.

A read-only authenticated browser check established that the active Auth0 session shows
the expected operator email. Final acceptance reads the protected production 20-scenario
Test Runs projection.
That projection is returned only when the authenticated Auth0 subject exactly equals the
configured evaluator UID, so this proves the browser account and protected evaluator
configuration refer to the same operator without printing either identifier. Firebase
email lookup is not an identity proof for this flow: Firebase is entered with a custom
token keyed by the Auth0 subject, and its user record may legitimately have no email.
The Firebase part of preflight therefore verifies only that the configured canonical UID
exists and is enabled.

Therefore normal execution must not invoke interactive `setup` and must not ask the user
for identity data. If the embedded preflight later reports a closed configuration or
identity error, stop and report that code. Do not guess values, replace the configured
account, or run `setup` without separate authorization.

The fixed execution environment is:

| Boundary | Required value |
| --- | --- |
| Runner host | SSH alias `home-dev` |
| Runner repository | `$HOME/deploy/intexuraos` |
| System under test | `https://intexuraos.cloud` on Hetzner |
| Runtime audience | `hetzner-prod` |
| Intex control plane | `/internal/evals/intex-agent/matrix-corpus/*` with Google OIDC |
| WhatsApp control plane | `/internal/evals/whatsapp/matrix-corpus/*` with Google OIDC |
| Matrix adapter | Home Dev `127.0.0.1:8099` |
| Time zone | `Europe/Warsaw` |

## What the operator sees on WhatsApp

Every catalog turn creates one user-authored message in the existing WhatsApp
conversation with Intex Agent. Every expected assistant reply appears in the same
conversation. The complete passing run therefore produces 59 visible test messages and
59 expected assistant replies, in scenario order, for 118 conversation bubbles.

The first turn of every scenario is visibly labelled:

```text
new session: 🧪 Scenario 001/020 · Matrix corpus · tools mocked · [one-use marker]

[natural scenario message]
```

Continuation turns are visibly labelled:

```text
🧪 Scenario 003/020 · step 2/3 · [one-use marker]

[natural scenario message]
```

Confirmation turns are visibly labelled and use natural Polish text:

```text
🧪 Scenario 003/020 · confirmation · [one-use marker]

Potwierdzam.
```

`[one-use marker]` above is a redacted representation of the capability printed in the
live message. The WhatsApp Service validates the complete header and removes the corpus
metadata and capability before the natural request enters the LLM. On the first turn it
preserves only the ordinary `new session:` instruction plus the natural body. The agent
therefore receives no scenario number, corpus label, mock label, or capability and must
not ask what those fields mean.

The phone is a live human-visible copy of the transport, not the authority for PASS. A
message that appears on the phone still needs durable Matrix, WhatsApp, session, reply,
and strict-mock evidence before the turn passes.

## Canonical scenario flow

The complete natural input bodies, turn order, confirmation decisions, deterministic
assertions, and semantic criteria are versioned in
`tools/intex-agent-evals/scenarios/intex-eval-001.scenario.json` through
`tools/intex-agent-evals/scenarios/intex-eval-020.scenario.json`. The runner loads those
tracked files directly; the procedure does not maintain a second editable copy of the
messages.

| No. | Scenario | Turns | Visible confirmations | Strict-mock execution |
| ---: | --- | ---: | ---: | --- |
| 001 | Create a note in one message | 2 | 1 accept | `create_note` once |
| 002 | Create a calendar event in one message | 2 | 1 accept | `create_calendar_event` once |
| 003 | Clarify a missing calendar date | 3 | 1 accept | `create_calendar_event` once |
| 004 | Supersede a pending clarification | 3 | 1 accept | `create_note` once |
| 005 | Reject an unsupported ride booking | 1 | 0 | none |
| 006 | Continue after a completed note | 4 | 2 accept | `create_note` twice |
| 007 | Resolve an ambiguous note-like request | 2 | 1 accept | `create_note` once |
| 008 | Clarify a missing calendar time | 3 | 1 accept | `create_calendar_event` once |
| 009 | Start an idle new session | 1 | 0 | none |
| 010 | Handle a voice transcript as a note | 2 | 1 accept | `create_note` once |
| 011 | Query calendar events | 1 | 0 | `query_calendar_events` once |
| 012 | Create a research draft | 2 | 1 accept | `create_research` once |
| 013 | Save a bare URL as a link | 2 | 1 accept | `create_link` once |
| 014 | Create a planning code task | 2 | 1 accept | `create_code_task` once |
| 015 | Save content externally | 2 | 1 accept | `save_external` once |
| 016 | Read saved preferences | 1 | 0 | `get_user_preferences` once |
| 017 | Add a user preference | 2 | 1 accept | `add_user_preference` once |
| 018 | Update a user preference | 2 | 1 accept | `update_user_preference` once |
| 019 | Delete a user preference | 2 | 1 accept | `delete_user_preference` once |
| 020 | Retain context for exactly twenty turns | 20 | 1 accept | `create_note` once |

Corpus totals are fixed at 20 scenarios, 59 turns, 17 confirmation decisions, 59
expected replies, and 19 scheduled strict-mock tool executions. Scenario 020 alone must
show 20 consecutive test messages and 20 assistant replies while retaining its isolated
session context.

## Execution procedure after explicit authorization

### 1. Interpret authorization exactly

The exact user instruction `odpal testy` means one live run. It does not authorize a
diagnostic run before the corpus. An already-active “iterate until PASS” goal authorizes
the full correction/deployment/new-run loop without another intermediate confirmation.

### 2. Start exactly one wrapper process

From the reviewed local repository root, execute once:

```bash
scripts/run-intex-agent-evals-prod.sh matrix-corpus
```

The wrapper must prove that the local requested revision equals both the Home Dev runner
revision and the Hetzner production `deployment.json` revision. It must not pull, deploy,
copy files, switch revisions, or restart services.

### 3. Let the embedded preflight decide admission

Do not run a separate preflight command. Before any write, message, or LLM call, the
embedded preflight verifies:

- the reviewed revision, Home Dev runner, and Hetzner production deployment are identical;
- guarded implementation paths are clean;
- the runtime audience is exactly `hetzner-prod` and production corpus execution is enabled;
- Intex Agent, WhatsApp Service, Matrix adapter, and web backend are healthy;
- the protected evaluator configuration and referenced files are valid;
- the configured Firebase user exists and is enabled;
- the configured Matrix token, user, source account, target room, and puppet agree;
- the WhatsApp sender maps to the same canonical IntexuraOS user;
- the user's effective Intex Agent model is DeepSeek V4 Flash;
- the evaluator is MiniMax M3;
- the time zone is `Europe/Warsaw`;
- all required Firestore indexes are ready;
- no conflicting active corpus lease exists;
- the artifact root, cleanup boundary, clock skew, and provider catalog are ready.

A failed preflight exits `2` with zero Matrix messages, zero WhatsApp messages, zero LLM
calls, and zero run artifacts. Stop and report the closed code.

### 4. Provision one isolated run

After preflight passes, the runner acquires one fenced lease, snapshots the exact catalog,
models, time zone, and prompt preferences, creates the safe Test Run projection, performs
exact-ID retention, and activates the run. Provisioning authority cannot send messages;
only an active lease can issue the first one-use turn capability.

### 5. Execute every turn through Matrix

For each scenario from 001 through 020, and for each turn in catalog order, the runner:

1. captures the Matrix room cursor before sending;
2. reads the exact current scenario/session state when continuing;
3. issues a one-use capability bound to run, user, room, scenario, turn, prompt, expected
   session, confirmation decision, mock profile, and lease fence;
4. builds the visible numbered message;
5. sends it as a user-authored Matrix event to the `intex_agent` room;
6. proves the exact Matrix event ID, sender, room, and message text;
7. waits for the WhatsApp ingress to consume the same capability and bind the scenario;
8. waits for the exact Intex Agent turn terminal marker;
9. collects every correlated assistant reply from the expected WhatsApp puppet in Matrix;
10. refuses to resend when delivery is ambiguous.

All agent input messages therefore originate in Matrix. The procedure never calls the
ordinary test-conversation endpoint as a substitute and never injects a scenario directly
into Intex Agent.

### 6. Preserve one session per scenario

The first visible message of each scenario requests a new session. The control plane
records one distinct session binding for that scenario. Every later numbered step and
confirmation must continue the exact same binding. A repeated session across two
scenarios or a changed session inside one scenario is a safety failure and stops the run.

### 7. Keep tools mocked while preserving natural UX

The agent sees normal tool definitions and may select a tool naturally. The immutable
test-session profile routes that selection only to the strict mock executor. The
operator sees the natural request, confirmation request, confirmation response, and
assistant completion message on WhatsApp, but no real note, calendar event, research,
bookmark, code task, external save, or preference change is created.

For each scheduled tool turn, automated evidence must contain both:

- `tool_selected` for the expected tool and ordinal;
- `mock_completed` for that same tool and ordinal.

Production executor construction, resolution, admission, and calls must remain zero.
Known unexpected tools produce behavioral failure with no execution. Rejecting a
confirmation executes neither a mock nor a production tool.

### 8. Evaluate every completed turn

Deterministic evaluation verifies the reply count, session transition, lifecycle,
confirmation, expected tool selection, strict-mock outcome, and allowlisted argument
facts. Every correlated assistant reply is then evaluated once by MiniMax M3 against the
tracked semantic criteria. An unexpected extra reply is also evaluated and fails the
deterministic count check; no eligible reply is silently ignored.

Confirmation control messages themselves make zero agent LLM calls and zero LLM usage
records. Normal assistant replies use DeepSeek V4 Flash. MiniMax may perform at most the
single bounded schema-repair call defined by the evaluator contract; it cannot repeat a
verdict request using another model.

### 9. Continue scenarios safely and iterate terminal failures

- A behavioral failure marks the scenario failed but continues through scenario 020 so
  the full corpus remains observable on WhatsApp.
- An infrastructure or safety failure stops the current run immediately, then enters the
  autonomous diagnosis/fix/review/PR/merge/deployment/new-run loop.
- An ambiguous Matrix send is never repeated.
- A fresh run starts only after the failed boundary has been corrected and the exact new
  revision is deployed to production.

### 10. Finalize durable evidence and artifacts

After the last executable turn, the runner quiesces and drains the lease, stages the
safe reports, deletes encrypted private run/scenario context, writes the durable
finalization tombstone, publishes the final Test Run projection, releases the lease, and
waits for terminal acknowledgement.

The ignored Home Dev artifact directory is:

```text
$HOME/deploy/intexuraos/.artifacts/intex-agent-evals/<eval-run-id>/
```

It contains mode-`0600` `report.json` and `report.md` in a mode-`0700` directory. The
terminal prints only the safe relative report path and aggregate evidence.

## Automated PASS contract

Exit `0` is valid only if all of the following reconcile for the same run:

- 20 scenarios planned, started, completed, and passed;
- 20 distinct scenario session-binding digests;
- 59 Matrix sends;
- 59 WhatsApp ingresses;
- 59 completed turns;
- 59 expected, observed, correlated, and MiniMax-judged assistant replies;
- 59 WhatsApp egress replies and 59 Matrix reply mirrors;
- 17 confirmation decisions completed;
- the exact 19-row tool schedule selected and completed through strict mocks;
- zero unexpected known-tool executions;
- zero production tool executor admissions and calls;
- every deterministic check passed;
- every MiniMax verdict passed;
- all DeepSeek and MiniMax token/cost totals reconcile with provider-reported usage;
- artifact delivery is `ready`;
- context finalization, terminal acknowledgement, lease release, and exact cleanup passed.

`sessionsClosed` remains `0` because safe evidence does not currently expose that field;
it must not be inferred or used as a substitute for exact session-binding proof.

## WhatsApp live-observation checklist

During the run, the operator may watch the existing Intex Agent conversation on the
phone. No input from the operator is required. The visible acceptance checklist is:

- scenario starts appear in ascending order from `001/020` to `020/020`;
- each scenario start contains `new session:` and `tools mocked`;
- continuation messages show `step X/Y` for the same scenario number;
- confirmation replies appear as `Potwierdzam.` in the expected scenarios;
- assistant replies follow the corresponding test message without another scenario
  interleaving;
- the agent never asks what the scenario number, corpus label, or marker means;
- scenario 020 visibly reaches step `20/20`;
- no real product-side notification or artifact indicates execution of a real tool.

Visual phone observation does not need to be reported turn by turn. Missing, reordered,
or cross-scenario bubbles are already machine-detectable and prevent PASS.

## Browser acceptance for the same successful run

Browser acceptance starts only after exit `0` and uses the existing saved credentials
for the operator account; do not ask the user to provide a password. Open:

```text
https://intexuraos.cloud/#/intex-agent/sessions?view=test-runs
```

Select the newest run matching the just-completed start time. Verify:

1. the run header shows `Completed · Passed`;
2. the badges show `REAL MATRIX`, `WHATSAPP`, and `MOCKED TOOLS`;
3. the models are DeepSeek V4 Flash and MiniMax M3;
4. progress shows `20 / 20 scenarios completed`, 20 passed, 0 failed, and 0 not run;
5. artifact delivery is ready and agent/evaluator/total costs are present;
6. the scenario rail contains exactly scenarios 001–020 in order;
7. every scenario shows completed/passed with matching completed/planned turns;
8. every scenario shows deterministic passed and MiniMax passed;
9. each scenario timeline contains its natural user and assistant messages;
10. tool scenarios contain `Tool selected` followed by `Mock completed` for the expected
    tool;
11. confirmation scenarios contain `Confirmation requested` and `Confirmation resolved`;
12. evaluation coverage shows expected = observed = judged for every scenario;
13. scenario 020 shows 20/20 turns and 20/20 replies;
14. no credential, UID, phone number, Matrix identifier, room ID, capability, raw
    provider payload, or hidden prompt is visible.

Browser acceptance fails if any scenario cannot be selected, the UI becomes stale before
terminal state, counts differ, a model differs, an expected timeline card is absent, or
private data is exposed.

## Terminal outcomes and communication

| Exit | Meaning | Required action |
| ---: | --- | --- |
| `0` | Corpus behavior, transport, strict mocks, evaluation, cleanup, and artifacts passed. | Perform browser acceptance for the same run. |
| `1` | The complete corpus ran but at least one behavioral or semantic check failed. | Preserve the report, correct the safe failed scenarios, deploy, and start one fresh production run. |
| `2` | Configuration, revision, transport, safety, provider, cleanup, or artifact infrastructure failed. | Preserve the safe code/path, correct the boundary, deploy, and start one fresh production run. |

After exit `0` plus successful browser acceptance, send exactly one final message through
the already bound Matrix-to-WhatsApp notification route:

```text
Krok 15 z 15 wykonany — pełny Intex Agent Matrix Corpus przeszedł automatyczną i live acceptance. Goal zakończony.
```

Do not send that message after exit `1`, exit `2`, incomplete browser acceptance, or an
ambiguous notification delivery. Reconcile an ambiguous notification by its idempotency
key; never send a blind duplicate.

## What requires user intervention

Normal execution requires no identity data, configuration values, confirmation before
individual scenarios, manual confirmation clicks, or tool-side cleanup. An active goal
that explicitly requires iteration until PASS is sufficient authorization for every
diagnosis/fix/deploy/new-run cycle. User intervention is reported only for a technically
inaccessible external action that cannot be performed with the available credentials,
tools, or systems.

## Endpoint changes

### Modified

- Production WhatsApp and Intex Agent Matrix-corpus contracts now bind to
  `hetzner-prod`.

### Created

- OIDC-protected `/internal/evals/whatsapp/matrix-corpus/*` routes.
- OIDC-protected `/internal/evals/intex-agent/matrix-corpus/*` routes.
- Canonical production command `scripts/run-intex-agent-evals-prod.sh matrix-corpus`.

### Removed

- None.

### Unchanged and used by this procedure

- WhatsApp Service private Matrix outbound message, readiness, corpus capability,
  transport status, send-proof, lease, quiesce, release, and recovery endpoints.
- Intex Agent private corpus context, projection, scenario status, evidence,
  finalization, terminal-control, artifact-delivery, retention, and cleanup endpoints.
- Authenticated Intex Agent `Test Runs` list, run-detail, and scenario-detail endpoints.

The public product API remains unchanged. Only the corpus-only protected control plane and
its production audience are added.
