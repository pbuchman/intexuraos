# Calendar Agent

Google Calendar integration with intelligent event preview and natural language scheduling.

## The Problem

Users need calendar management without leaving IntexuraOS:

1. **Event creation** - Schedule meetings and appointments from natural language
2. **Preview before commit** - See what will be created before approving
3. **Availability checking** - Find free slots for scheduling
4. **Multi-calendar support** - Work with primary and secondary calendars

## How It Helps

### Natural Language Event Creation

Transform casual messages into calendar events with AI extraction.

**Example:** User says "Dentist appointment next Tuesday at 2pm for 1 hour" via WhatsApp. The system extracts event details, generates a preview, and waits for approval before creating the Google Calendar event.

### Event Preview Generation

See exactly what will be created before committing. The preview includes:

- Event summary (title)
- Start and end times
- Duration calculation (e.g., "1 hour 30 minutes")
- All-day event detection
- Location and description
- LLM reasoning for transparency

**Example:** Before creating "Team standup tomorrow 10am", you see: Summary: "Team standup", Start: "2026-01-25T10:00:00", Duration: "30 minutes", reasoning explaining how it interpreted "tomorrow".

### Full CRUD Operations

Complete control over calendar events with standard REST operations.

**Operations:**

- `listEvents` - List with time range, search, pagination
- `getEvent` - Get single event by ID
- `createEvent` - Create new event
- `updateEvent` - Patch existing event
- `deleteEvent` - Remove event
- `getFreeBusy` - Check availability across calendars

### Direct Google Calendar Links

When calendar events are created through natural language actions, the response includes the Google Calendar `htmlLink` pointing directly to the event in Google Calendar. This allows approvals (e.g., in WhatsApp) to link users straight to their newly created event rather than an internal calendar page.

**Example:** After approving "Meeting tomorrow at 3pm", the WhatsApp confirmation message links directly to `https://calendar.google.com/calendar/event?eid=...` so the user can view or edit the event in Google Calendar immediately.

### Failed Event Recovery

When extraction fails (ambiguous dates, missing info), events are saved for manual review rather than lost. Failed events can be retried directly if start/end times are present, or deleted to dismiss.

**Example:** "Meeting sometime next week" is too vague for automatic creation. The failed event is stored with the LLM's reasoning, allowing you to manually complete the details later.

### LLM Extraction Repair

When the initial LLM extraction produces invalid JSON or fails schema validation, the service automatically sends a repair prompt with the error details. This self-healing mechanism reduces failed extractions without user intervention.

**Example:** If the LLM returns malformed JSON like `{summary: "Meeting"...`, the repair prompt includes the raw response and the specific parse error, giving the LLM a second chance to produce valid output.

### Improved Date Parsing

Date context now includes the day of week alongside the date, enabling accurate interpretation of relative date expressions in any language (e.g., Polish "nastepny czwartek" for "next Thursday"). Date-only formats (YYYY-MM-DD) are supported for all-day events.

## Use Cases

### Voice-to-Calendar Flow

1. User sends "Schedule dentist Tuesday 3pm" via WhatsApp
2. commands-agent classifies as `calendar` action
3. actions-agent creates action and publishes to `calendar-preview` topic
4. calendar-agent generates preview asynchronously (pending -> ready)
5. If LLM response is malformed, automatic repair attempt is made
6. UI polls preview status and displays when ready
7. User approves preview
8. calendar-agent creates Google Calendar event using preview data (skips LLM)
9. Response includes direct Google Calendar link as resourceUrl
10. Preview is cleaned up after successful creation

### Check Availability Flow

1. User asks "When is everyone free next week?"
2. Frontend calls getFreeBusy with team calendars
3. Returns busy slots for each calendar
4. UI shows available time windows

### List Upcoming Events Flow

1. Dashboard loads user's calendar
2. Calls listEvents with timeMin=now
3. Displays next 10 events

## Key Benefits

**Preview before commit** - See exactly what will be created with duration and all-day detection

**Natural language** - No need for structured input, AI extracts event details

**Direct event links** - Created events return Google Calendar URLs for immediate access

**Failed event recovery** - Vague requests are saved for manual completion with retry and delete support

**Self-healing extraction** - Automatic repair prompt when LLM returns invalid output

**Native Google Calendar** - Works directly with user's existing calendar

**Multi-calendar** - Access to primary, secondary, and shared calendars

**Non-blocking cleanup** - Preview deletion does not block event creation response

## Limitations

**Google only** - No support for Outlook, Apple Calendar, or other providers

**OAuth required** - User must connect Google account via user-service

**Rate limits** - Subject to Google Calendar API quotas

**No recurring events** - Recurring event expansion not supported

**No reminders** - Reminder management not exposed

**No colors** - Event color customization not available

**No attachments** - File attachments not supported

---

_Part of [IntexuraOS](../overview.md) - Schedule events with natural language._
