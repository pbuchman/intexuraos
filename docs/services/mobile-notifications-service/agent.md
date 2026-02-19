# mobile-notifications-service — Agent Interface

> Machine-readable interface definition for AI agents interacting with mobile-notifications-service.

---

## Identity

| Field    | Value                                                             |
| -------- | ----------------------------------------------------------------- |
| **Name** | mobile-notifications-service                                      |
| **Role** | Mobile Notification Capture Service                               |
| **Goal** | Capture, store, and provide access to mobile device notifications |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface MobileNotificationsServiceTools {
  // List notifications for authenticated user
  listNotifications(params?: {
    limit?: number;          // 1–100, default 50
    cursor?: string;         // Pagination cursor
    source?: string;         // Comma-separated for multiple
    app?: string;            // Comma-separated for multiple
    title?: string;          // Case-insensitive partial match
  }): Promise<NotificationsListResult>;

  // Delete a notification (returns empty data object, 200)
  deleteNotification(
    notificationId: string
  ): Promise<{ success: true; data: Record<string, never> }>;

  // Get filter options and saved filters
  getFilters(): Promise<NotificationFiltersData>;

  // Create saved filter (returns 201)
  createSavedFilter(params: {
    name: string;          // Required, 1–100 chars
    app?: string[];
    device?: string[];
    source?: string;
    title?: string;
  }): Promise<SavedNotificationFilter>;

  // Delete saved filter (returns 204 No Content)
  deleteSavedFilter(filterId: string): Promise<void>;
}
```

### Types

```typescript
interface MobileNotification {
  id: string;
  userId: string;
  source: string;           // e.g., "tasker"
  device: string;           // Device name
  app: string;              // App package name
  title: string;            // Notification title
  text: string;             // Notification body content
  timestamp: number;        // Unix milliseconds from device
  postTime: string;         // Post time string from device
  receivedAt: string;       // ISO 8601 server-side receipt time
  notificationId: string;   // Device-provided idempotency key
}

interface NotificationsListResult {
  notifications: MobileNotification[];
  nextCursor?: string;
}

interface NotificationFilterOptions {
  app: string[];     // App package names seen in notifications
  device: string[];  // Device names seen in notifications
  source: string[];  // Sources seen in notifications
}

interface NotificationFiltersData {
  userId: string;
  options: NotificationFilterOptions;
  savedFilters: SavedNotificationFilter[];
  createdAt: string;
  updatedAt: string;
}

interface SavedNotificationFilter {
  id: string;
  name: string;
  app?: string[];
  device?: string[];
  source?: string;
  title?: string;
  createdAt: string;
}
```

---

## Constraints

| Rule               | Description                                       |
| ------------------ | ------------------------------------------------- |
| **Ownership**      | Users can only access their own notifications     |
| **Pagination**     | Maximum 100 notifications per request             |
| **Device Linked**  | Requires Tasker/Automate integration on Android   |
| **Filter Options** | Populated dynamically from received notifications |
| **Idempotency**    | Duplicate `notification_id` per user is silently ignored |

---

## Usage Patterns

### List Recent Notifications

```typescript
const result = await listNotifications({ limit: 50 });
// result.notifications contains notification objects
// result.nextCursor for pagination (undefined if no more pages)
```

### Filter by App

```typescript
const result = await listNotifications({
  app: 'com.whatsapp,com.telegram', // Comma-separated string
});
```

### Create Saved Filter

```typescript
const filter = await createSavedFilter({
  name: 'Work Apps',
  app: ['com.slack', 'com.microsoft.teams'],
});
// filter.id can be used for later deletion
```

### Get Available Filters

```typescript
const filters = await getFilters();
// filters.options.app lists all apps that have sent notifications
// filters.savedFilters contains user's saved filter configurations
```

---

## Data Flow

```
┌─────────────────┐      ┌─────────────────────────┐      ┌──────────────────────────┐
│  Android Device │──────│ Tasker/Automate Script  │──────│ POST /webhooks           │
│  (Notification) │      │ (HTTP POST + Signature) │      │ X-Mobile-Notifications-  │
└─────────────────┘      └─────────────────────────┘      │ Signature: <sha256-hash> │
                                                           └────────────┬─────────────┘
                                                                        │ hash lookup
                                                                        │ idempotency check
                                                                        ▼
                                                           ┌─────────────────┐
                                                           │   Firestore     │
                                                           │ notifications   │
                                                           └─────────────────┘
```

---

## Internal Endpoints

| Method | Path                                    | Purpose                                              | Body                                      | Response Format                             |
| ------ | --------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| POST   | `/internal/mobile-notifications/query`  | Query notifications (called by data-insights-agent) | `{ userId, filter?, limit? }`             | `{ success, data }` or `{ success, error }` |

Internal endpoint requires `X-Internal-Auth` header with shared secret.

Internal response maps `text → body` and `receivedAt → timestamp` for compatibility:

```typescript
interface InternalNotification {
  id: string;
  app: string;
  title: string;
  body: string;      // mapped from notification.text
  timestamp: string; // mapped from notification.receivedAt (ISO string)
  source: string;
}
```

---

## Integration Notes

- Requires Tasker or Automate app on Android device
- HTTP Request task sends notification data to `/mobile-notifications/webhooks`
- Device signature validates the connection (SHA-256, stored as hash)
- Filter options auto-populate as notifications arrive
- Duplicate detection uses device-provided `notification_id` per user

---

**Last updated:** 2026-02-19
