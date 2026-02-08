# Mobile Notifications Service - Technical Reference

## Overview

Mobile-notifications-service manages device connections, filters, and notification delivery for push notifications.

## API Endpoints

### Connection

| Method | Path                            | Description                 | Auth         |
| ------ | ------------------------------- | --------------------------- | ------------ |
| POST   | `/mobile-notifications/connect` | Create signature connection | Bearer token |
| GET    | `/mobile-notifications/status`  | Get connection status       | Bearer token |

### Notifications

| Method | Path                                      | Description         | Auth         | Response |
| ------ | ----------------------------------------- | ------------------- | ------------ | -------- |
| GET    | `/mobile-notifications/notifications`     | List notifications  | Bearer token | 200 OK   |
| DELETE | `/mobile-notifications/notifications/:id` | Delete notification | Bearer token | 200 OK   |

### Filters

| Method | Path                                | Description               | Auth         |
| ------ | ----------------------------------- | ------------------------- | ------------ |
| GET    | `/mobile-notifications/filters`     | List notification filters | Bearer token |
| PATCH  | `/mobile-notifications/filters/:id` | Update filter             | Bearer token |

### Internal

| Method | Path                                     | Description          | Auth           | Response Format                                    |
| ------ | ---------------------------------------- | -------------------- | -------------- | -------------------------------------------------- |
| POST   | `/internal/mobile-notifications/process` | Process notification | Internal token | `{ success, data }` or `{ success, error: {...} }` |

### Webhook

| Method | Path                             | Description                | Auth      |
| ------ | -------------------------------- | -------------------------- | --------- |
| POST   | `/mobile-notifications/webhooks` | Receive push notifications | Signature |

## Domain Models

### SignatureConnection

| Field           | Type      | Description            |
| --------------- | --------- | ---------------------- |  |
| `id`            | string    | Connection ID          |
| `userId`        | string    | Owner user ID          |
| `signatureHash` | string    | Hashed signature token |
| `deviceLabel`   | string \  | undefined              | User-provided label |
| `createdAt`     | string    | ISO 8601 timestamp     |

### Notification

| Field       | Type      | Description        |
| ----------- | --------- | ------------------ |  |
| `id`        | string    | Notification ID    |
| `userId`    | string    | Target user ID     |
| `title`     | string    | Notification title |
| `body`      | string    | Notification body  |
| `source`    | string    | Source identifier  |
| `data`      | object \  | undefined          | Additional data |
| `createdAt` | string    | ISO 8601 timestamp |

### NotificationFilter

| Field     | Type    | Description                   |
| --------- | ------- | ----------------------------- |
| `id`      | string  | Filter ID                     |
| `userId`  | string  | Owner user ID                 |
| `source`  | string  | Source to filter              |
| `enabled` | boolean | Whether notifications allowed |

## Configuration

| Environment Variable             | Required | Description                     |
| -------------------------------- | -------- | ------------------------------- |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes      | Shared secret for internal auth |

## Gotchas

**Signature security** - Plaintext signature returned only on creation. Store it securely.

**Hash comparison** - Webhook signatures compared as hashes, never plaintext stored.

**Filter defaults** - Sources without filters use default behavior (allow all).

**Response contract** - All endpoints use `reply.ok(data)` / `reply.fail(code, message)`. Internal auth errors return `{ success: false, error: { code: "UNAUTHORIZED", message: "..." } }`.

**DELETE returns 200** - DELETE notification returns `{ success: true, data: {} }` instead of 204 No Content.

**Sentry logging** - Uses `createAppLogger()` from `@intexuraos/infra-sentry`, not direct `pino()`.

## File Structure

```
apps/mobile-notifications-service/src/
  domain/
    notifications/     # Models and use cases
    filters/           # Filter models
  infra/
    firestore/         # Repository implementations
  routes/
    connectRoutes.ts    # Connection endpoints
    statusRoutes.ts     # Status endpoint
    notificationRoutes.ts
    filterRoutes.ts
    webhookRoutes.ts    # External webhooks
    internalRoutes.ts    # Internal processing
  services.ts
```
