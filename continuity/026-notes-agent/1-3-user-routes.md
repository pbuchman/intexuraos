# 1-3 User-Authenticated Routes

Implement JWT-protected endpoints for user note operations.

## Tasks

- [ ] Create `src/routes/noteRoutes.ts`
- [ ] Implement `GET /notes` — list user's notes
- [ ] Implement `POST /notes` — create note
- [ ] Implement `GET /notes/:id` — get single note (verify ownership)
- [ ] Implement `PUT /notes/:id` — update note (verify ownership)
- [ ] Implement `DELETE /notes/:id` — delete note (verify ownership)
- [ ] Add OpenAPI schemas for all endpoints
- [ ] Integration tests via `app.inject()`

## Endpoints

| Method | Path         | Description                       |
| ------ | ------------ | --------------------------------- |
| GET    | `/notes`     | List notes for authenticated user |
| POST   | `/notes`     | Create new note                   |
| GET    | `/notes/:id` | Get note by ID                    |
| PUT    | `/notes/:id` | Update note                       |
| DELETE | `/notes/:id` | Delete note                       |

## Auth

- Extract `userId` from JWT claims
- All endpoints require valid Bearer token
- Ownership check: note.userId must match JWT userId
