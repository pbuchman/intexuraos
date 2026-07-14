# Intex Session Debug-to-Regression Skills Design

**Date:** 2026-07-14
**Status:** Proposed for user review
**Program order:** 3 of 4

## Purpose

Turn every Intex Agent session investigation into a privacy-safe, executable regression draft instead of ending at a diagnosis. When the current request explicitly authorizes repository changes, the draft is registered automatically as a candidate; a diagnosis-only request remains read-only. The user-facing sequence is fixed:

1. what happened;
2. what should have happened;
3. the executable scenario that represents the difference;
4. how the scenario enters the evaluation pipeline;
5. the verification result.

This specification depends on the [evaluation foundation](./2026-07-14-intex-agent-evaluation-foundation-design.md) and its scenario schema. Model-specific reproduction uses the [per-user model contract](./2026-07-14-intex-agent-user-model-selection-design.md). It does not replace the separate [WhatsApp live canary](./2026-07-14-intex-agent-whatsapp-live-canary-design.md).

## Current State

The existing `.codex/skills/debug-intex-session` skill:

- triggers on an Intex session URL or `intex_session_*` ID;
- reads the session and events from Firestore through a service-account credential;
- orders the event timeline consistently with the product;
- redacts user IDs, phone numbers, message bodies, URLs, prompt text, tool arguments, and result strings;
- presents factual evidence and a diagnosis.

It stops after diagnosis. It has no expected-behavior contract, synthetic scenario authoring, privacy lint, baseline reproduction, corpus insertion, model matrix, or promotion gate.

The fetcher currently prints either one JSON document or mixed human text plus JSON. Its truncated content hashes and session identifiers are incident-specific and linkable; they must be removed from the new machine handoff as well as every tracked regression file.

## Goals

1. Make in-memory regression-draft conversion a mandatory continuation of a successful session investigation without treating diagnosis as filesystem/write or live-execution authorization.
2. Preserve the rule that observed facts are shown before conclusions or expected behavior.
3. Derive expected behavior from explicit user intent or existing product invariants without inventing an answer when evidence is ambiguous.
4. Author only synthetic conversation text, IDs, dates, URLs, and tool data.
5. Reproduce the issue against the effective incident model when that model is known.
6. Add an authorized candidate to a discovery-based pipeline without editing workflow code for each incident.
7. Distinguish `candidate` regressions from approved `blocking` regressions.
8. Test the skills themselves with baseline and forward tests, not only lint their Markdown.
9. Keep production session content, user-specific data, source IDs, and incident-derived hashes out of Git.

## Non-Goals

- A debugger cannot infer the semantic meaning of redacted message bodies from hashes.
- The workflow does not copy or paraphrase a private production transcript into the repository.
- A skill does not silently decide between multiple plausible product behaviors.
- A newly authored scenario does not automatically modify prompts or production code.
- A semantic LLM judge cannot override missing product intent or a deterministic invariant.
- This workflow does not prove Meta/WhatsApp delivery.

## Selected Skill Team

Use three narrow Codex skills backed by one deterministic evaluator CLI.

### 1. `debug-intex-session` — investigate and orchestrate

Update the existing skill. It remains the only trigger for session URLs/IDs and owns environment detection, sanitized evidence collection, root-cause analysis, and the ordered user report. After the factual diagnosis it must continue into an in-memory regression draft unless a named hard blocker applies. It may persist, execute, or register the draft only when the original task authorizes those changes/tests or after the user explicitly approves them.

### 2. `author-intex-regression` — synthesize and register

Create a skill that accepts only an `ExpectedBehaviorDecisionV1` containing stable behavior/invariant IDs and the user's synthetic description. The privileged observation stays inside the debugger and is never handed to the authoring skill/subagent. The skill creates an inert synthetic scenario draft, runs mechanical privacy/static checks, and runs baseline reproduction when credentials permit. It writes to the tracked corpus only when change authorization and human synthetic-privacy approval are both present, then registers the scenario as `candidate` or `blocking` according to the lifecycle rules.

### 3. `verify-intex-regression` — execute and promote

Create a skill that runs one registered regression through the evaluator, reports deterministic and UX verdicts per model, compares baseline and candidate code when both are available, and promotes a candidate only when the approval and pass gates are satisfied.

The skills do not duplicate schema validation, corpus discovery, privacy rules, execution, or report aggregation. They invoke the applicable `pnpm intex-agent-evals <command>` operation from the evaluation package.

## Why Three Skills

A single large debugger would mix privileged evidence access, product judgment, scenario writing, live execution, and promotion. Three skills keep trigger descriptions precise, let authoring and verification be reused without a live incident, and allow each behavior to be forward-tested independently.

More skills are not justified initially. Corpus listing, static validation, and matrix execution are CLI operations rather than additional judgment-oriented skills.

## Canonical Data Handoffs

The evaluator package owns Zod schemas for four versioned handoffs. Skill text describes when to invoke them; scripts produce and validate the actual data.

### Sanitized observation

```ts
interface SanitizedSessionObservationV1 {
  schemaVersion: '1.0.0';
  environment: 'dev' | 'prod';
  session: {
    status?: string;
    startReason?: string;
    endReason?: string;
    activeTool?: string;
    startedAt?: string;
    endedAt?: string;
  };
  events: Array<{
    sequence: number;
    productTurnIndex?: number;
    type: string;
    createdAt?: string;
    toolName?: string;
    status?: string;
    resolution?: string;
    reason?: string;
    model?: IntexAgentModel;
    modelResolutionSource?: 'user_setting' | 'default' | 'fallback';
  }>;
}
```

The session ID is used to fetch data but is not part of this handoff. Message-derived hashes and exact lengths are prohibited: short values are dictionary-attackable and hashes remain linkable. The privileged fetcher may use process-local opaque handles such as `event-001` while ordering data, but those handles have no cross-run meaning and are not passed to an LLM or tracked file.

### Expected-behavior decision

```ts
interface ExpectedBehaviorDecisionV1 {
  schemaVersion: '1.0.0';
  summary: string;
  observedViolationIds: string[];
  syntheticIntent: string;
  source:
    | { type: 'explicit_user_requirement'; evidence: string }
    | { type: 'existing_invariant'; invariantIds: string[] };
  deterministic: DeterministicExpectation;
  ux: UxExpectation;
  ambiguity: 'none' | 'product_decision_required';
}
```

The `evidence` field contains the user's synthetic description from the current task, not copied production text. An existing invariant is referenced by stable ID and repository location.

Before invoking the authoring skill, the debugger validates that this decision contains no session event, timestamp, model-call correlation, opaque handle, or other incident-derived value. Only stable behavior/invariant/rubric IDs and newly synthetic text cross that boundary.

### Regression draft

```ts
interface RegressionDraftV1 {
  schemaVersion: '1.0.0';
  scenario: IntexEvalScenario;
  reproduction:
    | { status: 'not_run'; reason: string }
    | { status: 'reproduced' | 'intermittent' | 'not_reproduced'; reportPath: string };
  lifecycle: 'private_draft' | 'candidate' | 'blocking';
}
```

### Verification report

The normal evaluator `results.json` is the machine handoff. The skill renders only its sanitized per-model verdict, repetitions, deterministic failures, UX criteria, duration, usage, cost, and cleanup result.

## Diagnostic Fetch Contract

Extend the canonical wrapper with:

```bash
.codex/skills/debug-intex-session/scripts/fetch-session.sh \
  <sessionId-or-url> --events --json
```

`--json` writes one validated `SanitizedSessionObservationV1` envelope to stdout and diagnostics to stderr. Existing human modes remain compatible.

Requirements:

- service-account credentials only;
- environment/project mismatch is a hard error rather than an implicit fallback;
- no raw message body mode;
- no raw user, phone, URL, prompt, result, or tool-argument mode;
- include a model only on its sanitized per-turn `model_resolved` event after that event exists; never collapse a multi-model session into one incident model;
- return distinct exit codes for invalid input, missing credential, session not found, project mismatch, Firestore failure, and sanitization failure;
- test every redaction class and the complete JSON envelope;
- never write fetched output into a tracked directory.

The deterministic fetch implementation should move to a neutral repository script or evaluator package so `.codex` and `.claude` wrappers do not depend on divergent copies. Runtime-specific `SKILL.md` files may differ in invocation syntax but must call the same tested fetcher.

## Ordered Debug-to-Regression Workflow

### Phase 1 — Observe: “what happened”

1. Parse the session input and environment.
2. Verify machine and credential/project identity.
3. Fetch the sanitized observation.
4. Present session state and the ordered event evidence.
5. State the root cause only to the confidence supported by that evidence.

Required output section: **What happened**. It contains facts before recommendations.

### Phase 2 — Define: “what should have happened”

Resolve desired behavior in this order:

1. an explicit requirement in the user's current message;
2. a deterministic, stable product invariant already present in domain tests/specifications;
3. an existing executable scenario with the same behavior class.

If two outcomes remain plausible, set `ambiguity = product_decision_required`, show the alternatives and their consequences, and ask one focused product question. Do not author a tracked scenario until the answer is available.

If the only missing information is the semantic content hidden by the privacy redaction, ask the user for a synthetic equivalent such as “a user asks to create a calendar event tomorrow.” Never request the original private message body.

Required output section: **What should have happened** with its requirement/invariant source.

### Phase 3 — Encode: executable scenario

The authoring skill:

1. creates synthetic turns and tool mocks;
2. fixes date/timezone and replaces all names/resources with synthetic values;
3. assigns `scenarioId = regression.<capability>.<descriptive-slug>` with no incident ID;
4. sets `tier = regression`, `maturity = candidate`, and `provenance.origin = session_debug`;
5. sets `provenance.privacyReview = unreviewed` and runs schema validation, mechanical privacy lint, ID uniqueness, fingerprint, and generated-catalog checks;
6. renders a validated in-memory/response draft after those checks pass without touching the filesystem;
7. writes a private artifact or tracked `.scenario.json` only when the request already authorizes the applicable write/test or the user separately approves it; tracked registration additionally requires a human reviewer to mark the newly written text `approved_synthetic`.

Tracked files may contain the behavior class and synthetic expected outcome. They may not contain:

- source session ID, URL, Auth0/user ID, phone, e-mail, message ID, WAMID, confirmation ID, or resource ID;
- raw or paraphrased production text;
- a source hash or fingerprint;
- incident timestamp precise enough to identify the source;
- tool arguments or result values copied from production.

Required output section: **Regression scenario**, including ID, synthetic Given/When/Then summary, deterministic invariants, UX rubric IDs, target model, inline/proposed artifact (or path only when authorized), and whether execution/tracked registration is authorized.

### Phase 4 — Reproduce and register

When live/evaluation execution is explicitly authorized, run the scenario three times against the failing product turn's recorded model. A diagnosis-only request reports `not_run: execution_not_authorized` without starting services, writing test data, or spending an LLM budget. If the failing turn has no model-resolution evidence, use `DEFAULT_INTEX_AGENT_MODEL` explicitly and label an authorized run `incident_model_unknown`; never resolve through the synthetic evaluation user's preference and call it the incident model. Classification:

- `reproduced`: at least two of three runs violate the new expectation in the same behavior class;
- `intermittent`: one of three violates it;
- `not_reproduced`: zero of three violate it;
- `not_run`: live credentials/services are unavailable.

A deterministic violation always counts as a failed sample. Provider/network failures are infrastructure failures and do not count as behavioral reproduction.

Registration is discovery-based: every authorized, human-approved valid file under `scenarios/regressions/` enters static CI and the nightly catalog automatically. No workflow YAML or hard-coded scenario list is edited for an individual regression. A diagnosis-only invocation produces the complete proposed scenario in memory/the response and reports `registration_pending_authorization`; it does not modify the worktree or private artifact directories.

Candidate behavior:

- static CI validates it and blocks privacy/schema/catalog failures;
- trusted changed-regression smoke executes it and reports the result;
- nightly executes it as advisory;
- it does not become a required behavioral gate until promoted.

Required output section: **Pipeline registration**, with maturity, jobs that discover it, baseline classification, and any unrun live gate.

### Phase 5 — Verify and promote

Promotion from `candidate` to `blocking` requires all of:

1. expected behavior has explicit user approval or an unambiguous existing-invariant source;
2. privacy/static checks pass;
3. the candidate code passes deterministic expectations on every target model and repetition required by the scenario;
4. UX criteria meet the approved baseline and contain no `uncertain` result;
5. cleanup succeeds;
6. a reviewer confirms the scenario would fail for the original behavior class rather than merely snapshotting the fix.

If the issue is being fixed in the same development task, that request authorizes the regression write: the candidate is written before implementation, observed failing, then promoted after the fix passes. If the invocation is diagnosis-only, it remains a private draft/proposed patch until the user authorizes registration; the skill does not mutate the repository or broaden scope into a product fix.

Required output section: **Verification result**, with evidence and an explicit `blocking`, `candidate`, or `blocked` conclusion.

## Scenario Lifecycle

Add to `IntexEvalScenario`:

```ts
maturity: 'candidate' | 'blocking';
```

Rules:

- Gold and Extended scenarios are always `blocking`.
- Session-derived regressions start as `candidate`.
- A scenario file changes maturity only through the verified promotion command.
- Promotion increments `scenarioVersion` and updates its fingerprint.
- Demotion requires a written reason in the change description; no `skip`, `only`, quarantine flag, or silent exclusion is allowed.
- Candidate count, age, owner, and last result appear in the generated catalog. A scheduled governance job flags candidates older than 30 days for promotion or reviewed removal; age alone does not fail unrelated pull requests.

## Private Artifacts and Repository Data

Only a task that explicitly authorizes persistence or execution may create private work outside every repository/workspace under:

```text
~/.intexuraos/private/session-regressions/<runId>/
```

The directory is created with mode `0700`, and files are mode `0600`. It is never mounted into CI, uploaded, indexed, or passed wholesale to a subagent. Authorized write/execute workflows sweep artifacts older than seven days on start and end; separately authorized scheduled maintenance provides crash recovery. A diagnosis-only invocation performs no sweep or filesystem write. A privileged fetcher may transiently read a raw Firestore document in process in order to redact it, but raw content is never emitted, logged, persisted, or included in an LLM/skill handoff.

The repository receives only:

- synthetic scenario data;
- stable invariant/rubric IDs;
- model IDs and aggregate execution expectations;
- skill manifests, deterministic scripts, tests, and generated synthetic catalog entries.

The repository does not receive any data specific to the incident user. The evaluation executes as `test-intex-agent-<runId>`, not as the production user whose session was investigated.

## Skill Authoring and Testing

Skill implementation follows test-driven skill development. Each skill is implemented and verified separately before work begins on the next skill.

### RED

Use fresh subagents with committed synthetic fixtures and without the new/changed skill. Record the actual baseline output in ignored artifacts. Required cases:

1. clear deterministic failure with explicit desired behavior;
2. ambiguous desired behavior that requires a product decision;
3. private-looking observation designed to tempt copying identifiers/content;
4. unavailable live credential/provider;
5. non-reproduced generative failure.

The baseline must demonstrate the gap being taught; if an unassisted agent already behaves correctly, do not add redundant skill text.

### GREEN

Initialize each new skill with the skill-creator scaffolder, write the minimum instructions and bundled command references needed to correct observed failures, generate `agents/openai.yaml`, run `quick_validate.py`, and repeat the same cases with the skill.

### REFACTOR

Add guidance only for observed loopholes, then forward-test with fresh context. Generated agent outputs remain ignored; committed test cases contain synthetic inputs and structural grading criteria.

Minimum skill verdict assertions:

- ordered five-section output;
- facts before conclusions;
- no tracked incident identifiers/hashes/content;
- one focused question on ambiguity;
- no false claim that an unrun live check passed;
- scenario discovery and maturity reported correctly;
- deterministic failure cannot be overridden by UX judgment.

## Failure and Blocker Policy

Stop and name the blocker before authoring or claiming verification when:

- the service-account credential is missing or points at the wrong project;
- the session is missing;
- sanitized evidence does not support a root cause;
- desired behavior is ambiguous;
- a synthetic semantic equivalent is unavailable because message content is intentionally redacted;
- privacy lint fails;
- repository registration is required but change authorization or human synthetic-privacy approval is absent;
- live LLM credentials or protected workflow access are unavailable;
- cleanup fails.

`not_reproduced` is a valid authoring/registration result, not permission to adjust expectations until the test fails. It blocks promotion and any claim that the original behavior was observed failing; it does not block creation of an authorized candidate. `not_run` is not a pass.

## Endpoint Changes

### Created

- None.

### Modified

- None. The skills use the internal evaluation endpoint defined by the evaluation foundation.

### Removed

- None.

## Testing Strategy

In addition to skill forward tests:

1. Fetcher unit tests for JSON output, event ordering, environment/project mismatch, and every redaction branch.
2. Handoff schema tests for missing/additional/invalid fields.
3. Authoring CLI tests for synthetic ID generation, collision handling, maturity, versioning, and atomic writes.
4. Privacy tests proving all incident identifiers and hashes are removed before tracking.
5. Reproduction classification tests for 0/1/2/3 behavioral failures and infrastructure failures.
6. Promotion tests for each required gate and version increment.
7. Catalog/discovery tests proving one new file requires no workflow change.
8. Candidate-age governance tests.
9. End-to-end synthetic fixture: sanitized observation → expected decision → candidate file → failing baseline → passing candidate → blocking promotion.

## Acceptance Criteria

- Invoking `debug-intex-session` no longer stops at diagnosis when a private regression draft can be safely defined.
- Its final report always follows the five required sections in order.
- Ambiguous expected behavior is surfaced as one explicit product decision, never guessed.
- A safe diagnosis-only case creates a complete in-memory/response synthetic draft automatically and leaves both the worktree and private artifact directories unchanged.
- A safe change-authorized case creates a discoverable synthetic regression candidate automatically after human synthetic-privacy approval.
- The incident's actual session/user/phone/message/resource identifiers, hashes, e-mail, URL, timestamps, and content do not appear in Git.
- The baseline result distinguishes reproduced, intermittent, not reproduced, infrastructure failure, and not run.
- A candidate cannot become blocking without the complete promotion gate.
- Every skill has observed RED evidence, successful GREEN/REFACTOR forward tests, valid metadata, and deterministic command tests.
- A future session-derived scenario is added by creating one scenario file; the pipeline needs no per-case code change.

## Rollout

1. Add scenario maturity and candidate governance to the evaluation foundation.
2. Add neutral sanitized observation and regression-authoring CLI contracts.
3. Create and forward-test `author-intex-regression`.
4. Create and forward-test `verify-intex-regression`.
5. Update and forward-test `debug-intex-session` to orchestrate both.
6. Convert one fully synthetic historical-style fixture end to end before using the workflow on a live session.
