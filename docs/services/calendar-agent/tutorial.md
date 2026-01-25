# Calendar Agent - Tutorial

Learn to manage Google Calendar events through IntexuraOS with preview support.

## Prerequisites

- Auth0 access token
- Google account connected via user-service
- Familiarity with ISO 8601 datetime formats

## Part 1: Hello World - List Events

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

## Part 3: Using Preview Generation (v2.0.0)

The preview flow allows users to see what will be created before committing.

### Step 3.1: Check Preview Status

After an action is submitted, check the preview status:

```bash
curl -X GET "https://calendar-agent.intexuraos.com/internal/calendar/preview/action-123" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN"
```

**Response (pending):**

```json
{
  "success": true,
  "data": {
    "actionId": "action-123",
    "userId": "user-456",
    "status": "pending",
    "generatedAt": "2026-01-24T10:00:00Z"
  }
}
```

**Response (ready):**

```json
{
  "success": true,
  "data": {
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
```

### Step 3.2: Understanding Preview Fields

| Field       | Description                                       |
| ----------- | ------------------------------------------------- |
| `status`    | `pending` (processing), `ready`, or `failed`      |
| `duration`  | Human-readable like "1 hour 30 minutes"           |
| `isAllDay`  | True if event spans full days                     |
| `reasoning` | LLM's explanation of how it interpreted the input |

### Step 3.3: Process Action After Approval

When user approves, the preview data is used:

```bash
curl -X POST "https://calendar-agent.intexuraos.com/internal/calendar/process-action" \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actionId": "action-123",
    "userId": "user-456",
    "text": "Dentist appointment next Tuesday at 2pm"
  }'
```

If preview is ready, it skips LLM extraction and uses cached data.

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
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Preview not found for action action-123"
  }
}
```

**Solution:** Preview may not exist yet. Poll until status changes or timeout.

### Error: Preview Failed

```json
{
  "success": true,
  "data": {
    "actionId": "action-123",
    "status": "failed",
    "error": "Could not extract date from 'sometime next week'. Please specify a date.",
    "reasoning": "The phrase 'sometime next week' is too vague for scheduling."
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
        "error": "Could not determine specific date",
        "reasoning": "No day of week or date specified",
        "createdAt": "2026-01-24T09:00:00Z"
      }
    ]
  }
}
```

## Troubleshooting

| Issue            | Symptom              | Solution                                         |
| ---------------- | -------------------- | ------------------------------------------------ |
| NOT_CONNECTED    | 403 on all requests  | Connect Google account via user-service          |
| Invalid time     | 400 error            | Use ISO 8601 format with timezone                |
| Event not found  | 404                  | Verify eventId and calendarId                    |
| Preview pending  | Status stays pending | Wait and poll, may take 2-5 seconds              |
| Preview failed   | Status is failed     | Check error field, event saved for manual review |
| Attendee ignored | Attendee not added   | Ensure email is valid email address              |

## Best Practices

1. **Poll preview status** - Check every 1-2 seconds until ready or failed
2. **Always specify timeMin/timeMax** - Reduces data transfer and improves performance
3. **Use pagination** - Don't fetch all events at once
4. **Handle partial success** - Free/busy may return some calendars with errors
5. **Implement caching** - Cache event data for short periods
6. **Respect rate limits** - Google Calendar has daily quota limits
7. **Display reasoning** - Show users why dates were interpreted a certain way

## Exercises

### Easy

1. List next 7 days of events
2. Create a simple one-hour event
3. Get a specific event by ID

### Medium

1. Create an all-day event
2. Search for events containing "meeting"
3. Poll a preview until it becomes ready

### Hard

1. Find next available 1-hour slot for multiple attendees
2. Implement preview polling with exponential backoff
3. Handle all preview states (pending, ready, failed) in UI

---

**Last updated:** 2025-01-25
