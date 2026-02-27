# INT-631 GitHub Webhook Agent Implementation Task Sequence

- Parent issue: [INT-631](https://linear.app/pbuchman/issue/INT-631/feature-introduce-github-webhook-agent-ownership-orchestration)
- Generated: 2026-02-26
- Branch target: `development` (plan artifact only)
- Execution model: strict sequential child-task chain for less-skilled LLM agents

## Objective

Implement a code-agent `GitHubWebhookAgent` that owns webhook actionability decisions, GitHub-side processing markers, worker-type directive parsing, and user-visible chat notifications. Preserve current PR/comment behavior for MVP and prepare the same pattern for `workflow_run` failures and PR conflict routing.

## Validation Guarantees Required Across All Child Tasks

- LLM planner outputs must be schema-validated and semantically validated before any side effects
- Every side effect must be executed through a typed tool wrapper with idempotency and audit logging
- GitHub agent owns processing markers and event-processing responsibility; workers execute delegated code tasks only
- `pnpm run ci:tracked` must pass before commit for every implementation step

## Execution Order

| Seq | Tier | Issue                                                                                                                     | Title                                                                  | Blocked By | Delivers                                                                                                                                                   |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0    | [INT-632](https://linear.app/pbuchman/issue/INT-632/tier-0-define-webhook-agent-schemas-and-run-record-contracts)         | [tier-0] Define webhook agent schemas and run-record contracts         | None       | Create versioned runtime-validated schemas for decisions, plans, execution results, and run records used by the GitHub webhook agent.                      |
| 2   | 0    | [INT-633](https://linear.app/pbuchman/issue/INT-633/tier-0-add-run-log-repository-and-idempotency-lease)                  | [tier-0] Add run log repository and idempotency lease                  | INT-632    | Persist GitHub webhook agent runs and processing leases for replay-safe, idempotent execution.                                                             |
| 3   | 0    | [INT-634](https://linear.app/pbuchman/issue/INT-634/tier-0-add-structured-logging-and-redaction-helpers)                  | [tier-0] Add structured logging and redaction helpers                  | INT-633    | Create reusable structured logging helpers, step timers, and payload redaction utilities for webhook agent traceability.                                   |
| 4   | 0    | [INT-635](https://linear.app/pbuchman/issue/INT-635/tier-0-add-webhook-agent-rollout-flags-and-config)                    | [tier-0] Add webhook agent rollout flags and config                    | INT-634    | Add strongly-typed config and feature flags for shadow mode, execution mode, and ownership transfer toggles.                                               |
| 5   | 0    | [INT-636](https://linear.app/pbuchman/issue/INT-636/tier-0-add-chat-agent-internal-event-ingestion-endpoint)              | [tier-0] Add chat-agent internal event ingestion endpoint              | INT-635    | Create a chat-agent internal endpoint for idempotent system notifications from the GitHub webhook agent.                                                   |
| 6   | 1    | [INT-637](https://linear.app/pbuchman/issue/INT-637/tier-1-add-event-family-registry-and-context-loader)                  | [tier-1] Add event-family registry and context loader                  | INT-636    | Create event grouping and context loading primitives that normalize saved events into agent-ready context, with extension hooks for future event families. |
| 7   | 1    | [INT-638](https://linear.app/pbuchman/issue/INT-638/tier-1-add-deterministic-worker-type-directive-parser)                | [tier-1] Add deterministic worker-type directive parser                | INT-637    | Parse explicit worker-type directives from comment/review bodies in code-agent before any LLM planning.                                                    |
| 8   | 1    | [INT-639](https://linear.app/pbuchman/issue/INT-639/tier-1-add-deterministic-actionability-rule-engine)                   | [tier-1] Add deterministic actionability rule engine                   | INT-638    | Move obvious no-op/actionable detection into code-agent with explicit reason codes before planner calls.                                                   |
| 9   | 1    | [INT-640](https://linear.app/pbuchman/issue/INT-640/tier-1-add-planner-prompt-builder-and-decision-schema)                | [tier-1] Add planner prompt builder and decision schema                | INT-639    | Implement the versioned GitHub webhook planner prompt that returns structured decision JSON only.                                                          |
| 10  | 1    | [INT-641](https://linear.app/pbuchman/issue/INT-641/tier-1-add-llm-response-validation-pipeline-and-fail-closed-fallback) | [tier-1] Add LLM response validation pipeline and fail-closed fallback | INT-640    | Validate planner responses in three stages (schema, semantic, policy) and normalize invalid outputs to safe no-op decisions.                               |
| 11  | 1    | [INT-642](https://linear.app/pbuchman/issue/INT-642/tier-1-add-action-plan-compiler-and-policy-validator)                 | [tier-1] Add action plan compiler and policy validator                 | INT-641    | Compile validated decisions into typed action plans and enforce ownership/worker-type policies before execution.                                           |
| 12  | 1    | [INT-643](https://linear.app/pbuchman/issue/INT-643/tier-1-add-executor-tool-framework-with-step-audit-logs)              | [tier-1] Add executor tool framework with step audit logs              | INT-642    | Implement typed executor tool interfaces, step execution engine, and run-step audit recording with idempotency hooks.                                      |
| 13  | 2    | [INT-644](https://linear.app/pbuchman/issue/INT-644/tier-2-extend-createtaskforpr-with-workertype-selection)              | [tier-2] Extend createTaskForPR with workerType selection              | INT-643    | Allow PR-comment task creation to accept workerType selected by GitHub agent and record selection source.                                                  |
| 14  | 2    | [INT-645](https://linear.app/pbuchman/issue/INT-645/tier-2-add-action-wrappers-for-task-dispatch-and-chat-notify)         | [tier-2] Add action wrappers for task dispatch and chat notify         | INT-644    | Implement concrete executor tools wrapping sendTaskMessage/createTaskForPR and the new chat-agent internal event client.                                   |
| 15  | 2    | [INT-646](https://linear.app/pbuchman/issue/INT-646/tier-2-add-github-processing-marker-tool-and-delegation-brief)        | [tier-2] Add GitHub processing marker tool and delegation brief        | INT-645    | Move processing-marker responsibility to GitHubWebhookAgent and define a worker delegation brief that excludes GitHub control duties.                      |
| 16  | 2    | [INT-647](https://linear.app/pbuchman/issue/INT-647/tier-2-wire-webhook-route-to-githubwebhookagent-modes)                | [tier-2] Wire webhook route to GitHubWebhookAgent modes                | INT-646    | Integrate GitHubWebhookAgent into the webhook route with shadow/observe/execute modes while preserving ingress verification and persistence behavior.      |
| 17  | 2    | [INT-648](https://linear.app/pbuchman/issue/INT-648/tier-2-add-webhook-replay-harness-and-planner-regressions)            | [tier-2] Add webhook replay harness and planner regressions            | INT-647    | Create a dry-run replay harness using saved `github-pr-events` fixtures for planner regression and parity checks.                                          |
| 18  | 3    | [INT-649](https://linear.app/pbuchman/issue/INT-649/tier-3-extend-parserstorage-for-github-actions-result-events)         | [tier-3] Extend parser/storage for GitHub Actions result events        | INT-648    | Add normalized parsing and storage support for GitHub Actions result events used by future repair routing.                                                 |
| 19  | 3    | [INT-650](https://linear.app/pbuchman/issue/INT-650/tier-3-route-failed-workflow-run-to-code-fix-execution)               | [tier-3] Route failed workflow_run to code-fix execution               | INT-649    | Implement github_action_result family routing for failed workflow runs to trigger code-fix execution with push-safe guardrails.                            |
| 20  | 3    | [INT-651](https://linear.app/pbuchman/issue/INT-651/tier-3-route-pr-conflict-events-to-conflict-resolution-action)        | [tier-3] Route PR conflict events to conflict-resolution action        | INT-650    | Detect PR conflicts and route a conflict-resolution execution action with explicit user instructions through the GitHub agent.                             |
| 21  | 4    | [INT-652](https://linear.app/pbuchman/issue/INT-652/tier-4-publish-rollout-runbook-and-acceptance-matrix)                 | [tier-4] Publish rollout runbook and acceptance matrix                 | INT-651    | Document staged rollout, operational runbook, ownership model, and acceptance matrix for the GitHub webhook agent architecture.                            |

## Tier 0

### 1. [INT-632](https://linear.app/pbuchman/issue/INT-632/tier-0-define-webhook-agent-schemas-and-run-record-contracts) [tier-0] Define webhook agent schemas and run-record contracts

- Purpose: Create versioned runtime-validated schemas for decisions, plans, execution results, and run records used by the GitHub webhook agent.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/models.ts`, `apps/code-agent/src/domain/githubWebhookAgent/models.test.ts`
- Validation focus: Reject any planner decision payload that contains fields not defined in the schema.

### 2. [INT-633](https://linear.app/pbuchman/issue/INT-633/tier-0-add-run-log-repository-and-idempotency-lease) [tier-0] Add run log repository and idempotency lease

- Purpose: Persist GitHub webhook agent runs and processing leases for replay-safe, idempotent execution.
- Files: `apps/code-agent/src/infra/firestore/githubWebhookAgentRunsRepository.ts`, `apps/code-agent/src/infra/firestore/githubWebhookAgentRunsRepository.test.ts`, `apps/code-agent/src/infra/firestore/githubWebhookAgentLeaseRepository.ts`, `apps/code-agent/src/infra/firestore/githubWebhookAgentLeaseRepository.test.ts`
- Validation focus: A run record write must fail fast when schema validation fails before persistence.

### 3. [INT-634](https://linear.app/pbuchman/issue/INT-634/tier-0-add-structured-logging-and-redaction-helpers) [tier-0] Add structured logging and redaction helpers

- Purpose: Create reusable structured logging helpers, step timers, and payload redaction utilities for webhook agent traceability.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/logging.ts`, `apps/code-agent/src/domain/githubWebhookAgent/logging.test.ts`
- Validation focus: Every helper-generated log event must include `agent`, `runId`, and `step` fields.

### 4. [INT-635](https://linear.app/pbuchman/issue/INT-635/tier-0-add-webhook-agent-rollout-flags-and-config) [tier-0] Add webhook agent rollout flags and config

- Purpose: Add strongly-typed config and feature flags for shadow mode, execution mode, and ownership transfer toggles.
- Files: `apps/code-agent/src/config/githubWebhookAgentConfig.ts`, `apps/code-agent/src/config/githubWebhookAgentConfig.test.ts`
- Validation focus: Flag parser must not silently accept unknown environment values.

### 5. [INT-636](https://linear.app/pbuchman/issue/INT-636/tier-0-add-chat-agent-internal-event-ingestion-endpoint) [tier-0] Add chat-agent internal event ingestion endpoint

- Purpose: Create a chat-agent internal endpoint for idempotent system notifications from the GitHub webhook agent.
- Files: `apps/chat-agent/src/routes/chatRoutes.ts`, `apps/chat-agent/src/routes/internalChatEventsRoute.ts`, `apps/chat-agent/src/routes/internalChatEventsRoute.test.ts`
- Validation focus: Route must reject requests without internal auth before touching storage.

## Tier 1

### 6. [INT-637](https://linear.app/pbuchman/issue/INT-637/tier-1-add-event-family-registry-and-context-loader) [tier-1] Add event-family registry and context loader

- Purpose: Create event grouping and context loading primitives that normalize saved events into agent-ready context, with extension hooks for future event families.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/contextLoader.ts`, `apps/code-agent/src/domain/githubWebhookAgent/eventFamilies.ts`, `apps/code-agent/src/domain/githubWebhookAgent/contextLoader.test.ts`
- Validation focus: Context loader must return typed reason codes instead of throwing for unsupported events.

### 7. [INT-638](https://linear.app/pbuchman/issue/INT-638/tier-1-add-deterministic-worker-type-directive-parser) [tier-1] Add deterministic worker-type directive parser

- Purpose: Parse explicit worker-type directives from comment/review bodies in code-agent before any LLM planning.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/directiveParser.ts`, `apps/code-agent/src/domain/githubWebhookAgent/directiveParser.test.ts`
- Validation focus: Parser must not call an LLM or network dependency.

### 8. [INT-639](https://linear.app/pbuchman/issue/INT-639/tier-1-add-deterministic-actionability-rule-engine) [tier-1] Add deterministic actionability rule engine

- Purpose: Move obvious no-op/actionable detection into code-agent with explicit reason codes before planner calls.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/rules.ts`, `apps/code-agent/src/domain/githubWebhookAgent/rules.test.ts`
- Validation focus: Rules must not perform side effects or network calls.

### 9. [INT-640](https://linear.app/pbuchman/issue/INT-640/tier-1-add-planner-prompt-builder-and-decision-schema) [tier-1] Add planner prompt builder and decision schema

- Purpose: Implement the versioned GitHub webhook planner prompt that returns structured decision JSON only.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/plannerPrompt.ts`, `apps/code-agent/src/domain/githubWebhookAgent/plannerPrompt.test.ts`, `docs/patterns/prompt-versioning.md`
- Validation focus: Prompt builder must export explicit name and semver version.

### 10. [INT-641](https://linear.app/pbuchman/issue/INT-641/tier-1-add-llm-response-validation-pipeline-and-fail-closed-fallback) [tier-1] Add LLM response validation pipeline and fail-closed fallback

- Purpose: Validate planner responses in three stages (schema, semantic, policy) and normalize invalid outputs to safe no-op decisions.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/planner.ts`, `apps/code-agent/src/domain/githubWebhookAgent/planner.test.ts`
- Validation focus: No invalid or low-confidence planner output may flow into executor actions.

### 11. [INT-642](https://linear.app/pbuchman/issue/INT-642/tier-1-add-action-plan-compiler-and-policy-validator) [tier-1] Add action plan compiler and policy validator

- Purpose: Compile validated decisions into typed action plans and enforce ownership/worker-type policies before execution.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/validator.ts`, `apps/code-agent/src/domain/githubWebhookAgent/actionCompiler.ts`, `apps/code-agent/src/domain/githubWebhookAgent/actionCompiler.test.ts`
- Validation focus: Executor must receive only compiler/validator-approved plans.

### 12. [INT-643](https://linear.app/pbuchman/issue/INT-643/tier-1-add-executor-tool-framework-with-step-audit-logs) [tier-1] Add executor tool framework with step audit logs

- Purpose: Implement typed executor tool interfaces, step execution engine, and run-step audit recording with idempotency hooks.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/executor.ts`, `apps/code-agent/src/domain/githubWebhookAgent/executor.test.ts`
- Validation focus: Executor must not run any side-effect tool whose preconditions fail.

## Tier 2

### 13. [INT-644](https://linear.app/pbuchman/issue/INT-644/tier-2-extend-createtaskforpr-with-workertype-selection) [tier-2] Extend createTaskForPR with workerType selection

- Purpose: Allow PR-comment task creation to accept workerType selected by GitHub agent and record selection source.
- Files: `apps/code-agent/src/domain/usecases/createTaskForPR.ts`, `apps/code-agent/src/domain/usecases/createTaskForPR.test.ts`
- Validation focus: Do not preserve any hardcoded `auto` assignment on explicit worker type path.

### 14. [INT-645](https://linear.app/pbuchman/issue/INT-645/tier-2-add-action-wrappers-for-task-dispatch-and-chat-notify) [tier-2] Add action wrappers for task dispatch and chat notify

- Purpose: Implement concrete executor tools wrapping sendTaskMessage/createTaskForPR and the new chat-agent internal event client.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/notifier.ts`, `apps/code-agent/src/domain/githubWebhookAgent/tools.ts`, `apps/code-agent/src/infra/clients/chatAgentClient.ts`, `apps/code-agent/src/domain/githubWebhookAgent/tools.test.ts`
- Validation focus: Chat notifications must be based on execution results, not planner summary text.

### 15. [INT-646](https://linear.app/pbuchman/issue/INT-646/tier-2-add-github-processing-marker-tool-and-delegation-brief) [tier-2] Add GitHub processing marker tool and delegation brief

- Purpose: Move processing-marker responsibility to GitHubWebhookAgent and define a worker delegation brief that excludes GitHub control duties.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/tools.ts`, `apps/code-agent/src/domain/githubWebhookAgent/delegationBrief.ts`, `apps/code-agent/src/domain/githubWebhookAgent/delegationBrief.test.ts`, `apps/code-agent/src/routes/webhooks/github.ts`
- Validation focus: When marker ownership is enabled, no worker-facing message may instruct Claude to mark the comment as processing.

### 16. [INT-647](https://linear.app/pbuchman/issue/INT-647/tier-2-wire-webhook-route-to-githubwebhookagent-modes) [tier-2] Wire webhook route to GitHubWebhookAgent modes

- Purpose: Integrate GitHubWebhookAgent into the webhook route with shadow/observe/execute modes while preserving ingress verification and persistence behavior.
- Files: `apps/code-agent/src/routes/webhooks/github.ts`, `apps/code-agent/src/domain/githubWebhookAgent/processEvent.ts`, `apps/code-agent/src/domain/githubWebhookAgent/processEvent.test.ts`, `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts`
- Validation focus: Route must not skip signature verification or event persistence when agent is enabled.

### 17. [INT-648](https://linear.app/pbuchman/issue/INT-648/tier-2-add-webhook-replay-harness-and-planner-regressions) [tier-2] Add webhook replay harness and planner regressions

- Purpose: Create a dry-run replay harness using saved `github-pr-events` fixtures for planner regression and parity checks.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/replayHarness.ts`, `apps/code-agent/src/domain/githubWebhookAgent/replayHarness.test.ts`, `apps/code-agent/src/__tests__/fixtures/githubWebhookAgent/`
- Validation focus: Dry-run replay must not execute side effects.

## Tier 3

### 18. [INT-649](https://linear.app/pbuchman/issue/INT-649/tier-3-extend-parserstorage-for-github-actions-result-events) [tier-3] Extend parser/storage for GitHub Actions result events

- Purpose: Add normalized parsing and storage support for GitHub Actions result events used by future repair routing.
- Files: `apps/code-agent/src/infra/github-event-parser.ts`, `apps/code-agent/src/infra/github-event-parser.test.ts`, `apps/code-agent/src/routes/webhooks/github.ts`
- Validation focus: Parser must reject malformed CI payloads with explicit errors, not partial objects.

### 19. [INT-650](https://linear.app/pbuchman/issue/INT-650/tier-3-route-failed-workflow-run-to-code-fix-execution) [tier-3] Route failed workflow_run to code-fix execution

- Purpose: Implement github_action_result family routing for failed workflow runs to trigger code-fix execution with push-safe guardrails.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/eventFamilies/githubActionResult.ts`, `apps/code-agent/src/domain/githubWebhookAgent/actionCompiler.ts`, `apps/code-agent/src/domain/githubWebhookAgent/processEvent.ts`, `apps/code-agent/src/domain/githubWebhookAgent/eventFamilies/githubActionResult.test.ts`
- Validation focus: No workflow repair action may run without branch/workflow eligibility checks.

### 20. [INT-651](https://linear.app/pbuchman/issue/INT-651/tier-3-route-pr-conflict-events-to-conflict-resolution-action) [tier-3] Route PR conflict events to conflict-resolution action

- Purpose: Detect PR conflicts and route a conflict-resolution execution action with explicit user instructions through the GitHub agent.
- Files: `apps/code-agent/src/domain/githubWebhookAgent/eventFamilies/pullRequest.ts`, `apps/code-agent/src/domain/githubWebhookAgent/contextLoader.ts`, `apps/code-agent/src/domain/githubWebhookAgent/eventFamilies/pullRequest.test.ts`
- Validation focus: Conflict routing must not execute without explicit conflict confirmation or resolved mergeability check.

## Tier 4

### 21. [INT-652](https://linear.app/pbuchman/issue/INT-652/tier-4-publish-rollout-runbook-and-acceptance-matrix) [tier-4] Publish rollout runbook and acceptance matrix

- Purpose: Document staged rollout, operational runbook, ownership model, and acceptance matrix for the GitHub webhook agent architecture.
- Files: `docs/designs/github-webhook-agent.md`, `docs/patterns/github-webhook-agent-rollout.md`
- Validation focus: Documentation must not describe ambiguous ownership boundaries.

## Parent Issue Commit Reference

- Parent issue description contains a `COMMIT_REFERENCE_PENDING` placeholder and must be updated after this file is committed and pushed.

