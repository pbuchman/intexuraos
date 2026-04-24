# INT-1470 — Planning Evidence

**Task:** Ensure deterministic agent output with final parser
**Linear:** https://linear.app/pbuchman/issue/INT-1470/ensure-deterministic-agent-output-with-final-parser
**Code task:** https://intexuraos.cloud/#/code-tasks/task_8666b575-63b2-45f4-9e03-f997655af42b
**Timestamp:** 2026-04-24
**Classification:** PLAN-DOC (single worker — `workers/orchestrator` — no parallel subtasks possible per the "MAX 1 SUBTASK PER SERVICE/WORKER/AGENT" rule)

## Plan document

The complete, TDD-ready implementation plan already exists in the repo:

`docs/superpowers/plans/2026-04-24-deterministic-agent-final-parser.md`

It was authored and merged under INT-1469 (PR #1940). Re-authoring is unnecessary — this evidence PR acknowledges the existing plan and re-routes INT-1470 (the code-task issue) to it.

This PR also patches two execution-readiness gaps identified during plan review:

1. **Task 6.2 `gh pr create` template** now emits `INT-1470` in the title and `Fixes INT-1470` plus the required metadata block (`Linear`, `IntexuraOS Code Task`, `Worker Type`, `Model`) in the body, so the delivery step satisfies the repo PR contract (CLAUDE.md §Cross-Linking).
2. **Phase 3 file map** now explicitly schedules `task-dispatcher/metrics.ts`, `agent-compliance-validator.ts`, and the `CompletionAgentType` / `getLast50Lines` import migration in `task-dispatcher/prompts.ts` — all current `completion-verifier` public-surface consumers. Task 3.4 enumerates the full in-scope consumer list.

## Scope recap

- Replace the LLM-based completion verifier with a deterministic 3-stage parser (`locateFinalBlock` → `parseKeyValues` → `coerceFields`).
- Update all `completion-verifier` public-surface consumers (`task-dispatcher/webhook-callbacks.ts`, `task-dispatcher/metrics.ts`, `task-dispatcher/prompts.ts`, `agent-compliance-validator.ts`) to the canonical parsed-field shape and new type-module locations. Captured in the plan's Modified-files table and Phase 3 Task 3.4.
- Introduce `contracts.ts` as single source of truth for agent-emitted fields, with dual-read aliases for the execution agent's legacy `execution_memory_*` names.
- Rename `execution_memory_*` → `memory_*` in `execution-prompt.ts` (behavior-change prompt version bump).
- Route missing `AGENT_FINAL` blocks to `TASK_RUNTIME_HARD_ERROR`.
- Treat memory-field omissions as warn-only (no retry) for all tiers.
- Preserve the resume-summary LLM path (`extractResumeSummary`, `RESUME_SUMMARY_SCHEMA`) — only verification-era helpers are deleted.
- 130 real production fixtures already staged at `workers/orchestrator/src/__tests__/fixtures/completion-verifier/` drive a golden-file parametric test suite.

## Why no subtasks

All implementation files live under `workers/orchestrator/`. Per the planning contract, parallel subtasks require distinct service/worker/agent boundaries, so this task stays as a single PLAN-DOC deliverable and will be executed linearly by one execution agent using `superpowers:subagent-driven-development`.

## Endpoint changes

None. This refactor is internal to the orchestrator; the webhook wire format (`execution_memory_ids_used` etc.) is preserved by the dispatcher-side mapping in `task-dispatcher/webhook-callbacks.ts`.

## Follow-ups (tracked in the plan doc)

1. Alias-removal PR two releases after this lands.
2. Per-agent narrow typing helper for `coerceFields` output.
3. Weekly fixture auto-harvest cron for new worker models.
