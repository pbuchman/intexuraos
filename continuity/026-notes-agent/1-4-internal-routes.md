# 1-4 Internal Routes

Implement X-Internal-Auth protected endpoint for service-to-service communication.

## Tasks

- [ ] Create `src/routes/internalRoutes.ts`
- [ ] Implement `POST /internal/notes/notes` — create note
- [ ] Use `validateInternalAuth()` for authentication
- [ ] Use `logIncomingRequest()` at entry point
- [ ] Add OpenAPI schemas
- [ ] Integration tests

## Endpoint

| Method | Path                    | Description                      |
| ------ | ----------------------- | -------------------------------- |
| POST   | `/internal/notes/notes` | Create note from another service |

## Request Body

```typescript
{
  userId: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  sourceId: string;
}
```

## Auth

- Requires `X-Internal-Auth` header
- Use `validateInternalAuth()` from `@intexuraos/common-http`
