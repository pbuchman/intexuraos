# INT-1324: Fix misleading review scope in @review prompt

> **Planned:** 2026-04-08 | **Complexity:** SIMPLE

## Summary

The re-review context section in `buildReviewPrompt()` unconditionally mandates focusing on changes since a specific commit. This ignores the user's actual review request and overrides their intent.

## Change

**File:** `apps/code-agent/src/domain/usecases/createReviewTask.ts` (lines 251-268)
**Test:** `apps/code-agent/src/__tests__/usecases/createReviewTask.test.ts`

Update the re-review context block to:

1. **When `reviewComment` is present:** The review focuses on the user's specific request. The prior review commit SHA is provided as context (not a mandate).
2. **When no `reviewComment`:** Fall back to full PR scope. Mention the prior review commit as informational context for what was already covered.
3. **Remove** the rigid "MUST focus on changes since commit X" language.

### Before (current behavior)

```
## Re-review Context

This is a re-review for this PR. Your review MUST focus on changes
since commit abc123.

### Review Scope
Commits since last review: abc123..HEAD

IMPORTANT: Do NOT re-flag findings from the previous review unless
they are still present in the new changes...
```

### After (with user comment)

The prompt acknowledges the user's specific request as the primary focus, with the commit range as supplementary context.

### After (no user comment)

The prompt instructs a full PR review, noting the prior review commit as informational context.
