# Web App -- Agent Interface

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
- Standardized delete confirmations on all destructive actions

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

**Endpoint:** `GET /issues` from linear-agent (Firestore-backed for real-time)

**When to use:** When user views Linear issue dashboard

**Features:**

- 3-column layout: Planning, Work, Closed
- State-to-column mapping
- Sub-issues displayed indented under parent issues
- Labels shown as colored badges
- Assignee names displayed with emerald green badges
- Null assignee values handled gracefully (no crash on missing data)
- Real-time Firestore updates (no polling)
- Issue creation and management
- Full sync from Linear (`POST /linear/sync`)
- Webhook secret configuration (`GET/POST/DELETE /linear/webhook-config`)

### Manage Code Tasks

**Endpoint:** `GET /code/tasks` from code-agent

**When to use:** When user creates, views, or manages code generation tasks

**Features:**

- Task list with multi-status filtering (dispatched, running, planned, implemented, failed, interrupted, cancelled) and cursor-based pagination
- Filter state persists in localStorage across page refreshes
- Task creation with markdown editor, model selection (auto/opus/glm), and Linear issue linking (via `LinearIssueSelectorModal`)
- Task detail view (`CodeTaskViewPage`) with:
  - Real-time `LogStream` component (Firestore-backed, custom CSS color-coded log lines)
  - Collapsible tool output blocks: `[tool]` tagged lines and subsequent indented lines group into expandable sections, preventing long tool results from overwhelming the log
  - Agent-based planning/execution flow with `DesignTaskBanner` (violet, links to planning task) and `ImplementationLinkBanner` (emerald, links to implementation)
  - Queue-based follow-up messaging without interrupting running tasks
  - Worker offline banner with worker name
  - Copy-all-logs button
  - Log follow mode with manual scroll override
  - Log transcript tags: [prompt], [instructions], [user], [queued], [resumed], [claude], [tool], [error], [done], [hook], [init], [system], [orchestrator]
- Task retry, cancel, and conflict resolution (409 handling)
- Worker status monitoring (health checks with color coding by health)
- GitHub PR events aggregated view (`GET /code/github-pr-events`)
- Standardized delete confirmations

**Agent-Based Code Task Flow:**

```
agentType: 'planning'  -> Shows ImplementationLinkBanner when implementationTaskId is set
agentType: 'execution' -> Shows DesignTaskBanner linking back to planning task
No agentType -> Single-phase task, no banner
```

### GitHub PR Events

**Endpoint:** `GET /code/github-pr-events` from code-agent

**When to use:** When user views GitHub pull request activity

**Features:**

- PR summaries loaded immediately via `useGitHubPRSummaries`
- Individual event details load lazily per-group via `useGitHubPREvents`
- Comment bodies render in GitHub style with HTML support (rehype-raw)
- Compare URL displayed for "synchronize" (push) events
- Clickable GitHub links on all event items
- Status badges (open/closed/merged) per PR

### Intex Chat

**Endpoint:** `POST /chat` from chat-agent

**When to use:** When user interacts with the AI chat assistant

**Features:**

- Floating action button (FAB) with resizable panel (desktop) and bottom sheet (mobile)
- Authenticated and guest chat sessions (guest uses `X-Guest-Session` header with rate limiting)
- Command creation flow: chat can suggest actions that create commands via commands-agent
- Session persistence in localStorage
- Panel size persistence across sessions

### Manage Worker Settings

**Endpoint:** `GET /code/worker-settings` from code-agent

**When to use:** When user configures code execution workers

**Features:**

- Add, update, delete worker configurations (max 2 workers)
- Drag-and-drop priority reordering
- Connectivity testing per worker
- Masked secret display (Cloudflare Access credentials, orchestrator secret)
- Color-coded status badges by health (green/red/gray)
- Secret fields use `autoComplete="new-password"` to prevent browser autofill

### Manage Saved Visualizations

**Endpoint:** `GET /visualizations` from data-insights-agent

**When to use:** When user browses or creates saved Vega/Vega-Lite charts

**Features:**

- Global list at `/data-insights/visualizations`
- Per-feed list at `/data-insights/:feedId/visualizations`
- Create, view, and persist chart definitions
- Integrates with composite feed data

### Manage Integration Settings

**Endpoints:** Various per integration service

**Integrations:**

- **Notion:** `GET /notion/connection` from notion-service (includes research export page configuration)
- **WhatsApp:** `GET /whatsapp/status` from whatsapp-service (includes phone verification flow)
- **Google Calendar:** `GET /calendar/connection` from calendar-agent
- **Linear:** `GET /linear/connection` from linear-agent (includes webhook secret management)
- **Mobile Notifications:** `GET /notifications/connection` from mobile-notifications-service
- **API Keys:** `GET /api-keys` from user-service
- **Workers:** `GET /code/worker-settings` from code-agent

### Persistent User Preferences

**When to use:** Automatically applied across all pages

**localStorage Keys:**

| Key                          | Purpose                              | Scope            |
| ---------------------------- | ------------------------------------ | ---------------- |
| `inbox-active-tab`           | Active tab (actions/commands)        | InboxPage        |
| `inbox-status-filter`        | Selected status filter               | InboxPage        |
| `code-tasks-status-filter`   | Multi-status filter array            | CodeTasksPage    |
| `sidebar-collapsed`          | Sidebar collapse state               | Global           |
| `theme`                      | Light/dark/system preference         | Global           |
| `intex-chat-session`         | Chat conversation history            | Chat             |
| `intex-chat-panel-size`      | Chat panel dimensions                | Chat             |
| `intex-guest-session-id`     | Guest session identifier             | Chat (guest)     |
| `devbar-*`                   | DevBar tabs, height, logs, filters   | DevBar           |
| `my-page-filter`             | Generic filter pattern (per page)    | Various pages    |

## Constraints

**Do NOT:**

- Call backend services without Auth0 access token
- Bypass the `apiRequest` function for HTTP calls
- Create routes without hash prefix (`/#/path` required for GCS hosting)
- Use browser `pushState` for navigation (hash routing only)
- Delete items without showing a confirmation dialog first

**Requires:**

- Auth0 authentication for all protected routes
- Valid access token for API calls
- Firebase project configured for Firestore access

## Usage Patterns

### Pattern 1: Real-Time Data Updates

```
1. Component mounts -> useXXXChanges hook creates Firestore listener
2. Firestore detects change -> Changed ID added to state
3. Debounce timeout (500ms) expires -> Batch API call
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
2. InboxPage mounts -> Parses query parameter from hash
3. Cleans URL immediately (prevents modal re-appearing)
4. Checks local state for action
5. If not found, fetches via batchGetActions
6. Opens ActionDetailModal
```

### Pattern 4: Code Task Agent-Based Navigation

```
1. User views planning task -> ImplementationLinkBanner renders if implementationTaskId present
2. User clicks banner link -> Navigates to /code-tasks/:implementationTaskId
3. CodeTaskViewPage remounts (key={id}) for the implementation task
4. Execution agent log stream shows live progress
```

### Pattern 5: PR Events Lazy Loading

```
1. PREventsPage loads -> useGitHubPRSummaries fetches PR list (lightweight)
2. User expands a PR group -> useGitHubPREvents fetches detail for that PR only
3. Events render with HTML comment bodies and clickable GitHub links
```

### Pattern 6: Multi-Status Filtering with Persistence

```
1. User selects multiple status checkboxes on CodeTasksPage
2. Filter state saved to localStorage immediately
3. API call made with selected statuses as query parameters
4. User navigates away and returns -> filter restored from localStorage
5. Page renders with previously selected filters active
```

### Pattern 7: Collapsible Tool Output in Log Stream

```
1. LogStream receives log lines from Firestore
2. Parser detects [tool] tagged line -> starts new collapsible group
3. Subsequent indented lines (isBodyLine) added to group
4. Group renders collapsed by default with "Show tool output" toggle
5. User clicks toggle -> expands to show full tool result
```

## Error Handling

| Error Code  | Meaning         | Recovery Action                              |
| ----------- | --------------- | -------------------------------------------- |
| 401         | Unauthorized    | Redirect to login page                       |
| 403         | Forbidden       | Show permission error                        |
| 404         | Not Found       | Show "not found" state                       |
| 408         | Request Timeout | Show timeout message with retry              |
| 409         | Conflict        | Show TaskConflictModal with resolution steps |
| 429         | Rate Limited    | Show rate limit message                      |
| 500+        | Server Error    | Show error banner with retry option          |
| 502/503/504 | Gateway Error   | Show user-friendly non-JSON error message    |

**Declarative Error Display:** `errorConfig.ts` maps error codes to icons, colors, titles, messages, and action buttons. `TaskErrorModal` renders error-code-specific modals (e.g., `WORKER_NOT_CONFIGURED` navigates to worker settings).

## Rate Limits

No client-side rate limiting. Backend services enforce their own limits. Guest chat sessions have server-side rate limits.

## Events Published

None (web app is a consumer, not publisher).

## Dependencies

| Service                      | Why Needed                          | Failure Behavior                          |
| ---------------------------- | ----------------------------------- | ----------------------------------------- |
| user-service                 | Authentication, settings            | Cannot authenticate or load settings      |
| actions-agent                | Action CRUD operations              | Cannot view or execute actions            |
| commands-agent               | Command viewing + chat creation     | Cannot see command queue or use chat      |
| research-agent               | Research reports + Notion settings  | Cannot view research history              |
| todos-agent                  | Todo management                     | Cannot manage todos                       |
| notes-agent                  | Note management                     | Cannot manage notes                       |
| bookmarks-agent              | Bookmark management                 | Cannot manage bookmarks                   |
| calendar-agent               | Calendar integration                | Cannot view or manage events              |
| linear-agent                 | Linear integration + webhooks       | Cannot view or manage issues              |
| data-insights-agent          | Data visualization + visualizations | Cannot view data insights or saved charts |
| code-agent                   | Code tasks, workers, PR events      | Cannot manage code tasks or workers       |
| chat-agent                   | AI chat assistant                   | Cannot use Intex Chat                     |
| whatsapp-service             | WhatsApp connection + verification  | Cannot connect WhatsApp                   |
| notion-service               | Notion connection                   | Cannot connect Notion                     |
| mobile-notifications-service | Push notification management        | Cannot manage push devices                |
| app-settings-service         | LLM pricing, analytics              | Cannot view costs/pricing                 |
| Firestore                    | Real-time data sync                 | Falls back to polling only                |
| Auth0                        | User authentication                 | Cannot log in (chat still works as guest) |

## State Management

| Type           | Implementation                      | Scope                              |
| -------------- | ----------------------------------- | ---------------------------------- |
| Global Auth    | React Context (`AuthContext`)       | App-wide                           |
| Sync Queue     | React Context (`SyncQueueContext`)  | App-wide                           |
| Theme          | React Context (`ThemeContext`)      | App-wide (light/dark/system)       |
| PWA Install    | React Context (`PWAProvider`)       | App-wide                           |
| UI State       | useState (component-level)          | Per component                      |
| Preferences    | localStorage                        | Persisted across sessions          |
| Chat Session   | localStorage (`intex-chat-session`) | Persisted chat conversation        |
| DevBar State   | localStorage                        | Persisted tabs, height, logs       |
| One-time Flags | sessionStorage                      | Current session only               |
| Real-time Data | Firestore listeners                 | Per component (cleanup on unmount) |

## Route Reference

| Route                                     | Auth | Purpose                         |
| ----------------------------------------- | ---- | ------------------------------- |
| `/#/`                                     | No   | Landing page                    |
| `/#/login`                                | No   | Auth0 login                     |
| `/#/inbox`                                | Yes  | Commands and actions            |
| `/#/research`                             | Yes  | Research list                   |
| `/#/research/new`                         | Yes  | Create research                 |
| `/#/research/:id`                         | Yes  | Research detail                 |
| `/#/code-tasks`                           | Yes  | Code task list                  |
| `/#/code-tasks/new`                       | Yes  | Create code task                |
| `/#/code-tasks/:id`                       | Yes  | Code task detail with logs      |
| `/#/code-tasks/pr-events`                 | Yes  | GitHub PR events                |
| `/#/my-todos`                             | Yes  | Todos                           |
| `/#/todos/:id`                            | Yes  | Todo detail                     |
| `/#/my-notes`                             | Yes  | Notes                           |
| `/#/notes/:id`                            | Yes  | Note detail                     |
| `/#/my-bookmarks`                         | Yes  | Bookmarks                       |
| `/#/bookmarks/:id`                        | Yes  | Bookmark detail                 |
| `/#/notes`                                | Yes  | WhatsApp notes                  |
| `/#/calendar`                             | Yes  | Calendar events                 |
| `/#/linear`                               | Yes  | Linear issues                   |
| `/#/data-insights`                        | Yes  | Data insights feeds             |
| `/#/data-insights/visualizations`         | Yes  | Saved visualizations (global)   |
| `/#/data-insights/:feedId/visualizations` | Yes  | Saved visualizations (per feed) |
| `/#/data-insights/:id`                    | Yes  | Feed data/charts                |
| `/#/data-insights/static-sources`         | Yes  | Static data sources             |
| `/#/data-insights/static-sources/new`     | Yes  | Create static source            |
| `/#/data-insights/static-sources/:id`     | Yes  | Edit static source              |
| `/#/notifications`                        | Yes  | Push notification history       |
| `/#/settings/whatsapp`                    | Yes  | WhatsApp connection             |
| `/#/settings/mobile`                      | Yes  | Mobile notifications            |
| `/#/settings/notion`                      | Yes  | Notion connection               |
| `/#/settings/calendar`                    | Yes  | Google Calendar connection      |
| `/#/settings/linear`                      | Yes  | Linear + webhook config         |
| `/#/settings/workers`                     | Yes  | Worker configuration            |
| `/#/settings/api-keys`                    | Yes  | API key management              |
| `/#/settings/llm-pricing`                 | Yes  | LLM pricing                     |
| `/#/settings/usage-costs`                 | Yes  | Usage cost tracking             |
| `/#/settings/share-history`               | Yes  | Share history                   |
| `/#/share-target`                         | Yes  | PWA share handler               |
