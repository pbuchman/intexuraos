# Design: Action Feedback Mechanism

**Issue:** [INT-124](https://linear.app/pbuchman/issue/INT-124/sync-linear-issue-creation-status-and-improve-error-feedback)
**Author:** Claude Opus 4.5
**Date:** 2026-01-17
**Status:** In Progress

---

## Problem Statement

Users experience misleading feedback when executing actions via WhatsApp voice commands:

1. **Silent Success Bug:** ~~Linear issue creation shows "failed" on UI despite the issue being successfully created in Linear~~ **FIXED in INT-125**
2. **Missing Failure Context:** When actions fail, no specific reason is displayed to the user
3. **Inconsistent Feedback Contract:** Different action types return feedback in different formats

---

## Implementation Status

| Phase | Issue | Status |
|-------|-------|--------|
| Phase 1: Hotfix | [INT-125](https://linear.app/pbuchman/issue/INT-125) | ✅ Completed |
| Phase 2: Standardize Contract | [INT-126](https://linear.app/pbuchman/issue/INT-126) | 🔄 In Progress |

---

## ActionFeedback Contract (INT-126)

```typescript
// packages/common-core/src/types/actionFeedback.ts

export interface ActionFeedback {
  /** Execution outcome */
  status: 'completed' | 'failed';

  /** Human-readable message for user display (REQUIRED) */
  message: string;

  /** URL to the created/affected resource (success only) */
  resourceUrl?: string;

  /** Error code for debugging (REQUIRED when status === 'failed') */
  errorCode?: string;
}
```

### Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Single `message` field | Simpler than separate successMessage/failureReason; status determines context | 2026-01-17 |
| `resourceUrl` only | Dropped `resourceIdentifier` - URL is sufficient, ID can be parsed if needed | 2026-01-17 |
| `message` required | Every response MUST include user-facing feedback | 2026-01-17 |
| `errorCode` required on failure | Enables debugging; standard codes defined in common-core | 2026-01-17 |
| No metadata field | Keep it simple; add later if needed | 2026-01-17 |

---

## Standard Error Codes

```typescript
// packages/common-core/src/types/errorCodes.ts

export const ActionErrorCodes = {
  // Network/Infrastructure
  TIMEOUT: 'TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Authentication/Authorization
  AUTH_FAILED: 'AUTH_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Business Logic
  DUPLICATE: 'DUPLICATE',
  NOT_FOUND: 'NOT_FOUND',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',

  // External API
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
} as const;
```

---

## Architecture

### Action Execution Flow

```
┌────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌──────────────┐
│   Web UI   │───▶│   actions-agent  │───▶│  *-agent        │───▶│ External API │
│            │    │  POST /actions/  │    │  POST /internal │    │              │
│            │    │  {actionId}/     │    │  /{type}        │    │              │
│            │    │  execute         │    │                 │    │              │
└────────────┘    └──────────────────┘    └─────────────────┘    └──────────────┘
      │                    │                      │                      │
      ▼                    ▼                      ▼                      ▼
┌────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌──────────────┐
│  Displays: │    │  Expects:        │    │  Returns:       │    │  Returns:    │
│  message   │◀───│  ActionFeedback  │◀───│  ActionFeedback │◀───│  Result      │
│  from      │    │  in envelope     │    │  { status,      │    │              │
│  backend   │    │                  │    │    message, ... }│    │              │
└────────────┘    └──────────────────┘    └─────────────────┘    └──────────────┘
```

### Downstream Services

All 6 services must return `ActionFeedback`:

| Service | Endpoint | Status |
|---------|----------|--------|
| linear-agent | `/internal/linear/process-action` | 🔄 Pending |
| todos-agent | `/internal/todos` | 🔄 Pending |
| notes-agent | `/internal/notes` | 🔄 Pending |
| links-agent | `/internal/links` | 🔄 Pending |
| calendar-agent | `/internal/calendar` | 🔄 Pending |
| research-agent | `/internal/research` | 🔄 Pending |

---

## UI Display Pattern

### Current Behavior

- Success: Green notification banner with hardcoded message + link to resource
- Failure: Exception caught → generic error (no specific reason shown)
- Source: `NotificationArea` in `InboxPage.tsx`

### Target Behavior

- **Success:** Green banner with `ActionFeedback.message` + link to `resourceUrl`
- **Failure:** Red banner with `ActionFeedback.message`

---

## Testing Strategy

### Integration Tests

For each downstream service, verify:

1. **Success case:** Returns `{ status: 'completed', message: '...', resourceUrl: '...' }`
2. **Failure case:** Returns `{ status: 'failed', message: '...', errorCode: '...' }`
3. **Envelope format:** Response wrapped in `{ success: true, data: ActionFeedback }`

---

## Appendix: Affected Files

| File | Change Type |
|------|-------------|
| `packages/common-core/src/types/actionFeedback.ts` | New file |
| `packages/common-core/src/types/errorCodes.ts` | New file |
| `apps/*/src/routes/internalRoutes.ts` | Update response |
| `apps/actions-agent/src/infra/http/*Client.ts` | Parse `message` |
| `apps/web/src/types/actionConfig.ts` | Add `message` to result |
| `apps/web/src/pages/InboxPage.tsx` | Display backend message |
| `apps/web/src/components/ConfigurableActionButton.tsx` | Pass `message` |
