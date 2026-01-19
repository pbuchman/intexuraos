# mobile-notifications-service — Agent Interface

> Machine-readable interface definition for AI agents interacting with mobile-notifications-service.

---

## Identity

| Field    | Value                                                                |
| -------- | -------------------------------------------------------------------- |
| **Name** | mobile-notifications-service                                         |
| **Role** | Mobile Notification Capture Service                                  |
| **Goal** | Capture, store, and provide access to mobile device notifications    |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface MobileNotificationsServiceTools {
  // List notifications with filters
  listNotifications(params?: {
    limit?: number;
    cursor?: string;
    source?: string;    // Comma-separated
    app?: string;       // Comma-separated
    title?: string;     // Partial match
  }): Promise<NotificationsListResult>;

  // Delete a notification
  deleteNotification(notificationId: string): Promise<void>;

  // Get filter options and saved filters
  getFilters(): Promise<FiltersData>;

  // Create saved filter
  createSavedFilter(params: {
    name: string;
    app?: string[];
    device?: string[];
    source?: string;
    title?: string;
  }): Promise<SavedFilter>;

  // Delete saved filter
  deleteSavedFilter(filterId: string): Promise<void>;
}
```

### Types

```typescript
interface MobileNotification {
  id: string;
  userId: string;
  app: string;
  title: string;
  text: string;
  source: string;
  device?: string;
  receivedAt: string;
}

interface NotificationsListResult {
  notifications: MobileNotification[];
  nextCursor?: string;
}

interface FiltersData {
  userId: string;
  options: {
    app: string[];      // Available app package names
    device: string[];   // Available device identifiers
    source: string[];   // Available sources
  };
  savedFilters: SavedFilter[];
  createdAt: string;
  updatedAt: string;
}

interface SavedFilter {
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

| Rule               | Description                                     |
| ------------------ | ----------------------------------------------- |
| **Ownership**      | Users can only access their own notifications   |
| **Pagination**     | Maximum 100 notifications per request           |
| **Device Linked**  | Requires Tasker/Automate integration on Android |
| **Filter Options** | Populated dynamically from received notifications |

---

## Usage Patterns

### List Recent Notifications

```typescript
const result = await listNotifications({ limit: 50 });
// result.notifications contains notification objects
// result.nextCursor for pagination
```

### Filter by App

```typescript
const result = await listNotifications({
  app: 'com.whatsapp,com.telegram',  // Comma-separated
});
```

### Create Saved Filter

```typescript
const filter = await createSavedFilter({
  name: 'Work Apps',
  app: ['com.slack', 'com.microsoft.teams'],
});
// filter.id can be used for quick access
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
┌─────────────────┐      ┌─────────────────────────┐      ┌─────────────────┐
│  Android Device │──────│ Tasker/Automate Script  │──────│ Webhook Endpoint│
│  (Notification) │      │ (HTTP POST)             │      │ /connect        │
└─────────────────┘      └─────────────────────────┘      └────────┬────────┘
                                                                   │
                                                                   ▼
                                                          ┌─────────────────┐
                                                          │   Firestore     │
                                                          │ notifications   │
                                                          └─────────────────┘
```

---

## Internal Endpoints

| Method | Path                          | Purpose                                          |
| ------ | ----------------------------- | ------------------------------------------------ |
| GET    | `/internal/notifications`     | Query notifications (called by data-insights-agent) |
| POST   | `/connect`                    | Receive notifications from device                |

---

## Integration Notes

- Requires Tasker or Automate app on Android device
- HTTP Request task sends notification data to webhook
- Device token validates the connection
- Filter options auto-populate as notifications arrive

---

**Last updated:** 2026-01-19
