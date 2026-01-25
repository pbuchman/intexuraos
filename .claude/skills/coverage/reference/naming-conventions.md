# Naming Conventions

## Linear Issue Titles

### Format

```
[coverage][<target>] <filename> <description>
```

### Components

| Component | Description | Example |
|-----------|-------------|---------|
| `[coverage]` | Fixed prefix for all coverage issues | `[coverage]` |
| `[<target>]` | App or package name | `[actions-agent]`, `[infra-claude]` |
| `<filename>` | Source file name (without path) | `client.ts`, `researchRoutes.ts` |
| `<description>` | Brief description of gaps | `error handling branches` |

### Examples

```
[coverage][actions-agent] executeAction.ts error handling branches
[coverage][actions-agent] actionRoutes.ts authentication guards
[coverage][research-agent] researchRoutes.ts optional parameter checks
[coverage][infra-perplexity] client.ts timeout callback
[coverage][infra-claude] client.ts retry logic edge cases
[coverage][common-core] result.ts type narrowing fallbacks
```

### Search Patterns

To find existing issues:
```
# All coverage issues
title contains "[coverage]"

# Coverage issues for specific target
title contains "[coverage][actions-agent]"

# Coverage issues for specific file
title contains "[coverage][actions-agent] client.ts"
```

---

## Unreachable Files

### Location

```
.claude/skills/coverage/unreachable/<target>.md
```

### Target Names

Use exact directory name:
- `actions-agent.md` (not `apps-actions-agent.md`)
- `infra-claude.md` (not `packages-infra-claude.md`)
- `common-core.md`
- `research-agent.md`

### Section Headers

Use relative path from app/package root:

```markdown
## `src/infra/http/client.ts`
```

NOT:
```markdown
## `apps/actions-agent/src/infra/http/client.ts`
```

### Line References

Use approximate line with tilde:

```markdown
### Line ~45: `?? 'info'` fallback
```

NOT:
```markdown
### Line 45: `?? 'info'` fallback
```

---

## Branch Names

When working on coverage issues:

```
fix/INT-XXX-coverage-<filename>
```

Examples:
```
fix/INT-301-coverage-executeAction
fix/INT-302-coverage-client
fix/INT-303-coverage-researchRoutes
```

---

## Commit Messages

```
[coverage] <description>
```

Examples:
```
[coverage] Add tests for executeAction error handling
[coverage] Document unreachable branches in client.ts
[coverage] Fix actions-agent authentication guard coverage
```

---

## Labels

Use `coverage` label on all coverage-related Linear issues.

Create label if it doesn't exist:
- Name: `coverage`
- Color: (your choice, suggest yellow/orange for visibility)
