# Web App — Technical Debt

**Last Updated:** 2026-01-25
**Analysis Run:** Autonomous documentation generation (service-scribe agent)

---

## Summary

| Category    | Count | Severity      |
| ----------- | ----- | ------------- |
| Code Smells | 3     | Medium/Low    |
| Test Gaps   | N/A   | N/A (planned) |
| Type Issues | 0     | —             |
| TODOs       | 1     | Low           |
| **Total**   | **4** | —             |

---

## Future Plans

Based on code analysis and recent commits:

- **Refactoring for improved coverage:** The web app is exempt from the 95% coverage threshold due to planned refactoring (see CLAUDE.md)
- **PWA enhancements:** Enhanced offline capabilities and background sync
- **Mobile optimization:** Continued improvements to mobile responsiveness across all pages

---

## Code Smells

### High Priority

None identified.

### Medium Priority

| File                         | Issue                                  | Impact                                                                                                                                      |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `InboxPage.tsx`              | 879 lines (exceeds SRP guideline)      | File handles UI, state management, real-time listeners, filtering, pagination, and deep linking. Consider extracting to smaller components. |
| `pages/CalendarPage.tsx`     | Large page component with inline logic | Extract calendar event rendering and filtering logic into separate components.                                                              |
| `pages/ResearchListPage.tsx` | Combined list and detail views         | Consider separate list/detail pages for better separation.                                                                                  |

### Low Priority

| File           | Issue                           | Impact                                                                                   |
| -------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `HomePage.tsx` | 463 lines in a single component | Landing page is less critical, but extraction of sections could improve maintainability. |

---

## Test Coverage Gaps

**Note:** The web app is exempt from the 95% coverage threshold due to planned refactoring.

Tests are REQUIRED for:

- `utils/` - Utility functions
- `services/` - API client functions
- `hooks/` - Custom React hooks
- Calculations and business logic

Tests are OPTIONAL for:

- UI components (`components/`)
- Page components (`pages/`)

### Current Test Files

| File                                              | Coverage | Notes                                              |
| ------------------------------------------------- | -------- | -------------------------------------------------- |
| `services/__tests__/conditionEvaluator.test.ts`   | Present  | Tests condition evaluation logic for action config |
| `services/__tests__/variableInterpolator.test.ts` | Present  | Tests variable interpolation in action config      |
| `hooks/__tests__/useActionConfig.test.ts`         | Present  | Tests action config loading hook                   |
| `hooks/__tests__/useFailedLinearIssues.test.ts`   | Present  | Tests Linear issues hook                           |

### Missing Tests

| Module                       | Missing                 | Priority       |
| ---------------------------- | ----------------------- | -------------- |
| `services/apiClient.ts`      | Error handling tests    | Medium         |
| `services/actionExecutor.ts` | Execution flow tests    | Medium         |
| `hooks/useActionChanges.ts`  | Listener behavior tests | Low            |
| `hooks/useCommandChanges.ts` | Listener behavior tests | Low            |
| Most `pages/` components     | Integration tests       | Low (optional) |

---

## TypeScript Issues

No `any` types, `@ts-ignore`, or `@ts-expect-error` found in the codebase.

---

## TODOs / FIXMEs

| File           | Comment                                 | Priority                    |
| -------------- | --------------------------------------- | --------------------------- |
| `config.ts:26` | `todosAgentUrl` appears in env var list | Low (documentation clarity) |

---

## SRP Violations

| File                   | Lines | Issue                                                            | Suggestion                                                                                                         |
| ---------------------- | ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `InboxPage.tsx`        | 879   | Handles routing, state, listeners, filtering, pagination, modals | Extract filtering to `useInboxFilters` hook, pagination to `useInfiniteScroll` hook, modals to separate components |
| `CalendarPage.tsx`     | ~400+ | Event list, filtering, sync management                           | Extract event list rendering to `EventList.tsx`                                                                    |
| `ResearchListPage.tsx` | ~400+ | List view, filtering, share actions                              | Extract to `ResearchList.tsx` component                                                                            |

---

## Code Duplicates

| Pattern              | Locations                               | Suggestion                                     |
| -------------------- | --------------------------------------- | ---------------------------------------------- |
| API error handling   | All `pages/` components                 | Create `useApiCall` hook for try/catch pattern |
| Filter dropdown UI   | `InboxPage.tsx`, `LinearIssuesPage.tsx` | Extract to `FilterDropdown.tsx` component      |
| Modal close handlers | All modal components                    | Create `useModal` hook for close logic         |

---

## Deprecations

None identified.

---

## Resolved Issues

| Date       | Issue                                        | Resolution                             |
| ---------- | -------------------------------------------- | -------------------------------------- |
| 2025-01-14 | System health page in UI                     | Removed in INT-270 (commit `31ab6d2f`) |
| 2024-12-20 | Inbox showing old actions after initial load | Fixed in commit `089fbe51`             |
| 2024-12-XX | Calendar action failures not displayed       | Fixed in INT-144                       |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
