# Cross-Linking Protocol

All artifacts must be connected:

| From      | To        | Method                                                         |
| --------- | --------- | -------------------------------------------------------------- |
| Linear    | GitHub    | PR title contains `INT-XXX`                                    |
| GitHub    | Linear    | `Fixes INT-XXX` in PR body                                     |
| SentryBox | Linear    | Code Agent webhook creates an issue with the evidence URL      |
| Linear    | SentryBox | Generated issue description retains the SentryBox evidence URL |
| PR        | SentryBox | SentryBox issue link in PR description when applicable         |

## Rules

- **Never fabricate Linear issue IDs.** If no `INT-XXX` is provided by the user or found in the task context, ask before creating branches or PRs. Use a descriptive branch name without an issue reference (e.g., `fix/skip-release-pr-triage`) rather than inventing a fake ID.
