# Mobile Notifications Service - Technical Reference

## Overview

Mobile-notifications-service manages device connections, filters, and notification delivery for push notifications from Android devices via Tasker/Automate.

**Service version:** 0.0.4
**Local port:** 8114
**OpenAPI docs:** `/docs`

## API Endpoints

### Connection

| Method | Path                            | Description                 | Auth         |
| ------ | ------------------------------- | --------------------------- | ------------ |
| POST   | `/mobile-notifications/connect` | Create signature connection | Bearer token |
| GET    | `/mobile-notifications/status`  | Get connection status       | Bearer token |

### Notifications

| Method | Path                                    | Description         | Auth         | Response |
| ------ | --------------------------------------- | ------------------- | ------------ | -------- |
| GET    | `/mobile-notifications`                 | List notifications  | Bearer token | 200 OK   |
| DELETE | `/mobile-notifications/:notification_id`| Delete notification | Bearer token | 200 OK   |

### Filters

| Method | Path                              | Description                       | Auth         | Response |
| ------ | --------------------------------- | --------------------------------- | ------------ | -------- |
| GET    | `/notifications/filters`          | Get filter options + saved filters| Bearer token | 200 OK   |
| POST   | `/notifications/filters/saved`    | Create saved filter               | Bearer token | 201 Created |
| DELETE | `/notifications/filters/saved/:id`| Delete saved filter               | Bearer token | 204 No Content |

### Internal

| Method | Path                                    | Description               | Auth           | Response Format                                    |
| ------ | --------------------------------------- | ------------------------- | -------------- | -------------------------------------------------- |
| POST   | `/internal/mobile-notifications/query`  | Query notifications       | Internal token | `{ success, data }` or `{ success, error: {...} }` |

### Webhook

| Method | Path                             | Description                         | Auth      |
| ------ | -------------------------------- | ----------------------------------- | --------- |
| POST   | `/mobile-notifications/webhooks` | Receive push from mobile devices    | Signature |

## Webhook Payload

The webhook endpoint accepts JSON from Tasker/Automate:

```typescript
interface WebhookPayload {
  source: string;         // e.g., "tasker"
  device: string;         // Device name
  app: string;            // App package name, e.g., "com.whatsapp"
  notification_id: string;// Idempotency key (unique per user)
  title: string;          // Notification title
  text: string;           // Notification body/content
  timestamp: number;      // Unix milliseconds from device
  postTime: string;       // Post time string from device
}
```

Authentication: `X-Mobile-Notifications-Signature` header (SHA-256 hash lookup).

## List Notifications Query Parameters

| Parameter | Type    | Description                                             |
| --------- | ------- | ------------------------------------------------------- |
| `limit`   | integer | 1–100, default 50                                       |
| `cursor`  | string  | Pagination cursor from previous response                |
| `source`  | string  | Filter by source (comma-separated for multiple)         |
| `app`     | string  | Filter by app package name (comma-separated for multiple)|
| `title`   | string  | Case-insensitive partial match on title                 |

## Internal Query Body

```typescript
interface QueryNotificationsBody {
  userId: string;
  filter?: {
    app?: string[];    // OR logic across apps
    source?: string;   // Single value
    title?: string;    // Case-insensitive contains
  };
  limit?: number;      // 1–1000, default 50
}
```

## Domain Models

### Notification

| Field            | Type   | Description                              |
| ---------------- | ------ | ---------------------------------------- |
| `id`             | string | Notification ID (Firestore doc ID)       |
| `userId`         | string | Owner user ID                            |
| `source`         | string | Source identifier (e.g., "tasker")       |
| `device`         | string | Device name that sent the notification   |
| `app`            | string | App package name                         |
| `title`          | string | Notification title                       |
| `text`           | string | Notification body content                |
| `timestamp`      | number | Unix milliseconds from device            |
| `postTime`       | string | Post time string from device             |
| `receivedAt`     | string | ISO 8601 server-side receipt timestamp   |
| `notificationId` | string | Idempotency key (device-provided)        |

### SignatureConnection

| Field           | Type              | Description                        |
| --------------- | ----------------- | ---------------------------------- |
| `id`            | string            | Connection ID (Firestore doc ID)   |
| `userId`        | string            | Owner user ID                      |
| `signatureHash` | string            | SHA-256 hash of plaintext signature|
| `deviceLabel`   | string (optional) | User-provided label                |
| `createdAt`     | string            | ISO 8601 timestamp                 |

### NotificationFiltersData

| Field         | Type                   | Description                                    |
| ------------- | ---------------------- | ---------------------------------------------- |
| `userId`      | string                 | Owner user ID                                  |
| `options`     | NotificationFilterOptions | Available values from received notifications |
| `savedFilters`| SavedNotificationFilter[] | User's saved filter presets                 |
| `createdAt`   | string                 | ISO 8601 timestamp                             |
| `updatedAt`   | string                 | ISO 8601 timestamp                             |

### SavedNotificationFilter

| Field     | Type              | Description                         |
| --------- | ----------------- | ----------------------------------- |
| `id`      | string            | Filter ID                           |
| `name`    | string            | User-provided filter name (1–100 chars) |
| `app`     | string[] (optional) | App package names to filter        |
| `device`  | string[] (optional) | Device names to filter             |
| `source`  | string (optional) | Source to filter                    |
| `title`   | string (optional) | Title substring to filter           |
| `createdAt`| string           | ISO 8601 timestamp                  |

## Configuration

| Environment Variable             | Required | Description                            |
| -------------------------------- | -------- | -------------------------------------- |
| `INTEXURAOS_GCP_PROJECT_ID`      | Yes      | GCP project for Firestore              |
| `INTEXURAOS_AUTH_JWKS_URL`       | Yes      | JWT JWKS endpoint URL                  |
| `INTEXURAOS_AUTH_ISSUER`         | Yes      | JWT issuer                             |
| `INTEXURAOS_AUTH_AUDIENCE`       | Yes      | JWT audience                           |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN` | Yes      | Shared secret for internal auth        |
| `INTEXURAOS_SENTRY_DSN`          | No       | Sentry DSN (errors reported without it) |

## Gotchas

**Signature security** - Plaintext signature returned only on creation. Store it securely.

**Hash comparison** - Webhook signatures compared as SHA-256 hashes; plaintext is never stored.

**Idempotency** - Duplicate webhooks with the same `notification_id` per user are silently ignored (status: `ignored`, reason: `duplicate`).

**Filter defaults** - `GET /notifications/filters` returns an empty options document if no notifications received yet; never 404.

**Response contract** - All endpoints use `reply.ok(data)` / `reply.fail(code, message)`. DELETE saved filter uses raw `reply.send()` with 204 (`@allow-raw-send`).

**DELETE notification returns 200** - `DELETE /mobile-notifications/:notification_id` returns `{ success: true, data: {} }` (not 204).

**Sentry logging** - Uses `createAppLogger()` from `@intexuraos/infra-sentry`, not direct `pino()`.

**Webhook raw body capture** - A `preParsing` hook captures the raw body specifically for `/mobile-notifications/webhooks` to aid debugging JSON parse errors.

## File Structure

```
apps/mobile-notifications-service/src/
  domain/
    notifications/     # Notification + SignatureConnection models and use cases
      models/          # Notification, SignatureConnection entities
      ports/           # Repository interfaces
      usecases/        # createConnection, processNotification, listNotifications, deleteNotification
    filters/           # Filter models and repository interface
      models/          # NotificationFiltersData, SavedNotificationFilter
      ports/           # NotificationFiltersRepository
  infra/
    firestore/         # Repository implementations
  routes/
    connectRoutes.ts   # POST /mobile-notifications/connect
    statusRoutes.ts    # GET /mobile-notifications/status
    notificationRoutes.ts  # GET /mobile-notifications, DELETE /mobile-notifications/:notification_id
    filterRoutes.ts    # GET/POST /notifications/filters/..., DELETE /notifications/filters/saved/:id
    webhookRoutes.ts   # POST /mobile-notifications/webhooks
    internalRoutes.ts  # POST /internal/mobile-notifications/query
  services.ts
  server.ts
  config.ts
```

## Recent Changes

| Commit | Change |
| ------ | ------ |
| `6063175b` | Add dev-mode log formatting for PM2 readability |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration (distributed tracing) |
| `45f001c1` | Switch PM2 ecosystem to `pnpm --filter` with `start:local` scripts |
| `5aa3e1bd` | Enable strict 100% coverage enforcement (Phase 3) |
| `9723dc24` | Standardize DELETE endpoints to return consistent response contract |
| `c3198407` | Fix all response contract violations (reply.ok / reply.fail) |
| `dfd702f1` | Migrate to createAppLogger() (Sentry-enabled logging) |
