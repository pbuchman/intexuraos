# INT-1299: Fix ask-agent page showing incorrect conversation status

**Planned:** 2026-04-05
**Classification:** PLAN-DOC (revised from SIMPLE — user requires cross-device persistence)
**Linear:** [INT-1299](https://linear.app/pbuchman/issue/INT-1299/fix-ask-agent-page-showing-incorrect-conversation-status)

## Task Summary

Two bugs in the ask-agent page and shared log viewer, with a revised persistence approach:

1. **Active conversation not restored on page return:** `useAskAgent` initializes `taskId` as `null` on every mount, so navigating away and returning shows a blank "Start" view. Fix: add a backend `GET /code/ask-agent/active` endpoint that queries the user's latest non-archived ask-agent task from Firestore, and call it on hook mount. This replaces the original localStorage approach to support cross-device persistence.

2. **Empty state shows misleading loader:** Both ask-agent and code execution pages display a spinning `Loader2` with "Waiting for logs..." when no logs exist. Fix: replace with a static friendly message and remove the spinner.

## Plan Document

Plan document: docs/plans/INT-1299-fix-ask-agent-conversation-persistence.md

## Files to Modify

| File                                                                    | Change                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`         | Add `findLatestAskAgentTask` method to interface |
| `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts` | Implement Firestore query                        |
| `apps/code-agent/src/domain/usecases/getActiveAskAgent.ts`              | New use case                                     |
| `apps/code-agent/src/routes/codeRoutes.ts`                              | Add `GET /code/ask-agent/active` route           |
| `apps/web/src/services/codeAgentApi.ts`                                 | Add `getActiveAskAgent` API function             |
| `apps/web/src/hooks/useAskAgent.ts`                                     | Fetch active task on mount, archive on clear     |
| `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`              | Replace empty state spinner                      |

## Key Design Decision

Using a backend API query instead of localStorage because the user requires cross-device persistence. The `code_tasks` collection already contains all necessary data — a Firestore query on `(userId, agentType='ask_agent', status IN NON_ARCHIVED_STATUSES)` ordered by `createdAt DESC LIMIT 1` returns the active conversation. The existing archive endpoint handles `clear()`.
