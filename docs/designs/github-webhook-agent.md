# GitHub Webhook Agent — Design Document

## Overview

The GitHub Webhook Agent is a domain-layer orchestrator inside `code-agent` that owns the decision pipeline for incoming GitHub webhook events. It determines what action to take (create task, send message, dispatch worker, notify chat) without delegating decision-making to Claude worker prompts.

**Parent issue:** INT-631

## Ownership Contract

The agent and the Claude worker have non-overlapping responsibilities:

| Responsibility              | Owner              | Location                                              |
| --------------------------- | ------------------ | ----------------------------------------------------- |
| Event classification        | GitHub Agent       | `eventFamilies.ts`, `rules.ts`                        |
| Sender allowlist            | GitHub Agent       | `rules.ts` (sender_not_allowed check)                 |
| Actionability detection     | GitHub Agent       | `rules.ts` (deterministic), `planner.ts` (LLM)        |
| Worker type selection       | GitHub Agent       | `directiveParser.ts`                                  |
| Action plan compilation     | GitHub Agent       | `actionCompiler.ts`                                   |
| Plan validation             | GitHub Agent       | `validator.ts`                                        |
| Processing marker           | GitHub Agent       | `tools.ts` (mark_processing step)                     |
| Task dispatch               | GitHub Agent       | `tools.ts` (dispatch_task step)                       |
| Chat notification           | GitHub Agent       | `notifier.ts`, `tools.ts` (notify_chat step)          |
| CI failure repair detection | GitHub Agent       | `eventFamilies/githubActionResult.ts`                 |
| PR conflict detection       | GitHub Agent       | `eventFamilies/pullRequest.ts`                        |
| Code execution              | Claude Worker      | Worker prompt + Claude CLI                            |
| PR comment generation       | Claude Worker      | Worker prompt context                                 |
| File modifications          | Claude Worker      | Worker sandbox                                        |

### Boundary Rules

1. The agent never generates code or modifies repository files.
2. The worker never decides whether to act on an event — it receives explicit instructions.
3. The agent compiles a delegation brief (`delegationBrief.ts`) with structured instructions for the worker.
4. Ownership of the processing marker and final reply is controlled by rollout flags, not hardcoded.

## Architecture

```
GitHub Webhook
    │
    ▼
┌─────────────────────────────────────────────┐
│  Route Layer (webhooks/github.ts)           │
│  - Parses payload, saves event              │
│  - Fires processGitHubWebhookEvent (async)  │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  processEvent.ts                            │
│  - Classifies event group                   │
│  - Branches: github_action_result → repair  │
│              pull_request/comment → rules   │
│  - Compiles action plan                     │
│  - Validates plan                           │
│  - Executes or records (based on mode)      │
└─────────────────────────────────────────────┘
    │                              │
    ▼                              ▼
┌──────────────┐    ┌──────────────────────────┐
│  Rules       │    │  Event Family Evaluators  │
│  (generic)   │    │  - githubActionResult.ts  │
│              │    │  - pullRequest.ts         │
└──────────────┘    └──────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  Action Compiler → Validator → Executor     │
│  - Compiles steps (mark, dispatch, notify)  │
│  - Validates plan against context           │
│  - Executes steps with idempotency          │
└─────────────────────────────────────────────┘
```

## Processing Pipeline

1. **Event Classification** — `groupWebhookEvent()` maps event type + action to a group: `pull_request`, `comment`, `github_action_result`, `other`.

2. **Decision Routing** — `processEvent.ts` branches:
   - `github_action_result` → `evaluateWorkflowRepairEligibility()` (ordered guard checks)
   - `pull_request`/`comment` → `evaluateWebhookActionabilityRules()` (generic rules engine)

3. **Decision Kinds** — The pipeline produces one of:
   - `noop` — No action needed
   - `send_task_message` — Forward to existing active task
   - `create_pr_comment_task` — Create new task for PR/comment
   - `create_code_action` — Dispatch code-fixing worker (CI repair, conflict resolution)

4. **Action Compilation** — `compileWebhookActionPlan()` converts the decision into executable steps.

5. **Validation** — `validateWebhookActionPlan()` checks plan consistency (user mapping, existing task state).

6. **Execution** — `executeWebhookActionPlan()` runs steps sequentially with idempotency guards.

## Event Family Extension Pattern

To add a new event family (e.g., deployment events):

1. Add the event group value to `WebhookEventGroupSchema` in `models.ts`.
2. Add event type mappings in `eventFamilies.ts` (`EVENT_GROUP_MAPPINGS`).
3. Create an evaluator in `eventFamilies/<name>.ts` following the pattern:
   - Define `Input`, `Deps`, and `Result` interfaces
   - Implement an evaluation function with ordered guard checks
   - Return `{ eligible, decisionKind, reasonCode, reasoning }`
4. Wire the evaluator into `processEvent.ts` with a branch on `eventGroup`.
5. Update the replay harness for dry-run testing.
6. Add parser support in `infra/github-event-parser.ts` if needed.

The executor and action compiler require no changes — they operate on `DecisionKind`, which is shared across all families.

### Extension Examples

**workflow_run (CI failure repair):** `eventFamilies/githubActionResult.ts` evaluates event type, action, failure conclusion, PR linkage, protected branch, and duplicate suppression. Returns `create_code_action` for eligible failures.

**pull_request (conflict resolution):** `eventFamilies/pullRequest.ts` evaluates event type, PR linkage, mergeable state (dirty/unknown/clean), protected branch, and duplicate suppression. Returns `create_code_action` for confirmed conflicts, defers for unknown mergeability.

## Key Files

| File                              | Purpose                                   |
| --------------------------------- | ----------------------------------------- |
| `config/githubWebhookAgentConfig` | Rollout flags and env var loading         |
| `domain/.../models.ts`            | Zod schemas for decisions, plans, steps   |
| `domain/.../rules.ts`             | Deterministic actionability rule engine   |
| `domain/.../planner.ts`           | LLM-based planner for uncertain events    |
| `domain/.../plannerPrompt.ts`     | Prompt builder for planner                |
| `domain/.../directiveParser.ts`   | Worker type directive extraction          |
| `domain/.../actionCompiler.ts`    | Decision-to-action-plan compiler          |
| `domain/.../validator.ts`         | Plan consistency validator                |
| `domain/.../executor.ts`          | Sequential step executor with idempotency |
| `domain/.../tools.ts`             | Action tool wrappers                      |
| `domain/.../notifier.ts`          | Chat notification builder                 |
| `domain/.../delegationBrief.ts`   | Structured worker instructions            |
| `domain/.../logging.ts`           | Structured logging and redaction          |
| `domain/.../contextLoader.ts`     | Event context enrichment                  |
| `domain/.../eventFamilies.ts`     | Event group classification registry       |
| `domain/.../replayHarness.ts`     | Dry-run replay for regression testing     |
| `domain/.../processEvent.ts`      | Main orchestrator entry point             |
| `infra/runLogRepository.ts`       | Run record persistence                    |
| `infra/idempotencyLease.ts`       | Idempotency lease management              |
