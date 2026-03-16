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
- Batch fetching with debouncing (500 ms delay, 50 item limit)
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
}
```

**Execution Flow:**

1. User clicks button
2. `executeAction` interpolates variables (e.g., `{actionId}` replaced with actual ID)
3. API request made to configured endpoint
4. Local state updated optimistically
5. Real-time listener confirms change

### Manage Code Tasks

**Endpoint:** `GET /code/tasks` from code-agent

**When to use:** When user creates, views, or manages code generation tasks

**Features:**

- Task list with multi-status filtering (dispatched, running, planned, implemented, failed, interrupted, cancelled) and cursor-based pagination
- Filter state persists in localStorage across page refreshes
- Dynamic pipeline display (`IssueGroupRow`, `IssueTimeline`) showing planning/execution relationships
- TIME column shows Created and Started timestamps; falls back to `createdAt` when `startedAt` is absent
- Task creation with markdown editor, model selection, and Linear issue linking

### View Code Task Detail (V2)

**Route:** `/#/code-tasks/:id/view` → `CodeTaskViewPageV2`

**When to use:** This is the current default task detail view for new tasks

**Components:**

```typescript
// Sub-components of the v2 task view
V2TaskHeader    // Title, status, timestamps, worker type badge
V2LogStream     // Real-time color-coded log stream with follow mode
V2TaskActions   // Cancel, retry, implement, delete action buttons
V2NextSteps     // Post-completion next steps (PR links, retry prompts)
V2MessageInput  // Follow-up message input for active tasks
```

**Note:** Route `/#/code-tasks/:id` (no `/view` suffix) renders the legacy v1 view (`CodeTaskViewPage`), still accessible for backward compatibility.

### View Code Task Logs

**Data Source:** Firestore (real-time streaming)

**When to use:** Whenever a code task is active or completed and log output is needed

**Log color tags:**

```
[user]         → cyan
[queued]       → amber
[resumed]      → emerald
[prompt]       → orange
[instructions] → violet
[claude]       → blue
[tool]         → yellow
[error]        → red
[done]         → green
[hook]         → purple
[init]         → cyan
[system]/[orchestrator] → slate
```

**Collapsible tool output:** `[tool]` tagged lines + subsequent indented `isBodyLine` entries collapse into expandable blocks.

**Logs preview modal:** `CodeTaskLogsModal` provides a lightweight log preview from the task list without navigating to the full detail page.

### Agent-Based Code Task Flow

**When to use:** Understanding the two-phase planning/execution relationship

```typescript
type AgentType = 'planning' | 'execution';

// Planning task: shows ImplementationLinkBanner (emerald) when
// implementationTaskId is set
interface PlanningTask {
  agentType: 'planning';
  implementationTaskId?: string;
}

// Execution task: shows DesignTaskBanner (violet) linking back to
// the parent planning task
interface ExecutionTask {
  agentType: 'execution';
  designTaskId?: string;
}
```

### GitHub Event Decision Log

**Route:** `/#/code-tasks/pr-events` → `PREventsPage`

**Data Source:** Firestore `github-event-log-entries` collection via `useGitHubEventLog`

**When to use:** When user needs to inspect which GitHub webhook events triggered agent decisions and their outcomes

**Features:**

- Real-time Firestore listener with live connection health indicator
- Filter by decision status: all, pending, completed
- Search by repository, sender login, PR number, event type, action
- Compact inline layout using raw GitHub event names
- Manual refresh button

**Row Schema:**

```typescript
interface GitHubEventLogListRow {
  id: string;
  githubEventName: string;
  eventType: string;
  action: string | null;
  repository: string;
  senderLogin: string;
  pullRequestNumber: number | null;
  reason: string;
  decisionStatus: 'pending' | 'completed';
  createdAt: string;
}
```

### GitHub PR Events (Lazy-Loaded Summaries)

**Endpoint:** `GET /code/github-pr-events` from code-agent

**When to use:** When user views detailed GitHub pull request activity for code tasks

**Features:**

- PR summaries loaded immediately via `useGitHubPRSummaries`
- Individual event details load lazily per-group via `useGitHubPREvents` (on expand)
- Comment bodies rendered with HTML support (rehype-raw)
- Compare URL displayed for synchronize (push) events
- Clickable GitHub links on all event items

### Manage Worker Settings

**Endpoint:** `GET /code/worker-settings` from code-agent

**When to use:** When user configures code execution workers

**Input Schema:**

```typescript
interface WorkerConfigInput {
  name: string;
  url: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  dispatchSigningSecret: string;
}

type CodeTaskWorkerType =
  | 'auto' | 'opus' | 'sonnet' | 'minimax' | 'glm' | 'qwen' | 'kimi';
```

**Features:**

- Add, update, delete worker configurations (max 2 workers)
- Priority reordering
- Connectivity testing with in-button spinner on test action
- Masked secret display (Cloudflare Access credentials, orchestrator secret)
- Per-user default review worker type preference (stored via code-agent settings)
- Secret fields use `autoComplete="new-password"` to prevent browser autofill

### Display Research Reports

**Endpoint:** `GET /research` from research-agent

**When to use:** When user views research history or report details

**Features:**

- List view with pagination
- Detail view with full report content and model attribution
- Cover image display
- Public share URL generation
- Notion export integration

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

- 3-column layout: Planning, In Progress, Closed
- Sub-issues displayed indented under parent issues
- Labels shown as colored badges
- Assignee names displayed with emerald green badges (null values handled gracefully)
- Real-time Firestore updates (no polling)
- Webhook secret configuration (`GET/POST/DELETE /linear/webhook-config`)

### Intex Chat

**Endpoint:** `POST /chat` from chat-agent

**When to use:** When user interacts with the AI chat assistant

**Features:**

- Floating action button (FAB) with resizable panel (desktop) and bottom sheet (mobile)
- Authenticated and guest modes (`X-Guest-Session` header with server-side rate limiting)
- Command creation flow: chat can suggest actions that create commands via commands-agent
- Session and panel size persistence in localStorage

### Manage Saved Visualizations

**Endpoint:** `GET /visualizations` from data-insights-agent

**When to use:** When user browses or creates saved Vega/Vega-Lite charts

**Features:**

- Global list at `/#/data-insights/visualizations`
- Per-feed list at `/#/data-insights/:feedId/visualizations`
- Create, view, and persist chart definitions

### Manage Integration Settings

**Integrations covered:**

| Integration          | Service                      | Route                         |
| -------------------- | ---------------------------- | ----------------------------- |
| Notion               | notion-service               | `/#/settings/notion`          |
| WhatsApp             | whatsapp-service             | `/#/settings/whatsapp`        |
| Google Calendar      | calendar-agent               | `/#/settings/calendar`        |
| Linear               | linear-agent                 | `/#/settings/linear`          |
| GitHub               | code-agent / user-service    | `/#/settings/github`          |
| Mobile Notifications | mobile-notifications-service | `/#/settings/mobile`          |
| API Keys             | user-service                 | `/#/settings/api-keys`        |
| Workers              | code-agent                   | `/#/settings/code`            |
| LLM Pricing          | app-settings-service         | `/#/settings/llm-pricing`     |
| Usage Costs          | app-settings-service         | `/#/settings/usage-costs`     |
| Share History        | local (SyncQueueContext)     | `/#/settings/share-history`   |

### Persistent User Preferences

**When to use:** Automatically applied across all pages

**localStorage Keys:**

| Key                                    | Purpose                            | Scope         |
| -------------------------------------- | ---------------------------------- | ------------- |
| `inbox-active-tab`                     | Active tab (actions/commands)      | InboxPage     |
| `inbox-status-filter`                  | Selected status filter             | InboxPage     |
| `code-tasks-status-filter`             | Multi-status filter array          | CodeTasksPage |
| `sidebar-collapsed`                    | Sidebar collapse state             | Global        |
| `theme`                                | Light/dark/system preference       | Global        |
| `intex-chat-session`                   | Chat conversation history          | Chat          |
| `intex-chat-panel-size`                | Chat panel dimensions              | Chat          |
| `intex-guest-session-id`               | Guest session identifier           | Chat (guest)  |
| `devbar-*`                             | DevBar tabs, height, logs, filters | DevBar        |
| `intexuraos_install_dismissed_version` | PWA install prompt dismissed       | Global        |

## Constraints

**Do NOT:**

- Call backend services without Auth0 access token
- Bypass the `apiRequest` function for HTTP calls
- Create routes without hash prefix (`/#/path` required for GCS hosting)
- Use browser `pushState` for navigation (hash routing only)
- Delete items without showing a confirmation dialog first
- Register more than 2 workers in worker settings

**Requires:**

- Auth0 authentication for all protected routes
- Valid access token for API calls
- Firebase project configured for Firestore access

## Usage Patterns

### Pattern 1: Real-Time Data Updates

```
1. Component mounts → useXXXChanges hook creates Firestore listener
2. Firestore detects change → changed ID added to state
3. Debounce timeout (500 ms) expires → batch API call
4. Local state updated with fresh data
5. UI re-renders with new data
6. Component unmounts → listener unsubscribed
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
2. InboxPage mounts → parses query parameter from hash
3. Cleans URL immediately (prevents modal re-appearing on refresh)
4. Checks local state for action
5. If not found, fetches via batchGetActions
6. Opens ActionDetailModal
```

### Pattern 4: Code Task Agent-Based Navigation

```
1. User views planning task → ImplementationLinkBanner renders if
   implementationTaskId present (emerald banner)
2. User clicks banner → navigates to /#/code-tasks/:implementationTaskId/view
3. CodeTaskViewPageV2Keyed remounts (key={id}) for the implementation task
4. Execution agent log stream shows live progress
```

### Pattern 5: PR Events Lazy Loading

```
1. PREventsPage loads → useGitHubPRSummaries fetches PR list (lightweight)
2. User expands a PR group → useGitHubPREvents fetches detail for that PR only
3. Events render with HTML comment bodies and clickable GitHub links
```

### Pattern 6: Multi-Status Filtering with Persistence

```
1. User selects multiple status checkboxes on CodeTasksPage
2. Filter state saved to localStorage immediately
3. API call made with selected statuses as query parameters
4. User navigates away and returns → filter restored from localStorage
```

### Pattern 7: Collapsible Tool Output in Log Stream

```
1. LogStream receives log lines from Firestore
2. Parser detects [tool] tagged line → starts new collapsible group
3. Subsequent indented lines (isBodyLine check) added to group
4. Group renders collapsed by default
5. User clicks toggle → expands to show full tool result
```

### Pattern 8: GitHub Event Decision Log

```
1. PREventsPage mounts → useGitHubEventLog creates Firestore listener
2. Events appear in real-time as they are written by the system
3. User filters by decision status or searches by repository/PR number
4. User reads reason field to understand why agent made each decision
```

## Error Handling

| Error Code  | Meaning       | Recovery Action                              |
| ----------- | ------------- | -------------------------------------------- |
| 401         | Unauthorized  | Redirect to login page                       |
| 403         | Forbidden     | Show permission error                        |
| 404         | Not Found     | Show "not found" state                       |
| 408         | Timeout       | Show timeout message with retry              |
| 409         | Conflict      | Show TaskConflictModal with resolution steps |
| 429         | Rate Limited  | Show rate limit message                      |
| 500+        | Server Error  | Show error banner with retry option          |
| 502/503/504 | Gateway Error | Show user-friendly non-JSON error message    |

**Declarative Error Display:** `errorConfig.ts` maps error codes to icons, colors, titles, messages, and action buttons. `TaskErrorModal` renders error-code-specific modals — `WORKER_NOT_CONFIGURED` navigates to `/#/settings/code`.

## Rate Limits

No client-side rate limiting enforced. Backend services enforce their own limits. Guest chat sessions have server-side rate limits.

## Events Published

None. The web app is a consumer only — it does not publish Pub/Sub events.

## Dependencies

| Service                      | Why Needed                          | Failure Behavior                          |
| ---------------------------- | ----------------------------------- | ----------------------------------------- |
| user-service                 | Authentication, settings, API keys  | Cannot authenticate or load settings      |
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
| app-settings-service         | LLM pricing, analytics              | Cannot view costs or pricing              |
| Firestore                    | Real-time data sync                 | Falls back to polling only                |
| Auth0                        | User authentication                 | Cannot log in (chat still works as guest) |

## State Management

| Type           | Implementation                       | Scope                              |
| -------------- | ------------------------------------ | ---------------------------------- |
| Global Auth    | React Context (`AuthContext`)        | App-wide                           |
| Sync Queue     | React Context (`SyncQueueContext`)   | App-wide                           |
| Theme          | React Context (`ThemeContext`)       | App-wide (light/dark/system)       |
| PWA Install    | React Context (`PWAProvider`)        | App-wide                           |
| UI State       | useState (component-level)           | Per component                      |
| Preferences    | localStorage                         | Persisted across sessions          |
| Chat Session   | localStorage (`intex-chat-session`)  | Persisted chat conversation        |
| DevBar State   | localStorage                         | Persisted tabs, height, logs       |
| One-time Flags | sessionStorage                       | Current session only               |
| Real-time Data | Firestore listeners                  | Per component (cleanup on unmount) |

## Route Reference

| Route                                     | Auth | Purpose                             |
| ----------------------------------------- | ---- | ----------------------------------- |
| `/#/`                                     | No   | Landing page                        |
| `/#/login`                                | No   | Auth0 login                         |
| `/#/inbox`                                | Yes  | Commands and actions                |
| `/#/research`                             | Yes  | Research list                       |
| `/#/research/new`                         | Yes  | Create research                     |
| `/#/research/:id`                         | Yes  | Research detail                     |
| `/#/code-tasks`                           | Yes  | Code task list                      |
| `/#/code-tasks/new`                       | Yes  | Create code task                    |
| `/#/code-tasks/:id/view`                  | Yes  | Code task detail v2 (current)       |
| `/#/code-tasks/:id`                       | Yes  | Code task detail v1 (legacy)        |
| `/#/code-tasks/pr-events`                 | Yes  | GitHub event decision log           |
| `/#/my-todos`                             | Yes  | Todos                               |
| `/#/todos/:id`                            | Yes  | Redirect to `/my-todos?id=`         |
| `/#/my-notes`                             | Yes  | Notes                               |
| `/#/notes/:id`                            | Yes  | Redirect to `/my-notes?id=`         |
| `/#/my-bookmarks`                         | Yes  | Bookmarks                           |
| `/#/bookmarks/:id`                        | Yes  | Redirect to `/my-bookmarks?id=`     |
| `/#/notes`                                | Yes  | WhatsApp notes                      |
| `/#/calendar`                             | Yes  | Calendar events                     |
| `/#/linear`                               | Yes  | Linear issues                       |
| `/#/data-insights`                        | Yes  | Data insights feeds                 |
| `/#/data-insights/visualizations`         | Yes  | Saved visualizations (global)       |
| `/#/data-insights/:feedId/visualizations` | Yes  | Saved visualizations (per feed)     |
| `/#/data-insights/:id`                    | Yes  | Feed data/charts                    |
| `/#/data-insights/static-sources`         | Yes  | Static data sources                 |
| `/#/data-insights/static-sources/new`     | Yes  | Create static source                |
| `/#/data-insights/static-sources/:id`     | Yes  | Edit static source                  |
| `/#/notifications`                        | Yes  | Push notification history           |
| `/#/settings/whatsapp`                    | Yes  | WhatsApp connection                 |
| `/#/settings/mobile`                      | Yes  | Mobile notifications                |
| `/#/settings/notion`                      | Yes  | Notion connection                   |
| `/#/settings/calendar`                    | Yes  | Google Calendar connection          |
| `/#/settings/linear`                      | Yes  | Linear + webhook config             |
| `/#/settings/github`                      | Yes  | GitHub connection                   |
| `/#/settings/code`                        | Yes  | Worker configuration                |
| `/#/settings/api-keys`                    | Yes  | API key management                  |
| `/#/settings/llm-pricing`                 | Yes  | LLM pricing                         |
| `/#/settings/usage-costs`                 | Yes  | Usage cost tracking                 |
| `/#/settings/share-history`               | Yes  | Share history                       |
| `/#/share-target`                         | Yes  | PWA share handler                   |
