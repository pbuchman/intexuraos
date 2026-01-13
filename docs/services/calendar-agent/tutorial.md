# Calendar Agent - Tutorial

Learn to manage Google Calendar events through IntexuraOS.

## Prerequisites

- Auth0 access token
- Google account connected via user-service
- Familiarity with ISO 8601 datetime formats

## Part 1: Hello World - List Events

List your upcoming calendar events:

```bash
curl -X GET "https://calendar-agent.intexuraos.com/calendar/events?timeMin=2026-01-13T00:00:00Z&maxResults=10" \
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
          "dateTime": "2026-01-13T10:00:00-05:00",
          "timeZone": "America/New_York"
        },
        "end": {
          "dateTime": "2026-01-13T10:30:00-05:00",
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
      "dateTime": "2026-01-15T14:00:00Z",
      "timeZone": "America/New_York"
    },
    "end": {
      "dateTime": "2026-01-15T15:00:00Z",
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
      "start": {"dateTime": "2026-01-15T14:00:00Z"},
      "end": {"dateTime": "2026-01-15T15:00:00Z"},
      "attendees": [
        {"email": "alice@example.com", "responseStatus": "needsAction"},
        {"email": "bob@example.com", "optional": true, "responseStatus": "needsAction"}
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

Note: All-day events use `date` (YYYY-MM-DD), not `dateTime`. End date is exclusive (event ends at start of that day).

## Part 3: Handle Errors

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

### Error: Event Not Found

```bash
curl -X GET https://calendar-agent.intexuraos.com/calendar/events/nonexistent \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Event not found"
  }
}
```

### Error: Quota Exceeded

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Calendar API quota exceeded"
  }
}
```

**Solution:** Implement exponential backoff and reduce request frequency.

## Part 4: Check Availability

Find free time slots across multiple calendars:

```bash
curl -X POST https://calendar-agent.intexuraos.com/calendar/freebusy \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "timeMin": "2026-01-15T00:00:00Z",
    "timeMax": "2026-01-15T23:59:59Z",
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
        "busy": [
          {"start": "2026-01-15T10:00:00Z", "end": "2026-01-15T11:00:00Z"}
        ]
      },
      "alice@example.com": {
        "busy": [
          {"start": "2026-01-15T09:00:00Z", "end": "2026-01-15T12:00:00Z"},
          {"start": "2026-01-15T14:00:00Z", "end": "2026-01-15T17:00:00Z"}
        ]
      },
      "bob@example.com": {
        "busy": []
      }
    }
  }
}
```

**Finding free slots:** Subtract busy slots from the time range to find available windows.

## Part 5: Update and Delete

**Update event:**

```bash
curl -X PATCH https://calendar-agent.intexuraos.com/calendar/events/event123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Updated Title",
    "start": {"dateTime": "2026-01-15T15:00:00Z"}
  }'
```

Only provided fields are updated. Other fields remain unchanged.

**Delete event:**

```bash
curl -X DELETE https://calendar-agent.intexuraos.com/calendar/events/event123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Troubleshooting

| Issue            | Symptom             | Solution                                |
| ----------------  | -------------------  | ---------------------------------------  |
| NOT_CONNECTED    | 403 on all requests | Connect Google account via user-service |
| Invalid time     | 400 error           | Use ISO 8601 format with timezone       |
| Event not found  | 404                 | Verify eventId and calendarId           |
| Attendee ignored | Attendee not added  | Ensure email is valid email address     |

## Best Practices

1. **Always specify timeMin/timeMax** - Reduces data transfer and improves performance
2. **Use pagination** - Don't fetch all events at once
3. **Handle partial success** - Free/busy may return some calendars with errors
4. **Implement caching** - Cache event data for short periods
5. **Respect rate limits** - Google Calendar has daily quota limits

## Exercises

### Easy
1. List next 7 days of events
2. Create a simple one-hour event
3. Get a specific event by ID

### Medium
1. Create an all-day event
2. Search for events containing "meeting"
3. Update event location

### Hard
1. Find next available 1-hour slot for multiple attendees
2. Implement sync to local storage
3. Handle recurring event expansion
