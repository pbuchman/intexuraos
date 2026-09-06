# Sentry Task Dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop duplicate Sentry code tasks for the same underlying problem while preserving webhook audit records and leaving existing code tasks untouched.

**Architecture:** Keep `sentry-issue-events` as the webhook audit ledger, but add a separate problem-level task reservation before Linear/code-task creation. Quarantine known code-agent/orchestrator control-plane self-alerts before any reservation so automation failures do not recursively create Sentry repair tasks.

**Tech Stack:** TypeScript, Vitest, Fastify service DI, Firestore repository adapter, in-memory Firestore fakes.

## Global Constraints

- Do not cancel, delete, or mutate existing `code_tasks`.
- Follow TDD: write failing tests, confirm failure, then implement.
- Firestore investigations use `GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json`.
- Keep webhook audit behavior separate from task-creation behavior.
- No new external dependencies.

---

### Task 1: Problem-Level Reservation Contract

**Files:**
- Modify: `apps/code-agent/src/domain/models/sentryIssueEvent.ts`
- Modify: `apps/code-agent/src/domain/repositories/sentryIssueEventRepository.ts`
- Modify: `apps/code-agent/src/infra/firestore/sentryIssueEventRepository.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/sentryIssueEventRepository.test.ts`

**Interfaces:**
- Produces `reserveTaskForProblem({ event, receivedAt, payload }): Result<ReserveSentryIssueEventResult, SentryIssueEventRepositoryError>`.
- Reuses `markCodeTaskCreated({ dedupeKey, codeTaskId, linearIssueId })` for both audit and problem-lock records.
- Produces `createSentryProblemDedupeKey(event)`.

- [x] Write a failing repository test showing two different Sentry issue IDs with the same org/project/title reserve the same problem task key and return the first task once linked.
- [x] Write a failing repository test showing issue/event_alert deliveries for the same problem share the same task key.
- [x] Implement normalized problem-key generation.
- [x] Store task locks in `sentry-issue-events` with `sentry-task:` doc IDs to avoid adding a collection and index.
- [x] Run the repository test file and confirm it passes.

### Task 2: Use Case Guarding

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processSentryWebhook.ts`
- Test: `apps/code-agent/src/__tests__/usecases/processSentryWebhook.test.ts`

**Interfaces:**
- Consumes repository task reservation methods from Task 1.
- Produces duplicate outcome before Linear/code-task creation when a problem-level reservation exists.

- [x] Write a failing use-case test where an existing problem-level reservation prevents Linear/code-task/enqueue calls for a new Sentry issue ID with the same title.
- [x] Write a failing use-case test where known automation self-alert titles are ignored before reservation.
- [x] Call `reserveTaskForProblem` after webhook audit reservation and before worker settings/Linear/code-task creation.
- [x] Link both the webhook audit record and the problem task record after task creation.
- [x] Run the use-case test file and confirm it passes.

### Task 3: Verification and Runtime Check

**Files:**
- No production file changes beyond Tasks 1-2.

- [x] Run `pnpm --filter code-agent test -- src/__tests__/infra/firestore/sentryIssueEventRepository.test.ts src/__tests__/usecases/processSentryWebhook.test.ts src/__tests__/routes/webhooks/sentry.test.ts`.
- [x] Run `pnpm run verify:workspace:tracked code-agent`.
- [x] Run `pnpm run ci:tracked`.
- [ ] Query Firestore read-only and confirm no active code task was killed or mutated by this local change.
- [ ] Create a PR targeting `development`; do not merge until CI and review conditions are satisfied.

## Endpoint Changes

Modified: none.

Created: none.

Removed: none.

Unchanged: `POST /api/code/webhooks/sentry` keeps the same request and response contract.
