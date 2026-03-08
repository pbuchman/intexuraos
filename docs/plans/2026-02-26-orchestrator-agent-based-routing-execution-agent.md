# Orchestrator Agent-Based Routing + Execution Agent Contract Refactor

> **For Claude:** REQUIRED SUB-SKILLS at execution start: `superpowers:executing-plans` then `superpowers:requesting-code-review` (mandatory order).

## Goal

Implement the Execution Agent as the second major piece of the agent-based orchestrator workflow, replacing legacy phase-2 execution behavior with an orchestrator-defined prompt/verifier contract and deterministic Linear enforcement owned by `code-agent`.

## Scope

- `workers/orchestrator` Execution Agent prompt, final block contract, Gemini verifier path, webhook result flattening, resume behavior, agent markers/naming updates for execution flow.
- `apps/code-agent` execution webhook handling and deterministic Linear enforcement for successful execution-agent runs.
- Rename/replace legacy `submitToPhase2` flow with execution-agent terminology and update callers (route/use case names, docs, tests).
- Detailed testing and implementation verification checklist.

## Non-Goals

- UI fixes (explicitly deferred to step 3).
- Backward compatibility for legacy `PHASE2_FINAL`, `executionPhase`, or phase-based naming.
- Reintroducing `/linear` skill dependencies into orchestrator worker prompts.
- Ancestor issue mutations on execution success (planning/original issue updates are out of scope for Execution Agent success handling).

## Prerequisite Assumption

This plan assumes the Planning Agent refactor has already been implemented (agent-based routing, `agentType` internals, planning verifier/model, etc.) and focuses on completing the Execution Agent path end-to-end.

## Architecture Summary (Authoritative for Execution Agent)

### Agent Model

- `planning`
- `execution`
- `pull_request`

### Routing (relevant to Execution Agent)

- Execution Agent is selected for Linear issue tasks with label `code-task` (subject to global routing precedence where PR/comment/review events route to `pull_request` first).

### Prompt Markers (must be present)

Keep:
- `[WORKER-MODE]`

Execution marker:
- `[AGENT:EXECUTION]`

### Final Block Name (no backward compatibility)

- `EXECUTION_AGENT_FINAL`

## Execution Agent Contract (Authoritative)

### Required Input

- A specific routed Linear `code-task` issue (execute only this issue, not children/descendants)

### Success Outcome

- Semantic success outcome is only: `implemented`
- All other situations are generic failures (worker/runtime/verifier failures)

### Ownership Split (critical)

- Claude worker owns GitHub execution work:
  - code changes
  - tests
  - CI reruns
  - PR creation via `gh` CLI
  - code review loop (`superpowers:requesting-code-review`)
- `code-agent` owns deterministic Linear enforcement after successful completion callback:
  - executed issue state transition and PR comment

### Linear Scope on Success

On `implemented`, `code-agent` mutates only the executed issue:
- move to `In Review`
- keep label `code-task`
- add comment with PR URL

No ancestor mutations:
- no planning issue mutation
- no original issue mutation

### Execution Scope

- Execute only the exact routed issue
- Do not execute children or descendants as part of one Execution Agent run

## Execution Agent Prompt Rules (Orchestrator-defined, Source of Truth)

The Execution Agent system prompt must explicitly state:

- System prompt is the source of truth; user prompt is secondary
- No `/linear` skill usage (deprecated from orchestrator workflow)
- Start with `superpowers:executing-plans` (mandatory)
- Run `superpowers:requesting-code-review` after implementation/PR creation (mandatory)
- Skill order is mandatory and must be reflected in output evidence
- Subagents are mandatory for non-trivial tasks
- Trivial tasks may skip subagents
- Prompt must contain strict subagent instructions (explicitly controlled, no ambiguity)
- PR creation must be performed with `gh` CLI (not plain git-only flow), because auth relies on GitHub CLI session

### `gh` CLI PR Creation Guidance (prompt requirement)

The prompt should describe and require a `gh`-based PR flow, for example:

1. `git push -u origin <branch>`
2. `gh pr create --base development ...`
3. `gh pr view --json url`
4. `gh pr checks <pr-number> --watch`

This is a prompt requirement only (no explicit `gh` proof field in final block).

## `EXECUTION_AGENT_FINAL` Semantic Contract (Gemini-verified, no regex)

Gemini validates semantic completeness from Claude responses only (latest response first, previous couple only as fallback). No regex parsing for Execution Agent final block. No runtime signal use for Execution Agent completion verification.

### Required `EXECUTION_AGENT_FINAL` fields (exact contract direction)

`EXECUTION_AGENT_FINAL` must semantically include:

- Outcome: `implemented`
- PR URL (full GitHub PR URL)
- CI evidence statement (`pnpm run ci:tracked` successful)
- Linear issue URL (full URL for the executed issue)
- Review iterations (number)
- `superpowers_executing_plans_used: 0|1` (must be `1`)
- `superpowers_requesting_code_review_used: 0|1` (must be `1`)
- `trivial_task: 0|1`
- `subagents: <explicit list>` (required for non-trivial; may be `none`/empty for trivial)
- Skill sequence proof (must show `superpowers:executing-plans` happened before `superpowers:requesting-code-review`)
- Summary (3-5 factual sentences, single-line style consistent with existing final blocks)

### Subagent proof rule (strict)

- If `trivial_task=0`:
  - `subagents` must contain an explicit list of subagents with role + scope/task
  - Empty/`none` is invalid
- If `trivial_task=1`:
  - `subagents` may be empty/`none`

## Execution Agent Gemini Verifier Rules

- Evidence source: Claude responses only
- Primary evidence: most recent Claude response
- Previous responses: fallback only
- Confidence: informational only (not a pass threshold)
- No regex-based final-block parsing for Execution Agent
- No runtime signals for completion verification (no PR/CI/exit-code dependence in verdict)
- Must verify:
  - `EXECUTION_AGENT_FINAL` semantic presence
  - outcome = `implemented`
  - both mandatory superpower fields are `1`
  - required skill sequence proof present (executing-plans before requesting-code-review)
  - subagent proof complies with trivial/non-trivial rule
  - PR URL and executed Linear issue URL present
  - review iterations present
  - CI evidence statement present
- Must fail hard on wrong-issue mismatch:
  - final block Linear issue URL must match routed task target issue
- If missing/ambiguous:
  - return targeted gap-fill resume instruction only (no rewrite-all unless unusable)

## Orchestrator -> `code-agent` Webhook Mapping (Execution Agent)

### Success (`implemented`)

- webhook `status = completed`
- Preserve existing `result` fields (`prUrl`, `branch`, `commits`, `summary`, etc.) where available
- Add flattened `execution_*` metadata in `result`

### Generic execution failures

- webhook `status = failed`
- no special semantic failure code (unless existing generic codes already apply)
- `code-agent` performs no Linear mutations for generic execution failures

## Flattened `execution_*` Result Fields (Locked Exact Keys)

Add flattened `execution_*` keys to webhook `result` for successful Execution Agent runs (and for failed execution verification if available/appropriate, but not required unless the result exists).

| Key                                                 | Required (implemented) | Values / Notes                                                                                         |
| --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `execution_outcome_label`                           | Yes                    | `implemented`                                                                                          |
| `execution_superpowers_executing_plans_used`        | Yes                    | `0` or `1` (must be `1` on pass)                                                                       |
| `execution_superpowers_requesting_code_review_used` | Yes                    | `0` or `1` (must be `1` on pass)                                                                       |
| `execution_trivial_task`                            | Yes                    | `0` or `1`                                                                                             |
| `execution_subagents`                               | Yes                    | Explicit list serialization (role + scope per entry); may be `none` only if `execution_trivial_task=1` |
| `execution_review_iterations`                       | Yes                    | Number of review loop iterations                                                                       |
| `execution_linear_issue_url`                        | Yes                    | Full Linear issue URL for executed issue                                                               |

Notes:
- Existing `result.prUrl` remains the canonical PR URL field for `code-agent` enforcement.
- Existing `result.summary` may remain the canonical summary field; no extra `execution_summary` key is required.

## Deterministic Linear Enforcement (Owned by `code-agent`)

### Success path (`implemented`)

`code-agent` must enforce on the executed issue only:

1. Verify final-block/extracted executed issue URL matches routed task target issue
2. Verify `result.prUrl` is present (from orchestrator result payload)
3. Add comment on executed issue with PR URL
4. Move executed issue to `In Review`
5. Keep label `code-task` (no removal)
6. Do not mutate ancestors (planning/original issues)
7. Mark task status `implemented`

### Failure path (generic execution failures)

- No Linear mutations
- Task is marked failed/interrupted/cancelled per existing webhook semantics

### Wrong-issue safety (hard fail)

If worker-reported/extracted Linear issue URL does not match routed task target issue:
- fail the task
- no Linear mutations

## Legacy `submitToPhase2` Replacement (no phase terminology)

### Replace now

Rename/replace legacy phase-2 submission flow with execution-agent terminology, including:

- Use case file/function: `submitToPhase2` -> `submitToExecutionAgent` (or equivalent agent-based name)
- Internal comments, logs, metrics metadata, and follow-up reason names that still encode phase terminology
- Route metadata (`operationId`, summary/description text) to execution-agent wording

### API path handling

Current path is already neutral enough for UI compatibility:
- `POST /code/tasks/:taskId/implement`

Path may remain unchanged in this step to avoid UI churn (UI fixes are step 3), but all backend semantics/docs/contracts must use agent-based terminology.

## Endpoint Changes

### Modified

| Service                | Method | Path                               | Change                                                                                                                                                              |
| ---------------------- | ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator` | `POST` | `/tasks`                           | Execution dispatch uses agent-based markers/contracts; Execution Agent verifier/result mapping switches to Gemini semantic verification and `EXECUTION_AGENT_FINAL` |
| `apps/code-agent`      | `POST` | `/internal/webhooks/task-complete` | Adds deterministic execution-issue Linear enforcement on successful execution-agent completion; accepts flattened `execution_*` result fields                       |
| `apps/code-agent`      | `POST` | `/code/tasks/:taskId/implement`    | Backend semantics and route metadata updated from phase-based wording to execution-agent terminology; implementation use case renamed/replaced                      |

### Created

| Service | Method | Path | Change                        |
| ------- | ------ | ---- | ----------------------------- |
| None    | -      | -    | No new endpoints in this step |

### Removed

| Service | Method | Path | Change                                                         |
| ------- | ------ | ---- | -------------------------------------------------------------- |
| None    | -      | -    | No endpoint removals in this step (UI compatibility preserved) |

### Unchanged

| Service                | Method                       | Path           | Change                                                                                              |
| ---------------------- | ---------------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `workers/orchestrator` | `GET`                        | `/health`      | No endpoint change                                                                                  |
| `workers/orchestrator` | `POST`                       | `/admin/*`     | No endpoint change                                                                                  |
| `apps/code-agent`      | Other task/webhook endpoints | Existing paths | No path additions/removals; behavior changes scoped to execution submission + task-complete webhook |

## Parallel Implementation Streams (Mandatory split by service/package)

### Stream A - `workers/orchestrator`: Execution Agent prompt rewrite

Files:
- `workers/orchestrator/src/services/system-prompt.ts`
- `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

Work:
- Replace legacy phase-2 wording with Execution Agent wording
- Replace `[PHASE:2]` with `[AGENT:EXECUTION]`
- Remove `/linear` mandatory first action
- Add system-prompt-authority rule near top
- Add mandatory `superpowers:executing-plans` then `superpowers:requesting-code-review`
- Add strict subagent instructions and trivial-task exception
- Add `gh` CLI PR creation instructions
- Rename final block to `EXECUTION_AGENT_FINAL`
- Remove `Turn summary` from execution final-block contract

### Stream B - `workers/orchestrator`: Execution Agent Gemini verifier + extraction

Files:
- `workers/orchestrator/src/services/completion-verifier.ts`
- `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

Work:
- Remove regex-based execution final-block checks
- Add Execution Agent LLM verifier path aligned with Planning Agent rules
- Enforce mandatory superpower proofs, skill sequence proof, subagent rules, and wrong-issue mismatch fail-hard
- Extract execution metadata for webhook flattening (`execution_*` keys)
- Keep no-runtime-signals rule for execution verdicts
- Keep Pull Request Agent verifier behavior separate unless shared renames are needed

### Stream C - `workers/orchestrator`: dispatcher/webhook mapping for execution results

Files:
- `workers/orchestrator/src/services/task-dispatcher.ts`
- relevant result/typing files

Work:
- Map verifier-extracted execution metadata into flattened `execution_*` webhook result fields
- Preserve existing `result.prUrl` / `summary` compatibility for `code-agent`
- Update retry/resume prompts for Execution Agent to reference `EXECUTION_AGENT_FINAL` and targeted gap filling
- Ensure wrong-issue mismatch is surfaced as failure without sending success webhook

### Stream D - `apps/code-agent`: deterministic Linear enforcement for Execution Agent success

Files likely touched:
- `apps/code-agent/src/routes/webhookRoutes.ts`
- `apps/code-agent/src/domain/services/linearIssueService.ts`
- linear client adapters and tests

Work:
- Detect execution-agent completion from `agentType=execution`
- On success, enforce executed-issue-only mutations (PR comment + `In Review`)
- Hard-fail on final-block/routed issue mismatch
- No ancestor mutations
- No Linear mutations on generic execution failures

### Stream E - `apps/code-agent`: replace `submitToPhase2` with execution-agent terminology

Files likely touched:
- `apps/code-agent/src/domain/usecases/submitToPhase2.ts` -> replacement/rename
- `apps/code-agent/src/routes/codeRoutes.ts`
- tests for submit/route behavior
- repository/domain types referencing follow-up reasons/comments

Work:
- Rename use case and internal naming to execution-agent terms
- Update route `operationId`, summaries, descriptions, logs, and comments
- Update tests/fixtures from phase language to execution-agent language
- Preserve route path `/code/tasks/:taskId/implement` for UI compatibility in this step

### Stream F - Documentation updates (orchestrator + execution flow docs)

Files:
- `workers/orchestrator/README.md`
- `docs/services/orchestrator/technical.md`
- `docs/services/orchestrator/features.md`
- `docs/services/orchestrator/agent.md`
- `apps/code-agent` docs/API docs if they document execution submission semantics

Work:
- Document Execution Agent prompt contract and verifier rules
- Document `EXECUTION_AGENT_FINAL` (without Turn summary)
- Document `gh` CLI PR creation requirement in worker prompts
- Document deterministic Linear enforcement ownership split (worker GitHub / code-agent Linear)
- Document flattened `execution_*` webhook result fields
- Replace remaining phase-based execution wording in authoritative docs touched by this path

## Detailed Implementation Verification Checklist

### A. Repo / Session / Branch Preconditions

- [ ] Branch is `planning-agent` (or designated execution-agent implementation branch if split later)
- [ ] Working tree clean before starting implementation
- [ ] `direnv allow` run in repo root
- [ ] Required env vars check passed
- [ ] `pnpm build` passed at session start (or rerun if stale after major refactor)

### B. Execution Agent Prompt Contract (orchestrator)

- [ ] Prompt includes `[WORKER-MODE]`
- [ ] Prompt includes `[AGENT:EXECUTION]`
- [ ] Prompt no longer includes `[PHASE:2]`
- [ ] Prompt does not instruct `/linear`
- [ ] Prompt states system prompt is source of truth; user prompt is secondary
- [ ] Prompt mandates `superpowers:executing-plans` first
- [ ] Prompt mandates `superpowers:requesting-code-review` after implementation/PR
- [ ] Prompt explicitly documents `gh` CLI PR creation flow (`gh pr create`, not plain git-only)
- [ ] Prompt includes strict subagent rules for non-trivial tasks
- [ ] Prompt documents trivial-task exception for subagents
- [ ] Prompt requires `EXECUTION_AGENT_FINAL`
- [ ] Prompt execution final block no longer includes Turn summary

### C. `EXECUTION_AGENT_FINAL` Contract + Verifier Enforcement

- [ ] Verifier uses Gemini semantic validation (Claude-response-only)
- [ ] Verifier does not use regex parsing for Execution Agent final block
- [ ] Verifier uses latest response first
- [ ] Verifier uses previous responses only as fallback
- [ ] Verifier ignores runtime signals for completion verdict
- [ ] Verifier enforces outcome `implemented`
- [ ] Verifier enforces `superpowers_executing_plans_used=1`
- [ ] Verifier enforces `superpowers_requesting_code_review_used=1`
- [ ] Verifier enforces skill sequence proof (executing-plans before requesting-code-review)
- [ ] Verifier enforces `trivial_task` presence
- [ ] Verifier enforces subagent list required for non-trivial tasks
- [ ] Verifier allows empty/none subagents only for trivial tasks
- [ ] Verifier enforces PR URL presence
- [ ] Verifier enforces CI evidence statement presence
- [ ] Verifier enforces review iterations presence
- [ ] Verifier enforces executed issue Linear URL presence
- [ ] Verifier hard-fails wrong-issue mismatch vs routed target issue
- [ ] Verifier returns targeted gap-fill resume instructions (not rewrite-all by default)
- [ ] Verifier extracts flattened `execution_*` metadata

### D. Orchestrator Execution Webhook Result Mapping

- [ ] Successful execution-agent completion sends webhook `status=completed`
- [ ] Generic execution failures send webhook `status=failed`
- [ ] `result` preserves existing compatibility fields (`prUrl`, `summary`, etc.)
- [ ] `result` includes exact flattened `execution_*` keys
- [ ] Wrong-issue mismatch does not produce success webhook
- [ ] Resume prompts reference `EXECUTION_AGENT_FINAL`

### E. `code-agent` Deterministic Linear Enforcement (execution success)

- [ ] `code-agent` detects execution-agent completion via `agentType=execution`
- [ ] `code-agent` validates routed issue vs `execution_linear_issue_url` (hard fail on mismatch)
- [ ] `code-agent` requires `result.prUrl` before mutating Linear
- [ ] `code-agent` adds PR URL comment on executed issue only
- [ ] `code-agent` moves executed issue to `In Review`
- [ ] `code-agent` keeps label `code-task` on executed issue
- [ ] `code-agent` does not mutate parent planning issue
- [ ] `code-agent` does not mutate original issue
- [ ] Task status becomes `implemented` only after deterministic enforcement succeeds

### F. `code-agent` Failure Handling (execution)

- [ ] Generic execution failures cause no Linear mutations
- [ ] Wrong-issue mismatch causes no Linear mutations
- [ ] Deterministic Linear enforcement errors fail task (strict fail)
- [ ] Errors are logged clearly with routed issue ID and worker-reported issue URL for diagnosis

### G. Legacy `submitToPhase2` Replacement / Rename

- [ ] Use case renamed/replaced with execution-agent terminology
- [ ] Route metadata (`operationId`, summary, description) no longer says Phase 2
- [ ] Internal comments/logs/tests no longer use phase-2 wording in active execution path
- [ ] Route path `/code/tasks/:taskId/implement` remains compatible (unless explicitly changed later with UI)

### H. Documentation Verification

- [ ] Orchestrator docs describe Execution Agent contract and routing role
- [ ] Docs use `EXECUTION_AGENT_FINAL` (no `PHASE2_FINAL` in updated authoritative sections)
- [ ] Docs mention `gh` CLI PR creation requirement
- [ ] Docs document worker GitHub / code-agent Linear ownership split
- [ ] Docs include flattened `execution_*` result fields
- [ ] UI fixes explicitly noted as later step
- [ ] Tables formatted (`pnpm run format:docs-tables`)

## Detailed Testing Plan (must be fully implemented)

### Testing Principles

- Tests first for behavior changes where practical
- Confirm new tests fail before implementation for representative cases
- No external network deps; use fakes/mocks/`nock`
- Preserve coverage thresholds; do not relax coverage config
- Prefer real branch coverage over `v8 ignore`

### Test Suites and Required Cases

#### 1. `workers/orchestrator` prompt tests (`system-prompt`)

Add/update assertions for Execution Agent prompt:
- includes `[WORKER-MODE]`
- includes `[AGENT:EXECUTION]`
- excludes `[PHASE:2]`
- excludes `/linear` execution instruction
- includes system-prompt-authority rule
- includes mandatory `superpowers:executing-plans`
- includes mandatory `superpowers:requesting-code-review`
- includes `gh` CLI PR creation instructions (`gh pr create`)
- includes strict subagent requirements + trivial exception
- requires `EXECUTION_AGENT_FINAL`
- execution final block excludes Turn summary

#### 2. `workers/orchestrator` Execution Agent verifier tests (`completion-verifier`)

Create/update fixtures (Claude latest + prior responses) covering:
- valid `implemented` with all required fields and proofs
- missing `EXECUTION_AGENT_FINAL` -> fail with targeted gap
- missing PR URL -> fail
- missing CI evidence statement -> fail
- missing review iterations -> fail
- missing superpower field(s) -> fail
- superpower field `0` -> fail
- missing skill sequence proof -> fail
- non-trivial with empty subagent list -> fail
- trivial with empty/none subagents -> pass
- wrong Linear issue URL vs routed target -> hard fail
- malformed URLs -> fail
- latest-response-first behavior (proof only in prior response) -> fallback behavior validated
- vague/sloppy prose causing ambiguity -> fail with precise missing criteria

Assertions:
- no regex parser path used for execution verification
- no runtime signals used to pass execution verification
- flattened `execution_*` extraction present on pass
- confidence returned but not threshold-gated

#### 3. `workers/orchestrator` dispatcher/result mapping tests (`task-dispatcher`)

Add/update tests for execution completion mapping:
- `implemented` -> webhook `completed` with existing `result` fields + exact `execution_*`
- generic execution verifier failure -> webhook `failed` (no success enrichment)
- wrong-issue mismatch -> fails before success webhook
- retry/resume prompt uses `EXECUTION_AGENT_FINAL` and targeted missing fields

#### 4. `apps/code-agent` webhook route tests (`/internal/webhooks/task-complete`)

Add/update tests for execution-agent path:
- completed execution task with matching `execution_linear_issue_url` + `prUrl` -> comment + `In Review`
- mismatch between routed issue and `execution_linear_issue_url` -> fail, no Linear mutations
- missing `prUrl` on completed execution -> fail/no mutations (or explicit handling path)
- generic execution failed webhook -> no Linear mutations
- ensures no ancestor issue mutations occur
- task status `implemented` only after enforcement success

#### 5. `apps/code-agent` Linear service tests (execution enforcement helpers)

Add tests for:
- PR comment posting on executed issue
- `markInReview` call behavior and error propagation
- no-op/absence of ancestor mutation helpers in execution path
- strict failure propagation when Linear mutation fails

#### 6. `apps/code-agent` execution submission path tests (`submitToExecutionAgent` replacement)

Add/update tests for renamed flow:
- route `/code/tasks/:taskId/implement` calls renamed use case
- legacy phase wording removed from route metadata and logs
- eligibility checks still require correct task readiness semantics after agent-based rename
- dispatch payload uses `agentType=execution` (not `executionPhase`)

#### 7. Contract compatibility tests (orchestrator <-> `code-agent`)

Add fixtures/assertions for exact webhook payload compatibility:
- required `execution_*` keys present and named correctly
- `execution_outcome_label=implemented`
- `result.prUrl` still present and used by `code-agent`
- no legacy `PHASE2_FINAL` assumptions in new execution path
- no `executionPhase` field in new contracts

### Weak-LLM / Sloppy Output Regression Fixtures (must include)

Create execution-verifier fixtures for likely low-quality outputs:
- claims skills used but omits 0/1 proof fields
- includes both superpower fields but no ordering proof
- non-trivial task with generic “used subagents” text but no explicit list
- trivial task marked `0` with no subagents list
- wrong Linear issue URL copied into final block
- malformed PR URL
- missing CI evidence line but says “tests passed” vaguely
- review iterations omitted or non-numeric/vague
- latest response says “done” while proof exists only in older response

Expected behavior:
- strict fail with precise gap-targeted resume instructions

### Test Commands (implementation verification sequence)

Run from repo root unless noted.

1. Targeted orchestrator tests during prompt/verifier/result work:
   - `pnpm --filter orchestrator vitest run src/services/__tests__/system-prompt.test.ts`
   - `pnpm --filter orchestrator vitest run src/services/__tests__/completion-verifier.test.ts`
   - `pnpm --filter orchestrator vitest run src/services/__tests__/task-dispatcher.test.ts`

2. Targeted `code-agent` tests during execution webhook/enforcement/rename work:
   - `pnpm --filter code-agent vitest run src/routes/__tests__/webhooks.test.ts`
   - `pnpm --filter code-agent vitest run src/__tests__/routes/codeRoutes.test.ts`
   - `pnpm --filter code-agent vitest run src/**/__tests__/*submit*Execution*.test.ts`
     - If renamed file pattern differs, run the exact renamed use-case test file directly
   - `pnpm --filter code-agent vitest run src/**/__tests__/*linearIssueService*.test.ts`

3. Workspace verification (tracked):
   - `pnpm run verify:workspace:tracked -- orchestrator`
   - `pnpm run verify:workspace:tracked -- code-agent`

4. Docs formatting:
   - `pnpm run format:docs-tables`

5. Full CI gate before commit:
   - `pnpm run ci:tracked`

### Required Evidence to Record During Implementation

- Representative failing test output before each major stream change
- Passing targeted test output after each stream
- Verifier test outputs showing wrong-issue mismatch fail and subagent/trivial rule enforcement
- `pnpm run format:docs-tables` output (if docs updated)
- Final `pnpm run ci:tracked` pass output
- Terraform change check result (`No terraform changes` expected unless touched)

## Acceptance Criteria

- Execution Agent prompt is fully orchestrator-defined and no longer depends on `/linear` skill
- `EXECUTION_AGENT_FINAL` replaces `PHASE2_FINAL` with agent-based naming and no Turn summary
- Execution verification uses Gemini semantic checks only (Claude-response-only, latest-first, no regex, no runtime signals)
- Mandatory superpower proofs and skill-order proof are enforced
- Non-trivial execution requires explicit subagent list; trivial execution may skip subagents
- Wrong-issue mismatch hard-fails with no Linear mutations
- `code-agent` deterministically enforces executed-issue-only Linear updates on success
- Generic execution failures cause no Linear mutations
- `submitToPhase2` flow is replaced/renamed to execution-agent terminology in backend contracts
- `execution_*` flattened webhook result fields are present and documented
- Orchestrator/code-agent execution flow is complete end-to-end (UI fixes deferred)
- Tests cover all new branches and weak-LLM regression cases
- `pnpm run ci:tracked` passes before merge/commit of implementation work

## Implementation Branch

Continue on:
- Branch from `origin/development`
- Branch name: `planning-agent`
