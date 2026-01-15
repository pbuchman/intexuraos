# Expected Sentry Warnings

This file documents Sentry issues that represent **expected behavior** and should be marked as "Ignored" in Sentry. These are informational warnings that provide observability into operational states without indicating code defects.

## Format

For each expected warning, use this format:

### `Warning Message`

- **Sentry Issue**: [ISSUE-ID](URL)
- **Code Location**: `path/to/file.ts:line`
- _Reason:_ Why this is expected behavior

---

## Expected Warnings

### `[3.5.4] Partial failure detected, awaiting user confirmation`

- **Sentry Issue**: [INTEXURAOS-DEVELOPMENT-7](https://piotr-buchman.sentry.io/issues/INTEXURAOS-DEVELOPMENT-7)
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

- **Sentry Issue**: (Similar pattern to above)
- **Code Location**: `apps/research-agent/src/routes/internalRoutes.ts:807-811`
- **Reason**: When all configured LLM providers fail simultaneously, the research is correctly marked as failed. This is **expected behavior** when external services are unavailable or misconfigured. The warning provides visibility into complete service failures without blocking the system.

---

## Summary

These warnings are **intentional observability signals** that:

1. Provide operational visibility into external service dependencies
2. Allow monitoring of partial/complete LLM failures
3. Enable user intervention when needed
4. Do not indicate code defects

**Action**: Mark similar Sentry issues with these warning patterns as **"Ignored"** unless they indicate a sudden spike in frequency or new failure modes.
