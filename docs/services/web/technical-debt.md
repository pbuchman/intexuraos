# Web App -- Technical Debt

**Last Updated:** 2026-02-22
**Analysis Run:** Autonomous documentation generation (service-scribe agent)

---

## Summary

| Category    | Count | Severity      |
| ----------- | ----- | ------------- |
| Code Smells | 6     | Medium/Low    |
| Test Gaps   | N/A   | N/A (planned) |
| Type Issues | 1     | Low           |
| TODOs       | 0     | --            |
| **Total**   | **7** | --            |

---

## Future Plans

Based on code analysis and recent commits:

- **Refactoring for improved coverage:** The web app is exempt from the 95% coverage threshold due to planned refactoring (see CLAUDE.md)
- **PWA enhancements:** Enhanced offline capabilities and background sync
- **Mobile optimization:** Continued improvements to mobile responsiveness across all pages
- **Code task UX refinement:** Ongoing iteration on collapsible tool output, multi-status filtering, and agent-based flow
- **Component extraction:** Large page files (InboxPage, CodeTaskViewPage, LinearIssuesPage) are candidates for decomposition into smaller, focused components

---

## Code Smells

### High Priority

None identified.

### Medium Priority

| File                     | Issue                                     | Impact                                                                                                                                 |
| ------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `CodeTaskViewPage.tsx`   | 1021 lines with collapsible log viewer    | Task detail, collapsible tool output, agent-type banner, queue messaging, retry, and PR events timeline all in one file.               |
| `InboxPage.tsx`          | 871 lines (exceeds SRP guideline)         | Handles UI, state management, real-time listeners, filtering, pagination, and deep linking. Consider extracting to smaller components. |
| `LinearIssuesPage.tsx`   | 810 lines with inline sub-issue rendering | Board columns, Firestore listener, sub-issue tree, assignee badges, label display, and sync management all in one file.                |
| `WorkerSettingsPage.tsx` | 637 lines with inline form components     | Worker add/edit forms, drag-and-drop reorder, connectivity testing, and autofill prevention all in one file.                           |

### Low Priority

| File                              | Issue                                                   | Impact                                                                                                   |
| --------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ResearchDetailPage.tsx`          | 1818 lines -- largest file in the app                   | Report detail with markdown rendering, model attribution, cover image, and export. Major SRP violation.  |
| `HomePage.tsx`                    | 607 lines, large single component                       | Landing page is less critical, but extraction of sections could improve maintainability.                 |
| `Sidebar.tsx`                     | 690 lines with filter URL building and matching logic   | Navigation, collapsible sections, notification filters, and scroll preservation all in one component.    |

---

## Test Coverage Gaps

**Note:** The web app is exempt from the 95% coverage threshold due to planned refactoring.

Tests are REQUIRED for:

- `utils/` -- Utility functions
- `services/` -- API client functions
- `hooks/` -- Custom React hooks
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
| `hooks/__tests__/useVisualizations.test.ts`                | Present  | Tests visualization management hook                |
| `components/__tests__/Chat/Chat.test.tsx`                  | Present  | Tests Chat component (send, guest, errors)         |
| `components/__tests__/TaskConflictModal.test.tsx`          | Present  | Tests conflict modal rendering and actions         |
| `utils/__tests__/markdownUtils.test.ts`                    | Present  | Tests markdown/HTML stripping utilities            |
| `utils/__tests__/todoItemSort.test.ts`                     | Present  | Tests todo sorting logic                           |
| `utils/__tests__/dateUtils.test.ts`                        | Present  | Tests calendar date utilities                      |

### Missing Tests

| Module                          | Missing                            | Priority       |
| ------------------------------- | ---------------------------------- | -------------- |
| `services/actionExecutor.ts`    | Execution flow tests               | Medium         |
| `hooks/useGitHubPRSummaries.ts` | PR summary hook tests              | Medium         |
| `hooks/useTaskView.ts`          | Task view state tests              | Medium         |
| `hooks/useActionChanges.ts`     | Listener behavior tests            | Low            |
| `hooks/useCommandChanges.ts`    | Listener behavior tests            | Low            |
| `hooks/useWorkerSettings.ts`    | Worker settings hook tests         | Low            |
| Most `pages/` components        | Integration tests                  | Low (optional) |

---

## TypeScript Issues

| File                                            | Issue            | Count |
| ----------------------------------------------- | ---------------- | ----- |
| `components/__tests__/Chat/Chat.test.tsx`       | @ts-expect-error | 1     |

The single `@ts-expect-error` is for assigning to `import.meta.env` in test setup, which is a valid test infrastructure need.

---

## TODOs / FIXMEs

None identified. The codebase is clean of TODO/FIXME/HACK comments.

---

## SRP Violations

| File                     | Lines | Issue                                                                         | Suggestion                                                                                                         |
| ------------------------ | ----- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ResearchDetailPage.tsx` | 1818  | Report detail, markdown, model attribution, cover image, export, share        | Extract `ResearchReport`, `ModelAttribution`, `CoverImageViewer`, and `ExportPanel` components                     |
| `CodeTaskViewPage.tsx`   | 1021  | Task detail, collapsible tool log, agent-type banner, queue messaging, retry  | Extract `CollapsibleLogViewer`, `DesignTaskBanner`, `TaskActions`, and `TaskMessaging` into separate components    |
| `TodosListPage.tsx`      | 1149  | Todo list, inline editing, item management, drag-and-drop, filtering          | Extract `TodoCard`, `TodoItemList`, and `TodoFilters` components                                                   |
| `BookmarksListPage.tsx`  | 1134  | Bookmark list, search, OG preview, AI summary, archive, filtering             | Extract `BookmarkCard`, `BookmarkSearch`, and `BookmarkFilters` components                                         |
| `InboxPage.tsx`          | 871   | Routing, state, listeners, filtering, pagination, modals                      | Extract filtering to `useInboxFilters` hook, pagination to `useInfiniteScroll` hook, modals to separate components |
| `LinearIssuesPage.tsx`   | 810   | Board columns, Firestore listener, sub-issue tree, assignees, labels, sync    | Extract `IssueCard`, `IssueTree`, and `LinearBoardColumn` components                                               |
| `Sidebar.tsx`            | 690   | Navigation, collapsible sections, filter URL logic, scroll preservation       | Extract `SidebarSection`, `NotificationFilterList`, and filter URL utils                                           |
| `WorkerSettingsPage.tsx` | 637   | Add/edit forms, drag-drop reorder, connectivity testing, autofill prevention  | Extract `WorkerForm`, `WorkerCard`, and `WorkerList` components                                                    |

---

## Code Duplicates

| Pattern                     | Locations                                                        | Suggestion                                     |
| --------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| API error handling          | All `pages/` components                                          | Create `useApiCall` hook for try/catch pattern |
| Filter dropdown UI          | `InboxPage.tsx`, `CodeTasksPage.tsx`, `LinearIssuesPage.tsx`     | Extract to `FilterDropdown.tsx` component      |
| Delete confirmation dialogs | `CodeTasksPage`, `DataSourcesListPage`, `TodosListPage`, etc.    | Extract to shared `ConfirmDeleteDialog`        |
| Modal close handlers        | All modal components                                             | Create `useModal` hook for close logic         |
| Loading spinner             | Repeated in most page components                                 | Extract `PageLoader` component                 |
| Dark mode classes           | `dark:bg-*` / `dark:text-*` repeated across all pages/components | Consider shared theme utility classes          |
| Status badge styling        | `CodeTasksPage.tsx`, `CodeTaskViewPage.tsx`                      | Extract `StatusBadge` component                |

---

## Deprecations

None identified.

---

## Resolved Issues

| Date       | Issue                                                     | Resolution                                                      |
| ---------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| 2026-02-22 | Tool output lines not collapsing correctly in log viewer  | Fixed isBodyLine single-space timestamp detection (`1ee7e8c6`)  |
| 2026-02-22 | Worker reorder buttons not working in settings UI         | Fixed button handlers in WorkerSettingsPage (`fbe7c944`)        |
| 2026-02-21 | Delete confirmations inconsistent across pages            | Standardized all delete actions with confirmation (`c9acdce3`)  |
| 2026-02-21 | Filter state and sidebar collapse lost on page refresh    | Persisted both to localStorage (`2e3ae30c`)                     |
| 2026-02-21 | Browser autofill on worker secret fields                  | Added autoComplete="new-password" to secret inputs (`3b081686`) |
| 2026-02-20 | Null assignee crashes LinearIssuesPage                    | Added null guards for assignee in board display (`19442f43`)    |
| 2026-02-20 | Assignee not displayed on Linear board cards              | Added assignee name with emerald badge (`6df58b52`)             |
| 2026-02-19 | PR event comment bodies showed raw HTML                   | Added rehype-raw rendering (`2a187f90`)                         |
| 2026-02-19 | PR event page loaded all events at once (expensive)       | Split into lazy-loaded summaries + details (`e8bbacd7`)         |
| 2026-02-18 | No way to navigate from design task to impl task          | Added DesignTaskBanner with link (`0e07e938`)                   |
| 2026-02-17 | Code task detail had dead code from migration             | Cleaned up CodeTaskViewPage migration (`5fa51f75`)              |
| 2026-02-17 | Log duplication on Firestore listener resume              | Added cancellation guard to async effects (`a59e194b`)          |
| 2026-02-16 | Messages interrupted running tasks                        | Added queue-based messaging without interrupt (`935d3210`)      |
| 2026-02-14 | Linear sub-issues not visible in board                    | Added parent-child indented rendering (`08dbaf84`)              |
| 2026-02-17 | xterm.js terminal removed; replaced with custom LogStream | Deleted TerminalLogViewer.tsx and xterm.js deps (`5fa51f75`)    |
| 2026-02-08 | Text log viewer lacked ANSI color support                 | Replaced with xterm.js terminal (`340971a8`)                    |
| 2026-02-07 | RefreshIndicator caused layout shifts                     | Removed; replaced with inline RefreshCw (`1bc3c44f`)            |
| 2026-02-07 | UI inconsistencies in Linear issues and code tasks        | Fixed in commit `c6ed05c3`                                      |
| 2026-02-06 | Missing redirect when dev environment is ready            | Fixed in INT-511 (`65c26987`)                                   |
| 2026-02-05 | Firestore Timestamp bug in PR events                      | Fixed in commit `a31578d7`                                      |
| 2026-02-04 | Invalid Date display in log viewer                        | Fixed in commit `c2dd8db2`                                      |
| 2026-02-04 | Code task 409 conflict not handled in UI                  | Added conflict modal in INT-498 (`a29e301b`)                    |
| 2026-02-02 | LinearIssueCombobox crash when filtering issues           | Moved selector to modal (`LinearIssueSelectorModal`)            |
| 2025-01-14 | System health page in UI                                  | Removed in INT-270 (commit `31ab6d2f`)                          |
| 2024-12-20 | Inbox showing old actions after initial load              | Fixed in commit `089fbe51`                                      |
| 2024-12-XX | Calendar action failures not displayed                    | Fixed in INT-144                                                |

---

## Related

- [Features](features.md) -- User-facing documentation
- [Technical](technical.md) -- Developer reference
- [Documentation Run Log](../../documentation-runs.md)
