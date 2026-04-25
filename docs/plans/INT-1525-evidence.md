# INT-1525 — Planning Evidence

**Linear:** [INT-1525](https://linear.app/pbuchman/issue/INT-1525/sec-oauth-state-value-logged-at-info-level-enables-forgery)
**Parent:** INT-1472
**Classification:** SIMPLE — issue description enriched in-place; no plan doc, no subtasks.
**Date:** 2026-04-24

## Task

Stop logging the full base64url(JSON) OAuth `state` at INFO level in `user-service`. Replace it with a 12-character SHA-256 hex prefix (`stateHash`) so logs remain correlatable but no longer expose the CSRF nonce or the rest of the payload.

## Why SIMPLE

- Two adjacent files in a single service (`apps/user-service/src/domain/oauth/usecases/initiateOAuthFlow.ts` and `initiateGitHubOAuthFlow.ts`).
- One mechanical change per file (swap `state` for `stateHash` in the `logger.info` payload).
- No design decisions, no cross-service coordination, no schema migration, no API change.
- `node:crypto` already imported in both files; no new dependency.

## Decisions

- **Hash, not prefix:** prefix of base64url state still leaks `userId` (it sits at the start of the JSON). SHA-256 hashing is non-reversible.
- **12 hex chars:** ample collision resistance for log correlation while keeping log lines short.
- **Field renamed `state` → `stateHash`:** prevents future log consumers from assuming the value is still usable as a state token.

## Acceptance Criteria & Test Plan

See enriched Linear description on INT-1525.
