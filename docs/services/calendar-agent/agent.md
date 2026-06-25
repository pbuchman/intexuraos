# Calendar Agent Reference

Calendar Agent owns Google Calendar event creation, calendar connection checks, failed-event recovery, and preview data still used by current dashboard flows.

## Current Callers

- Web dashboard public routes.
- Intex direct calendar tool calls.
- Trusted internal clients that create calendar events.

## Internal Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/internal/calendar/events` | Create a calendar event from a trusted service |
| `POST` | `/internal/calendar/preview` | Generate a synchronous event preview |
| `GET` | `/internal/calendar/preview/:actionId` | Fetch a stored preview by ID |

Do not reintroduce retired async preview topics or removed action orchestration callers.

