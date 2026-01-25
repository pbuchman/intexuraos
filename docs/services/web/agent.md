# Web App — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                                         |
| --------- | ----------------------------------------------------------------------------- |
| Name      | web                                                                           |
| Role      | Progressive Web App providing unified UI for IntexuraOS                       |
| Goal      | Enable users to interact with all IntexuraOS services from a single interface |

## Capabilities

### Display Actions Inbox

**Endpoint:** Multiple (fetches from actions-agent, commands-agent)

**When to use:** When user needs to see, approve, or execute pending actions

**Data Sources:**

- `GET /actions` from actions-agent
- `GET /commands` from commands-agent
- Firestore listeners for real-time updates

**Features:**

- Real-time updates via Firestore listeners
- Status filtering (pending, awaiting_approval, completed, failed, rejected)
- Batch fetching with debouncing (500ms delay, 50 item limit)
- Infinite scroll pagination
- Action detail modals with configurable buttons

### Execute Action Buttons

**Endpoint:** Configured via `action-config.yaml`

**When to use:** When user clicks an action button to approve, reject, retry, or delete

**Input Schema:**

```typescript
interface ActionButton {
  id: string;
  label: string;
  endpoint: {
    path: string; // e.g., /actions/{actionId}/approve
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
  };
  displayOn: {
    status?: ActionStatus;
    sourceType?: string;
  };
  style?: 'primary' | 'secondary' | 'danger';
}

interface Action {
  id: string;
  commandId: string;
  type: CommandType;
  status: ActionStatus;
  createdAt: string;
  // ... additional fields
}
```

**Execution Flow:**

1. User clicks button
2. `executeAction` interpolates variables (e.g., `{actionId}` replaced with actual ID)
3. API request made to configured endpoint
4. Local state updated optimistically
5. Real-time listener confirms change

### Display Research Reports

**Endpoint:** `GET /research` from research-agent

**When to use:** When user views research history or report details

**Features:**

- List view with pagination
- Detail view with full report content
- Cover image display
- Public share URL generation
- Model attribution (which LLMs contributed)

### Manage Calendar Events

**Endpoint:** `GET /events` from calendar-agent

**When to use:** When user views or manages calendar events

**Features:**

- Event list with date filtering
- Event creation/edit via calendar-agent
- Failed event recovery workflow

### Display Linear Issues

**Endpoint:** `GET /issues` from linear-agent

**When to use:** When user views Linear issue dashboard

**Features:**

- 3-column layout: Planning, Work, Closed
- State-to-column mapping
- Todo and To Test category support
- Issue creation and management

### Manage Integration Settings

**Endpoints:** Various per integration service

**Integrations:**

- **Notion:** `GET /notion/connection` from notion-service
- **WhatsApp:** `GET /whatsapp/connection` from whatsapp-service
- **Google Calendar:** `GET /calendar/connection` from calendar-agent
- **Linear:** `GET /linear/connection` from linear-agent
- **Mobile Notifications:** `GET /notifications/connection` from mobile-notifications-service
- **API Keys:** `GET /api-keys` from user-service

## Constraints

**Do NOT:**

- Call backend services without Auth0 access token
- Bypass the `apiRequest` function for HTTP calls
- Create routes without hash prefix (`/#/path` required for GCS hosting)
- Use browser `pushState` for navigation (hash routing only)

**Requires:**

- Auth0 authentication for all protected routes
- Valid access token for API calls
- Firebase project configured for Firestore access

## Usage Patterns

### Pattern 1: Real-Time Data Updates

```
1. Component mounts → useXXXChanges hook creates Firestore listener
2. Firestore detects change → Changed ID added to state
3. Debounce timeout (500ms) expires → Batch API call
4. Local state updated with fresh data
5. UI re-renders with new data
```

### Pattern 2: Action Execution Flow

```
1. User clicks button on action item
2. executeAction() interpolates variables from action
3. API request made via useApiClient
4. On success: optimistic update or full refresh
5. Real-time listener confirms server state
```

### Pattern 3: Deep Linking to Actions

```
1. External link: https://app.intexuraos.com/#/inbox?action=abc123
2. InboxPage mounts → Parses query parameter from hash
3. Cleans URL immediately (prevents modal re-appearing)
4. Checks local state for action
5. If not found, fetches via batchGetActions
6. Opens ActionDetailModal
```

## Error Handling

| Error Code | Meaning         | Recovery Action                     |
| ---------- | --------------- | ----------------------------------- |
| 401        | Unauthorized    | Redirect to login page              |
| 403        | Forbidden       | Show permission error               |
| 404        | Not Found       | Show "not found" state              |
| 408        | Request Timeout | Show timeout message with retry     |
| 429        | Rate Limited    | Show rate limit message             |
| 500+       | Server Error    | Show error banner with retry option |

## Rate Limits

No client-side rate limiting. Backend services enforce their own limits.

## Events Published

None (web app is a consumer, not publisher).

## Dependencies

| Service                      | Why Needed                   | Failure Behavior                     |
| ---------------------------- | ---------------------------- | ------------------------------------ |
| user-service                 | Authentication, settings     | Cannot authenticate or load settings |
| actions-agent                | Action CRUD operations       | Cannot view or execute actions       |
| commands-agent               | Command viewing              | Cannot see command queue             |
| research-agent               | Research reports             | Cannot view research history         |
| todos-agent                  | Todo management              | Cannot manage todos                  |
| notes-agent                  | Note management              | Cannot manage notes                  |
| bookmarks-agent              | Bookmark management          | Cannot manage bookmarks              |
| calendar-agent               | Calendar integration         | Cannot view or manage events         |
| linear-agent                 | Linear integration           | Cannot view or manage issues         |
| data-insights-agent          | Data visualization           | Cannot view data insights            |
| whatsapp-service             | WhatsApp connection          | Cannot connect WhatsApp              |
| notion-service               | Notion connection            | Cannot connect Notion                |
| mobile-notifications-service | Push notification management | Cannot manage push devices           |
| app-settings-service         | LLM pricing, analytics       | Cannot view costs/pricing            |
| Firestore                    | Real-time data sync          | Falls back to polling only           |
| Auth0                        | User authentication          | Cannot log in                        |

## State Management

| Type           | Implementation                     | Scope                              |
| -------------- | ---------------------------------- | ---------------------------------- |
| Global Auth    | React Context (`AuthContext`)      | App-wide                           |
| Sync Queue     | React Context (`SyncQueueContext`) | App-wide                           |
| PWA Install    | React Context (`PWAProvider`)      | App-wide                           |
| UI State       | useState (component-level)         | Per component                      |
| Preferences    | localStorage                       | Persisted across sessions          |
| One-time Flags | sessionStorage                     | Current session only               |
| Real-time Data | Firestore listeners                | Per component (cleanup on unmount) |

## Route Reference

| Route              | Auth | Purpose                   |
| ------------------ | ---- | ------------------------- |
| `/#/`              | No   | Landing page              |
| `/#/login`         | No   | Auth0 login               |
| `/#/inbox`         | Yes  | Commands and actions      |
| `/#/research`      | Yes  | Research list             |
| `/#/research/new`  | Yes  | Create research           |
| `/#/research/:id`  | Yes  | Research detail           |
| `/#/my-todos`      | Yes  | Todos                     |
| `/#/my-notes`      | Yes  | Notes                     |
| `/#/my-bookmarks`  | Yes  | Bookmarks                 |
| `/#/calendar`      | Yes  | Calendar events           |
| `/#/linear`        | Yes  | Linear issues             |
| `/#/data-insights` | Yes  | Data insights             |
| `/#/notifications` | Yes  | Push notification history |
| `/#/settings/*`    | Yes  | Integration settings      |
| `/#/share-target`  | Yes  | PWA share handler         |
