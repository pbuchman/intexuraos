# Notes Agent - Technical Debt

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | -        |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 0     | -        |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |
| Feature Gaps        | 2     | Low      |

Last updated: 2026-02-19

## Feature Gaps

### Tag Filtering Not Implemented

The `listNotes` use case accepts only `userId` and returns all notes without any filtering. Tag filtering has been planned since the initial release but is not yet implemented. Clients must filter client-side.

**Impact:** API consumers cannot request a filtered list; all notes must be transferred and filtered locally.
**Fix:** Add optional `tags?: string[]` param to `NoteRepository.findByUserId()`, implement Firestore `array-contains-any` query, and expose via the route query string.

### Status Not Returned in Public API

The `formatNote()` serializer in `noteRoutes.ts` omits the `status` field from all public responses, even though the field is stored in Firestore and part of the domain model. The draft/active distinction is invisible to public API consumers.

**Impact:** Clients cannot differentiate draft from active notes.
**Fix:** Add `status: note.status` to the `formatNote()` return object and update response schemas.

## Future Plans

### Planned Features

- **Tag filtering** — Filter notes by tag in the list endpoint (server-side)
- **Full-text search** — Search across note content
- **Note sharing** — Share notes with other users

### Proposed Enhancements

1. Rich text content support (markdown rendering)
2. Note folders/organization
3. Collaborative editing

## Code Smells

### None Detected

No active code smells found in current codebase.

## Test Coverage

### Current Status

All endpoints and use cases have test coverage. No gaps identified.

### Coverage Areas

- Routes: Fully tested
- Use cases: All covered
- Infrastructure: Tested via routes

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found.

## SRP Violations

### None Detected

All files are within reasonable size limits.

## Code Duplicates

### None Detected

No significant code duplication patterns identified.

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Resolved Issues

### Recent Improvements

| Date       | Improvement                                  | Detail                                                  |
| ---------- | -------------------------------------------- | ------------------------------------------------------- |
| 2026-02-16 | Dash0 OpenTelemetry integration              | Added distributed tracing via `@intexuraos/infra-dash0` |
| 2026-02-16 | Dev-mode log formatting for PM2              | Improved local log readability in PM2 output            |
| 2026-02-14 | PM2 ecosystem uses pnpm --filter start:local | Unified local start script across all services          |

### Historical Issues

| Date       | Issue                               | Resolution                                  |
| ---------- | ----------------------------------- | ------------------------------------------- |
| 2026-01-30 | Raw reply.send() in internal routes | Migrated to reply.fail() for auth errors    |
| 2026-01-31 | Legacy notes missing status field   | Added default status fallback in repository |
