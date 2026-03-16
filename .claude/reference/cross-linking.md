# Cross-Linking Protocol

All artifacts must be connected:

| From   | To     | Method                                          |
| ------ | ------ | ----------------------------------------------- |
| Linear | GitHub | PR title contains `INT-XXX`                     |
| GitHub | Linear | `Fixes INT-XXX` in PR body                      |
| Sentry | Linear | `[sentry] <title>` prefix + link in description |
| Linear | Sentry | Comment on Sentry issue with Linear link        |
| PR     | Sentry | Sentry link in PR description                   |

## Rules

- **Never fabricate Linear issue IDs.** If no `INT-XXX` is provided by the user or found in the task context, ask before creating branches or PRs. Use a descriptive branch name without an issue reference (e.g., `fix/skip-release-pr-triage`) rather than inventing a fake ID.
