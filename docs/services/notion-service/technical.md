# Notion Service - Technical Reference

## Overview

Notion-service manages the lifecycle of Notion integrations - connection validation, token storage, and disconnection.

## Recent Changes

| Commit     | Description                                        | Date       |
| ---------- | -------------------------------------------------- | ---------- |
| `6063175b` | Add dev-mode log formatting for PM2 readability    | 2026-02-16 |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration (#803)         | 2026-02-16 |
| `d5fbb354` | Fix start:local to use tsx (not node strip-types)  | 2026-02-14 |
| `45f001c1` | Switch PM2 ecosystem to pnpm --filter start:local  | 2026-02-14 |
| `3a25d55e` | Add Notion page validation for Research Export     | 2026-01-29 |
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

### Webhook Endpoints

| Method | Path               | Description                    | Auth    |
| ------ | ------------------ | ------------------------------ | ------- |
| POST   | `/notion-webhooks` | Receive Notion webhook events  | None    |

### Internal Endpoints

| Method | Path                                                   | Description                  | Auth         |
| ------ | ------------------------------------------------------ | ---------------------------- | ------------ |
| GET    | `/internal/notion/users/:userId/context`               | Get connection context/token | Internal key |
| GET    | `/internal/notion/users/:userId/pages/:pageId/preview` | Get Notion page preview      | Internal key |

### System Endpoints

| Method | Path          | Description       | Auth |
| ------ | ------------- | ----------------- | ---- |
| GET    | `/health`     | Health check      | None |
| GET    | `/openapi.json` | OpenAPI spec    | None |
| GET    | `/docs`       | Swagger UI        | None |

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

### Webhook Response

```typescript
{
  received: boolean
}
```

## Error Codes

| Code               | HTTP Status | Description              |
| ------------------ | ----------- | ------------------------ |
| `INVALID_REQUEST`  | 400         | Invalid token format     |
| `UNAUTHORIZED`     | 401         | Token rejected by Notion |
| `NOT_FOUND`        | 404         | No connection or page    |
| `DOWNSTREAM_ERROR` | 502         | Notion API error         |

## Dependencies

**Infrastructure:**

- Firestore (`notion_connections` collection) - Connection storage

**External APIs:**

- Notion API - Token validation and workspace info

**Observability:**

- Sentry - Error tracking via `createAppLogger()`
- Dash0 OpenTelemetry - Distributed tracing (added 2026-02-16)

## Configuration

| Environment Variable             | Required | Description                     |
| -------------------------------- | -------- | ------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`      | Yes      | GCP project for Firestore       |
| `INTEXURAOS_AUTH_JWKS_URL`       | Yes      | JWKS URL for JWT validation     |
| `INTEXURAOS_AUTH_ISSUER`         | Yes      | JWT issuer                      |
| `INTEXURAOS_AUTH_AUDIENCE`       | Yes      | JWT audience                    |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes      | Shared secret for internal auth |
| `INTEXURAOS_SENTRY_DSN`          | No       | Sentry DSN (optional)           |
| `PORT`                           | No       | HTTP port (default: 8082)       |

## Gotchas

**Token validation** - Connect calls Notion API to validate. Invalid tokens return 401.

**One integration per user** - Reconnecting replaces existing connection.

**Legacy createdAt handling** - The repository defaults `createdAt` to the current timestamp when existing documents lack the field (backward compatibility).

**Disconnect returns empty data** - The disconnect endpoint returns `reply.ok({})` (empty object), not connection state.

**Page preview requires active connection** - The page preview endpoint validates the user has an active Notion connection with a valid token before querying the Notion API.

**Webhook is a stub** - `POST /notion-webhooks` accepts any JSON payload and returns `{ received: true }` without processing events. No side effects.

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
      index.ts               # Re-exports from @intexuraos/infra-notion
  routes/
    integrationRoutes.ts   # Connect/status/disconnect
    internalRoutes.ts      # Context + page preview endpoints
    webhookRoutes.ts       # Notion webhook stub
    schemas.ts             # Zod request schemas
  services.ts
  server.ts
```
