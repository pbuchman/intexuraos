# INT-1299: Fix ask-agent page showing incorrect conversation status

**Planned:** 2026-04-05
**Classification:** SIMPLE
**Linear:** [INT-1299](https://linear.app/pbuchman/issue/INT-1299/fix-ask-agent-page-showing-incorrect-conversation-status)

## Task Summary

Two frontend bugs in the ask-agent page and shared log viewer:

1. **Active conversation not restored on page return:** `useAskAgent` initializes `taskId` as `null` on every mount, so navigating away from the ask-agent page and returning always shows a blank "Start" view instead of the user's active conversation. Fix: persist the active taskId in localStorage.

2. **Empty state shows misleading loader:** Both ask-agent and code execution pages display a spinning `Loader2` with "Waiting for logs..." when no logs exist. Fix: replace with a static friendly message ("Your conversation will appear here when available" / "Execution logs will appear here when available") and remove the spinner.

## Files to Modify

| File                                                       | Change                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/web/src/hooks/useAskAgent.ts`                        | Add localStorage persistence for taskId (lazy init, save on start, clear on clear) |
| `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx` | Replace empty state: remove Loader2 spinner, show context-aware static message     |

## Key Design Decision

Using localStorage instead of a backend API call (`GET /code/tasks` filters out ask-agent tasks server-side at line 2254 of codeRoutes.ts). localStorage avoids backend changes and naturally enforces "at most one active ask-agent conversation" since the stored taskId is always the latest session.
