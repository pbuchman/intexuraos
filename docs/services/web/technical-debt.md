# Web App — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 autonomous documentation refresh](../../documentation-runs.md)

---

## Summary

| Category    | Count  | Severity      |
| ----------- | ------ | ------------- |
| Code Smells | 7      | Medium/Low    |
| Test Gaps   | N/A    | N/A (exempt)  |
| Type Issues | 0      | —             |
| TODOs       | 0      | —             |
| **Total**   | **7**  | —             |

---

## Future Plans

Based on code analysis and recent commits:

- **Migrate remaining code tasks to v2 view:** `CodeTaskViewPage` (v1, route `/code-tasks/:id`) still exists alongside `CodeTaskViewPageV2` (route `/code-tasks/:id/view`). The intent is to retire v1 once v2 reaches full parity.
- **Component extraction:** Large page files (`ResearchDetailPage.tsx`, `InboxPage.tsx`, `LinearIssuesPage.tsx`) are primary candidates for decomposition into smaller, focused components per the SRP guideline.
- **PWA enhancements:** Enhanced offline capabilities and background sync for more content types.
- **Mobile optimization:** Continued improvements to mobile responsiveness across all pages.
- **Worker settings — per-worker default review type:** The default review worker type is currently a single global preference. Per-worker overrides may follow.
- **Coverage for utils/ and services/:** The web app is exempt from the 95% coverage threshold, but `utils/` and `services/` files are expected to have coverage — gaps exist in some API service files.

---

## Code Smells

### High Priority

None identified.

### Medium Priority

| File                        | Issue                                               | Impact                                                                                                                                      |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResearchDetailPage.tsx`    | Largest file in the app; handles many concerns      | Report detail with markdown rendering, model attribution, cover image, export, retry, and favouriting all in one file. Clear SRP violation. |
| `InboxPage.tsx`             | Exceeds SRP guideline                               | Handles UI, state management, real-time listeners, filtering, pagination, and deep linking. Candidate for component extraction.             |
| `CodeTaskViewPage.tsx`      | Legacy v1 task view still maintained in parallel    | Two parallel implementations of the code task detail view; v1 must be kept in sync with v2 changes until retirement.                        |

### Low Priority

| File                               | Issue                                                                       | Impact                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `LinearIssuesPage.tsx`             | Inline sub-issue rendering and board column logic                           | Board columns, Firestore listener, sub-issue tree, assignee badges, label display, and sync all in one file.                |
| `WorkerSettingsPage.tsx`           | Inline form components for add/edit                                         | Worker add/edit forms, drag-and-drop reorder, connectivity testing, and autofill prevention in one file.                    |
| `Sidebar.tsx`                      | Filter URL building and matching logic inline                               | Navigation, collapsible sections, notification filters, and scroll preservation all in one component.                       |
| `WORKER_TYPE_METADATA` duplication | Defined independently in `CodeTaskNewPage.tsx` and `WorkerSettingsPage.tsx` | Same worker type name/description objects duplicated across two files. A comment marks it as premature abstraction for now. |

---

## Test Coverage Gaps

**Note:** The web app is exempt from the 95% coverage threshold. However, `utils/` and `services/` files are expected to have coverage per CLAUDE.md.

| File/Module                              | Notes                                                            |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `services/codeAgentApi.ts`               | Core API functions have tests; newer endpoints may lack coverage |
| `services/workerSettingsApi.ts`          | Connectivity test flow not fully covered                         |
| `utils/issueGroups.ts`                   | Active status grouping logic partially covered                   |

---

## TypeScript Issues

None identified. No `any` types, `@ts-ignore`, or `@ts-expect-error` usages found in production source files.

---

## TODOs / FIXMEs

None found in production source files.

---

## SRP Violations

| File                       | Issue                                                    | Suggestion                                                         |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `ResearchDetailPage.tsx`   | Handles full report lifecycle in a single file           | Extract `ResearchReport`, `LlmResultList`, `SharePanel` components |
| `InboxPage.tsx`            | Commands + actions + real-time + filtering + deep link   | Extract `CommandList`, `ActionList`, `InboxFilters` components     |
| `LinearIssuesPage.tsx`     | Board rendering + Firestore + sub-issue tree + sync      | Extract `LinearBoard`, `LinearIssueCard` components                |

---

## Code Duplicates

| Pattern                        | Locations                                              | Suggestion                                                                      |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `WORKER_TYPE_METADATA` record  | `CodeTaskNewPage.tsx`, `WorkerSettingsPage.tsx`        | Extract to a shared util or `common-core` once abstraction is clearly warranted |
| Spinner loading pattern        | Multiple pages use identical `animate-spin` markup     | Partially consolidated in `ui/` components; extend to remaining pages           |

---

## Deprecations

| Item                    | Location                          | Replacement          | Deadline                          |
| ----------------------- | --------------------------------- | -------------------- | --------------------------------- |
| `CodeTaskViewPage` (v1) | `src/pages/CodeTaskViewPage.tsx`  | `CodeTaskViewPageV2` | TBD — after v2 parity confirmed   |

---

## Resolved Issues

| Date       | Issue                                                                             | Resolution                                                  |
| ---------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 2026-03-13 | `startedAt` could be absent, causing incorrect sort order in code tasks list      | Added `createdAt` fallback for started-time sort            |
| 2026-03-13 | Worker Settings UI had inconsistent spacing and no loading state on test button   | Improved spacing and added in-button spinner                |
| 2026-03-12 | PR Events page used processed event type names instead of raw GitHub names        | Switched to raw GitHub event names in compact inline layout |
| 2026-02-22 | Collapsible tool output: `isBodyLine` stripped single-space timestamp incorrectly | Fixed timestamp stripping logic                             |
| 2026-02-22 | Worker reorder buttons in settings were non-functional                            | Fixed reorder button click handling                         |
| 2026-02-21 | Filter and sidebar collapse state lost on page refresh                            | Persisted to localStorage                                   |
| 2026-02-21 | Browser autofill on worker secret fields (INT-501)                                | Added `autoComplete="new-password"` to secret inputs        |
| 2026-02-20 | Null assignee in `LinearIssuesPage` caused runtime errors                         | Added null guards on assignee access                        |
| 2026-02-20 | `any` type in `types/index.ts`                                                    | Replaced with correct typed definition                      |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
