# Mobile Notifications Service

Push notification gateway for mobile devices via signature-based authentication.

## The Problem

Mobile apps need real-time notifications:

1. **Authentication** - Devices need secure push token access
2. **Filtering** - Users should control which notifications they receive
3. **Multi-device** - Users have multiple devices (phone, tablet)
4. **Webhook delivery** - Push providers send webhooks, not polling

## How It Helps

Mobile-notifications-service manages the entire push flow:

1. **Signature connections** - Cryptographic tokens for device auth
2. **Notification storage** - Persistent notification history
3. **Saved filters** - Per-user named filter presets (by app, device, source, title)
4. **Webhooks** - Receive push from mobile devices via Tasker/Automate
5. **Internal query** - Feed notifications to data-insights-agent

## Key Features

**Connection Types:**

- Signature-based (plaintext returned once, stored hashed)
- Device labeling for identification
- Single active signature per user — reconnecting replaces the previous signature

**Notification Filters:**

- Create named saved filters by app, device, source, or title
- Filter options auto-populate from received notifications
- Delete saved filters when no longer needed

**Webhook Support:**

- Receive push from mobile devices (Tasker, Automate)
- Verify signatures via SHA-256 hash comparison
- Idempotency via device-provided `notification_id`
- Route to Firestore for persistent storage

## Use Cases

### Connect device

1. App requests connection with device label
2. Service deletes any previous signature for this user (single active signature per user)
3. Service generates new signature token, returns `{ connectionId, signature }`
4. App stores plaintext token (shown only once)
5. Service stores SHA-256 hash for verification
6. App uses token as `X-Mobile-Notifications-Signature` header on webhooks

### Receive notification

1. Tasker/Automate POSTs to `/mobile-notifications/webhooks`
2. SHA-256 signature verified against stored hash
3. Duplicate check via `notification_id` idempotency key
4. Notification stored in Firestore
5. Available for listing and internal queries

### Create saved filter

1. User selects filter criteria (app, device, source, title)
2. POST to `/notifications/filters/saved` with a name
3. Filter stored in user's filters document
4. Retrieve with GET `/notifications/filters`

## Key Benefits

**Secure** - SHA-256 hashed signatures, plaintext shown once

**Multi-device** - Multiple connections per user

**Idempotent** - Device-provided notification IDs prevent duplicates

**Audit trail** - All notifications stored persistently in Firestore

**Observable** - Full request/signature/result logging for webhook debugging; Dash0 OpenTelemetry tracing

## Limitations

**Android-only** - Requires Tasker or Automate app on Android device

**Signature only shown once** - Lost tokens require reconnect

**No sound/badge customization** - Basic notification forwarding only

**No push fanout** - Does not push back to devices; stores for polling/internal queries

## Recent Changes

- **Dash0 OpenTelemetry integration** - Added distributed tracing via `@intexuraos/infra-sentry` Dash0 integration; all service calls now emit traces
- **Dev-mode log formatting** - Structured log output reformatted for PM2 readability in local development
- **PM2 ecosystem migration** - Service startup switched to `pnpm --filter` with `start:local` scripts
- **Response contract standardization** - All endpoints now use `reply.ok(data)` / `reply.fail(code, message)` for consistent `{ success, data }` or `{ success, error: { code, message } }` responses
- **DELETE endpoint updated** - `DELETE /mobile-notifications/:notification_id` returns 200 with `{ success: true, data: {} }` instead of 204 No Content
- **Sentry-enabled logging** - Migrated from direct `pino()` to `createAppLogger()` for automatic Sentry error reporting
- **100% branch coverage** - Added v8 ignore exemptions for TypeScript-only safety branches
