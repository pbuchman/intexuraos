# Web App — Technical Reference

## Overview

Single-page React application built with Vite, serving as the primary user interface for IntexuraOS. Uses Auth0 for authentication, Firestore for real-time data synchronization, and connects to 15+ backend microservices via REST APIs. Deploys as a Progressive Web App (PWA) to Google Cloud Storage behind a load balancer. Supports dark mode, an AI chat assistant (Intex Chat), a two-phase code task management system, saved data visualizations, and a developer toolbar (DevBar) for local and dev machine environments.

## Architecture

```mermaid
graph TB
    subgraph "Client Browser"
        PWA[Progressive Web App]
        Auth0[Auth0 Lock]
        SW[Service Worker]
    end

    subgraph "Backend Services"
        USER[user-service]
        CMD[commands-agent]
        ACT[actions-agent]
        RES[research-agent]
        TODO[todos-agent]
        NOTE[notes-agent]
        BKMK[bookmarks-agent]
        CAL[calendar-agent]
        LIN[linear-agent]
        DATA[data-insights-agent]
        NOTIF[mobile-notifications]
        SETTINGS[app-settings-service]
        NOTION[notion-service]
        WA[whatsapp-service]
        CODE[code-agent]
        CHAT[chat-agent]
    end

    subgraph "Data & Auth"
        Firestore[(Firestore)]
        Auth0Svc[Auth0 API]
    end

    PWA --> Auth0Svc
    PWA --> USER
    PWA --> CMD
    PWA --> ACT
    PWA --> RES
    PWA --> TODO
    PWA --> NOTE
    PWA --> BKMK
    PWA --> CAL
    PWA --> LIN
    PWA --> DATA
    PWA --> NOTIF
    PWA --> SETTINGS
    PWA --> NOTION
    PWA --> WA
    PWA --> CODE
    PWA --> CHAT
    PWA --> Firestore
    SW --> PWA
```

## Recent Changes

| Commit     | Description                                                         | Date       |
| ---------- | ------------------------------------------------------------------- | ---------- |
| `27ef6a7b` | INT-505: Show compare URL for PR synchronize events                 | 2026-02-19 |
| `2a187f90` | Fix: render HTML in PR event comment bodies with rehype-raw         | 2026-02-19 |
| `0a48ed4e` | Display comment body on PR events page in GitHub style              | 2026-02-19 |
| `5ead960d` | Add clickable GitHub links to PR event items                        | 2026-02-19 |
| `0e07e938` | Show two-phase flow banner on design tasks with implementation link | 2026-02-19 |
| `e8bbacd7` | GitHub PR summaries with lazy event loading                         | 2026-02-19 |
| `75cc9eb7` | linearIssueUrl threading, UI badge improvements                     | 2026-02-19 |
| `6f6b6fd8` | Add executionPhase field and Phase 2 implementation trigger         | 2026-02-18 |
| `f00798da` | Add saved visualizations feature                                    | 2026-02-18 |
| `5fa51f75` | Clean up CodeTaskViewPage migration                                 | 2026-02-17 |
| `a59e194b` | Redesign code task detail page with useTaskView hook                | 2026-02-17 |
| `935d3210` | Queue-based task messaging (no interrupt)                           | 2026-02-16 |
| `08dbaf84` | Show sub-issues under parent issues on Linear board                 | 2026-02-14 |
| `340971a8` | INT-491: Replace text log viewer with xterm.js terminal             | 2026-02-08 |
| `f86bdbf3` | Add webhook secret configuration UI to Linear settings              | 2026-02-08 |

## Application Structure

```
apps/web/src/
├── components/         # Reusable UI components
│   ├── ui/             # Base UI components (Button, Card, Input)
│   ├── Chat/           # Chat system (FAB, Panel, BottomSheet, Message, Input)
│   ├── devbar/         # DevBar sub-components (tabs, filters, resize)
│   ├── ActionItem.tsx          # Single action display with buttons
│   ├── DevBar.tsx              # Developer toolbar (dev only)
│   ├── Layout.tsx              # Main app layout with sidebar
│   ├── Header.tsx              # Top navigation bar with theme toggle
│   ├── LinearIssueSelectorModal.tsx  # Modal for selecting Linear issues
│   ├── TaskConflictModal.tsx   # 409 conflict resolution modal
│   ├── TaskErrorModal.tsx      # Error-code-specific modal with actions
│   ├── TerminalLogViewer.tsx   # xterm.js-based log viewer for code tasks
│   └── ...
├── context/            # React context providers
│   ├── AuthContext.tsx     # Auth0 authentication wrapper
│   ├── SyncQueueContext.tsx # Offline sync queue
│   ├── ThemeContext.tsx    # Dark/light/system theme management
│   └── pwa-context.tsx    # PWA install prompts
├── hooks/              # Custom React hooks
│   ├── useApiClient.ts    # API request wrapper with auth
│   ├── useActionChanges.ts # Firestore listener for actions
│   ├── useBookmarks.ts     # Bookmark CRUD
│   ├── useBookmarkChanges.ts # Firestore listener for bookmarks
│   ├── useCalendarEvents.ts  # Calendar event list with filtering
│   ├── useChartDefinition.ts # Chart definition management
│   ├── useChartPreview.ts    # Chart preview rendering
│   ├── useCodeTasks.ts    # Code task CRUD + polling
│   ├── useCompositeFeeds.ts  # Composite feed management
│   ├── useCreateVisualization.ts # Create visualization mutations
│   ├── useDataInsights.ts    # Data insights feed data
│   ├── useDataSources.ts     # Static data source management
│   ├── useDevBarState.ts  # DevBar persistence and state
│   ├── useFailedCalendarEvents.ts # Failed calendar event recovery
│   ├── useFailedLinearIssues.ts  # Failed Linear issue tracking
│   ├── useGitHubPREvents.ts # GitHub PR event details (lazy-loaded)
│   ├── useGitHubPRSummaries.ts # GitHub PR summary list
│   ├── useLinearIssueOptions.ts # Linear issue selection options
│   ├── useLlmKeys.ts       # LLM API key management
│   ├── useNotes.ts         # Note CRUD
│   ├── usePm2Logs.ts     # PM2 log streaming via SSE
│   ├── usePubSubEvents.ts # Pub/Sub event streaming via SSE
│   ├── useResearch.ts      # Research report management
│   ├── useTaskView.ts      # Code task detail view state
│   ├── useTodos.ts         # Todo CRUD
│   ├── useUsageCosts.ts    # LLM usage cost data
│   ├── useVisualizations.ts  # Saved visualization management
│   ├── useWorkerSettings.ts # Worker config management
│   └── ...
├── pages/              # Route components
│   ├── HomePage.tsx       # Public landing page
│   ├── LoginPage.tsx      # Auth0 login
│   ├── InboxPage.tsx      # Unified commands/actions inbox
│   ├── CodeTasksPage.tsx  # Code task list
│   ├── CodeTaskNewPage.tsx # Create new code task (form + modal)
│   ├── CodeTaskViewPage.tsx # Code task detail with terminal and two-phase UI
│   ├── PREventsPage.tsx   # GitHub PR events with lazy-loaded summaries
│   ├── WorkerSettingsPage.tsx # Worker configuration management
│   ├── ResearchAgentPage.tsx # Research query form
│   ├── CalendarPage.tsx   # Calendar events list
│   ├── LinearIssuesPage.tsx  # 3-column board with sub-issues and labels
│   ├── VisualizationsListPage.tsx # Saved data visualizations
│   └── ...
├── services/           # API client functions
│   ├── apiClient.ts       # Base API request handler
│   ├── chatService.ts     # Chat agent API + session persistence
│   ├── codeAgentApi.ts    # Code agent API (tasks, workers, PR events)
│   ├── errorConfig.ts     # Declarative error display configuration
│   ├── linearApi.ts       # Linear API (connection, issues, webhook config, sync)
│   ├── researchSettingsApi.ts # Research Notion export settings
│   ├── whatsappApi.ts     # WhatsApp API (verification, messages, media)
│   ├── workerSettingsApi.ts # Worker settings CRUD + connectivity testing
│   └── ...
├── types/              # TypeScript type definitions
│   ├── chat.ts            # Chat message, session, response types
│   └── index.ts           # All shared types
├── utils/              # Utility functions
│   ├── dateFormat.ts      # Centralized date/time formatting
│   ├── dateUtils.ts       # Calendar date utilities
│   ├── markdownUtils.ts   # Markdown/HTML stripping
│   ├── todoItemSort.ts    # Todo sorting logic
│   └── ...
├── config.ts           # Environment configuration
├── App.tsx             # Main app with routing
└── index.tsx           # Application entry point
```

## Routes

| Route                                     | Page                              | Auth Required                   | Purpose                            |
| ----------------------------------------- | --------------------------------- | ------------------------------- | ---------------------------------- |
| `/`                                       | HomePage                          | No                              | Public landing page                |
| `/login`                                  | LoginPage                         | No (redirects if authenticated) | Auth0 login                        |
| `/inbox`                                  | InboxPage                         | Yes                             | Commands and actions queue         |
| `/research`                               | ResearchListPage                  | Yes                             | Research reports list              |
| `/research/new`                           | ResearchAgentPage                 | Yes                             | Create new research query          |
| `/research/:id`                           | ResearchDetailPage                | Yes                             | Research report detail             |
| `/code-tasks`                             | CodeTasksPage                     | Yes                             | Code task list                     |
| `/code-tasks/new`                         | CodeTaskNewPage                   | Yes                             | Create new code task               |
| `/code-tasks/:id`                         | CodeTaskViewPage                  | Yes                             | Code task detail with terminal     |
| `/code-tasks/pr-events`                   | PREventsPage                      | Yes                             | GitHub PR events view              |
| `/my-todos`                               | TodosListPage                     | Yes                             | Todo items                         |
| `/todos/:id`                              | Todo detail                       | Yes                             | Single todo item                   |
| `/my-notes`                               | NotesListPage                     | Yes                             | Notes list                         |
| `/notes/:id`                              | Note detail                       | Yes                             | Single note                        |
| `/my-bookmarks`                           | BookmarksListPage                 | Yes                             | Bookmarks list                     |
| `/bookmarks/:id`                          | Bookmark detail                   | Yes                             | Single bookmark                    |
| `/notes`                                  | WhatsAppNotesPage                 | Yes                             | WhatsApp notes                     |
| `/calendar`                               | CalendarPage                      | Yes                             | Calendar events                    |
| `/linear`                                 | LinearIssuesPage                  | Yes                             | Linear issues dashboard            |
| `/data-insights`                          | CompositeFeedsListPage            | Yes                             | Data insights feeds                |
| `/data-insights/new`                      | CompositeFeedFormPage             | Yes                             | Create composite feed              |
| `/data-insights/visualizations`           | VisualizationsListPage            | Yes                             | Saved visualizations               |
| `/data-insights/:feedId/visualizations`   | VisualizationsListPage            | Yes                             | Saved visualizations for a feed    |
| `/data-insights/:id`                      | DataInsightsPage                  | Yes                             | Feed visualizations                |
| `/data-insights/static-sources`           | DataSourcesListPage               | Yes                             | Static data sources                |
| `/data-insights/static-sources/new`       | DataSourceFormPage                | Yes                             | Create data source                 |
| `/data-insights/static-sources/:id`       | DataSourceFormPage                | Yes                             | Edit data source                   |
| `/notifications`                          | MobileNotificationsListPage       | Yes                             | Push notifications history         |
| `/settings/whatsapp`                      | WhatsAppConnectionPage            | Yes                             | WhatsApp connection                |
| `/settings/mobile`                        | MobileNotificationsConnectionPage | Yes                             | Mobile notification settings       |
| `/settings/notion`                        | NotionConnectionPage              | Yes                             | Notion connection                  |
| `/settings/calendar`                      | GoogleCalendarConnectionPage      | Yes                             | Google Calendar connection         |
| `/settings/linear`                        | LinearConnectionPage              | Yes                             | Linear connection + webhooks       |
| `/settings/workers`                       | WorkerSettingsPage                | Yes                             | Code worker configuration          |
| `/settings/api-keys`                      | ApiKeysSettingsPage               | Yes                             | LLM API key management             |
| `/settings/llm-pricing`                   | LlmPricingPage                    | Yes                             | LLM pricing configuration         |
| `/settings/usage-costs`                   | LlmCostsPage                      | Yes                             | LLM usage cost tracking            |
| `/settings/share-history`                 | ShareHistoryPage                  | Yes                             | PWA share history                  |
| `/share-target`                           | ShareTargetPage                   | Yes                             | PWA share target handler           |

**Note:** All routes use hash routing (`/#/path`) because the app is served from a GCS backend bucket which doesn't support SPA fallback. Legacy routes (`/notion`, `/whatsapp`, `/whatsapp-notes`, `/mobile-notifications`, `/mobile-notifications/list`) redirect to their canonical paths.

## API Client Pattern

All API calls use the `apiRequest` function from `apiClient.ts`:

```typescript
export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  accessToken: string,
  options?: RequestOptions
): Promise<T>;
```

The `useApiClient` hook wraps this with Auth0 token management:

```typescript
const { request, isAuthenticated } = useApiClient();
const data = await request<ServiceUrlType>(path, options);
```

## Real-Time Updates

The app uses Firestore listeners for real-time updates:

**Action Changes Listener:**

- `useActionChanges` hook creates Firestore listener on `actions` collection
- Tracks changed action IDs in state
- Debounced batch fetch (500ms) to prevent excessive API calls
- Only enabled when Actions tab is active (cost optimization)

**Command Changes Listener:**

- `useCommandChanges` hook listens to `commands` collection
- Full refresh on changes (commands less frequent than actions)

**Bookmark Changes Listener:**

- `useBookmarkChanges` hook tracks Firestore bookmark mutations
- Triggers re-fetch of bookmark data

**Linear Issues:**

- Firestore-backed real-time board; no polling needed
- Supports parent-child sub-issues displayed with indentation

## Code Task Two-Phase Flow

Code tasks support a `executionPhase` field: `design` or `execution`.

- **Design phase:** Task produces a design artifact. When an implementation task is linked (`implementationTaskId`), a `DesignTaskBanner` appears with a link to the implementation task.
- **Execution phase:** Runs the code changes. The banner label changes to distinguish the two phases.
- **Single-phase tasks:** No banner shown.

## State Management

- **React Context** for global state (auth, sync queue, PWA, theme)
- **Component State** (`useState`) for local UI state
- **localStorage** for user preferences (active tab, filters, theme, chat sessions, chat panel size, DevBar state)
- **sessionStorage** for one-time flags (deep link fetch tracking)
- **Firestore** for real-time data synchronization (actions, commands, code task logs, Linear issues)

## Configuration

Environment variables (prefixed with `INTEXURAOS_`):

| Variable                                      | Purpose                          | Required |
| --------------------------------------------- | -------------------------------- | -------- |
| `INTEXURAOS_AUTH0_DOMAIN`                     | Auth0 domain                     | Yes      |
| `INTEXURAOS_AUTH0_SPA_CLIENT_ID`              | Auth0 client ID                  | Yes      |
| `INTEXURAOS_AUTH_AUDIENCE`                    | Auth0 API audience               | Yes      |
| `INTEXURAOS_USER_SERVICE_URL`                 | User service endpoint            | Yes      |
| `INTEXURAOS_WHATSAPP_SERVICE_URL`             | WhatsApp service endpoint        | Yes      |
| `INTEXURAOS_NOTION_SERVICE_URL`               | Notion service endpoint          | Yes      |
| `INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL` | Mobile notifications endpoint    | Yes      |
| `INTEXURAOS_RESEARCH_AGENT_URL`               | Research agent endpoint          | Yes      |
| `INTEXURAOS_COMMANDS_AGENT_URL`               | Commands agent endpoint          | Yes      |
| `INTEXURAOS_ACTIONS_AGENT_URL`                | Actions agent endpoint           | Yes      |
| `INTEXURAOS_TODOS_AGENT_URL`                  | Todos agent endpoint             | Yes      |
| `INTEXURAOS_NOTES_AGENT_URL`                  | Notes agent endpoint             | Yes      |
| `INTEXURAOS_BOOKMARKS_AGENT_URL`              | Bookmarks agent endpoint         | Yes      |
| `INTEXURAOS_CALENDAR_AGENT_URL`               | Calendar agent endpoint          | Yes      |
| `INTEXURAOS_LINEAR_AGENT_URL`                 | Linear agent endpoint            | Yes      |
| `INTEXURAOS_CODE_AGENT_URL`                   | Code agent endpoint              | Yes      |
| `INTEXURAOS_CHAT_AGENT_URL`                   | Chat agent endpoint              | Yes      |
| `INTEXURAOS_DATA_INSIGHTS_AGENT_URL`          | Data insights endpoint           | Yes      |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL`         | App settings endpoint            | Yes      |
| `INTEXURAOS_FIREBASE_PROJECT_ID`              | Firebase project                 | Yes      |
| `INTEXURAOS_FIREBASE_API_KEY`                 | Firebase API key                 | Yes      |
| `INTEXURAOS_FIREBASE_AUTH_DOMAIN`             | Firebase auth domain             | Yes      |
| `INTEXURAOS_SENTRY_DSN_WEB`                   | Sentry error tracking            | Yes      |
| `INTEXURAOS_ENVIRONMENT`                      | Environment name                 | No       |
| `INTEXURAOS_BUILD_VERSION`                    | Auto-generated version           | No       |
| `INTEXURAOS_COMMIT_SHA`                       | Git commit SHA for version modal | No       |
| `INTEXURAOS_COMMIT_MESSAGE`                   | Git commit message               | No       |
| `INTEXURAOS_BUILD_DATE`                       | Build timestamp                  | No       |

## PWA Configuration

The app uses `vite-plugin-pwa` with Workbox:

- **Manifest:** Standalone display mode, portrait orientation
- **Share Target:** Handles shared links/text from other apps
- **Cache Strategy:**
  - JS/CSS: StaleWhileRevalidate (7 days)
  - Images: CacheFirst (30 days)
  - Fonts: CacheFirst (1 year)
  - API requests: No caching (bypassed)
- **Service Worker:** Auto-update with skipWaiting: true
- **Max file size:** 4MB (for large libraries like Vega + Auth0 Lock)

## Action Configuration

Buttons on action items are generated from `public/action-config.yaml`:

```yaml
buttons:
  - id: approve
    label: Approve
    endpoint:
      path: /actions/{actionId}/approve
      method: PATCH
    displayOn:
      status: awaiting_approval
```

The `actionConfigLoader` reads this at runtime and `ActionItem` renders buttons based on current action state.

## Firebase Integration

**Authentication:**

- `authenticateFirebase()` exchanges Auth0 token for Firebase custom token
- `getFirebaseAuth()` returns the Firebase auth instance
- Tokens are cached in memory

**Firestore:**

- `getFirestoreClient()` returns the Firestore instance
- Used for real-time listeners on `actions`, `commands`, `linear-issues`, and code task log collections
- `TerminalLogViewer` subscribes to Firestore for streaming code task log chunks to xterm.js
- `LinearIssuesPage` listens to Firestore for real-time issue board updates

## Error Handling

**API Errors:**

- `ApiError` class with code, message, status, and details
- Displayed as red alert banners in pages
- Timeout after 30 seconds (configurable per request)
- Declarative error configuration in `errorConfig.ts` maps error codes to icons, colors, titles, messages, and action buttons
- Code task errors use `TaskErrorModal` with error-code-specific display (e.g., `WORKER_NOT_CONFIGURED` navigates to worker settings)
- 409 Conflict responses parsed into structured conflict info for `TaskConflictModal`
- Non-JSON responses (502/503/504) handled with user-friendly messages

**Sentry Integration:**

- Initialized in `index.tsx`
- `sendDefaultPii: true` for user context
- Traces sample rate: 100%

## Gotchas

- **Hash routing required:** Backend buckets don't support SPA fallback, all routes use `/#/path`
- **Firestore listener cleanup:** Listeners must be unsubscribed when components unmount or tabs switch
- **Auth0 token cache:** Uses `localstorage` to persist sessions across reloads
- **PWA share target:** Handles URL parameters differently due to hash routing (see `App.tsx` share redirect handler)
- **CostGuard markers:** Comments marked with `#CostGuard` indicate cost optimization patterns (batching, debouncing, conditional listeners)
- **Vega bundle size:** Chart library is large; maximum file size for service worker caching is 4MB
- **Deep linking:** URL query parameters work with hash routing (`/#/inbox?action=xyz`)
- **Dev mode:** When `import.meta.env.DEV` is true (Vite dev server), service URLs use relative API paths (e.g., `/api/code`) proxied by Vite instead of absolute service URLs
- **DevBar visibility:** Only renders in dev environments (`import.meta.env.DEV`) and on `dev.intexuraos.cloud`; never in production
- **Chat guest sessions:** Unauthenticated users can use the chat with rate limiting via `X-Guest-Session` header; session ID persists in localStorage
- **xterm.js terminal:** Code task logs use xterm.js for ANSI color rendering; the terminal component subscribes to Firestore for real-time log chunks
- **CodeTaskViewPage keying:** The route mounts `CodeTaskViewPage` with `key={id}` to fully remount when navigating between tasks
- **PR events lazy loading:** `PREventsPage` loads summaries first via `useGitHubPRSummaries`; individual event details load lazily via `useGitHubPREvents` when a PR group is expanded

## Technology Stack

| Layer      | Technology                          |
| ---------- | ----------------------------------- |
| Framework  | React 19.1 with TypeScript          |
| Build      | Vite 7.3                            |
| Styling    | TailwindCSS 4.1 (dark mode support) |
| Auth       | Auth0 SPA SDK                       |
| Real-time  | Firebase SDK (Firestore)            |
| PWA        | vite-plugin-pwa, workbox            |
| Icons      | lucide-react                        |
| Charts     | Vega, Vega-Lite, Vega-Embed         |
| Terminal   | @xterm/xterm, @xterm/addon-fit      |
| Markdown   | @uiw/react-md-editor                |
| HTML parse | rehype-raw (PR event comment bodies)|
| Deployment | GCS + Cloud Load Balancer           |

## Deployment

Built via Cloud Build:

1. TypeScript compilation
2. Vite production build
3. Upload to GCS bucket
4. Invalidate Cloud CDN cache

The app serves from `https://app.intexuraos.com` (production) or `https://dev.intexuraos.com` (development).
