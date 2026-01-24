# Cross-Linking Protocol

All issues must be linked between systems for full traceability.

## Link Directions

| Direction       | Method                                                             |
| --------------- | ------------------------------------------------------------------ |
| Linear → GitHub | PR title contains `INT-XXX` (enables auto-attachment)              |
| GitHub → Linear | GitHub integration attaches PR (when title + branch have issue ID) |
| Linear → GitHub | `Fixes INT-XXX` in PR body (for issue closing behavior)            |
| Sentry → Linear | `[sentry] <title>` naming + link in description                    |
| Linear → Sentry | Comment on Sentry issue                                            |

## GitHub Integration (Automatic Attachment)

**CRITICAL:** For PRs to appear as attachments in Linear UI (visible in `attachments` array):

### Required Conditions

1. **Branch name MUST contain Linear issue ID**
   - ✅ `fix/INT-123`
   - ✅ `feature/INT-44-add-tests`
   - ❌ `fix/coverage-web-agent`

2. **PR title MUST contain Linear issue ID**
   - ✅ `[INT-123] Fix auth`
   - ✅ `INT-44: Add tests`
   - ❌ `Fix auth bug`

### What Happens When Conditions Are Met

- PR automatically appears in Linear issue's `attachments` array
- Issue state transitions automatically: `In Progress` → `In Review` → `QA`
- Bidirectional link established (click PR from Linear, see issue from GitHub)
- **No manual comment needed** — attachment is the canonical link

### What Happens When Conditions Are NOT Met

- PR does NOT attach to Linear issue
- Only manual comment with PR URL (not visible as attachment)
- No automatic state transitions
- Must manually update Linear state

## Verification After PR Creation

Always verify after creating a PR:

```bash
# Check Linear issue has PR under "Pull requests" section
# If missing, the naming convention wasn't followed
```

## Sentry Integration

### Creating Linear Issue from Sentry

1. Title format: `[sentry] <error-message>`
2. Description includes:
   - Sentry issue link
   - Stacktrace excerpt
   - Error context

### Linking Linear Issue to Sentry

After creating Linear issue, add comment to Sentry with:

- Linear issue link
- Brief summary of planned fix

## PR Body Links

Include these in every PR:

```markdown
## Cross-References

- **Linear Issue**: [INT-XXX](https://linear.app/...)
- **Sentry Issue** (if applicable): [Error Title](https://sentry.io/...)
```

## Why Comments Don't Work

Adding PR URL as a comment only adds text — it doesn't create the attachment relationship.

The GitHub integration requires the issue ID in **both** branch name **AND** PR title to establish the bidirectional link that shows the PR in Linear's UI.

## Example: Proper vs Improper Linking

### Proper (PR in attachments) ✅

```
Branch: fix/INT-42-auth-bug
PR Title: [INT-42] Fix authentication token not refreshing
Result: PR appears in Linear issue attachments
```

### Improper (Only comment link) ❌

```
Branch: fix/auth-bug
PR Title: Fix authentication token not refreshing
Result: Must manually add PR URL as comment
```
