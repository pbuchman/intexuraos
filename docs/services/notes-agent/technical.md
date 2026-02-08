# Notes Agent - Technical Reference

## Overview

Notes-agent provides simple CRUD operations for text notes with tag-based filtering and source tracking.

## Recent Changes

| Commit     | Description                                          | Date       |
| ---------- | ---------------------------------------------------- | ---------- |
| `c3198407` | Fix response contract violations (reply.fail)        | 2026-01-30 |
| `09091782` | Fix branch coverage for legacy status default        | 2026-01-30 |
| `9f1f8dc2` | INT-126: Standardize ServiceFeedback contract        | 2026-01-18 |

## API Endpoints

### Public Endpoints

| Method | Path         | Description       | Auth         |
| ------ | ------------ | ----------------- | ------------ |
| GET    | `/notes`     | List user's notes | Bearer token |
| POST   | `/notes`     | Create new note   | Bearer token |
| GET    | `/notes/:id` | Get specific note | Bearer token |
| PATCH  | `/notes/:id` | Update note       | Bearer token |
| DELETE | `/notes/:id` | Delete note       | Bearer token |

### Internal Endpoints

| Method | Path              | Description                      | Auth            |
| ------ | ----------------- | -------------------------------- | --------------- |
| POST   | `/internal/notes` | Create note from internal source | Internal header |

**Response includes:** `id`, `url` (web app path), and `note` object.

## Domain Models

### Note

| Field       | Type       | Description            |
| ----------- | ---------- | ---------------------- |  |
| `id`        | string     | Unique note identifier |
| `userId`    | string     | Owner user ID          |
| `title`     | string     | Note title             |
| `content`   | string     | Note content           |
| `tags`      | string[]   | User-defined tags      |
| `status`    | 'draft' \  | 'active'               | Draft or active |
| `source`    | string     | Source system          |
| `sourceId`  | string     | ID in source system    |
| `createdAt` | Date       | Creation timestamp     |
| `updatedAt` | Date       | Last update timestamp  |

### CreateNoteInput

| Field      | Type       | Required |
| ---------- | ---------- | -------- |  |
| `userId`   | string     | Yes      |
| `title`    | string     | Yes      |
| `content`  | string     | Yes      |
| `tags`     | string[]   | Yes      |
| `status`   | 'draft' \  | 'active' | No (default: active) |
| `source`   | string     | Yes      |
| `sourceId` | string     | Yes      |

## Dependencies

### Infrastructure

| Component                      | Purpose          |
| ------------------------------ | ---------------- |
| Firestore (`notes` collection) | Note persistence |

## Configuration

No service-specific environment variables beyond standard Firebase configuration.

## Gotchas

- **Legacy documents without status field**: The Firestore repository defaults `status` to `'active'` for documents that predate the status feature. This ensures backward compatibility.

## File Structure

```
apps/notes-agent/src/
  domain/
    models/
      note.ts                  # Note entity
    ports/
      noteRepository.ts
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
    noteRoutes.ts
    internalRoutes.ts
```
