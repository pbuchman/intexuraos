# Notes Agent - Technical Reference

## Overview

Notes-agent provides simple CRUD operations for text notes with tag-based filtering (planned) and source tracking. Deployed as a Cloud Run service. Runs on port 8121 locally.

## Recent Changes

| Commit     | Description                                       | Date       |
| ---------- | ------------------------------------------------- | ---------- |
| `6063175b` | Add dev-mode log formatting for PM2 readability   | 2026-02-16 |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration               | 2026-02-16 |
| `d5fbb354` | Fix start:local to use tsx instead of node        | 2026-02-14 |
| `45f001c1` | Switch PM2 ecosystem to pnpm --filter start:local | 2026-02-14 |
| `c3198407` | Fix response contract violations (reply.fail)     | 2026-01-30 |
| `09091782` | Fix branch coverage for legacy status default     | 2026-01-30 |
| `9f1f8dc2` | INT-126: Standardize ServiceFeedback contract     | 2026-01-18 |

## API Endpoints

### Public Endpoints

| Method | Path         | Description        | Auth         |
| ------ | ------------ | ------------------ | ------------ |
| GET    | `/notes`     | List user's notes  | Bearer token |
| POST   | `/notes`     | Create new note    | Bearer token |
| GET    | `/notes/:id` | Get specific note  | Bearer token |
| PATCH  | `/notes/:id` | Update note fields | Bearer token |
| DELETE | `/notes/:id` | Delete note        | Bearer token |

**Note:** The public note response does **not** include the `status` field. Status is stored in Firestore but is intentionally omitted from the serialized response (`formatNote` excludes it).

### Internal Endpoints

| Method | Path              | Description                       | Auth            |
| ------ | ----------------- | --------------------------------- | --------------- |
| POST   | `/internal/notes` | Create note from internal service | Internal header |

**Internal response shape:** `ServiceFeedback` — `{ status: 'completed' | 'failed', message, resourceUrl?, errorCode? }` — not a note object.

## Domain Models

### Note

| Field       | Type                  | Description            |
| ----------- | --------------------- | ---------------------- |
| `id`        | string                | Unique note identifier |
| `userId`    | string                | Owner user ID          |
| `title`     | string                | Note title             |
| `content`   | string                | Note content           |
| `tags`      | string[]              | User-defined tags      |
| `status`    | `'draft' \| 'active'` | Draft or active        |
| `source`    | string                | Source system          |
| `sourceId`  | string                | ID in source system    |
| `createdAt` | Date                  | Creation timestamp     |
| `updatedAt` | Date                  | Last update timestamp  |

### CreateNoteInput

| Field      | Type                  | Required             |
| ---------- | --------------------- | -------------------- |
| `userId`   | string                | Yes                  |
| `title`    | string                | Yes                  |
| `content`  | string                | Yes                  |
| `tags`     | string[]              | Yes                  |
| `status`   | `'draft' \| 'active'` | No (default: active) |
| `source`   | string                | Yes                  |
| `sourceId` | string                | Yes                  |

### UpdateNoteInput

| Field     | Type     | Required |
| --------- | -------- | -------- |
| `title`   | string   | No       |
| `content` | string   | No       |
| `tags`    | string[] | No       |

**Note:** `status` cannot be updated via the PATCH endpoint. The `UpdateNoteInput` type does not include a `status` field.

## Dependencies

### Infrastructure

| Component                      | Purpose          |
| ------------------------------ | ---------------- |
| Firestore (`notes` collection) | Note persistence |

## Configuration

| Variable                         | Required | Description                     |
| -------------------------------- | -------- | ------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`      | Yes      | GCP project for Firestore       |
| `INTEXURAOS_AUTH_JWKS_URL`       | Yes      | JWKS endpoint for JWT auth      |
| `INTEXURAOS_AUTH_ISSUER`         | Yes      | JWT issuer                      |
| `INTEXURAOS_AUTH_AUDIENCE`       | Yes      | JWT audience                    |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes      | Token for internal service auth |
| `INTEXURAOS_SENTRY_DSN`          | Yes      | Sentry error reporting DSN      |

## Gotchas

- **Status not in API responses**: The `formatNote()` serializer omits `status` from all public endpoint responses. The field exists in Firestore and the domain model but is not surfaced over the API.
- **Legacy documents without status field**: The Firestore repository defaults `status` to `'active'` for documents that predate the status feature. This ensures backward compatibility.
- **No status update via PATCH**: `UpdateNoteInput` only accepts `title`, `content`, and `tags`. Status changes are not supported through any public endpoint.
- **No tag filtering**: The `listNotes` use case returns all notes for a user without filter support. Tag filtering is planned but not yet implemented.
- **List ordering**: `findByUserId()` orders results by `updatedAt` descending. Most recently updated notes appear first.
- **FORBIDDEN is use-case inline**: The `NoteRepository` port only defines `NOT_FOUND | STORAGE_ERROR` error codes. The `FORBIDDEN` error code is produced inline by `getNote` and `updateNote` use cases when the requesting user does not own the note.

## File Structure

```
apps/notes-agent/src/
  domain/
    models/
      note.ts                  # Note entity + input types
    ports/
      noteRepository.ts        # Repository interface + error types
    usecases/
      createNote.ts
      getNote.ts
      listNotes.ts
      updateNote.ts
      deleteNote.ts
  infra/
    firestore/
      firestoreNoteRepository.ts
  routes/
    noteRoutes.ts              # Public CRUD endpoints
    internalRoutes.ts          # Internal create endpoint (ServiceFeedback response)
  services.ts
  server.ts
  index.ts                     # Entry point, env validation, Sentry init
```
