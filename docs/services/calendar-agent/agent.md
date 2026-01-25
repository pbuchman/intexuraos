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
    currentDate: string; // YYYY-MM-DD
  }): Promise<CalendarPreview>;

  // Get preview status
  getPreview(actionId: string): Promise<CalendarPreview | null>;

  // Process calendar action (with preview support)
  processAction(params: {
    actionId: string;
    userId: string;
    text: string;
  }): Promise<ServiceFeedback>;

  // List events in date range
  listEvents(params: {
    calendarId?: string;
    timeMin: string;
    timeMax: string;
    maxResults?: number;
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
    items: { id: string }[];
  }): Promise<FreeBusyResponse>;

  // List failed event extractions
  listFailedEvents(params?: { limit?: number }): Promise<FailedEvent[]>;
}
```

### Types

```typescript
interface CalendarPreview {
  actionId: string;
  userId: string;
  status: 'pending' | 'ready' | 'failed';
  summary?: string;
  start?: string; // ISO 8601
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
  htmlLink: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  created: string;
  updated: string;
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
  actionId: string;
  originalText: string;
  summary: string;
  start?: string;
  end?: string;
  error: string;
  reasoning: string;
  createdAt: string;
}

interface ServiceFeedback {
  status: 'success' | 'error' | 'info';
  resourceUrl?: string;
  resourceId?: string;
  message?: string;
}
```

---

## Constraints

| Rule                      | Description                                     |
| ------------------------- | ----------------------------------------------- |
| **Google OAuth Required** | User must have Google OAuth connected           |
| **Calendar Access**       | Default calendarId is 'primary'                 |
| **Time Format**           | All times in ISO 8601 format                    |
| **Date Range**            | timeMin must be before timeMax                  |
| **Preview Lifecycle**     | Preview deleted after successful event creation |

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
7. Preview automatically cleaned up after successful creation
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
3. Allow manual correction of event details
4. Call POST /calendar/events with corrected data
```

---

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
        ┌──────────┐
        │          │
  ┌─────▶  pending │
  │     │          │
  │     └────┬─────┘
  │          │
  │          │ LLM extraction
  │          │
  │     ┌────▼─────┐     ┌──────────┐
  │     │          │     │          │
  │     │  ready   │────▶│ deleted  │ (after event creation)
  │     │          │     │          │
  │     └──────────┘     └──────────┘
  │
  │     ┌──────────┐
  │     │          │
  └────▶│  failed  │ (extraction error)
        │          │
        └──────────┘
```

---

## Dependencies

| Service         | Why Needed                  | Failure Behavior           |
| --------------- | --------------------------- | -------------------------- |
| user-service    | OAuth tokens, LLM API keys  | Reject request             |
| Google Calendar | Event CRUD, free/busy       | Map error to CalendarError |
| Gemini LLM      | Event extraction from text  | Save to failed events      |
| Firestore       | Previews, processed actions | Return INTERNAL_ERROR      |

---

**Last updated:** 2025-01-25 (v2.1.0 - INT-269 internal-clients migration)
