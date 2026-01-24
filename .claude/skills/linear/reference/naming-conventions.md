# Naming Conventions

Standardized naming patterns for Linear issues, branches, and PRs.

## Branch Naming

| Issue Type    | Branch Pattern     | Example                   |
| ------------- | ------------------ | ------------------------- |
| Bug           | `fix/INT-XXX`      | `fix/INT-42`              |
| Feature       | `feature/INT-XXX`  | `feature/INT-42`          |
| Sentry        | `fix/sentry-XXX`   | `fix/sentry-INTEXURAOS-4` |
| Refactor      | `refactor/INT-XXX` | `refactor/INT-42`         |
| Documentation | `docs/INT-XXX`     | `docs/INT-42`             |

**CRITICAL:** Branch name MUST contain the Linear issue ID for GitHub integration to work.

## Issue Title Naming

| Type          | Pattern                             | Examples                                            |
| ------------- | ----------------------------------- | --------------------------------------------------- |
| Bug           | `[bug] <short-error-message>`       | `[bug] Cannot read property 'id' of undefined`      |
| Feature       | `[feature] <action-object-context>` | `[feature] Add OAuth token refresh for calendar`    |
| Sentry        | `[sentry] <error-name>`             | `[sentry] TypeError: null is not an object`         |
| Coverage      | `[coverage][<app>] <description>`   | `[coverage][user-service] Add tests for validation` |
| Refactoring   | `[refactor] <component-name>`       | `[refactor] Extract shared HTTP client utilities`   |
| Documentation | `[docs] <topic>`                    | `[docs] API authentication flow`                    |

### For Plan Splitting (Tiered Issues)

| Tier | Pattern                        | Example                                    |
| ---- | ------------------------------ | ------------------------------------------ |
| 0    | `[tier-0] <setup task>`        | `[tier-0] Setup skill directory structure` |
| 1    | `[tier-1] <independent task>`  | `[tier-1] Implement domain model`          |
| 2    | `[tier-2] <integration task>`  | `[tier-2] Wire up routes`                  |
| 3    | `[tier-3] <verification task>` | `[tier-3] Add test coverage`               |
| 4+   | `[tier-4] <finalization task>` | `[tier-4] Update documentation`            |

## PR Title Naming

Format: `[INT-XXX] <issue title without prefix>`

| Issue Title                         | PR Title                                |
| ----------------------------------- | --------------------------------------- |
| `[bug] Fix auth token refresh`      | `[INT-42] Fix auth token refresh`       |
| `[feature] Add calendar sync`       | `[INT-43] Add calendar sync`            |
| `[sentry] TypeError in AuthService` | `[INT-44] Fix TypeError in AuthService` |

**CRITICAL:** PR title MUST contain the Linear issue ID for GitHub integration.

## Title Generation Rules

1. **Keep under 80 characters** when possible
2. **Start with type tag** (enforced)
3. **Use present tense, imperative mood**
   - ✅ "Fix", "Add", "Update", "Remove"
   - ❌ "Fixed", "Added", "Fixing", "Adds"
4. **Be specific about location/context**
   - ✅ `[bug] Fix null pointer in UserService.authenticate()`
   - ❌ `[bug] Fix bug`
5. **Avoid technical jargon in first 50 chars**
   - Title should be scannable without deep context

## Project Key

**This project uses `INT-` prefix** (e.g., `INT-123`, `INT-144`).

Generic documentation uses `LIN-XXX` placeholders, but all actual references should use `INT-XXX`.
