# Expected SentryBox Reports And Code Suppression

This file documents SentryBox reports that represent **expected behavior** and are
candidates for code-level suppression. They are informational warnings that
provide observability into operational states without indicating code defects.

For Code Agent SentryBox automation, suppression is never a hidden SentryBox-side
ignore. The worker must open a PR that changes code to suppress the specific
non-error report, and the PR must include evidence that the report is safe to
suppress. If the evidence is not clear, fix the bug instead.

## Format

For each expected warning, use this format:

### `Warning Message`

- **SentryBox Issue**: [ISSUE-ID](URL)
- **Code Location**: `path/to/file.ts:line`
- **Suppression**: The code-level guard, filter, logger downgrade, or Sentry
  `beforeSend` rule that suppresses only this expected report.
- _Reason:_ Why this is expected behavior and not an application error.

---

## Expected Warnings

### `[3.5.4] Partial failure detected, awaiting user confirmation`

- **SentryBox Issue**: No current retained issue.
- **Code Location**: `apps/research-agent/src/routes/internalRoutes.ts:813-818`
- **Reason**: When external LLM providers fail (rate limits, network issues, invalid API keys), the system correctly transitions to `awaiting_confirmation` state and lets the user decide whether to proceed with successful results. This is an **expected operational state**, not a bug.

The application handles partial failures correctly by:

1. Detecting which models failed
2. Preserving successful results
3. Notifying the user via the warning
4. Waiting for explicit user confirmation before synthesis

**Context**: The `glm-4.7` model (Zai GLM) may fail intermittently due to API rate limits or provider-side issues. This does not indicate a code defect.

---

### `[3.5.3] All LLMs failed, research marked as failed`

- **SentryBox Issue**: No current retained issue.
- **Code Location**: `apps/research-agent/src/routes/internalRoutes.ts:807-811`
- **Reason**: When all configured LLM providers fail simultaneously, the research is correctly marked as failed. This is **expected behavior** when external services are unavailable or misconfigured. The warning provides visibility into complete service failures without blocking the system.

---

## Summary

These reports are **intentional observability signals** that:

1. Provide operational visibility into external service dependencies
2. Allow monitoring of partial/complete LLM failures
3. Enable user intervention when needed
4. Do not indicate code defects

**Action**: handle similar SentryBox issues through a PR. Either fix the bug, or
add a narrowly scoped code-level suppression with evidence. Do not use a
SentryBox-side ignore as the only resolution for the automated SentryBox code-task
path.
