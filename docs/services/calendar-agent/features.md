# Calendar Agent

Google Calendar integration - create, read, update, and delete events, plus check availability across calendars.

## The Problem

Users need calendar management without leaving IntexuraOS:

1. **Event creation** - Schedule meetings and appointments
2. **Availability checking** - Find free slots for scheduling
3. **Calendar sync** - Access Google Calendar data
4. **Multi-calendar support** - Work with multiple calendars

## How It Helps

Calendar-agent provides full Google Calendar API access:

1. **CRUD operations** - Create, read, update, delete events
2. **Free/busy queries** - Check availability across calendars
3. **Search** - Full-text search across events
4. **Attendee management** - Add attendees with response tracking
5. **Multi-calendar** - Support for primary and secondary calendars
6. **All-day events** - Support for both timed and all-day events

## Key Features

**Event Types:**

- Timed events (with dateTime and timeZone)
- All-day events (with date only)

**Operations:**

- `listEvents` - List with time range, search, pagination
- `getEvent` - Get single event by ID
- `createEvent` - Create new event
- `updateEvent` - Patch existing event
- `deleteEvent` - Remove event
- `getFreeBusy` - Check availability

**Search & Filter:**

- Time range (timeMin, timeMax)
- Full-text search (q parameter)
- Max results pagination
- Order by start time or updated time

## Use Cases

### Schedule meeting flow

1. User says "Schedule team standup tomorrow at 10am"
2. commands-agent classifies as `calendar`
3. calendar-agent creates event via createEvent
4. Attendees receive Google Calendar invitations

### Check availability flow

1. User asks "When is everyone free next week?"
2. Frontend calls getFreeBusy with team calendars
3. Returns busy slots for each calendar
4. UI shows available time windows

### List upcoming events flow

1. Dashboard loads user's calendar
2. Calls listEvents with timeMin=now
3. Displays next 10 events

## Key Benefits

**Native Google Calendar** - Works directly with user's existing calendar

**Attendee tracking** - Response status (accepted, declined, tentative, needsAction)

**Multi-calendar** - Access to primary, secondary, and shared calendars

**Search** - Full-text search across event titles and descriptions

**All-day support** - Proper handling of date-only events

**OAuth integration** - Uses user-service for token management

## Limitations

**Google only** - No support for Outlook, Apple Calendar, or other providers

**OAuth required** - User must connect Google account via user-service

**Rate limits** - Subject to Google Calendar API quotas

**No reminders** - Reminder management not exposed

**No recurring events** - Recurring event expansion not supported

**No colors** - Event color customization not available

**No attachments** - File attachments not supported
