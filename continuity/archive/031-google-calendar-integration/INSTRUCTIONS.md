# Plan: Google Calendar Integration via OAuth in user-service

## Overview

Add OAuth connections to **user-service** (not a separate service), create **calendar-agent** to operate on user's Google Calendar, and integrate calendar action handling into **actions-agent**.

**Why user-service?** It already handles Auth0 OAuth, encrypted token storage, and internal endpoints for credentials. OAuth connections follow the same pattern as LLM API keys.

---

## Continuity Workflow

This is a multi-step feature. Use continuity process:

```
continuity/NNN-google-calendar-integration/
├── INSTRUCTIONS.md      # Goal, scope, constraints, success criteria
├── CONTINUITY.md        # Progress ledger (Done/Now/Next)
├── 0-0-setup.md         # Tier 0: Initial setup, Google Cloud Console config
├── 1-0-user-service.md  # Tier 1: OAuth domain + routes in user-service
├── 1-1-calendar-agent.md # Tier 1: New calendar-agent service (use /create-service)
├── 1-2-actions-agent.md # Tier 1: Calendar handler in actions-agent
├── 1-3-web-ui.md        # Tier 1: Connection page + sidebar
├── 2-0-terraform.md     # Tier 2: Infrastructure deployment
├── 2-1-integration.md   # Tier 2: End-to-end testing
└── 2-2-deploy-verify.md # Tier 2: Deploy to dev + verify /health
```

---

## Part 1: user-service OAuth Extension

### New Firestore Collection

Add to `firestore-collections.json`:

```json
"oauth_connections": {
  "owner": "user-service",
  "description": "Third-party OAuth tokens (Google, Microsoft) - AES-256-GCM encrypted"
}
```

### Domain Layer

**Create `apps/user-service/src/domain/oauth/`:**

| File                              | Purpose                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `models.ts`                       | `OAuthProvider`, `OAuthConnection`, `OAuthTokens` types     |
| `errors.ts`                       | `OAuthErrorCode` union type                                 |
| `ports.ts`                        | `OAuthConnectionRepository`, `GoogleOAuthClient` interfaces |
| `useCases/initiateOAuthFlow.ts`   | Generate state + redirect URL                               |
| `useCases/exchangeOAuthCode.ts`   | Exchange code for tokens                                    |
| `useCases/getValidAccessToken.ts` | Return token, auto-refresh if expired                       |
| `useCases/disconnectProvider.ts`  | Remove connection                                           |
| `index.ts`                        | Module exports                                              |

### Infrastructure Layer

**Create:**

| File                                           | Purpose                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `infra/firestore/oauthConnectionRepository.ts` | Encrypted token storage (follow `authTokenRepository.ts` pattern) |
| `infra/google/googleOAuthClient.ts`            | Google OAuth token exchange + refresh                             |

**Key patterns from existing code:**

- Use `encryptToken`/`decryptToken` from `./encryption.js`
- Use `getFirestore()` singleton
- Return `Result<T, OAuthError>` types

### Routes

**Create `routes/oauthConnectionRoutes.ts`:**

| Method | Path                                 | Auth   | Purpose                  |
| ------ | ------------------------------------ | ------ | ------------------------ |
| POST   | `/oauth/connections/google/initiate` | Bearer | Return `{ redirectUrl }` |
| GET    | `/oauth/connections/google/callback` | None   | Handle Google redirect   |
| GET    | `/oauth/connections/google/status`   | Bearer | Return connection status |
| DELETE | `/oauth/connections/google`          | Bearer | Disconnect               |

**Add to `routes/internalRoutes.ts`:**

| Method | Path                                      | Auth            | Purpose                   |
| ------ | ----------------------------------------- | --------------- | ------------------------- |
| GET    | `/internal/users/:uid/oauth/google/token` | X-Internal-Auth | Return valid access token |

### Environment Variables

Add to user-service required env:

- `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID`
- `INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET`

### Services Container

Update `services.ts`:

```typescript
oauthConnectionRepository: OAuthConnectionRepository;
googleOAuthClient: GoogleOAuthClient | null;
```

---

## Part 2: calendar-agent Service

### Service Structure

```
apps/calendar-agent/
├── src/
│   ├── domain/
│   │   ├── models.ts          # CalendarEvent, FreeBusySlot
│   │   ├── errors.ts          # CalendarErrorCode
│   │   ├── ports.ts           # GoogleCalendarClient interface
│   │   └── useCases/
│   │       ├── listEvents.ts
│   │       ├── createEvent.ts
│   │       ├── updateEvent.ts
│   │       ├── deleteEvent.ts
│   │       └── getFreeBusy.ts
│   ├── infra/
│   │   ├── google/googleCalendarClient.ts
│   │   └── user/userServiceClient.ts
│   ├── routes/
│   │   ├── calendarRoutes.ts
│   │   └── schemas.ts
│   ├── services.ts
│   ├── server.ts
│   └── index.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Endpoints

| Method | Path                        | Purpose                               |
| ------ | --------------------------- | ------------------------------------- |
| GET    | `/calendar/events`          | List events (query: timeMin, timeMax) |
| POST   | `/calendar/events`          | Create event                          |
| GET    | `/calendar/events/:eventId` | Get event                             |
| PATCH  | `/calendar/events/:eventId` | Update event                          |
| DELETE | `/calendar/events/:eventId` | Delete event                          |
| POST   | `/calendar/freebusy`        | Get free/busy times                   |
| GET    | `/health`                   | Health check                          |
| GET    | `/openapi.json`             | OpenAPI spec                          |

### Token Flow

```
calendar-agent                    user-service
     │                                 │
     │ GET /internal/users/:uid/       │
     │     oauth/google/token          │
     ├────────────────────────────────►│
     │                                 │ Check expiry
     │                                 │ Refresh if needed
     │◄────────────────────────────────┤
     │ { accessToken: "..." }          │
     │                                 │
     │ Use token with Google API       │
     ▼                                 │
```

### Environment Variables

```
INTEXURAOS_GCP_PROJECT_ID
INTEXURAOS_AUTH_JWKS_URL
INTEXURAOS_AUTH_ISSUER
INTEXURAOS_AUTH_AUDIENCE
INTEXURAOS_INTERNAL_AUTH_TOKEN
INTEXURAOS_USER_SERVICE_URL
```

---

## Part 3: Terraform Changes

### Secrets (terraform/environments/dev/main.tf)

Add to `module "secret_manager"`:

```terraform
"INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID"     = "..."
"INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET" = "..."
"INTEXURAOS_CALENDAR_AGENT_URL"         = "..."
```

### IAM (terraform/modules/iam/)

Add service account for `calendar-agent`:

- Secret Manager access
- Cloud Logging write

### Cloud Run

Add `calendar-agent` module following existing service patterns.

### user-service Update

Add Google OAuth secrets to user-service env vars.

---

## Part 4: actions-agent Calendar Handler

**Current state:** `calendar` action type is defined but has no handler - stays `pending` forever.

### Files to Create

| File                                       | Purpose                            |
| ------------------------------------------ | ---------------------------------- |
| `domain/useCases/handleCalendarAction.ts`  | Move action to `awaiting_approval` |
| `domain/useCases/executeCalendarAction.ts` | Create event after user approval   |
| `domain/ports/calendarServiceClient.ts`    | Interface for calendar-agent       |
| `infra/http/calendarHttpClient.ts`         | HTTP client implementation         |

### Two-Phase Calendar Action Flow

**Phase 1: handleCalendarAction.ts (on action created)**

```typescript
// Move to awaiting_approval - DO NOT create event yet
export async function handleCalendarAction(
  event: ActionCreatedEvent,
  deps: { actionServiceClient; whatsappPublisher; logger }
): Promise<Result<void, ActionError>> {
  // 1. Update action to 'awaiting_approval'
  // 2. Notify user via WhatsApp: "Calendar event pending approval: {title}"
  // 3. User reviews in UI and clicks "Approve"
}
```

**Phase 2: executeCalendarAction.ts (on user approval)**

```typescript
// Only create event AFTER user approves
export async function executeCalendarAction(
  action: Action,
  deps: { calendarServiceClient; actionServiceClient; whatsappPublisher; logger }
): Promise<Result<CalendarEvent, ActionError>> {
  // 1. Update action to 'processing'
  // 2. Get user's Google token via user-service
  // 3. Create calendar event via calendar-agent
  // 4. Update action to 'completed' with event link
  // 5. Notify user via WhatsApp with calendar link
}
```

### Approval Flow

```
WhatsApp: "Meeting with John tomorrow 3pm"
         │
         ▼
commands-router classifies as 'calendar'
         │
         ▼
actions-agent creates action (pending)
         │
         ▼
handleCalendarAction → status: 'awaiting_approval'
         │
         ▼
User sees in UI: "Calendar: Meeting with John - Tomorrow 3pm" [Approve] [Edit] [Reject]
         │
         ▼ (user clicks Approve)
         │
executeCalendarAction → creates event → status: 'completed'
         │
         ▼
WhatsApp: "✓ Calendar event created: Meeting with John - link"
```

### Action Payload Structure

```typescript
interface CalendarActionPayload {
  eventTitle: string;
  eventDateTime: string; // ISO 8601
  eventEndDateTime?: string;
  attendees?: string[];
  description?: string;
  location?: string;
}
```

### Register Handler

Update `apps/actions-agent/src/services.ts`:

```typescript
// Add to handler registry (line ~47)
calendar: handleCalendarActionUseCase,
```

Update `apps/actions-agent/src/domain/actionHandlerRegistry.ts`:

```typescript
// Add calendar to registry type
```

### Environment Variables

Already configured:

- `INTEXURAOS_PUBSUB_ACTIONS_CALENDAR_TOPIC` - exists in config.ts
- Add: `INTEXURAOS_CALENDAR_AGENT_URL` - for HTTP client

---

## Part 5: Web App UI

### 5.1 New Connection Page

**Create `apps/web/src/pages/GoogleCalendarConnectionPage.tsx`**

Follow `NotionConnectionPage.tsx` pattern:

- Status display (connected/disconnected)
- OAuth flow initiation (redirects to Google)
- Disconnect button
- Connected email display

**States:**

```typescript
const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
const [isLoading, setIsLoading] = useState(true);
const [isConnecting, setIsConnecting] = useState(false);
const [isDisconnecting, setIsDisconnecting] = useState(false);
const [error, setError] = useState<string | null>(null);
const [successMessage, setSuccessMessage] = useState<string | null>(null);
```

### 5.2 Sidebar Navigation

**Modify `apps/web/src/components/Sidebar.tsx`**

Add to `settingsItems` array:

```typescript
{ to: '/settings/google-calendar', label: 'Google Calendar', icon: Calendar },
```

Import `Calendar` from `lucide-react`.

### 5.3 Route Configuration

**Modify `apps/web/src/App.tsx`**

Add route:

```typescript
<Route path="/settings/google-calendar" element={<GoogleCalendarConnectionPage />} />
```

### 5.4 API Service

**Create `apps/web/src/services/googleCalendarApi.ts`**

```typescript
export async function getGoogleCalendarStatus(accessToken: string): Promise<GoogleCalendarStatus>;
export async function initiateGoogleCalendarOAuth(
  accessToken: string
): Promise<{ redirectUrl: string }>;
export async function disconnectGoogleCalendar(accessToken: string): Promise<void>;
```

### 5.5 Type Definitions

**Modify `apps/web/src/types/index.ts`**

```typescript
export interface GoogleCalendarStatus {
  connected: boolean;
  email?: string;
  scopes?: string[];
  createdAt: string | null;
  updatedAt: string | null;
}
```

### 5.6 Configuration

**Modify `apps/web/src/config.ts`**

```typescript
userServiceUrl: getEnvVar('INTEXURAOS_USER_SERVICE_URL'),  // OAuth endpoints here
```

**Modify `apps/web/src/types/index.ts` (AppConfig)**

No new URL needed - OAuth endpoints are on user-service.

---

## Implementation Order (Continuity Subtasks)

### Tier 0: Setup (0-0-setup.md)

1. Create continuity directory structure
2. Document Google Cloud Console setup requirements
3. Create OAuth credentials in Google Cloud Console (manual step)
4. Add secrets to Secret Manager

### Tier 1: Independent Deliverables

**1-0-user-service.md: OAuth in user-service**

1. Domain layer (models, ports, use cases)
2. Infrastructure (repository with encryption, Google OAuth client)
3. Routes (public + internal endpoints)
4. Tests (95% coverage)
5. Verify: `npm run ci`

**1-1-calendar-agent.md: New service**

1. Run `/create-service` to scaffold calendar-agent
2. Domain layer (CalendarEvent model, ports)
3. Infrastructure (Google Calendar API client, user-service client)
4. Routes (CRUD + freebusy)
5. Tests (95% coverage)
6. Verify: `npm run ci`

**1-2-actions-agent.md: Calendar handler**

1. Create handleCalendarAction use case
2. Create CalendarServiceClient port + HTTP implementation
3. Register handler in services.ts
4. Add env var for CALENDAR_AGENT_URL
5. Tests
6. Verify: `npm run ci`

**1-3-web-ui.md: Connection page**

1. GoogleCalendarConnectionPage.tsx
2. googleCalendarApi.ts service
3. Sidebar navigation update
4. Route in App.tsx
5. Type definitions
6. Verify: `npm run ci`

### Tier 2: Integration & Deployment

**2-0-terraform.md: Infrastructure**

1. Add Google OAuth secrets to secret-manager
2. Update user-service with new secrets
3. Add calendar-agent IAM service account
4. Add calendar-agent Cloud Run module
5. Update actions-agent with CALENDAR_AGENT_URL
6. Verify: `tf fmt -check && tf validate && tf plan`

**2-1-integration.md: End-to-end local testing**

1. Local integration test of OAuth flow
2. Local integration test of calendar operations
3. Test action → calendar event creation flow
4. Verify token refresh works

**2-2-deploy-verify.md: Deployment & Verification**

1. Build and push Docker images to Artifact Registry
2. Apply Terraform changes (`tf apply`)
3. Verify /health endpoints:
   - `curl https://<user-service>/health`
   - `curl https://<calendar-agent>/health`
   - `curl https://<actions-agent>/health`
4. Test OAuth flow in deployed environment
5. Create calendar event via WhatsApp command
6. Archive continuity directory to `continuity/archive/`

---

## Deployment Process (Claude Self-Managed)

Claude will manage the entire deployment:

### 1. Build & Push Images

```bash
# For each modified service
docker build -t <region>-docker.pkg.dev/<project>/<repo>/<service>:latest apps/<service>
docker push <region>-docker.pkg.dev/<project>/<repo>/<service>:latest
```

Or use existing script:

```bash
./scripts/push-missing-images.sh
```

### 2. Apply Terraform

```bash
cd terraform/environments/dev
tf apply -auto-approve
```

### 3. Verify Health Endpoints

```bash
# Get service URLs from Terraform output
tf output -json | jq '.service_urls.value'

# Verify each service
curl -f https://<user-service-url>/health
curl -f https://<calendar-agent-url>/health
curl -f https://<actions-agent-url>/health
```

### 4. End-to-End Verification

1. Open web app → Settings → Google Calendar
2. Click "Connect Google Calendar"
3. Complete OAuth flow
4. Verify "Connected" status shows
5. Send WhatsApp message: "Schedule meeting tomorrow at 3pm"
6. Verify action appears in UI with status `awaiting_approval`
7. Click "Approve" in the UI
8. Verify calendar event created and action status is `completed`
9. Verify WhatsApp notification received with calendar link

---

## Critical Files Reference

| Purpose                   | File                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| Token encryption pattern  | `apps/user-service/src/infra/firestore/authTokenRepository.ts`    |
| Internal endpoint pattern | `apps/user-service/src/routes/internalRoutes.ts`                  |
| Service scaffold template | `apps/bookmarks-agent/`                                           |
| Connection page UI        | `apps/web/src/pages/NotionConnectionPage.tsx`                     |
| Collection registry       | `firestore-collections.json`                                      |
| Handle action pattern     | `apps/actions-agent/src/domain/usecases/handleResearchAction.ts`  |
| Execute action pattern    | `apps/actions-agent/src/domain/usecases/executeResearchAction.ts` |
| Handler registry          | `apps/actions-agent/src/domain/actionHandlerRegistry.ts`          |
| Continuity workflow       | `continuity/README.md`                                            |
