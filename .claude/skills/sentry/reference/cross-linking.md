# Cross-Linking Protocol

Every Sentry issue must be traceable across all systems: Sentry, Linear, and GitHub.

## Three-Way Linking Diagram

```
┌─────────────────┐
│     Sentry      │
│   (Error Source)│
└────────┬────────┘
         │
         │ 1. Create Linear issue
         │    with [sentry] prefix
         ▼
┌─────────────────┐
│     Linear      │
│  (Work Tracking)│
└────────┬────────┘
         │
         │ 2. Create PR with
         │    "Fixes INT-XXX"
         ▼
┌─────────────────┐
│     GitHub      │
│   (Code Change) │
└─────────────────┘
```

## Required Links

### Sentry → Linear

**Method:** Comment on Sentry issue (manual) or description link

**Content:**

```
Linear Issue: [INT-XXX](https://linear.app/pbuchman/issue/INT-XXX)
```

### Linear → Sentry

**Method:** Include in Linear issue description

**Content:**

```markdown
**Sentry Issue:** [INTEXURAOS-DEVELOPMENT-42](https://intexuraos-dev-pbuchman.sentry.io/issues/42/)
```

### Linear → GitHub (Automatic)

**Method:** GitHub-Linear integration auto-attaches PRs when:

1. Branch name contains Linear issue ID: `fix/INT-123-description`
2. PR title contains Linear issue ID: `[INT-123] Fix auth redirect`

### GitHub → Linear

**Method:** Include `Fixes INT-XXX` in PR body

**Content:**

```markdown
Fixes [INT-123](https://linear.app/pbuchman/issue/INT-123)
```

**Effect:** When PR is merged, Linear issue auto-transitions to "Done" (if configured)

### GitHub → Sentry

**Method:** Include Sentry link in PR description

**Content:**

```markdown
Fixes Sentry issue: [INTEXURAOS-DEVELOPMENT-42](https://intexuraos-dev-pbuchman.sentry.io/issues/42/)
```

## Naming Conventions

### Linear Issue Title

Always use `[sentry]` prefix for Sentry-sourced issues:

| Pattern                              | Example                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `[sentry] <short-error-message>`     | `[sentry] Cannot read property 'id' of undefined`    |
| `[sentry] <ErrorType> in <Service>`  | `[sentry] TypeError in TodoService`                  |
| `[sentry] <Action> failed: <reason>` | `[sentry] Auth callback failed: missing user record` |

### Branch Name

Include Linear issue ID:

```
fix/INT-123-sentry-auth-error
feature/INT-456-add-validation
```

### PR Title

Include Linear issue ID:

```
[INT-123] Fix auth redirect race condition
[INT-456] Add input validation to user service
```

## Verification Checklist

Before completing a Sentry triage:

- [ ] Linear issue exists with `[sentry]` prefix
- [ ] Linear issue description contains Sentry URL
- [ ] Branch name contains Linear issue ID
- [ ] PR title contains Linear issue ID
- [ ] PR body contains `Fixes INT-XXX`
- [ ] PR body contains Sentry issue URL

## Troubleshooting

### PR Not Appearing in Linear

**Cause:** Branch name or PR title doesn't contain issue ID

**Fix:** Rename branch to include `INT-XXX`:

```bash
git branch -m old-branch fix/INT-123-description
```

### Linear Issue Not Auto-Closing

**Cause:** PR body doesn't use `Fixes` keyword

**Fix:** Ensure PR body contains:

```markdown
Fixes [INT-123](url)
```

### Can't Find Related Sentry Issue

**Search in Linear:**

```
Call: mcp__linear__list_issues
Parameters:
  - query: "[sentry]"
  - team: "pbuchman"
```

**Search in Sentry:**

```
Call: mcp__sentry__list_issues
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - query: "is:unresolved"
```
