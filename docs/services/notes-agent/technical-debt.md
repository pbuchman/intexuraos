# Notes Agent -- Technical Debt

**Last Updated:** 2026-02-22
**Analysis Run:** [2026-02-22 documentation-runs.md entry](../../documentation-runs.md)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| Code Smells         | 1     | Low      |
| Test Gaps           | 0     | --       |
| Type Issues         | 0     | --       |
| TODOs               | 0     | --       |
| Feature Gaps        | 3     | Low      |
| SRP Violations      | 0     | --       |
| Code Duplicates     | 1     | Low      |
| Deprecations        | 0     | --       |
| **Total**           | **5** | --       |

---

## Future Plans

### Planned Features

- **Tag filtering** -- Add server-side tag filtering to the `GET /notes` endpoint. Implement via Firestore `array-contains-any` query with optional `tags` query parameter. Requires a composite index on `(userId, tags)`.
- **Full-text search** -- Search across note title and content fields. May require Firestore full-text search integration or a dedicated search index.
- **Pagination** -- Add cursor-based pagination to `GET /notes` to handle users with large note collections efficiently.

### Proposed Enhancements

1. Expose `status` field in public API responses
2. Add status transition endpoint (draft -> active)
3. Rich text content support (markdown storage and rendering)
4. Note folders or hierarchical organization
5. Collaborative note sharing between users
6. Revision history and version tracking

---

## Feature Gaps

### Tag Filtering Not Implemented

The `listNotes` use case accepts only `userId` and returns all notes without any filtering. Tag filtering has been planned since the initial release but is not yet implemented. Clients must filter client-side.

**Impact:** API consumers cannot request a filtered list; all notes must be transferred and filtered locally.
**Fix:** Add optional `tags?: string[]` param to `NoteRepository.findByUserId()`, implement Firestore `array-contains-any` query, expose via the route query string, and create a composite index migration.

### Status Not Returned in Public API

The `formatNote()` serializer in `noteRoutes.ts` (line 73-85) omits the `status` field from all public responses, even though the field is stored in Firestore and part of the domain model. The draft/active distinction is invisible to public API consumers.

**Impact:** Clients cannot differentiate draft from active notes.
**Fix:** Add `status: note.status` to the `formatNote()` return object and update the `noteResponseSchema` to include a `status` field.

### No Pagination on List Endpoint

The `findByUserId()` method returns all notes for a user in a single query with no limit or cursor support. As users accumulate notes, response sizes and Firestore read costs grow unbounded.

**Impact:** Performance degrades for users with many notes; higher Firestore read costs.
**Fix:** Add `limit` and `startAfter` parameters to `findByUserId()`, implement cursor-based pagination in the route handler, and return pagination metadata in the response.

---

## Code Smells

### Low Priority

| File                                             | Issue                             | Impact                                                                          |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------- |
| `src/infra/firestore/firestoreNoteRepository.ts` | Double-read on update and delete  | Two Firestore reads per mutation (use case + repository both read the document) |

---

## Test Coverage Gaps

### None Detected

All endpoints, use cases, and repository operations have comprehensive test coverage including:

- Happy path for all CRUD operations
- Ownership verification (FORBIDDEN) for get, update, delete
- NOT_FOUND handling for non-existent notes
- STORAGE_ERROR handling for Firestore failures
- Authentication failures (401) for all endpoints
- Legacy document backward compatibility (status default)
- Config loading with all env var combinations

---

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found in source code. The only occurrences of "any" in the codebase are string literals in test data (e.g., `'any-id'` in test URLs).

---

## TODOs / FIXMEs

### None Found

No `TODO:`, `FIXME:`, `HACK:`, or `XXX:` comments in the source code.

---

## SRP Violations

### None Detected

All source files are within reasonable size limits:

| File                               | Lines | Assessment               |
| ---------------------------------- | ----- | ------------------------ |
| `routes/noteRoutes.ts`             | 330   | Within limit (5 routes)  |
| `server.ts`                        | 237   | Within limit (setup)     |
| `infra/firestoreNoteRepository.ts` | 169   | Within limit (5 methods) |
| All other files                    | <55   | Well within limits       |

---

## Code Duplicates

### Ownership Check Pattern

| Pattern                               | Locations                                                      | Suggestion                                                |
| ------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| findById + null check + userId check  | `getNote.ts`, `updateNote.ts`, `deleteNote.ts` (3 files)       | Extract to a shared `verifyOwnership` helper function     |

The three use cases (`getNote`, `updateNote`, `deleteNote`) all repeat the same pattern: call `findById`, check for null, check `userId` ownership, return FORBIDDEN if not the owner. This could be extracted to a shared utility, though the current duplication is minor (each file is under 45 lines).

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Resolved Issues

| Date       | Issue                               | Resolution                                             |
| ---------- | ----------------------------------- | ------------------------------------------------------ |
| 2026-02-16 | Dash0 OpenTelemetry integration     | Added distributed tracing via `@intexuraos/infra-otel` |
| 2026-02-16 | Dev-mode log formatting for PM2     | Improved local log readability in PM2 output           |
| 2026-02-14 | PM2 ecosystem uses pnpm --filter    | Unified local start script across all services         |
| 2026-01-30 | Raw reply.send() in internal routes | Migrated to reply.fail() for auth errors               |
| 2026-01-30 | Legacy notes missing status field   | Added default status fallback in repository            |

---

## Related

- [Features](features.md) -- User-facing documentation
- [Technical](technical.md) -- Developer reference
- [Agent Interface](agent.md) -- Machine-readable specification
- [Documentation Run Log](../../documentation-runs.md)
