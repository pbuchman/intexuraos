# Orchestrator Resume + Completion Verification Design (Production Plan)

Date: 2026-02-11
Scope: `workers/orchestrator`, `workers/claude-worker`, `apps/code-agent`
Status: Design (implementation not started)

## 1) Problem Statement

Tasks can be marked `completed` even when requested output was not achieved.

The concrete user-visible case: `task_cc2eacd9-0eb5-4c06-82c9-3db73ae0f0ae` ended `completed` but did not produce the requested final table.

## 2) Proven Findings (with evidence)

### F1. Completion status currently depends mostly on PR presence + phase, not requested-output success

In `workers/orchestrator/src/services/task-dispatcher.ts`:
- `isPhase2` is `task.linearIssueLabels.includes('code-task')`
- If no Claude error, no PR, and not phase2 => `completed`

This is why phase1/info tasks can complete without meaningful fulfillment.

### F2. Retry flow reuses stale labels and does not revalidate Linear issue labels

In `apps/code-agent/src/domain/usecases/retryTask.ts`:
- Dispatch payload uses `linearIssueLabels: originalTask.linearIssueLabels ?? []`
- No re-validation call for latest labels before dispatch

Impact: after a phase1 run adds `code-task`, subsequent retries can still dispatch with `[]`, staying in phase1 behavior.

### F3. `task_cc2eacd9...` was dispatched with empty labels and completed without result/error

From orchestrator log (`~/.claude-orchestrator/logs/orchestrator.log`):
- incoming `/tasks` body had `"linearIssueLabels":[]`
- completion webhook payload was `{ taskId, status:"completed", duration }` (no `result`, no `error`)

From Firestore task doc:
- `status: completed`
- `linearIssueLabels: []`
- `result: null`, `error: null`

### F4. Structured result lines are inconsistent in real traffic

24h Firestore sample (real env, project `intexuraos-dev-pbuchman`):
- window: `2026-02-10T19:36:35.168Z` to `2026-02-11T19:36:38.964Z`
- tasks: 9 (`completed` 7, `interrupted` 2)
- completed without PR URL: 7
- completed tasks without `type:"result"` line in logs: 5/7
- completed tasks with `<tool_use_error>`: 3/7
- completed tasks with `type:"result"` + `is_error:true`: 1/7

This is enough to justify verification beyond current result-line heuristic.

### F5. Stop hook enforcement is not active for completion-validator in current worker settings

In `.claude/settings.json`:
- `Stop` hooks include only `ownership-check.sh`
- `completion-validator.sh` exists but is not wired in active `Stop` hook list

### F6. Exit code is available but not used in dispatcher completion decision

In `workers/orchestrator/src/services/isolation/docker-provider.ts`:
- `onComplete` receives `exitCode` from `container.wait()`

In `workers/orchestrator/src/services/task-dispatcher.ts`:
- `onComplete` callback currently only flushes logs
- completion status logic does not consume exit code

### F7. `claude --continue` is feasible and preferred

CLI proof on this machine:
- run 1 in `/tmp/ccresume` output `ALPHA`
- run 2 with `--continue` in same directory recalled prior answer (`ALPHA`)
- context reuse confirmed via non-zero `cache_read_input_tokens`

## 3) Target Behavior

When a task finishes:
1. Determine if the requested phase/objective is met.
2. If not met, automatically continue/resume up to `N` attempts.
3. Only mark `completed` when criteria pass.
4. If max attempts reached without criteria pass, mark `failed` with explicit remediation reason.

## 4) Architecture Changes

## 4.0 System Prompt + Final Message Contract (mandatory)

The existing worker system prompts in `workers/orchestrator/src/services/system-prompt.ts` must be updated to require explicit terminal statements in the assistant's last message.

Phase 1 mandatory last-message contract:
- must explicitly state label has been set on Linear issue
- label must be one of: `code-task` or `unclear`
- must explicitly state phase-2 readiness

Required format (plain text, exact headings):

```text
PHASE1_FINAL:
- Linear label set: <code-task|unclear>
- Phase 2 ready: <yes|no>
- Linear issue: <full Linear URL>
- Summary: <one short sentence>
```

Rules:
- if label is `code-task` => `Phase 2 ready: yes`
- if label is `unclear` => `Phase 2 ready: no`

Phase 2 mandatory last-message contract:
- must include PR URL
- must include explicit evidence that `pnpm run ci:tracked` succeeded

Required format (plain text, exact headings):

```text
PHASE2_FINAL:
- PR: <full GitHub PR URL>
- CI evidence: pnpm run ci:tracked successful
- Linear issue: <full Linear URL>
- Summary: <one short sentence>
```

## 4.1 P0 correctness fixes (must ship first)

1. Refresh labels on retry
- Update `retryTask` to validate current Linear issue before dispatch.
- Replace stale `originalTask.linearIssueLabels` with fresh labels.
- This directly fixes false phase1 routing after prior phase1 completion.

2. Use worker exit code in final decision
- Persist `exitCode` from provider callback.
- If `exitCode != 0` and no positive completion evidence, fail task (`WORKER_EXIT_NONZERO`).

3. Persist `completedAt` on code-agent webhook updates
- In `/internal/webhooks/task-complete`, write `completedAt` for all terminal statuses.

4. Harden error detection beyond single-line JSON parse
- Keep stream parser state to handle split JSON frames.
- Do not rely only on `obj.type === "result" && is_error === true` from one line.

## 4.2 Remove structured-output dependency (as requested)

Current:
- orchestrator injects `--json-schema` and phase-specific structured output requirements.

New:
- behind feature flag, skip `jsonSchema` injection.
- keep phase guidance in system prompt, but no strict schema enforcement.
- completion success is decided by verifier pipeline (deterministic + optional LLM), not structured-output contract.

Even without JSON schema, the plain-text final message contracts in section 4.0 remain mandatory and are verifier-checked.

## 4.3 Completion verifier pipeline

Add `CompletionVerifier` service in orchestrator:

Input:
- task metadata (`prompt`, `linearIssueId`, labels, hasChildren, attempts)
- terminal log window (last `K` lines + key extracted events)
- optional artifact probes (PR existence, CI status, branch/commit count)

Output (typed):
- `passed: boolean`
- `confidence: number`
- `reasons: string[]`
- `nextAction: "complete" | "resume" | "fail"`
- `resumePrompt?: string`

Verification stages:
1. Deterministic checks (no LLM)
2. LLM adjudication for semantic fulfillment only when deterministic checks are inconclusive
3. Decision policy

Deterministic checks include:
- hard failure signals: `tool_use_error`, worker nonzero exit, explicit API/auth errors
- minimum activity: assistant produced substantive response after user prompt
- phase checks:
  - phase2: PR required
  - phase1/info: objective-specific extraction checks (configurable predicates)

## 4.4 Resume loop model

Add per-task execution metadata:
- `attemptCount`
- `maxAttempts`
- `lastExitCode`
- `verificationHistory[]`

Flow:
1. Run attempt 1.
2. On container stop, verify completion.
3. If pass => webhook `completed`.
4. If fail and attempts left => dispatch another run with:
   - same worktree/branch context
   - `--continue` in same worktree
   - appended remediation prompt from verifier
5. If attempts exhausted => webhook `failed` with verifier reasons.

Important: run resume as a new attempt process. Do not overload final status webhook between attempts.

## 5) Environment and Dependency Plan

Current orchestrator required envs already include core task infra keys; no verifier provider key exists yet.

Add:
- `INTEXURAOS_COMPLETION_VERIFY_ENABLED` (`0|1`)
- `INTEXURAOS_COMPLETION_MAX_ATTEMPTS` (default `3`)
- `INTEXURAOS_COMPLETION_VERIFY_MODEL_PROVIDER` (`gemini|zai|claude`) default `gemini`
- `INTEXURAOS_COMPLETION_VERIFY_MODEL` (default `gemini-2.5-flash`)
- Provider key(s), minimally one:
  - `INTEXURAOS_GEMINI_APP_API_KEY` (if Gemini selected; stored in secrets)
  - or reuse existing ZAI/Anthropic keys

Dependency options for verifier:

Option A: Direct Gemini SDK (`@google/genai`)
- Pros: smallest call path, simplest Gemini-specific code
- Cons: would require implementing cost logging + response audit manually

Option B: Existing infra (`@intexuraos/infra-gemini` via `@intexuraos/llm-factory`)
- Pros:
  - already integrated with `@intexuraos/llm-audit` (prompt + response logging)
  - already integrated with usage/cost logging (`createUsageLogger`, `costUsd`)
  - consistent model/provider abstractions used elsewhere in repo
- Cons: adds workspace package deps to orchestrator

Decision:
- Use Option B (existing infra) for production.
- Reason: requirement says all API costs and responses must be logged; existing infra already provides this.

Mandatory logging requirement:
- every verifier LLM call must persist:
  - prompt
  - response (or error)
  - token usage
  - computed `costUsd`
  - timing and task correlation metadata

## 6) Prompting Strategy (Verifier)

Verifier prompt contract:
- Inputs:
  - original user objective
  - phase context
  - extracted terminal evidence (not full raw transcript)
- Required output (strict local zod parse):
  - `passed` boolean
  - `confidence` 0..1
  - `missingCriteria[]`
  - `resumeInstruction` short imperative text if failed

Guardrails:
- Never ask verifier to assess code quality broadly.
- Only ask whether requested deliverable was achieved in this attempt.
- Keep context small and normalized (pre-extracted evidence).

## 7) Is Gemini 2.5 Flash enough?

For this verifier role: likely yes, with constraints.

Why (evidence-based):
- 24h workload is small (9 tasks/day in observed window).
- Average logged text per task ~92 KB; verifier should consume only extracted tail/features, far smaller.
- Decision is binary fulfillment check, not deep synthesis.

Risk:
- Any single LLM can misclassify edge cases.

Mitigation (mandatory for production):
- stage with shadow mode (no gating) for at least 48h
- compare verifier outcome against human-labeled sample
- define SLO before enabling gating:
  - false-pass rate <= 1%
  - false-fail rate <= 5%

If SLO is not met, switch provider/model via env without code changes.

## 8) Testing Strategy

## 8.1 Unit tests

1. `retryTask` refreshes labels before dispatch.
2. `CompletionVerifier` deterministic rules:
- tool error => fail
- phase2 no PR => fail
- explicit deliverable found => pass
3. resume decision policy:
- attempts remaining => resume
- attempts exhausted => fail
4. robust stream parsing across split JSON frames.

## 8.2 Integration tests (orchestrator)

1. Worker returns incomplete output; verifier fails; attempt 2 resumes.
2. Attempt 2 meets criteria; final webhook `completed`.
3. Nonzero exit + incomplete output => fail.
4. `--continue` flow in same worktree triggers follow-up attempt as expected.

## 8.3 E2E (staging)

Run synthetic tasks:
- intentionally incomplete response task
- requires table output task (similar to `task_cc2eacd9...`)
- phase2 PR-required task

Assertions:
- no premature completed statuses
- retry count bounded
- webhooks emitted once per terminal outcome

## 8.4 Shadow-mode evaluation

For 48h:
- compute verifier decision but do not gate status
- store decision in task metadata for audit
- analyze disagreement with final human/system outcome

## 9) Observability and Ops

Add metrics:
- `completion_verifier_runs_total{provider,model}`
- `completion_verifier_pass_total`
- `completion_verifier_fail_total{reason}`
- `completion_resume_attempt_total{attempt}`
- `completion_terminal_failed_after_max_attempts_total`
- `completion_misclassification_total` (manual audit backfill)

Structured logs:
- include `taskId`, `attempt`, `claudeSessionId` (if observable), `verdict`, `reasons`

## 10) Rollout Plan

Phase A (safe correctness):
1. retry label refresh
2. completionAt persistence
3. exit-code-aware completion decision

Phase B (shadow verifier):
1. deploy verifier in observe-only mode
2. gather 48h metrics and confusion matrix

Phase C (gated verifier + resume):
1. enable gating for 10% traffic
2. ramp to 100% after SLO holds

Rollback:
- single env flag disables verifier gating and resume loop.

## 11) Feasibility of “no container close” approach

Possible but not required.

Current state:
- worker entrypoint `exec claude ...` exits container when claude exits.

Recommended:
- keep one-attempt-per-container model (simpler isolation/cleanup).
- perform continuation as a new attempt process using `--continue` in the same worktree.

Reason:
- less lifecycle complexity than in-container shell supervision
- preserves current security/isolation assumptions
- easier to test and roll back

## 12) Explicit Non-Goals

- No change to Linear state authority rules.
- No change to CI requirements in `.claude/CLAUDE.md`.
- No broad autonomous “quality” judging by verifier.

## 13) Implementation Checklist

1. `retryTask` label refresh + tests
2. orchestrator task metadata extension (attempt/session/verdict history)
3. stream parser hardening for result/error extraction
4. completion verifier module + tests
5. dispatcher resume loop + capped attempts
6. feature flags + env validation
7. metrics/logging
8. shadow rollout + evaluation report

## 14) Prompt Pack (for review before implementation)

### 14.1 Verifier System Prompt (Gemini, simplified)

Use as system instruction for completion adjudication:

```text
You are a strict task-completion verifier.
Decide only one thing: PASS or FAIL for this attempt.

Use only provided evidence.
Do not judge code quality.
If evidence is missing, return FAIL.
Return JSON only with the exact schema.

Phase checks:
- Phase 1: final message must include PHASE1_FINAL block and valid label/readiness lines.
- Phase 2: final message must include PHASE2_FINAL block, PR URL, and exact CI evidence line:
  "pnpm run ci:tracked successful"
```

### 14.2 Verifier User Prompt Template (simple, explicit)

```text
TASK {{taskId}} ATTEMPT {{attempt}}/{{maxAttempts}} PHASE {{phase}}

Original objective:
{{originalPrompt}}

Required contract:
{{requiredContractText}}

Deterministic signals:
- workerExitCode={{exitCode}}
- hasToolUseError={{hasToolUseError}}
- detectedPrUrl={{prUrlOrNull}}
- detectedCiTrackedSuccess={{ciTrackedSuccess}}

Last assistant message:
{{lastAssistantMessage}}

Last logs excerpt:
{{terminalExcerpt}}

Return PASS only if all required contract items are present with evidence.
Otherwise return FAIL with missing criteria and one short next instruction.
```

### 14.3 Verifier Expected JSON Schema

```json
{
  "type": "object",
  "properties": {
    "passed": { "type": "boolean" },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "reasons": { "type": "array", "items": { "type": "string" } },
    "missingCriteria": { "type": "array", "items": { "type": "string" } },
    "resumeInstruction": { "type": "string" }
  },
  "required": ["passed", "confidence", "reasons", "missingCriteria", "resumeInstruction"],
  "additionalProperties": false
}
```

### 14.4 Resume/Continue Prompt Template (next attempt)

Append this to next attempt user prompt:

```text
[AUTO-CONTINUE ATTEMPT]
Previous attempt did not meet completion criteria.
Address the exact gaps below, then finish.

Missing criteria:
{{missingCriteriaBulletList}}

Required action:
{{resumeInstruction}}

Constraints:
- Do not restart from scratch.
- Continue from current repository/worktree state.
- At the end, provide explicit output that satisfies the original objective.
```

## 15) Updated System Prompt Text Blocks (to implement)

Phase 1 prompt addendum (append near completion criteria):

```text
Your LAST message must include exactly this block:

PHASE1_FINAL:
- Linear label set: <code-task|unclear>
- Phase 2 ready: <yes|no>
- Linear issue: <full Linear URL>
- Summary: <one short sentence>

Validation rules:
- If label is code-task, Phase 2 ready must be yes.
- If label is unclear, Phase 2 ready must be no.
```

Phase 2 prompt addendum (append near completion criteria):

```text
Your LAST message must include exactly this block:

PHASE2_FINAL:
- PR: <full GitHub PR URL>
- CI evidence: pnpm run ci:tracked successful
- Linear issue: <full Linear URL>
- Summary: <one short sentence>
```
