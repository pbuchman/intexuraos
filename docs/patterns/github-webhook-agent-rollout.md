# GitHub Webhook Agent — Rollout Runbook

## Rollout Stages

The agent uses progressive rollout flags. Each stage builds on the previous one. Enable in order, never skip stages.

| Stage | Flag                      | Env Var                                       | Default | Effect                                         |
| ----- | ------------------------- | --------------------------------------------- | ------- | ---------------------------------------------- |
| 0     | `enabled`                 | `INTEXURAOS_GH_AGENT_ENABLED`                 | false   | Master switch — all processing off when false  |
| 1     | `observeOnly`             | `INTEXURAOS_GH_AGENT_OBSERVE_ONLY`            | true    | Log decisions and save run records, no actions |
| 2     | `notifyOnly`              | `INTEXURAOS_GH_AGENT_NOTIFY_ONLY`             | false   | Send chat notifications, skip task execution   |
| 3     | `executeComments`         | `INTEXURAOS_GH_AGENT_EXECUTE_COMMENTS`        | false   | Execute comment-triggered action plans         |
| 4     | `ownsProcessingMarker`    | `INTEXURAOS_GH_AGENT_OWNS_PROCESSING_MARKER`  | false   | Agent adds processing reaction to webhook      |
| 5     | `ownsFinalReply`          | `INTEXURAOS_GH_AGENT_OWNS_FINAL_REPLY`        | false   | Agent posts final summary reply                |

### Enabling Order

```bash
# Stage 0 → 1: Enable observe mode (safe, no side effects)
INTEXURAOS_GH_AGENT_ENABLED=true
INTEXURAOS_GH_AGENT_OBSERVE_ONLY=true

# Stage 1 → 2: Enable notifications (visible to chat, no task creation)
INTEXURAOS_GH_AGENT_OBSERVE_ONLY=false
INTEXURAOS_GH_AGENT_NOTIFY_ONLY=true

# Stage 2 → 3: Enable comment execution (tasks created for comments)
INTEXURAOS_GH_AGENT_NOTIFY_ONLY=false
INTEXURAOS_GH_AGENT_EXECUTE_COMMENTS=true

# Stage 3 → 4: Agent owns processing marker
INTEXURAOS_GH_AGENT_OWNS_PROCESSING_MARKER=true

# Stage 4 → 5: Agent owns final reply (full ownership)
INTEXURAOS_GH_AGENT_OWNS_FINAL_REPLY=true
```

### Rollback Steps

Rollback to any previous stage by reverting the flag changes. Flags are independent — disabling a later stage does not affect earlier ones.

| Scenario                      | Action                                           | Effect                                |
| ----------------------------- | ------------------------------------------------ | ------------------------------------- |
| Unexpected task creation      | Set `EXECUTE_COMMENTS=false`                     | Stops task creation, keeps observing  |
| Chat notification spam        | Set `NOTIFY_ONLY=false`, `OBSERVE_ONLY=true`     | Silent observe mode                   |
| Full emergency stop           | Set `ENABLED=false`                              | All processing disabled immediately   |
| Marker ownership conflict     | Set `OWNS_PROCESSING_MARKER=false`               | Worker resumes marker ownership       |
| Partial rollout: keep observe | Set `OBSERVE_ONLY=true`                          | Records decisions without acting      |

### Rollback Trigger Conditions

- Run record `outcome: 'failed'` rate exceeds 10% of events in a 1-hour window
- Validation failure rate spikes after prompt version change
- Duplicate task creation detected (idempotency lease failure)
- Chat notification delivery failures (chat-agent HTTP errors)

## Replay Procedure

The replay harness (`replayHarness.ts`) enables deterministic dry-run testing of the decision pipeline without side effects.

### Running a Replay

```typescript
import { replayWebhookEventDryRun } from './domain/githubWebhookAgent/replayHarness.js';

const result = replayWebhookEventDryRun(deps, fixture);
// result.decision — what the agent would decide
// result.plan — the compiled action plan
// result.validation — plan validation result
// result.diagnostics — event group, rule reason, fallback info
```

### Fixture Format

Fixtures are JSON files in `src/__tests__/fixtures/githubWebhookAgent/`:

```json
{
  "description": "PR synchronize from allowed sender",
  "event": {
    "id": "fixture-001",
    "eventType": "pull_request",
    "action": "synchronize",
    "senderLogin": "testuser",
    "repository": "pbuchman/intexuraos",
    "pullRequestNumber": 42,
    "state": "open",
    "body": null
  },
  "expected": {
    "decisionKind": "create_pr_comment_task",
    "actionCount": 1
  }
}
```

### Replaying Historical Events

1. Query saved events from the run log repository by event ID or time range.
2. Convert saved events to fixture format (same field structure).
3. Run through `replayWebhookEventDryRun` to verify current pipeline behavior.
4. Compare `result.decision.decision.kind` against the original run record outcome.

### After Schema Version Bump

If `WebhookAgentDecision` or `WebhookActionPlan` schemas change version:
1. Update fixture `expected` fields to match new schema output.
2. Run all replay tests to verify backward compatibility.
3. Historical run records retain their original schema version for audit.

## Log and Run Record Lookup

### Finding Run Records

Run records are saved via `saveRunRecord()` with structured fields:

```
runId, savedEventId, eventGroup, startedAt, completedAt,
durationMs, decision, actionPlan, stepResults, outcome, error
```

### Log Correlation

All log entries include `runId` for correlation:

```bash
# Find all logs for a specific run
rg "run_abc123" /var/log/code-agent/

# Find failed runs in a time window
rg '"outcome":"failed"' /var/log/code-agent/ | grep "2026-02-28"
```

### Debugging a Failed Run

1. Find the run ID from logs or the run record store.
2. Check `decision.decision.kind` — was the decision correct?
3. Check `actionPlan.actions` — were the right steps compiled?
4. Check `stepResults` — which step failed and with what error?
5. If validation failed, check `validation.errors` for constraint violations.

## Acceptance Matrix

Maps INT-631 parent success criteria to concrete evidence.

| Criterion                                       | Evidence                                                        | Child Tasks             |
| ----------------------------------------------- | --------------------------------------------------------------- | ----------------------- |
| Webhook events are classified into groups       | `eventFamilies.test.ts` — 19 tests                              | INT-637                 |
| Deterministic rules engine classifies events    | `rules.test.ts` — 20 tests                                      | INT-639                 |
| LLM planner handles uncertain events            | `planner.test.ts` — 17 tests, `plannerPrompt.test.ts` — 15      | INT-640                 |
| Worker type directives are parsed               | `directiveParser.test.ts` — 25 tests                            | INT-638                 |
| Action plans are compiled from decisions        | `actionCompiler.test.ts` — 14 tests                             | INT-642                 |
| Plans are validated before execution            | `validator.test.ts` — tests for user mapping, task state        | INT-642                 |
| Executor runs steps with idempotency            | `executor.test.ts` — 10 tests                                   | INT-643                 |
| Tools dispatch tasks and send notifications     | `tools.test.ts` — 13 tests                                      | INT-644                 |
| Rollout flags control behavior stages           | `githubWebhookAgentConfig.test.ts` — config loading tests       | INT-633                 |
| Run records capture full audit trail            | `runLogRepository.test.ts` — persistence tests                  | INT-632                 |
| Structured logging with redaction               | `logging.test.ts` — 18 tests                                    | INT-634                 |
| Context loading enriches events                 | `contextLoader.test.ts` — 11 tests                              | INT-637                 |
| Chat notifications built for all outcomes       | `notifier.test.ts` — 7 tests                                    | INT-644                 |
| Delegation brief structures worker instructions | `delegationBrief.test.ts` — 10 tests                            | INT-645                 |
| Webhook route wires to agent processing         | `github.test.ts` — route integration tests                      | INT-647                 |
| Replay harness enables dry-run regression       | `replayHarness.test.ts` — 7 tests + fixture files               | INT-648                 |
| CI event parser handles workflow/check events   | `github-event-parser.test.ts` — 30+ CI event tests              | INT-649                 |
| Failed workflow_run routes to repair            | `githubActionResult.test.ts` — 10 tests                         | INT-650                 |
| PR conflicts route to resolution action         | `pullRequestConflict.test.ts` — 11 tests                        | INT-651                 |
| Models enforce strict schema contracts          | `models.test.ts` — 29 tests (Zod schema validation)             | INT-632                 |
| Process event orchestrates full pipeline        | `processEvent.test.ts` — 13 tests (all modes and branches)      | INT-647                 |

### Verification Commands

```bash
# Run all webhook agent tests
npx vitest run apps/code-agent/src/__tests__/domain/githubWebhookAgent/

# Run full CI (must pass before any deployment)
pnpm run ci:tracked

# Check test count
npx vitest run apps/code-agent/src/__tests__/domain/githubWebhookAgent/ 2>&1 | grep "Tests"
```
