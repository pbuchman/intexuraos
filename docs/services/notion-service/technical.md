# Notion Service - Technical Reference

## Overview

Notion-service manages the lifecycle of Notion integrations - connection validation, token storage, and disconnection.

## Recent Changes

| Commit     | Description                                        | Date       |
| ---------- | -------------------------------------------------- | ---------- |
| `3a25d55e` | Add Notion page preview endpoint for validation    | 2026-01-29 |
| `7c5e9153` | INT-319: Remove PromptVault, keep Notion connector | 2026-01-26 |
| `dfd702f1` | Migrate from pino to createAppLogger (Sentry)      | 2026-01-30 |
| `c3198407` | Fix response contract violations (reply.ok/fail)   | 2026-01-30 |
| `9723dc24` | Standardize DELETE endpoint response               | 2026-01-31 |
| `5aa3e1bd` | INT-427: Enable strict 100% coverage enforcement   | 2026-01-31 |

## API Endpoints

### Public Endpoints

| Method | Path                 | Description                | Auth         |
| ------ | -------------------- | -------------------------- | ------------ |
| POST   | `/notion/connect`    | Connect Notion integration | Bearer token |
| GET    | `/notion/status`     | Get integration status     | Bearer token |
| DELETE | `/notion/disconnect` | Disconnect integration     | Bearer token |

### Internal Endpoints

| Method | Path                                                           | Description                   | Auth         |
| ------ | -------------------------------------------------------------- | ----------------------------- | ------------ |
| GET    | `/internal/notion/users/:userId/context`                       | Get connection context/token  | Internal key |
| GET    | `/internal/notion/users/:userId/pages/:pageId/preview`         | Get Notion page preview       | Internal key |

### Connect Request

```typescript
{
  notionToken: string; // Notion integration token
}
```

### Connect Response

```typescript
{
  connected: boolean,
  createdAt: string,
  updatedAt: string
}
```

### Status Response

```typescript
{
  configured: boolean,
  connected: boolean,
  createdAt?: string,
  updatedAt?: string
}
```

### Disconnect Response

Returns empty data object (`{}`).

### Page Preview Response (Internal)

```typescript
{
  title: string,
  url: string
}
```

## Error Codes

| Code               | HTTP Status | Description              |
| ------------------ | ----------- | ------------------------ |
| `VALIDATION_ERROR` | 400         | Invalid token format     |
| `INVALID_TOKEN`    | 401         | Token rejected by Notion |
| `DOWNSTREAM_ERROR` | 502         | Notion API error         |

## Dependencies

**Infrastructure:**

- Firestore (`notion_connections` collection) - Connection storage

**External APIs:**

- Notion API - Token validation and workspace info

## Configuration

| Environment Variable             | Required | Description                     |
| -------------------------------- | -------- | ------------------------------- |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes      | Shared secret for internal auth |

## Gotchas

**Token validation** - Connect calls Notion API to validate. Invalid tokens return 401.

**One integration per user** - Reconnecting replaces existing connection.

**Legacy createdAt handling** - The repository defaults `createdAt` to the current timestamp when existing documents lack the field (backward compatibility).

**Disconnect returns empty data** - The disconnect endpoint returns `reply.ok({})` (empty object), not connection state.

**Page preview requires active connection** - The page preview endpoint validates the user has an active Notion connection with a valid token before querying the Notion API.

## File Structure

```
apps/notion-service/src/
  domain/integration/
    usecases/
      connectNotion.ts
      disconnectNotion.ts
      getNotionStatus.ts
    ports/
      ConnectionRepository.ts
  infra/
    firestore/
      notionConnectionRepository.ts
    notion/
      notionApi.ts
  routes/
    integrationRoutes.ts   # Connect/status/disconnect
    internalRoutes.ts      # Context + page preview endpoints
    webhookRoutes.ts       # Notion webhooks
    schemas.ts             # Zod request schemas
  services.ts
  server.ts
```
