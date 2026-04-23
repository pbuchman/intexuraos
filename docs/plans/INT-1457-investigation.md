# INT-1457 — Completion Verifier Rate-Limit Failure Investigation

**Linear:** [INT-1457](https://linear.app/pbuchman/issue/INT-1457/fix-completion-verifier-failing-when-agents-hit-rate-limits)
**Service:** `workers/orchestrator`
**Area:** completion verification, execution-task failure classification
**Observed in transcript:** `2026-04-23 16:05:54Z` to `2026-04-23 16:07:33Z`

---

## 1. User-visible symptom

When an execution agent run ends because Claude hits a usage/rate limit, the completion verifier does not report the real reason. Instead:

1. The verifier asks validation models to emit an execution success payload.
2. A fallback model can correctly infer that the task failed because of rate limiting.
3. That semantically correct failure response is rejected as a schema error.
4. The orchestrator then reports a generic completion-verification failure instead of the underlying runtime failure.

The task transcript in the Linear issue shows this exact sequence:

- Worker log ends with `[entrypoint] Claude attempt finished with exit code: 1`
- Primary verifier model returns `outcome: "implemented"` but leaves `gh_pr_url` empty
- Fallback verifier model returns `outcome: "failed"` with a summary saying the task was interrupted by a rate limit
- Zod rejects that fallback response because the execution schema only allows `"implemented"` or `"already_completed"`
- The orchestrator logs `Completion verifier: all models failed schema validation`

## 2. Root cause

This is not one bug. It is a two-part contract mismatch.

### 2.1 Success-only execution schema rejects correct failure inferences

`workers/orchestrator/src/services/completion-verifier/prompt-builder.ts` defines the execution verifier as a success extractor only:

- `outcome` is restricted to `"implemented"` or `"already_completed"`
- `gh_pr_url` is required for all execution outcomes

`workers/orchestrator/src/services/completion-verifier/schemas.ts` enforces the same contract in `EXECUTION_SCHEMA`.

That means the verifier has no valid JSON shape for a transcript whose true answer is "the task failed before completion." In the incident transcript, Gemini's fallback response:

```json
{
  "outcome": "failed",
  "gh_pr_url": "",
  "summary": "* The task was interrupted due to a rate limit before completion."
}
```

is semantically correct, but the schema can only classify it as invalid.

### 2.2 Normal completion path ignores runtime hard-error evidence

The runtime pipeline already captures hard failure evidence:

- `claude-log-processor.ts` emits `attempt_failed` with `exitCode: 1` and `errorMessage`
- `task-dispatcher.ts` stores that message in `claudeErrors`

However, the standard completion path in `handleTaskCompletion(...)` does not use `claudeErrors` when deciding the terminal error. It only:

- passes `lastExitCode` into the verifier
- short-circuits only for fatal exits `137` and `139`
- relies on verifier success or schema failure for everything else

`claudeErrors` is only consulted in the separate `resumedAfterSuccess` path. So for a normal execution attempt that already emitted `"Task failed: rate limited"`, the dispatcher still routes the transcript through the success-only verifier contract and loses the real reason.

## 3. Why the current result is wrong

The current terminal reason is "schema validation failed" / "missing fields", but that is only a secondary artifact of the verifier contract. The primary failure happened earlier:

- Claude exited non-zero
- the runtime emitted a concrete hard-error message
- the fallback verifier correctly inferred failure semantics from the transcript

The system should surface the runtime failure reason, not the verifier's inability to encode that reason in the current schema.

## 4. Recommended fix direction

The fix should preserve the existing success-verification behavior for genuine success cases while adding a first-class path for failed execution attempts.

### 4.1 Separate extraction success from task success

Refactor execution verification so the verifier can return a parsed failure verdict without pretending that every valid response means the task succeeded.

Recommended shape:

- keep "verification passed" meaning "the transcript was parsed into a valid structured verdict"
- allow execution verdicts to include a failure outcome, for example:
  - `implemented`
  - `already_completed`
  - `failed`
- require `gh_pr_url` only for successful outcomes that actually need one
- add a structured failure reason field, e.g. `failure_reason`, that can carry values such as `rate_limited`, `non_zero_exit`, or `missing_final_block`

This lets a fallback model return a valid failure verdict instead of being misclassified as schema-invalid.

### 4.2 Let runtime hard-error evidence take precedence in the normal completion path

When a non-zero exit code is accompanied by a runtime `errorMessage`, the dispatcher should not degrade that into a generic verification failure. It should treat the runtime error as authoritative evidence.

Recommended precedence:

1. `attempt_failed` / `claudeErrors` message when present
2. fatal exit short-circuit (`137` / `139`)
3. parsed verifier failure verdict
4. `TASK_EXIT_CODE_OVERRIDE` only for the specific case where the verifier parsed a success payload but the worker still exited non-zero

That keeps the current `TASK_EXIT_CODE_OVERRIDE` safeguard for ambiguous post-success failures, while allowing rate-limit failures to report the correct reason.

### 4.3 Align failure classification with downstream retry logic

`apps/code-agent/src/domain/utils/classifyFailure.ts` already has special handling for:

- `TASK_EXIT_CODE_OVERRIDE`
- `TASK_RESUMED_HARD_ERROR` containing `429`

The normal execution path needs an equivalent failure code/message shape so code-agent can classify rate-limit failures consistently. The fix can either:

- introduce a shared runtime-hard-error code usable in both normal and resumed paths, or
- reuse an existing code path with a message contract that reliably contains the runtime reason

The important part is that a rate-limit failure must reach code-agent as a rate-limit failure, not as verifier schema noise.

## 5. Implementation plan

### Task 1: Expand verifier contracts for failed execution outcomes

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier/prompt-builder.ts`
- Modify: `workers/orchestrator/src/services/completion-verifier/schemas.ts`
- Modify: `workers/orchestrator/src/services/completion-verifier/types.ts`
- Test: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

- [ ] Update the execution prompt so the model can emit a failed execution verdict instead of being forced into a success-only schema.
- [ ] Relax `EXECUTION_SCHEMA` so failed outcomes are valid without a PR URL and carry a structured failure reason.
- [ ] Extend verifier result types so dispatcher code can distinguish:
  - transcript parsed successfully
  - task succeeded
  - task failed with an explicit reason
- [ ] Add regression tests covering:
  - primary success-schema failure followed by fallback `outcome: "failed"` response
  - parse failure on primary followed by valid failed verdict on fallback
  - successful execution verdicts still requiring `gh_pr_url`

### Task 2: Use runtime failure evidence in the standard completion path

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] Update `handleTaskCompletion(...)` so non-zero exit + runtime `claudeErrors` does not fall through to generic completion-verification failure.
- [ ] Keep `TASK_EXIT_CODE_OVERRIDE` only for the case where a valid success verdict exists but the worker still exited non-zero.
- [ ] Add a terminal failure path that preserves the runtime message for normal execution attempts.
- [ ] Add regression tests for:
  - normal execution attempt with runtime `rate limited` error and exit code `1`
  - normal execution attempt with generic runtime error and exit code `1`
  - success verdict + exit code `1` still finalizing with `TASK_EXIT_CODE_OVERRIDE`

### Task 3: Make downstream retry classification understand the corrected failure

**Files:**
- Modify: `apps/code-agent/src/domain/utils/classifyFailure.ts`
- Test: `apps/code-agent/src/__tests__/domain/utils/classifyFailure.test.ts`

- [ ] Ensure the failure code/message produced by Task 2 is classified as `retry_after_cooloff` when the runtime reason contains `429` or `rate limited`.
- [ ] Keep existing retry behavior for generic transient non-zero exits.
- [ ] Add classifier tests proving the new normal-path failure shape maps to the same verdict as the resumed-path rate-limit failure.

### Task 4: Verify the full incident path end-to-end in tests

**Files:**
- Modify: `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
- Modify: `apps/code-agent/src/__tests__/integration/status-update-e2e.test.ts`

- [ ] Add an orchestrator-level regression using the incident transcript pattern:
  - worker exits `1`
  - primary verifier returns invalid success payload
  - fallback verifier returns valid failed verdict with `rate_limited`
- [ ] Assert the final task error references the runtime/rate-limit reason instead of `missingFields: ["outcome"]`.
- [ ] Verify webhook/code-agent payloads expose the corrected reason and retry classification.

## 6. Endpoint Changes

**Modified:** none.
**Created:** none.
**Removed:** none.
**Unchanged:** all HTTP endpoints; this fix is internal to orchestrator verification and downstream failure classification.

## 7. Concrete findings summary

- The fallback model did not "misbehave" in the incident transcript; it produced the right semantic answer for a failed task.
- The verifier rejected that answer because execution verification currently encodes only successful completion states.
- The dispatcher already had a better source of truth (`attempt_failed` / `claudeErrors`) but ignores it in the normal completion path.
- The correct fix is to add a first-class failed execution verdict and to prioritize runtime hard-error evidence over generic schema-failure handling.
