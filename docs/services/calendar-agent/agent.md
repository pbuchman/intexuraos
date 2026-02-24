# calendar-agent - Agent Interface

> Machine-readable interface definition for AI agents interacting with calendar-agent.

---

## Identity

| Field    | Value                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------- |
| **Name** | calendar-agent                                                                                       |
| **Role** | Google Calendar Integration Service with Preview Support                                             |
| **Goal** | Manage calendar events with intelligent date parsing, preview generation, and multi-calendar support |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface CalendarAgentTools {
  // Generate preview for calendar action (Pub/Sub)
  generatePreview(params: {
    actionId: string;
    userId: string;
    text: string;
    currentDate: string; // YYYY-MM-DD DayOfWeek (e.g., "2026-02-22 Sunday")
  }): Promise<CalendarPreview>;

  // Get preview status
  getPreview(actionId: string): Promise<CalendarPreview | null>;

  // Process calendar action (with preview support)
  // HTTP body: { action: { id, userId, title } }
  // Returns resourceUrl pointing to Google Calendar event (htmlLink)
  processAction(params: {
    action: {
      id: string;
      userId: string;
      title: string; // user message text to extract event from
    };
  }): Promise<ServiceFeedback>;

  // List events in date range
  listEvents(params: {
    calendarId?: string;
    timeMin: string;
    timeMax: string;
    maxResults?: number;
    q?: string;
  }): Promise<CalendarEvent[]>;

  // Create new event
  createEvent(params: {
    calendarId?: string;
    summary: string;
    description?: string;
    start: EventDateTime;
    end: EventDateTime;
    attendees?: { email: string }[];
    location?: string;
  }): Promise<CalendarEvent>;

  // Get single event
  getEvent(
    eventId: string,
    params?: {
      calendarId?: string;
    }
  ): Promise<CalendarEvent>;

  // Update event
  updateEvent(
    eventId: string,
    params: {
      calendarId?: string;
      summary?: string;
      description?: string;
      start?: EventDateTime;
      end?: EventDateTime;
      attendees?: { email: string }[];
      location?: string;
    }
  ): Promise<CalendarEvent>;

  // Delete event
  deleteEvent(
    eventId: string,
    params?: {
      calendarId?: string;
    }
  ): Promise<void>;

  // Query free/busy time
  queryFreeBusy(params: {
    timeMin: string;
    timeMax: string;
    items?: { id: string }[];
  }): Promise<FreeBusyResponse>;

  // List failed event extractions
  listFailedEvents(params?: { limit?: number }): Promise<FailedEvent[]>;

  // Delete a failed event extraction
  deleteFailedEvent(id: string): Promise<void>;

  // Retry creating a calendar event from a failed extraction
  retryFailedEvent(id: string): Promise<CalendarEvent>;
}
```

### Types

```typescript
interface CalendarPreview {
  actionId: string;
  userId: string;
  status: 'pending' | 'ready' | 'failed';
  summary?: string;
  start?: string; // ISO 8601 or YYYY-MM-DD for all-day
  end?: string; // ISO 8601
  location?: string;
  description?: string;
  duration?: string; // Human-readable: "1 hour 30 minutes"
  isAllDay?: boolean;
  error?: string; // If status === 'failed'
  reasoning?: string; // LLM explanation
  generatedAt: string; // ISO 8601
}

interface EventDateTime {
  dateTime?: string; // ISO 8601 for timed events
  date?: string; // YYYY-MM-DD for all-day events
  timeZone?: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: { email: string; responseStatus?: string }[];
  location?: string;
  htmlLink?: string; // Direct link to Google Calendar event
  status?: 'confirmed' | 'tentative' | 'cancelled';
  created?: string;
  updated?: string;
  organizer?: { email?: string; displayName?: string };
}

interface FreeBusyResponse {
  calendars: Record<
    string,
    {
      busy: { start: string; end: string }[];
    }
  >;
}

interface FailedEvent {
  id: string;
  userId: string;
  actionId: string;
  originalText: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  description: string | null;
  error: string;
  reasoning: string;
  createdAt: string;
}

interface ServiceFeedback {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string; // Google Calendar htmlLink (or /#/calendar fallback)
  errorCode?: string;
}
```

---

## Constraints

| Rule                      | Description                                                                 |
| ------------------------- | --------------------------------------------------------------------------- |
| **Google OAuth Required** | User must have Google OAuth connected                                       |
| **Calendar Access**       | Default calendarId is 'primary'                                             |
| **Time Format**           | All times in ISO 8601 format                                                |
| **Date Range**            | timeMin must be before timeMax                                              |
| **Preview Lifecycle**     | Preview deleted after successful event creation                             |
| **Retry Precondition**    | Failed event retry requires both start and end times to be set              |
| **Ownership Check**       | Failed event delete/retry checks userId ownership (returns 404 if mismatch) |
| **htmlLink Priority**     | processAction uses Google Calendar htmlLink; falls back to /#/calendar      |

---

## Usage Patterns

### Pattern 1: Preview-Based Event Creation (Recommended)

```
1. Publish to calendar-preview topic with actionId, userId, text, currentDate
2. Poll GET /internal/calendar/preview/:actionId until status !== 'pending'
3. If status === 'ready': Display preview to user for approval
4. If status === 'failed': Show error and reasoning, allow manual edit
5. On approval: Call POST /internal/calendar/process-action
6. processAction uses preview data (skips LLM) and creates event
7. Response includes resourceUrl (Google Calendar htmlLink)
8. Preview automatically cleaned up after successful creation
```

### Pattern 2: Direct Event Creation

```
1. Call POST /calendar/events with full event details
2. Returns created CalendarEvent with id and htmlLink
```

### Pattern 3: Check Availability Then Create

```
1. Call POST /calendar/freebusy with time range and calendar IDs
2. Find available slot from gaps in busy array
3. Call POST /calendar/events with available time slot
```

### Pattern 4: Failed Event Recovery

```
1. Call GET /calendar/failed-events to list extraction failures
2. Display originalText, summary, error, reasoning to user
3. If start and end are present: Call POST /calendar/failed-events/:id/retry
4. If start/end missing: Allow manual correction, call POST /calendar/events with corrected data
5. To dismiss: Call DELETE /calendar/failed-events/:id
```

---

## Public Endpoints

| Method | Path                                | Purpose                    | Auth         |
| ------ | ----------------------------------- | -------------------------- | ------------ |
| GET    | `/calendar/events`                  | List events with filters   | Bearer token |
| GET    | `/calendar/events/:eventId`         | Get specific event         | Bearer token |
| POST   | `/calendar/events`                  | Create event               | Bearer token |
| PATCH  | `/calendar/events/:eventId`         | Update event               | Bearer token |
| DELETE | `/calendar/events/:eventId`         | Delete event               | Bearer token |
| POST   | `/calendar/freebusy`                | Get free/busy info         | Bearer token |
| GET    | `/calendar/failed-events`           | List failed extractions    | Bearer token |
| DELETE | `/calendar/failed-events/:id`       | Delete a failed event      | Bearer token |
| POST   | `/calendar/failed-events/:id/retry` | Retry creating from failed | Bearer token |

## Internal Endpoints

| Method | Path                                   | Purpose                         | Caller        |
| ------ | -------------------------------------- | ------------------------------- | ------------- |
| POST   | `/internal/calendar/process-action`    | Process calendar action         | actions-agent |
| POST   | `/internal/calendar/generate-preview`  | Generate preview (Pub/Sub push) | Cloud Pub/Sub |
| GET    | `/internal/calendar/preview/:actionId` | Get preview by action ID        | actions-agent |

---

## Error Handling

| Error Code      | Meaning                     | Recovery Action                |
| --------------- | --------------------------- | ------------------------------ |
| NOT_CONNECTED   | Google OAuth not connected  | Redirect to connect flow       |
| TOKEN_ERROR     | OAuth token invalid/expired | Refresh token via user-service |
| NOT_FOUND       | Event/preview not found     | Verify ID exists               |
| INVALID_REQUEST | Malformed request           | Check request payload          |
| QUOTA_EXCEEDED  | Google API rate limit       | Wait and retry with backoff    |
| INTERNAL_ERROR  | Server error                | Retry with backoff             |

---

## Preview Status State Machine

```
        +----------+
|                               |
|  |
|                               |                |
| ----------------------------- |
|                               |
|                               | LLM extraction |
|                               |
| +----v-----+     +----------+ |
|                               |                |  |  |
|                               | ready          | ----> | deleted | (after event creation) |
|                               |                |  |  |
| +----------+     +----------+ |
|                               |                |
| +----------+                  |
|                               |                |
  +---->|  failed  | (extraction error)
|  |
|  |
```

---

## Dependencies

| Service                         | Why Needed                        | Failure Behavior           |
| ------------------------------- | --------------------------------- | -------------------------- |
| user-service                    | OAuth tokens, LLM API keys        | Reject request             |
| Google Calendar                 | Event CRUD, free/busy             | Map error to CalendarError |
| Gemini 2.5 Flash (primary LLM)  | Event extraction from text        | Attempt fallback LLM       |
| GLM-4.7 via Zai (fallback LLM)  | Event extraction when Gemini down | Save to failed events      |
| Firestore                       | Previews, processed actions       | Return INTERNAL_ERROR      |
| app-settings-service            | LLM pricing context at startup    | Crash on startup           |

---

**Last updated:** 2026-02-22 (v3.1.0 - INT-585 htmlLink as resourceUrl, corrected ServiceFeedback type)
