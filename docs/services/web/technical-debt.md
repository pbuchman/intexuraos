# Web App — Technical Debt

**Last Updated:** 2026-02-19
**Analysis Run:** Autonomous documentation generation (service-scribe agent)

---

## Summary

| Category    | Count | Severity      |
| ----------- | ----- | ------------- |
| Code Smells | 5     | Medium/Low    |
| Test Gaps   | N/A   | N/A (planned) |
| Type Issues | 0     | --            |
| TODOs       | 0     | --            |
| **Total**   | **5** | --            |

---

## Future Plans

Based on code analysis and recent commits:

- **Refactoring for improved coverage:** The web app is exempt from the 95% coverage threshold due to planned refactoring (see CLAUDE.md)
- **PWA enhancements:** Enhanced offline capabilities and background sync
- **Mobile optimization:** Continued improvements to mobile responsiveness across all pages
- **Code task UX refinement:** Ongoing iteration on task submission, log viewing, and two-phase flow

---

## Code Smells

### High Priority

None identified.

### Medium Priority

| File                           | Issue                                   | Impact                                                                                                                                       |
| ------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `InboxPage.tsx`                | 866 lines (exceeds SRP guideline)       | Handles UI, state management, real-time listeners, filtering, pagination, and deep linking. Consider extracting to smaller components.        |
| `LinearIssuesPage.tsx`         | 804 lines with inline sub-issue rendering | Board columns, Firestore listener, sub-issue tree, label display, and sync management all in one file.                                        |
| `CodeTaskViewPage.tsx`         | 862 lines with two-phase UI inline      | Task detail, terminal, two-phase banner, worker offline handling, queue messaging, and retry all in one file.                                  |
| `pages/WorkerSettingsPage.tsx` | 601 lines with inline form components   | Worker add/edit forms, drag-and-drop, and connectivity testing all in one file. Extract form components.                                      |
| `pages/CalendarPage.tsx`       | 536 lines with inline logic             | Event list, month/week views, filtering, sync management, and failed event recovery all in one file.                                          |

### Low Priority

| File           | Issue                           | Impact                                                                                   |
| -------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `HomePage.tsx` | Large single component          | Landing page is less critical, but extraction of sections could improve maintainability. |

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

| File                                                       | Coverage | Notes                                              |
| ---------------------------------------------------------- | -------- | -------------------------------------------------- |
| `services/__tests__/conditionEvaluator.test.ts`            | Present  | Tests condition evaluation logic for action config |
| `services/__tests__/variableInterpolator.test.ts`          | Present  | Tests variable interpolation in action config      |
| `services/__tests__/apiClient.test.ts`                     | Present  | Tests API client error handling and request logic  |
| `services/__tests__/chatService.test.ts`                   | Present  | Tests chat send, guest send, session persistence   |
| `services/__tests__/codeAgentApi.test.ts`                  | Present  | Tests code agent API functions                     |
| `services/__tests__/researchAgentApi.notionExport.test.ts` | Present  | Tests research Notion export API                   |
| `hooks/__tests__/useActionConfig.test.ts`                  | Present  | Tests action config loading hook                   |
| `hooks/__tests__/useFailedLinearIssues.test.ts`            | Present  | Tests Linear issues hook                           |
| `hooks/__tests__/useCodeTasks.test.ts`                     | Present  | Tests code tasks hook (CRUD, polling, workers)     |
| `components/__tests__/Chat/Chat.test.tsx`                  | Present  | Tests Chat component (send, guest, errors)         |
| `components/__tests__/TaskConflictModal.test.tsx`          | Present  | Tests conflict modal rendering and actions         |
| `utils/__tests__/markdownUtils.test.ts`                    | Present  | Tests markdown/HTML stripping utilities            |
| `utils/__tests__/todoItemSort.test.ts`                     | Present  | Tests todo sorting logic                           |

### Missing Tests

| Module                         | Missing                   | Priority       |
| ------------------------------ | ------------------------- | -------------- |
| `services/actionExecutor.ts`   | Execution flow tests      | Medium         |
| `hooks/useGitHubPRSummaries.ts`| PR summary hook tests     | Medium         |
| `hooks/useTaskView.ts`         | Task view state tests     | Medium         |
| `hooks/useActionChanges.ts`    | Listener behavior tests   | Low            |
| `hooks/useCommandChanges.ts`   | Listener behavior tests   | Low            |
| Most `pages/` components       | Integration tests         | Low (optional) |

---

## TypeScript Issues

No `any` types, `@ts-ignore`, or `@ts-expect-error` found in the codebase.

---

## TODOs / FIXMEs

None identified.

---

## SRP Violations

| File                     | Lines | Issue                                                                   | Suggestion                                                                                                          |
| ------------------------ | ----- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `InboxPage.tsx`          | 866   | Handles routing, state, listeners, filtering, pagination, modals        | Extract filtering to `useInboxFilters` hook, pagination to `useInfiniteScroll` hook, modals to separate components  |
| `LinearIssuesPage.tsx`   | 804   | Board columns, Firestore listener, sub-issue tree, labels, sync inline  | Extract `IssueCard`, `IssueTree`, and `LinearBoardColumn` components                                                |
| `CodeTaskViewPage.tsx`   | 862   | Task detail, terminal, two-phase banner, queue messaging, retry inline  | Extract `TaskTerminal`, `DesignTaskBanner`, and `TaskActions` into separate components                              |
| `WorkerSettingsPage.tsx` | 601   | Add/edit forms, drag-drop reorder, connectivity testing inline          | Extract `WorkerForm`, `WorkerCard`, and `WorkerList` components                                                     |
| `CalendarPage.tsx`       | 536   | Event list, month/week views, filtering, sync, failed event recovery    | Extract calendar views and event list rendering                                                                     |

---

## Code Duplicates

| Pattern              | Locations                                                        | Suggestion                                     |
| -------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| API error handling   | All `pages/` components                                          | Create `useApiCall` hook for try/catch pattern |
| Filter dropdown UI   | `InboxPage.tsx`, `LinearIssuesPage.tsx`                          | Extract to `FilterDropdown.tsx` component      |
| Modal close handlers | All modal components                                             | Create `useModal` hook for close logic         |
| Loading spinner      | Repeated in most page components                                 | Extract `PageLoader` component                 |
| Dark mode classes    | `dark:bg-*` / `dark:text-*` repeated across all pages/components | Consider shared theme utility classes          |

---

## Deprecations

None identified.

---

## Resolved Issues

| Date       | Issue                                              | Resolution                                                   |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------ |
| 2026-02-19 | PR event comment bodies showed raw HTML            | Added rehype-raw rendering (`2a187f90`)                      |
| 2026-02-19 | PR event page loaded all events at once (expensive)| Split into lazy-loaded summaries + details (`e8bbacd7`)      |
| 2026-02-18 | No way to navigate from design task to impl task   | Added DesignTaskBanner with link (`0e07e938`)                |
| 2026-02-17 | Code task detail had dead code from migration      | Cleaned up CodeTaskViewPage migration (`5fa51f75`)           |
| 2026-02-17 | Log duplication on Firestore listener resume       | Added cancellation guard to async effects (`a59e194b`)       |
| 2026-02-16 | Messages interrupted running tasks                 | Added queue-based messaging without interrupt (`935d3210`)   |
| 2026-02-14 | Linear sub-issues not visible in board             | Added parent-child indented rendering (`08dbaf84`)           |
| 2026-02-08 | Text log viewer lacked ANSI color support          | Replaced with xterm.js terminal (`340971a8`)                 |
| 2026-02-07 | RefreshIndicator caused layout shifts              | Removed; replaced with inline RefreshCw (`1bc3c44f`)         |
| 2026-02-07 | UI inconsistencies in Linear issues and code tasks | Fixed in commit `c6ed05c3`                                   |
| 2026-02-06 | Missing redirect when dev environment is ready     | Fixed in INT-511 (`65c26987`)                                |
| 2026-02-05 | Firestore Timestamp bug in PR events               | Fixed in commit `a31578d7`                                   |
| 2026-02-04 | Invalid Date display in log viewer                 | Fixed in commit `c2dd8db2`                                   |
| 2026-02-04 | Code task 409 conflict not handled in UI           | Added conflict modal in INT-498 (`a29e301b`)                 |
| 2026-02-02 | LinearIssueCombobox crash when filtering issues    | Moved selector to modal (`LinearIssueSelectorModal`)         |
| 2025-01-14 | System health page in UI                           | Removed in INT-270 (commit `31ab6d2f`)                       |
| 2024-12-20 | Inbox showing old actions after initial load       | Fixed in commit `089fbe51`                                   |
| 2024-12-XX | Calendar action failures not displayed             | Fixed in INT-144                                             |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
