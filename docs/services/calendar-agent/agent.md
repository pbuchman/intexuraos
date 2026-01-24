# calendar-agent — Agent Interface

> Machine-readable interface definition for AI agents interacting with calendar-agent.

---

## Identity

| Field    | Value                                                                           |
| --------  | -------------------------------------------------------------------------------  |
| **Name** | calendar-agent                                                                  |
| **Role** | Google Calendar Integration Service                                             |
| **Goal** | Manage calendar events with intelligent date parsing and multi-calendar support |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface CalendarAgentTools {
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
}
```

### Types

```typescript
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
```

---

## Constraints

| Rule                      | Description                           |
| -------------------------  | -------------------------------------  |
| **Google OAuth Required** | User must have Google OAuth connected |
| **Calendar Access**       | Default calendarId is 'primary'       |
| **Time Format**           | All times in ISO 8601 format          |
| **Date Range**            | timeMin must be before timeMax        |

---

## Usage Patterns

### Create Event

```typescript
const event = await createEvent({
  summary: 'Team Sync',
  description: 'Weekly team synchronization meeting',
  start: { dateTime: '2026-01-20T14:00:00Z', timeZone: 'Europe/Berlin' },
  end: { dateTime: '2026-01-20T15:00:00Z', timeZone: 'Europe/Berlin' },
  attendees: [{ email: 'team@example.com' }],
});
```

### Create All-Day Event

```typescript
const event = await createEvent({
  summary: 'Company Holiday',
  start: { date: '2026-01-01' },
  end: { date: '2026-01-02' },
});
```

### Check Availability

```typescript
const freeBusy = await queryFreeBusy({
  timeMin: '2026-01-20T00:00:00Z',
  timeMax: '2026-01-20T23:59:59Z',
  items: [{ id: 'primary' }],
});
const busySlots = freeBusy.calendars['primary'].busy;
```

---

## Internal Endpoints

| Method | Path                   | Purpose                         |
| ------  | ----------------------  | -------------------------------  |
| POST   | `/internal/events`     | Create event from actions-agent |
| GET    | `/internal/events/:id` | Get event for internal services |

---

**Last updated:** 2026-01-19
