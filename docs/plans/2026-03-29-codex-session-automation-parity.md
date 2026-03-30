# Codex Session Automation Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep only the highest-value Claude hook guarantees for orchestrated Codex runs, make the owner of each guarantee explicit, and emit non-interactive evidence that proves the retained guarantees executed.

**Architecture:** Do not port Claude hooks one-for-one. Keep bootstrap/runtime proof in the shared code-worker image, keep execution-contract enforcement in the orchestrator prompt and validators, and document the dropped Claude-only behaviors explicitly so Codex is not judged against interactive hook UX it does not have.

**Tech Stack:** Bash, TypeScript, Vitest, Markdown docs, Codex CLI, orchestrator prompt/verifier flow

---

## Endpoint Changes

### Modified

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| None | - | - | No HTTP endpoint contract changes are required for the minimum parity slice |

### Created

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| None | - | - | No new HTTP endpoints |

### Removed

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| None | - | - | No endpoint removals |

### Unchanged

| Service | Method | Path | Change |
| --- | --- | --- | --- |
| `workers/orchestrator` | `POST` | `/tasks` | Dispatch flow stays unchanged; only prompt/validation wording changes |
| `apps/code-agent` | `POST` | `/internal/webhooks/task-complete` | Completion webhook schema stays unchanged for this minimum slice |

## Current Claude Hook Parity Matrix

| Claude hook behavior | Current Claude owner | Codex bucket | Retained? | Codex owner | Observable evidence |
| --- | --- | --- | --- | --- | --- |
| Session-start build and env readiness (`session-start-build.sh`) | Repo hook at session start | Codex-side startup/bootstrap logic | Yes | `workers/code-worker/entrypoint.sh` | `[entrypoint] Bootstrap evidence: ...` plus startup log lines for GCP auth, secret sync, and env loading |
| CI output capture reminders (`validate-ci-output-capture.sh`) | PreToolUse block | Orchestrator/runtime contract | Yes | Execution prompt + completion/deep validation | Transcript shows `pnpm run ci:tracked`; deep validator checks final claims against transcript |
| Terraform emulator clearing (`validate-terraform.sh`) | PreToolUse block | Orchestrator/runtime contract | Yes | Execution prompt + repo rules | Transcript shows compliant Terraform invocation when used; prompt explicitly instructs the rule |
| GCloud resource-creation guardrail (`validate-gcloud-resources.sh`) | PreToolUse block | Orchestrator/runtime contract | Yes | Execution prompt + repo rules | Transcript shows Terraform-based path or absence of forbidden direct creation |
| Coverage reminders and v8-ignore nudges | PreToolUse/PostToolUse hook mix | Codex-side startup/bootstrap/config logic | No | Repo rules + tests already enforced in CI | CI remains the proof; no Codex hook parity layer added |
| TypeScript / route anti-pattern reminders (`detect-common-patterns.sh`) | PostToolUse soft block | Intentionally Claude-only and explicitly dropped for Codex | No | None | Explicitly documented as dropped |
| Rebuild after git / typecheck after edit reminders | PostToolUse automation | Intentionally Claude-only and explicitly dropped for Codex | No | None | Explicitly documented as dropped |
| Completion final-block validation (`completion-validator.sh`) | Stop hook | Better enforced in orchestrator/runtime instead of Codex config | Yes | Orchestrator completion verifier | Final execution block + webhook completion result |
| Ownership language enforcement (`ownership-check.sh`) | Stop hook | Better enforced in orchestrator/runtime instead of Codex config | Yes | Execution prompt + deep validator | Prompt contract plus transcript/deep-validation evidence |
| Evidence-before-assertions enforcement (`evidence-check.sh`) | Stop hook | Better enforced in orchestrator/runtime instead of Codex config | Yes | Execution prompt + deep validator | Transcript must contain verification evidence; deep validator checks claims vs transcript |

## Minimum Viable Parity Scope

1. Emit one stable startup summary line from the shared code-worker image so Codex runs have machine-readable bootstrap proof without repo hooks.
2. Emit one stable Codex runtime summary line per attempt so fresh-vs-resume behavior and reasoning mode are visible in logs.
3. Teach the execution prompt and deep validator to treat those evidence lines as the retained Codex parity proof.
4. Document which Claude hook behaviors are retained, moved, or intentionally dropped so future work does not reintroduce duplicate enforcement.

## Task 1: Add retained Codex parity evidence to the worker runtime

**Files:**
- Modify: `workers/code-worker/entrypoint.sh`
- Test: `workers/orchestrator/src/services/isolation/__tests__/worker-image.test.ts`

- [ ] **Step 1: Write the failing evidence test**
  Add expectations for:
  - `[entrypoint] Bootstrap evidence:`
  - `[entrypoint] Codex runtime evidence:`
  - explicit bootstrap keys like `codex_skills=` and `github_token=`

- [ ] **Step 2: Run the focused test and confirm failure**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/isolation/__tests__/worker-image.test.ts
  ```

  Expected: FAIL because `entrypoint.sh` does not yet emit the new evidence lines.

- [ ] **Step 3: Implement the startup/runtime evidence lines**
  Add shell state tracking for:
  - Codex skill discovery restore status
  - GitHub token setup status
  - GCP auth status
  - secret sync status
  - envrc load status

  Emit:
  - one startup summary line after bootstrap
  - one Codex runtime summary line before `codex exec`

- [ ] **Step 4: Re-run the focused test**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/isolation/__tests__/worker-image.test.ts
  ```

  Expected: PASS

## Task 2: Make orchestrator prompt/validation consume the retained parity proof

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts`
- Modify: `workers/orchestrator/src/services/execution-deep-validator.ts`
- Test: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Test: `workers/orchestrator/src/services/__tests__/execution-deep-validator.test.ts`

- [ ] **Step 1: Write the failing prompt/validator tests**
  Add expectations that the execution prompt:
  - explicitly says Codex does not reproduce Claude hooks one-for-one
  - names the retained evidence lines
  - points completion enforcement at the orchestrator verifier/deep validator

  Add expectations that the deep validator prompt:
  - checks for the bootstrap/runtime evidence lines in Codex transcripts

- [ ] **Step 2: Run the focused tests and confirm failure**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/__tests__/system-prompt.test.ts
  pnpm --filter orchestrator test -- src/services/__tests__/execution-deep-validator.test.ts
  ```

  Expected: FAIL because the new parity section and validator instructions are missing.

- [ ] **Step 3: Implement the prompt/validator changes**
  Add:
  - a Codex session automation parity section to the execution prompt
  - Codex bootstrap/runtime evidence checks to the deep validator prompt
  - required prompt-version bumps

- [ ] **Step 4: Re-run the focused tests**

  Run:

  ```bash
  pnpm --filter orchestrator test -- src/services/__tests__/system-prompt.test.ts
  pnpm --filter orchestrator test -- src/services/__tests__/execution-deep-validator.test.ts
  ```

  Expected: PASS

## Task 3: Publish the parity matrix and retained-scope rationale

**Files:**
- Create: `docs/plans/2026-03-29-codex-session-automation-parity.md`

- [ ] **Step 1: Document the hook inventory and classification**
  Include:
  - keep/move/bootstrap/drop decision for each material Claude hook behavior
  - owner per retained behavior
  - log/transcript/result evidence for each retained behavior

- [ ] **Step 2: Self-check the matrix**
  Verify the doc:
  - does not duplicate enforcement across repo hook, worker bootstrap, and orchestrator runtime
  - explicitly marks Claude-only interactive behaviors as dropped
  - matches the implementation shipped in Tasks 1 and 2

## Verification

Run from repo root:

```bash
pnpm --filter orchestrator test -- src/services/isolation/__tests__/worker-image.test.ts
pnpm --filter orchestrator test -- src/services/__tests__/system-prompt.test.ts
pnpm --filter orchestrator test -- src/services/__tests__/execution-deep-validator.test.ts
pnpm run ci:tracked
```
