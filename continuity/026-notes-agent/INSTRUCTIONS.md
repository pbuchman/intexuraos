# 026 — Notes Service

## Goal

Create a new `notes-service` for CRUD operations on user-scoped notes with tagging support.

## Scope

### In Scope

- New service: `apps/notes-service`
- Domain model: `Note` entity with user scoping, tags, source tracking
- User-authenticated endpoints (JWT):
  - `GET /notes` — list user's notes
  - `POST /notes` — create note
  - `GET /notes/:id` — get single note
  - `PUT /notes/:id` — update note
  - `DELETE /notes/:id` — delete note
- Internal endpoint:
  - `POST /internal/notes/notes` — create note (X-Internal-Auth)
- Firestore persistence with proper collection ownership
- Full test coverage (95% threshold)
- Terraform infrastructure (Cloud Run, IAM, secrets)

### Out of Scope

- Notion integration (this is a separate notes concept)
- Search/filtering beyond basic list
- Note sharing between users
- Attachments/media

## Domain Model

```typescript
interface Note {
  id: string; // UUID
  userId: string; // Scopes note to a user
  title: string;
  content: string; // Markdown or plain text
  tags: string[]; // Simple string tags
  source: string; // Origin system (e.g., 'web', 'whatsapp', 'api')
  sourceId: string; // ID in the origin system
  createdAt: Date;
  updatedAt: Date;
}
```

## Constraints

- Follow `/create-service` checklist exactly
- No browsing unrelated code
- Firestore collection `notes` owned by `notes-service`
- Composite index: `userId` + `createdAt` for listing

## Success Criteria

- [ ] `npm run ci` passes
- [ ] `terraform validate` passes
- [ ] All endpoints functional with tests
- [ ] Registered in api-docs-hub
- [ ] Added to local dev setup
