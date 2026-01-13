# Notes Agent - Technical Reference

## Overview

Notes-agent provides simple CRUD operations for text notes with tag-based filtering and source tracking.

## API Endpoints

### Public Endpoints

| Method   | Path         | Description       | Auth         |
| --------  | ------------  | -----------------  | ------------  |
| GET      | `/notes`     | List user's notes | Bearer token |
| POST     | `/notes`     | Create new note   | Bearer token |
| GET      | `/notes/:id` | Get specific note | Bearer token |
| PATCH    | `/notes/:id` | Update note       | Bearer token |
| DELETE   | `/notes/:id` | Delete note       | Bearer token |

### Internal Endpoints

| Method   | Path              | Description                      | Auth            |
| --------  | -----------------  | --------------------------------  | ---------------  |
| POST     | `/internal/notes` | Create note from internal source | Internal header |

## Domain Models

### Note

| Field       | Type      | Description            |
| -----------  | ---------  | ----------------------  |
| `id`        | string    | Unique note identifier |
| `userId`    | string    | Owner user ID          |
| `title`     | string    | Note title             |
| `content`   | string    | Note content           |
| `tags`      | string[]  | User-defined tags      |
| `status`    | 'draft' \ | 'active'               | Draft or active |
| `source`    | string    | Source system          |
| `sourceId`  | string    | ID in source system    |
| `createdAt` | Date      | Creation timestamp     |
| `updatedAt` | Date      | Last update timestamp  |

### CreateNoteInput

| Field      | Type      | Required   |
| ----------  | ---------  | ----------  |
| `userId`   | string    | Yes        |
| `title`    | string    | Yes        |
| `content`  | string    | Yes        |
| `tags`     | string[]  | Yes        |
| `status`   | 'draft' \ | 'active'   | No (default: active) |
| `source`   | string    | Yes        |
| `sourceId` | string    | Yes        |

## Dependencies

### Infrastructure

| Component                      | Purpose          |
| ------------------------------  | ----------------  |
| Firestore (`notes` collection) | Note persistence |

## Configuration

No service-specific environment variables beyond standard Firebase configuration.

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
