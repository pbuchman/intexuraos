# Orchestrator Agent-Based Routing + Planning Agent Contract Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:writing-plans` when executing this plan.

## Goal

Replace legacy phase-based orchestration terminology and routing with an agent-based model, and introduce a strict Planning Agent contract with deterministic Linear enforcement owned by `code-agent`.

## Scope

- `workers/orchestrator` routing, prompt markers, final-block names, verifier behavior (Planning Agent only), webhook payload/result shaping, docs.
- `apps/code-agent` internal contract rename (`executionPhase` -> `agentType`), status rename (`designed` -> `planned`), webhook handling, deterministic Linear enforcement for Planning Agent outcomes, migration.
- Test coverage and verification checklist for all impacted areas.

## Non-Goals

- Implement or fix Execution Agent behavior beyond shared renames/contracts needed for this refactor.
- Backward compatibility for legacy final block names or legacy internal fields.
- Mutating Linear issues during migration.

## Architecture Summary (Authoritative)

### Agent Types (internal)

- `planning`
- `execution`
- `pull_request`

### Routing Precedence (orchestrator)

1. PR / issue comment / review event -> `pull_request` agent
2. Otherwise, Linear issue without `code-task` -> `planning` agent
3. Otherwise, Linear issue with `code-task` -> `execution` agent

### Prompt Markers

Keep:
- `[WORKER-MODE]`

Add exactly one:
- `[AGENT:PLANNING]`
- `[AGENT:EXECUTION]`
- `[AGENT:PULL_REQUEST]`

### Final Block Names (no backward compatibility)

- `PLANNING_AGENT_FINAL`
- `EXECUTION_AGENT_FINAL`
- `PULL_REQUEST_AGENT_FINAL`

### Internal Contract Renames (no backward compatibility)

- `executionPhase` -> `agentType`
- `designed` task status -> `planned`

## Planning Agent Contract (Authoritative)

### Required Input

- Original Linear issue

### Outcome: `planned`

Required:
- New planning issue (meaningful user-story title; no `[PLAN]` prefix)
- Planning issue must be a child of the original issue (`parentId`)
- `superpowers:writing-plans` must be used

Optional / conditional:
- Planning subtasks (children/descendants of the planning issue)
- Planning PR with plan docs in `docs/plans/...`
- For non-trivial tasks, planning PR + `docs/plans/...` is required

### Outcome: `unclear`

Required:
- No artifact required by the verifier
- Clear clarification/error message (what happened, what is missing/needed next)

Artifacts created accidentally on `unclear` are ignored by the system.

### Planning Rules (Prompt Requirements)

- No implementation coding allowed
- Creating/updating plan docs under `docs/plans/` and opening a planning PR is allowed (and required for non-trivial planning)
- System prompt is source of truth; user prompt is secondary
- `superpowers:writing-plans` is mandatory and non-negotiable
- Non-trivial tasks must begin with explicit parallel work breakdown for multi-subagent execution
- Split work by service/package groups
- Parallelism is preferred over sequential dependencies
- Trivial vs non-trivial is agent judgment (not deterministic heuristics)
- Runtime planning PR branch naming convention: `plan/short-slug`

## `PLANNING_AGENT_FINAL` Semantic Contract (Gemini-verified, no regex)

Gemini validates semantic completeness from Claude responses only (latest response first, previous couple only as fallback). No regex parsing for Planning Agent final block. No runtime signal use for Planning Agent completion validation.

### Required for all Planning Agent outcomes

- `PLANNING_AGENT_FINAL`
- Outcome label: `planned|unclear`
- `superpowers_writing_plans_used: 0|1` and it must be `1`
- Original issue URL
- Summary

### Required when outcome = `planned`

- Planning issue URL
- Trivial/non-trivial indicator (`0|1`)
- Explicit proof of parallel breakdown for non-trivial tasks
- For non-trivial: `docs/plans/...` path and planning PR URL

### Required when outcome = `unclear`

- Clear clarification/error message (specific and actionable)

## Planning Agent Gemini Verifier Rules

- Evidence source: Claude responses only
- Primary evidence: most recent Claude response
- Previous responses: fallback only
- Confidence: informational only (no pass threshold)
- If missing/ambiguous: fail with targeted gap-fill instruction (do not ask to rewrite everything unless unusable)
- For `unclear`: derive a normalized clarification message for `code-agent`
- Verifier must enforce presence of outcome intent and distinguish `planned` vs `unclear`
- Verifier must enforce `superpowers_writing_plans_used=1`

## Orchestrator -> `code-agent` Webhook Mapping (Planning Agent)

### `planned` outcome

- webhook `status = completed`
- flattened `planning_*` metadata in `result`

### `unclear` outcome

- webhook `status = failed`
- `error.code = PLANNING_AGENT_UNCLEAR`
- include flattened `planning_*` metadata in `result` (plus `error`)

### Other Planning Agent failures (worker crash, contract failure, verifier unavailable, etc.)

- webhook `status = failed`
- no deterministic Linear mutations in `code-agent`

## Flattened `planning_*` Result Fields (Locked Exact Keys)

Use flattened `planning_*` keys in webhook `result` for Planning Agent runs.

| Key                                       | Required                           | Values / Notes                                |
| ----------------------------------------- | ---------------------------------- | --------------------------------------------- |
| `planning_outcome_label`                  | All Planning Agent results         | `planned` or `unclear`                        |
| `planning_superpowers_writing_plans_used` | All Planning Agent results         | `0` or `1`                                    |
| `planning_issue_url`                      | `planned`                          | Planning issue URL; empty for `unclear`       |
| `planning_trivial_task`                   | `planned`                          | `0` or `1`; empty for `unclear`               |
| `planning_doc_path`                       | Non-trivial `planned`              | `docs/plans/...`; empty otherwise             |
| `planning_pr_url`                         | Non-trivial `planned` when created | GitHub PR URL; empty otherwise                |
| `planning_clarification_message`          | `unclear`                          | Verifier-derived message; empty for `planned` |

Implementation note: use a consistent empty-string sentinel if that minimizes existing schema churn in `code-agent` webhook parsing.

## Deterministic Linear Enforcement (Owned by `code-agent`)

### Shared rules

- `code-agent` is the deterministic owner of Linear mutations after orchestrator completion callbacks
- Worker output is not trusted for deterministic state/label correctness
- Strict fail on any deterministic enforcement failure
- Duplicate comments are allowed (simplest retry behavior)
- Worker-selection labels are not copied to planning issue/subtasks

### Original issue label rules (all Planning Agent outcomes)

`code-agent` must enforce mutual exclusivity and remove routing label leakage:

- Ensure exactly one of `planned|unclear` is present on original issue
- Remove the opposite label if present
- Remove `code-task` from original issue after any Planning Agent run

### `planned` outcome enforcement order (must verify graph before mutations)

1. Verify relationship graph (no mutations yet):
   - planning issue is a child of original issue
   - planning issue descendants discovered recursively via `parentId`
2. If relationship graph verification fails -> fail task, no Linear mutations
3. Original issue mutations:
   - comment with planning issue link
   - move original issue to `In Review`
   - enforce original label = `planned` (and remove `unclear`)
   - remove `code-task`
4. Normalize planning issue and all descendants (recursive `parentId` tree only):
   - state = `Todo`
   - assignee = none
   - ensure label `code-task`
   - remove `planned` and `unclear` if present
5. If planning PR exists:
   - add Linear comment with PR URL on original issue
   - add Linear comment with PR URL on planning issue
6. Task status in `code-agent` -> `planned`

### `unclear` outcome enforcement

1. Ignore artifacts even if worker created them accidentally
2. Add comment on original issue with verifier-derived clarification/error message
3. Enforce original label = `unclear` (and remove `planned`)
4. Remove `code-task` from original issue
5. Do not move original issue state
6. Task status in `code-agent` -> `failed`

## Planning Artifact Discovery Rules (`planned` outcome)

- Anchor from `planning_issue_url`
- Discover artifacts by recursive `parentId` traversal only (planning issue + all descendants)
- Ignore non-hierarchical relations (`relatedTo`, `blocks`, `blockedBy`) for normalization
- `code-agent` verifies parent/child graph but does not repair broken relationships

## Endpoint Changes

### Modified

| Service                | Method | Path                               | Change                                                                                                                                                                                      |
| ---------------------- | ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator` | `POST` | `/tasks`                           | Request schema and internals rename `executionPhase` -> `agentType`; routing semantics shift to agent-based selection and markers                                                           |
| `apps/code-agent`      | `POST` | `/internal/webhooks/task-complete` | Webhook `result` schema extended with flattened `planning_*` fields; Planning Agent `unclear` path uses `status=failed` + `error.code=PLANNING_AGENT_UNCLEAR` while still carrying `result` |

### Created

| Service | Method | Path | Change           |
| ------- | ------ | ---- | ---------------- |
| None    | -      | -    | No new endpoints |

### Removed

| Service | Method | Path | Change               |
| ------- | ------ | ---- | -------------------- |
| None    | -      | -    | No endpoint removals |

### Unchanged

| Service                | Method                     | Path           | Change                                                                            |
| ---------------------- | -------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `workers/orchestrator` | `GET`                      | `/health`      | No path change; only internal routing/verifier behavior updates                   |
| `workers/orchestrator` | `POST`                     | `/admin/*`     | Unchanged endpoints                                                               |
| `apps/code-agent`      | Other webhook/admin routes | Existing paths | No path additions/removals; behavior changes isolated to task-complete processing |

## Parallel Implementation Streams (Mandatory split by service/package)

### Stream A — `workers/orchestrator`: agent routing + naming refactor

Files likely touched:
- `workers/orchestrator/src/types/*`
- `workers/orchestrator/src/routes.ts`
- `workers/orchestrator/src/services/task-dispatcher.ts`
- `workers/orchestrator/src/services/completion-verifier.ts`
- `workers/orchestrator` tests/fixtures

Work:
- Replace legacy phase-based internal names with agent-based names
- Route by event type + labels using precedence rules
- Rename final block references and prompt markers
- Keep `[WORKER-MODE]`

### Stream B — `workers/orchestrator`: Planning Agent system prompt

Files:
- `workers/orchestrator/src/services/system-prompt.ts`
- `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`

Work:
- Rewrite planning prompt as Planning Agent contract
- Add system-prompt-authority rule near top
- Add no-implementation-coding rule with `docs/plans`/planning-PR exception
- Add mandatory `superpowers:writing-plans`
- Add parallel-first breakdown requirements
- Require `PLANNING_AGENT_FINAL`

### Stream C — `workers/orchestrator`: Planning Agent Gemini verifier + artifact extraction

Files:
- `workers/orchestrator/src/services/completion-verifier.ts`
- `workers/orchestrator/src/services/__tests__/completion-verifier.test.ts`

Work:
- Remove regex-based validation for Planning Agent only
- Add Gemini prompt: Claude-response-only, latest-first, no signals
- Branch-aware validation for `planned` vs `unclear`
- Targeted missing-gap resume instructions
- Extract `planning_*` fields and clarification message for webhook payload

### Stream D — `workers/orchestrator`: webhook result flattening

Files:
- `workers/orchestrator/src/services/task-dispatcher.ts`
- typing files storing task result / webhook payload contracts

Work:
- Flatten Planning Agent metadata into webhook `result`
- Emit `completed` for `planned`
- Emit `failed` + `PLANNING_AGENT_UNCLEAR` for `unclear`
- Preserve non-Planning-Agent semantics except shared renames

### Stream E — `apps/code-agent`: internal contract rename + migration

Files likely touched:
- domain task model/repository types
- persistence adapters (`firestoreCodeTaskRepository`)
- use cases and route handlers referencing `executionPhase`
- tests

Work:
- Rename `executionPhase` -> `agentType`
- Rename task status `designed` -> `planned`
- Write migration for persisted records
- Fail startup if legacy values remain post-migration
- Do not mutate Linear issues as part of migration

### Stream F — `apps/code-agent`: deterministic Linear enforcement for Planning Agent outcomes

Files likely touched:
- `apps/code-agent/src/routes/webhookRoutes.ts`
- Linear service/client abstractions and adapters
- tests

Work:
- Handle Planning Agent `planned` and `unclear`
- Verify relationship graph before any mutations (`planned`)
- Recursively normalize planning issue + descendants (`parentId` tree)
- Enforce original issue label exclusivity + remove `code-task`
- Add required comments (planning issue link / planning PR URL / unclear clarification)
- No Linear mutations for non-`PLANNING_AGENT_UNCLEAR` failures
- Strict fail on any deterministic enforcement failure

### Stream G — Documentation updates (required)

Files:
- `workers/orchestrator/README.md`
- `docs/services/orchestrator/technical.md`
- `docs/services/orchestrator/features.md`
- `docs/services/orchestrator/agent.md`
- Additional docs as needed where phase terminology is still authoritative

Work:
- Replace phase-based language with agent-based model
- Document routing precedence
- Document final blocks and prompt markers
- Document Planning Agent `planned`/`unclear` outcomes
- Document orchestrator -> `code-agent` enforcement ownership split
- Document flattened `planning_*` webhook result fields

## Detailed Implementation Verification Checklist

### A. Repo + Branch Setup

- [ ] Working branch is `planning-agent` and tracks `origin/development`
- [ ] `direnv allow` run in repo root
- [ ] Required env vars check printed and passed
- [ ] `pnpm build` passed at session start

### B. Internal Contract Rename (`executionPhase` -> `agentType`, `designed` -> `planned`)

- [ ] All TypeScript types/interfaces updated in orchestrator and `code-agent`
- [ ] Firestore/task persistence models updated
- [ ] Webhook request/response typing updated
- [ ] Logging/metrics fields updated where contract names are emitted
- [ ] Tests/fixtures/JSON snapshots updated for renamed fields
- [ ] No lingering runtime references to `executionPhase` in active code paths
- [ ] No lingering `designed` status in active code paths (except migration logic/tests for legacy detection)

### C. Agent Routing + Prompt Marker Refactor (orchestrator)

- [ ] Orchestrator selects agent by precedence (PR/comment/review first)
- [ ] Label-based routing uses `code-task` presence/absence for issue tasks
- [ ] All original labels are passed through (including worker-selection labels)
- [ ] `[WORKER-MODE]` preserved
- [ ] Exactly one `[AGENT:*]` marker injected per worker prompt
- [ ] Legacy phase markers removed from active prompts

### D. Final Block Contract Names

- [ ] `PLANNING_AGENT_FINAL` enforced in Planning Agent prompt and verifier
- [ ] `EXECUTION_AGENT_FINAL` and `PULL_REQUEST_AGENT_FINAL` names updated in shared verifier/prompt references
- [ ] No backward compatibility for legacy final block names in active parsing/verification paths

### E. Planning Agent Prompt Requirements

- [ ] Prompt starts with explicit Planning Agent mode guidance (not legacy phase wording)
- [ ] Prompt clearly states: system prompt is source of truth; user prompt is secondary
- [ ] Prompt explicitly forbids implementation coding
- [ ] Prompt explicitly allows `docs/plans/` planning docs + planning PR (and requires for non-trivial)
- [ ] Prompt makes `superpowers:writing-plans` mandatory
- [ ] Prompt requires explicit parallel breakdown for non-trivial tasks
- [ ] Prompt requires service/package-based decomposition for non-trivial tasks
- [ ] Prompt defines meaningful user-story title requirement for planning issue (no prefix)
- [ ] Prompt requires outcome label on original issue (`planned|unclear`) in final block semantics

### F. Planning Agent Gemini Verifier (response-only)

- [ ] No regex-based validation used for Planning Agent final block
- [ ] Verifier uses Claude responses only (no runtime signals)
- [ ] Verifier checks most recent Claude response first
- [ ] Verifier uses previous responses only as fallback
- [ ] Verifier enforces `superpowers_writing_plans_used=1`
- [ ] Verifier distinguishes `planned` vs `unclear`
- [ ] `planned` requires artifact proofs and conditional non-trivial PR/docs evidence
- [ ] `unclear` requires explicit clarification message
- [ ] Resume instructions are gap-targeted (not rewrite-all unless unusable)
- [ ] Verifier emits extracted `planning_*` metadata for webhook result

### G. Orchestrator Webhook Result Mapping

- [ ] `planned` outcome -> webhook `status=completed`
- [ ] `unclear` outcome -> webhook `status=failed`
- [ ] `unclear` uses `error.code=PLANNING_AGENT_UNCLEAR`
- [ ] `unclear` failed payload still includes flattened `planning_*` metadata in `result`
- [ ] Non-Planning-Agent behavior unchanged except shared agent-based renames

### H. `code-agent` Planning Outcome Enforcement (planned)

- [ ] Relationship graph verification happens before any Linear mutations
- [ ] Planning issue must be child of original issue
- [ ] Descendant discovery uses recursive `parentId` tree only
- [ ] Non-hierarchical relations ignored for normalization
- [ ] Original issue receives planning issue link comment
- [ ] Original issue moved to `In Review`
- [ ] Original issue label exclusivity enforced: `planned` only (remove `unclear`)
- [ ] Original issue `code-task` removed
- [ ] Planning issue + descendants normalized: `Todo`, unassigned, label `code-task`
- [ ] Planning issue + descendants have `planned`/`unclear` labels removed if present
- [ ] If planning PR exists: PR URL comment added to original issue and planning issue
- [ ] Duplicate comments on retries are accepted (no dedupe logic)
- [ ] Task status set to `planned` only after deterministic enforcement succeeds

### I. `code-agent` Planning Outcome Enforcement (unclear)

- [ ] `unclear` does not require planning artifacts
- [ ] Stray artifacts are ignored if present
- [ ] Original issue gets verifier-derived clarification comment
- [ ] Original issue label exclusivity enforced: `unclear` only (remove `planned`)
- [ ] Original issue `code-task` removed
- [ ] Original issue state is not changed
- [ ] Task status set to `failed`

### J. Failure Handling

- [ ] Non-`PLANNING_AGENT_UNCLEAR` Planning Agent failures cause no Linear mutations in `code-agent`
- [ ] Deterministic enforcement failure in `code-agent` causes task failure (strict all-or-nothing)
- [ ] Partial Linear mutations are surfaced with clear logs/errors for retry/manual recovery

### K. Migration Verification

- [ ] Migration updates persisted records from legacy values to agent-based values
- [ ] Startup fails if legacy values remain after migration check
- [ ] Migration does not issue any Linear API calls
- [ ] Migration tests cover valid conversion + fail-fast behavior

### L. Documentation Verification

- [ ] Orchestrator docs updated with agent-based routing model and precedence
- [ ] Docs mention final block names and agent markers
- [ ] Docs describe Planning Agent `planned`/`unclear` paths
- [ ] Docs describe orchestrator vs `code-agent` ownership split for Linear mutations
- [ ] Docs list flattened `planning_*` webhook result fields
- [ ] Tables formatted (`pnpm run format:docs-tables`)

## Detailed Testing Plan (must be fully implemented)

### Testing Principles (project rules)

- Write tests before implementation changes where behavior changes are introduced
- Run failing test first to confirm test validity
- No external dependencies in tests; use in-memory fakes / `nock` as needed
- Preserve coverage thresholds (do not relax coverage config)
- Prefer tests over `v8 ignore`; use exemptions only as last resort with canonical category + reason

### Test Suites and Required Cases

#### 1. `workers/orchestrator` prompt tests (`system-prompt`)

Add/Update tests to assert Planning Agent prompt contains:
- `[WORKER-MODE]`
- `[AGENT:PLANNING]`
- system-prompt-authority rule
- no implementation coding rule
- explicit `docs/plans/` / planning PR exception for planning docs
- mandatory `superpowers:writing-plans`
- explicit parallel breakdown requirement for non-trivial tasks
- service/package split requirement
- `PLANNING_AGENT_FINAL` requirements

Also assert shared prompt references use new agent final block names and agent markers (Execution/Pull Request names only; behavior may remain otherwise unchanged).

#### 2. `workers/orchestrator` Planning Agent verifier tests (`completion-verifier`)

Create fixtures for Claude responses (latest + previous) covering:
- `planned` success with full artifacts
- `planned` non-trivial missing `docs/plans/...` -> fail + targeted gap instruction
- `planned` missing planning issue URL -> fail + targeted gap instruction
- `planned` with `superpowers_writing_plans_used=0` -> fail + targeted gap instruction
- `unclear` success with clear clarification message and no artifacts
- `unclear` missing clarification message -> fail
- latest-response-first behavior (latest missing proof, previous has proof; allowed only if verifier fallback rule accepts explicit references)
- malformed/sloppy worker output causing ambiguity -> fail with precise missing fields

Assertions:
- no regex parser path used for Planning Agent
- no runtime signal dependency in verdict
- `planning_*` extraction fields emitted in verifier result
- confidence returned but not used as pass threshold

#### 3. `workers/orchestrator` dispatcher/webhook mapping tests (`task-dispatcher`)

Add/update tests for Planning Agent completion handling:
- `planned` -> webhook `status=completed`, flattened `planning_*` in `result`
- `unclear` -> webhook `status=failed`, `error.code=PLANNING_AGENT_UNCLEAR`, flattened `planning_*` still present in `result`
- non-unclear verifier/worker failures -> no Planning Agent-specific enrichment beyond failure semantics
- routing precedence tests: PR/comment/review events select `pull_request` agent even when Linear issue labels exist
- label routing tests: no `code-task` -> `planning`, with `code-task` -> `execution`
- all labels forwarded to dispatch payload (worker-selection labels preserved)

#### 4. `apps/code-agent` webhook route tests (`/internal/webhooks/task-complete`)

Add/update tests for Planning Agent outcomes:
- `planned` success path triggers relationship verification before mutations
- `planned` relationship mismatch -> task failed, no Linear mutations
- `planned` recursive `parentId` traversal normalization of descendants
- `planned` original issue comment + state `In Review` + label exclusivity + `code-task` removal
- `planned` PR URL comments added to original and planning issue
- `unclear` failed webhook with `PLANNING_AGENT_UNCLEAR` triggers clarification comment + `unclear` label + `code-task` removal
- `unclear` does not move original issue state
- `unclear` ignores stray artifacts if `planning_issue_url` or PR fields are present
- non-`PLANNING_AGENT_UNCLEAR` planning failures cause no Linear mutations
- deterministic enforcement failure mid-sequence -> task failed

#### 5. `apps/code-agent` Linear service/client tests

Add tests for helpers used by deterministic enforcement:
- relationship graph verification (planning issue child of original)
- recursive descendant discovery via `parentId`
- label normalization helpers (add/remove exact labels)
- state and assignee normalization calls
- comment posting for planning link / PR link / clarification message
- error propagation for strict-fail behavior

#### 6. Migration tests (`code-agent`)

Add tests verifying:
- legacy `executionPhase` values migrated to `agentType`
- legacy `designed` status migrated to `planned`
- startup fails if legacy values remain after migration validation
- migration does not call Linear services

#### 7. Contract compatibility tests (orchestrator <-> `code-agent`)

Add fixtures/assertions ensuring webhook payload compatibility:
- exact flattened `planning_*` keys present and correctly named
- `planned` and `unclear` mapping consistency across services
- `agentType` values serialized/deserialized consistently
- no legacy field names accepted in new paths

### Weak-LLM / Sloppy Output Regression Fixtures (must include)

Create verifier fixtures for likely low-quality worker outputs:
- claims `superpowers:writing-plans` without explicit final field
- sequential checklist with no explicit parallel breakdown
- missing planning issue URL but says “created issue” in prose
- malformed PR URL / malformed Linear URL
- inconsistent `trivial` flag vs described multi-service work
- `unclear` outcome with vague message (“need more info”) lacking specifics
- evidence only in older response, latest response says “done” with no proof

Verifier expectations must produce precise, gap-targeted retry instructions.

### Test Commands (implementation verification sequence)

Run from repo root unless noted.

1. Targeted tests while implementing orchestrator prompt/verifier/routing:
   - `pnpm --filter orchestrator vitest run src/services/__tests__/system-prompt.test.ts`
   - `pnpm --filter orchestrator vitest run src/services/__tests__/completion-verifier.test.ts`
   - `pnpm --filter orchestrator vitest run src/services/__tests__/task-dispatcher.test.ts`

2. Targeted tests while implementing `code-agent` webhook/enforcement/migration:
   - `pnpm --filter code-agent vitest run src/routes/__tests__/webhookRoutes.test.ts`
   - `pnpm --filter code-agent vitest run src/**/__tests__/*migration*.test.ts`
   - `pnpm --filter code-agent vitest run src/**/__tests__/*linear*.test.ts`

3. Workspace verification (tracked):
   - `pnpm run verify:workspace:tracked -- orchestrator`
   - `pnpm run verify:workspace:tracked -- code-agent`

4. Docs formatting and verification:
   - `pnpm run format:docs-tables`

5. Full CI gate before commit:
   - `pnpm run ci:tracked`

### Required Evidence to Record During Implementation

- Failing test output before each major behavior change (at least one representative per stream)
- Passing targeted test output after each stream
- `pnpm run format:docs-tables` output (if docs changed)
- Final `pnpm run ci:tracked` pass output
- `git diff --name-only HEAD~1 | grep -E "^terraform/" ...` check result (likely no terraform changes)

## Acceptance Criteria

- Agent-based routing fully replaces phase-based routing terminology and internal contracts
- Planning Agent prompt/verifier contract is enforced with Gemini semantic validation (no regex for Planning Agent)
- `planned` and `unclear` outcomes are mapped correctly from orchestrator to `code-agent`
- `code-agent` deterministically enforces Linear state/label/comment rules for Planning Agent outcomes
- Relationship graph is verified before mutation for `planned` outcomes
- Recursive planning artifact normalization uses `parentId` descendants only
- Internal migrations completed (`agentType`, `planned`) with fail-fast checks for legacy values
- Orchestrator docs updated to reflect new agent-based model
- Tests cover all new branches and failure modes, including weak-LLM output fixtures
- `pnpm run ci:tracked` passes before merge/commit of implementation work

## Implementation Branch Requirement

When implementing this plan, create and use:

- Branch from `origin/development`
- Branch name: `planning-agent`
