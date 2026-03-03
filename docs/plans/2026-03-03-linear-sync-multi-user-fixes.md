# Plan: Fix Linear Sync Issues 1-3 from Architecture Review

## Context

PR #981 ([INT-623]) fixed cross-user data overwrite during Linear sync by introducing composite document keys (`userId_issueId`). A comprehensive architecture review identified 6 remaining issues. This plan addresses the top 3:

1. **Issue #1 (Critical):** Webhook fan-out — webhooks only sync to ONE user per team
2. **Issue #2 (Critical):** Comment webhook user ambiguity — comments route via arbitrary user
3. **Issue #3 (Moderate):** Internal route `findByIdentifier` unscoped to userId

## Design Decisions

- **Per-user copies model** — keep current composite key design, extend with fan-out
- **Replace** `findUserIdByTeamId` (singular) **with** `findUserIdsByTeamId` (plural, returns `string[]`)
- **Comments are NOT user-scoped** — they're keyed by Linear UUID, shared across users. This is correct (comments belong to issues, not users). Fan-out for comments means the save is idempotent.
- **Webhook signature validation** — only needs ONE secret (all team users share the same Linear webhook). Keep `findWebhookSecretByTeamId` as-is with `.limit(1)`.
- **Code task trigger** — fires for first user only to avoid duplicates
- **Internal route fix** — pass userId from `x-user-id` header; add ownership check on `PATCH /metadata`

## Subagent Delegation Plan

### Agent 1: "Repository & Port Layer" (Foreground)

**Role:** Infrastructure engineer updating data access contracts

**Files to modify:**
- `apps/linear-agent/src/domain/ports.ts`
- `apps/linear-agent/src/infra/firestore/linearConnectionRepository.ts`
- `apps/linear-agent/src/infra/firestore/linearIssueRepository.ts`
- `apps/linear-agent/src/__tests__/fakes.ts`

**Tasks:**

1. **ports.ts** — Rename `findUserIdByTeamId` -> `findUserIdsByTeamId`, change return `Result<string | null>` -> `Result<string[]>`. Add `findUserIdsByIssueId(issueId: string): Promise<Result<string[], LinearError>>` to `LinearIssueRepository`.

2. **linearConnectionRepository.ts** — Rename function `findUserIdByTeamId` -> `findUserIdsByTeamId`. Remove `.limit(1)`. Return `string[]` (empty array instead of null). Update factory.

3. **linearIssueRepository.ts** — Add `findUserIdsByIssueId` function: query `where('id', '==', issueId)` without `.limit(1)`, return array of `userId` values. Update factory.

4. **fakes.ts** — Update `FakeLinearConnectionRepository.findUserIdByTeamId` -> `findUserIdsByTeamId` returning `string[]`. Add `FakeLinearIssueRepository.findUserIdsByIssueId`.

### Agent 2: "Webhook Route Handler" (Foreground, depends on Agent 1)

**Role:** Backend engineer implementing webhook fan-out logic

**Files to modify:**
- `apps/linear-agent/src/routes/linearWebhookRoutes.ts`

**Tasks:**

1. **Issue event path (lines 141-229):**
   - Replace `findUserIdByTeamId(teamId)` with `findUserIdsByTeamId(teamId)`
   - Check `userIds.length === 0` instead of `userId === null`
   - Keep signature validation unchanged (uses `findWebhookSecretByTeamId` which stays)
   - Build event once (shared across users)
   - Fan out `syncSingleIssue` via `Promise.allSettled(userIds.map(...))`
   - Log per-user results, return first success
   - `triggerCodeTaskFromAssignment` — fire for `userIds[0]` only

2. **Comment event path (lines 230-306):**
   - Replace `issueRepository.findById(data.issueId)` lookup for userId with `issueRepository.findUserIdsByIssueId(data.issueId)` to find ALL users
   - Still use `findById` for getting teamId for signature validation (need one issue copy)
   - Since comments are NOT user-scoped (stored by Linear UUID), calling `syncCommentFromWebhook` once is sufficient — no per-user fan-out needed for the actual save
   - The `_userId` param in `syncCommentFromWebhook` is unused ("Reserved for future use"), so passing any userId is fine

### Agent 3: "Internal Route Scoping" (Foreground, independent of Agents 1-2)

**Role:** Security engineer fixing authorization gaps

**Files to modify:**
- `apps/linear-agent/src/routes/internalIssuesRoutes.ts`

**Tasks:**

1. **GET /internal/linear/issues/:identifier (line 598-666):**
   - Add `x-user-id` header extraction after `validateInternalAuth` (same pattern as other routes)
   - Return 401 if missing
   - Pass `userId` to `findByIdentifier(identifier, userId)` — port already accepts optional userId
   - Add userId to logger call

2. **PATCH /internal/linear/issues/:issueId/metadata (line 277-333):**
   - After `findById(issueId)` returns an issue, add ownership check: `if (issueResult.value.userId !== userId) -> 404`
   - Return 404 (not 403) to prevent information leakage

### Agent 4: "Tests" (Foreground, depends on Agents 1-3)

**Role:** QA engineer writing comprehensive test coverage

**Files to modify:**
- `apps/linear-agent/src/__tests__/routes/linearWebhookRoutes.test.ts`
- `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`
- `apps/linear-agent/src/__tests__/infra/linearConnectionRepository.test.ts`
- `apps/linear-agent/src/__tests__/infra/linearIssueRepository.test.ts`

**Tasks:**

1. **Webhook route tests:**
   - Multi-user fan-out: seed two connections for same team, verify both users get issue synced
   - Partial failure: one user's save fails, other succeeds, response is 200
   - All-users fail: both syncs fail -> 500
   - Code task triggers for first user only
   - Update existing tests for `findUserIdsByTeamId` returning `string[]`

2. **Connection repository tests:**
   - `findUserIdsByTeamId` returns all connected userIds for team
   - Returns empty array for unknown team
   - Excludes disconnected users

3. **Issue repository tests:**
   - `findUserIdsByIssueId` returns all userIds who have the issue
   - Returns empty array when no users have the issue

4. **Internal route tests:**
   - GET identifier: 401 when X-User-Id missing
   - GET identifier: 404 when issue belongs to different user
   - PATCH metadata: 404 when issue belongs to different user
   - Update existing GET identifier tests to include `x-user-id` header

## Execution Order

Since this is a single PR branch, agents work sequentially:

```
Agent 1 (Repository layer)
    |
Agent 2 (Webhook routes) — uses new port methods
    |
Agent 3 (Internal routes) — independent of Agent 2 but same service
    |
Agent 4 (Tests) — validates all changes
    |
CI verification: pnpm run ci:tracked
```

## File Change Summary

| File                                                                         | Agent | Change                                        |
| ---------------------------------------------------------------------------- | ----- | --------------------------------------------- |
| `apps/linear-agent/src/domain/ports.ts`                                      | 1     | Rename method, add method                     |
| `apps/linear-agent/src/infra/firestore/linearConnectionRepository.ts`        | 1     | Rename, remove `.limit(1)`, return `string[]` |
| `apps/linear-agent/src/infra/firestore/linearIssueRepository.ts`             | 1     | Add `findUserIdsByIssueId`                    |
| `apps/linear-agent/src/__tests__/fakes.ts`                                   | 1     | Update fakes for new signatures               |
| `apps/linear-agent/src/routes/linearWebhookRoutes.ts`                        | 2     | Fan-out via `Promise.allSettled`              |
| `apps/linear-agent/src/routes/internalIssuesRoutes.ts`                       | 3     | Add userId scoping                            |
| `apps/linear-agent/src/__tests__/routes/linearWebhookRoutes.test.ts`         | 4     | Multi-user fan-out tests                      |
| `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`        | 4     | Scoping tests                                 |
| `apps/linear-agent/src/__tests__/infra/linearConnectionRepository.test.ts`   | 4     | New query tests                               |
| `apps/linear-agent/src/__tests__/infra/linearIssueRepository.test.ts`        | 4     | New query tests                               |

## Endpoint Changes

| Service      | Method | Path                                         | Change                                      |
| ------------ | ------ | -------------------------------------------- | ------------------------------------------- |
| linear-agent | POST   | `/linear/webhook`                            | Fan-out issue sync to all team users        |
| linear-agent | GET    | `/internal/linear/issues/:identifier`        | Add userId scoping via x-user-id header     |
| linear-agent | PATCH  | `/internal/linear/issues/:issueId/metadata`  | Add ownership check after fetch             |

## Verification

1. `pnpm run verify:workspace:tracked -- linear-agent` — TypeCheck + Lint + Tests + Coverage
2. `pnpm run ci:tracked` — Full CI must pass
3. Manual check: inspect Firestore emulator behavior for composite key operations
