# Calendar Agent — Tutorial

Learn to manage Google Calendar events through IntexuraOS with preview support.

## Prerequisites

- Auth0 access token
- Google account connected via user-service
- Familiarity with ISO 8601 datetime formats

## Part 1: Hello World — List Events

List your upcoming calendar events:

```bash
curl -X GET "https://calendar-agent.intexuraos.com/calendar/events?timeMin=2026-01-24T00:00:00Z&maxResults=10" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "event123",
        "summary": "Team Standup",
        "start": {
          "dateTime": "2026-01-24T10:00:00-05:00",
          "timeZone": "America/New_York"
        },
        "end": {
          "dateTime": "2026-01-24T10:30:00-05:00",
          "timeZone": "America/New_York"
        },
        "status": "confirmed",
        "htmlLink": "https://www.google.com/calendar/event?eid=event123"
      }
    ]
  }
}
```

**Checkpoint:** You should see your upcoming events.

## Part 2: Create an Event

Create a new timed event:

```bash
curl -X POST https://calendar-agent.intexuraos.com/calendar/events \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Product Review",
    "description": "Q1 product roadmap review",
    "location": "Conference Room A",
    "start": {
      "dateTime": "2026-01-27T14:00:00Z",
      "timeZone": "America/New_York"
    },
    "end": {
      "dateTime": "2026-01-27T15:00:00Z",
      "timeZone": "America/New_York"
    },
    "attendees": [
      {"email": "alice@example.com"},
      {"email": "bob@example.com", "optional": true}
    ]
  }'
```

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "event": {
      "id": "newEvent123",
      "summary": "Product Review",
      "start": { "dateTime": "2026-01-27T14:00:00Z" },
      "end": { "dateTime": "2026-01-27T15:00:00Z" },
      "attendees": [
        { "email": "alice@example.com", "responseStatus": "needsAction" },
        { "email": "bob@example.com", "optional": true, "responseStatus": "needsAction" }
      ]
    }
  }
}
```

**All-day event:**

```bash
curl -X POST https://calendar-agent.intexuraos.com/calendar/events \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Company Holiday",
    "start": {"date": "2026-12-25"},
    "end": {"date": "2026-12-26"}
  }'
```

Note: All-day events use `date` (YYYY-MM-DD), not `dateTime`. End date is exclusive.

## Part 3: Using Preview Generation

The preview flow allows users to see what will be created before committing. There are two generation modes: synchronous (direct HTTP) and asynchronous (Pub/Sub).

### Step 3.1: Generate Preview Synchronously (Recommended)

For approval flows where the preview must be available immediately:

```bash
curl -X POST "https://calendar-agent.intexuraos.com/internal/calendar/preview" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actionId": "action-123",
    "userId": "user-456",
    "text": "Dentist appointment next Tuesday at 2pm",
    "currentDate": "2026-03-07"
  }'
```

**Response (ready):**

```json
{
  "success": true,
  "data": {
    "preview": {
      "actionId": "action-123",
      "userId": "user-456",
      "status": "ready",
      "summary": "Dentist appointment",
      "start": "2026-03-11T14:00:00",
      "end": "2026-03-11T15:00:00",
      "duration": "1 hour",
      "isAllDay": false,
      "reasoning": "Interpreted 'next Tuesday at 2pm' as March 11th based on current date.",
      "generatedAt": "2026-03-07T10:00:05Z"
    }
  }
}
```

The synchronous endpoint returns the preview data directly in the response, avoiding the need to poll.

### Step 3.2: Check Preview Status

After an async preview is submitted, check the preview status:

```bash
curl -X GET "https://calendar-agent.intexuraos.com/internal/calendar/preview/action-123" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN"
```

**Response (pending):**

```json
{
  "success": true,
  "data": {
    "preview": {
      "actionId": "action-123",
      "userId": "user-456",
      "status": "pending",
      "generatedAt": "2026-01-24T10:00:00Z"
    }
  }
}
```

**Response (ready):**

```json
{
  "success": true,
  "data": {
    "preview": {
      "actionId": "action-123",
      "userId": "user-456",
      "status": "ready",
      "summary": "Dentist appointment",
      "start": "2026-01-28T14:00:00",
      "end": "2026-01-28T15:00:00",
      "duration": "1 hour",
      "isAllDay": false,
      "reasoning": "Interpreted 'next Tuesday at 2pm' as January 28th based on current date.",
      "generatedAt": "2026-01-24T10:00:05Z"
    }
  }
}
```

### Step 3.3: Understanding Preview Fields

| Field       | Description                                       |
| ----------- | ------------------------------------------------- |
| `status`    | `pending` (processing), `ready`, or `failed`      |
| `duration`  | Human-readable like "1 hour 30 minutes"           |
| `isAllDay`  | True if event spans full days                     |
| `reasoning` | LLM's explanation of how it interpreted the input |

### Step 3.4: Process Action After Approval

When user approves, the preview data is used. Pass the full user prompt via the `text` field:

```bash
curl -X POST "https://calendar-agent.intexuraos.com/internal/calendar/process-action" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": {
      "id": "action-123",
      "userId": "user-456",
      "title": "Dentist appointment"
    },
    "text": "Dentist appointment next Tuesday at 2pm"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "status": "completed",
    "message": "Event \"Dentist appointment\" created successfully",
    "resourceUrl": "https://www.google.com/calendar/event?eid=abc123"
  }
}
```

If preview is ready, it skips LLM extraction and uses cached data. The `resourceUrl` links directly to the created Google Calendar event. If the event has no `htmlLink`, it falls back to `/#/calendar`.

The `text` field contains the full user prompt for LLM extraction. When omitted, falls back to `action.title`. Always prefer sending `text` with the complete natural language input.

## Part 4: Handle Errors

### Error: Not Connected

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Google account not connected. Please connect your account in settings."
  }
}
```

**Solution:** User must connect Google account via user-service OAuth flow.

### Error: Token Expired

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "OAuth token expired"
  }
}
```

**Solution:** user-service handles token refresh. This error means refresh failed.

### Error: Preview Not Found

```json
{
  "success": true,
  "data": {
    "preview": null
  }
}
```

**Solution:** Preview may not exist yet. Poll until it appears and status changes, or timeout.

### Error: Preview Failed

```json
{
  "success": true,
  "data": {
    "preview": {
      "actionId": "action-123",
      "status": "failed",
      "error": "Could not extract date from 'sometime next week'. Please specify a date.",
      "reasoning": "The phrase 'sometime next week' is too vague for scheduling."
    }
  }
}
```

**Solution:** Check the error and reasoning fields. The failed event is saved for manual review.

## Part 5: Check Availability

Find free time slots across multiple calendars:

```bash
curl -X POST https://calendar-agent.intexuraos.com/calendar/freebusy \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "timeMin": "2026-01-27T00:00:00Z",
    "timeMax": "2026-01-27T23:59:59Z",
    "items": [
      {"id": "primary"},
      {"id": "alice@example.com"},
      {"id": "bob@example.com"}
    ]
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "calendars": {
      "primary": {
        "busy": [{ "start": "2026-01-27T10:00:00Z", "end": "2026-01-27T11:00:00Z" }]
      },
      "alice@example.com": {
        "busy": [
          { "start": "2026-01-27T09:00:00Z", "end": "2026-01-27T12:00:00Z" },
          { "start": "2026-01-27T14:00:00Z", "end": "2026-01-27T17:00:00Z" }
        ]
      },
      "bob@example.com": {
        "busy": []
      }
    }
  }
}
```

**Finding free slots:** Subtract busy slots from the time range.

## Part 6: Update and Delete

**Update event:**

```bash
curl -X PATCH https://calendar-agent.intexuraos.com/calendar/events/event123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Updated Title",
    "start": {"dateTime": "2026-01-27T15:00:00Z"}
  }'
```

Only provided fields are updated. Other fields remain unchanged.

**Delete event:**

```bash
curl -X DELETE https://calendar-agent.intexuraos.com/calendar/events/event123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Part 7: Review Failed Events

List events that failed extraction:

```bash
curl -X GET "https://calendar-agent.intexuraos.com/calendar/failed-events?limit=10" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "failedEvents": [
      {
        "id": "failed-001",
        "actionId": "action-789",
        "originalText": "Meeting sometime next week",
        "summary": "Meeting",
        "start": "2026-02-10T10:00:00Z",
        "end": "2026-02-10T11:00:00Z",
        "error": "Could not determine specific date",
        "reasoning": "No day of week or date specified",
        "createdAt": "2026-02-08T09:00:00Z"
      }
    ]
  }
}
```

### Retry a Failed Event

If the failed event has start and end times, retry creating it directly:

```bash
curl -X POST "https://calendar-agent.intexuraos.com/calendar/failed-events/failed-001/retry" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "event": {
      "id": "newEvent456",
      "summary": "Meeting",
      "start": { "dateTime": "2026-02-10T10:00:00Z" },
      "end": { "dateTime": "2026-02-10T11:00:00Z" }
    }
  }
}
```

The failed event record is automatically deleted after successful retry.

**Response (422 — Missing times):**

```json
{
  "success": false,
  "error": {
    "code": "UNPROCESSABLE_ENTITY",
    "message": "Cannot retry: missing start or end time"
  }
}
```

### Delete a Failed Event

Dismiss a failed event from the review queue:

```bash
curl -X DELETE "https://calendar-agent.intexuraos.com/calendar/failed-events/failed-001" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:** 204 No Content

## Troubleshooting

| Issue             | Symptom              | Solution                                             |
| ----------------- | -------------------- | ---------------------------------------------------- |
| NOT_CONNECTED     | 403 on all requests  | Connect Google account via user-service              |
| Invalid time      | 400 error            | Use ISO 8601 format with timezone                    |
| Event not found   | 404                  | Verify eventId and calendarId                        |
| Preview pending   | Status stays pending | Wait and poll, may take 2–5 seconds                  |
| Preview failed    | Status is failed     | Check error field, event saved for manual review     |
| Attendee ignored  | Attendee not added   | Ensure email is valid email address                  |
| Retry returns 422 | Missing start/end    | Failed event has no extracted times, create manually |
| Retry returns 404 | Wrong user           | Failed event belongs to a different user             |
| Auto-execute fail | Missing date/time    | Ensure `text` field has full user prompt, not title  |

## Best Practices

1. **Use synchronous preview** — For approval flows, use `POST /internal/calendar/preview` for immediate preview data
2. **Pass full prompt text** — Always send the complete user message via the `text` field in process-action, not just the short classifier title
3. **Always specify timeMin/timeMax** — Reduces data transfer and improves performance
4. **Use pagination** — Set maxResults to avoid fetching all events at once
5. **Handle partial success** — Free/busy may return some calendars with errors
6. **Implement caching** — Cache event data for short periods
7. **Respect rate limits** — Google Calendar has daily quota limits
8. **Display reasoning** — Show users why dates were interpreted a certain way
9. **Use resourceUrl** — The process-action response links directly to Google Calendar

## Exercises

### Easy

1. List next 7 days of events
2. Create a simple one-hour event
3. Get a specific event by ID

### Medium

1. Create an all-day event
2. Search for events containing "meeting"
3. Generate a preview synchronously and display it

### Hard

1. Find next available 1-hour slot for multiple attendees
2. Implement preview polling with exponential backoff for async flow
3. Handle all preview states (pending, ready, failed) in UI
4. Build a failed events review flow with retry and delete support

---

**Last updated:** 2026-03-07
