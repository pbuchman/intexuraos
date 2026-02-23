# Calendar Agent

Say it, it's on your calendar. Voice-to-calendar scheduling that works with the Google Calendar you already use.

## The Problem

Scheduling should take less effort than the event itself. Instead, most calendar workflows demand that you stop what you are doing, open a calendar app, tap through a form, pick a date from a grid, set a start time, set an end time, type a title, and hit save. Seven steps for a dentist appointment. And if the thought occurs to you while you are talking, driving, or mid-conversation on WhatsApp, the appointment lives in your memory until you get around to entering it -- which, often enough, means it never gets entered at all.

The friction is not in the calendar. It is in the distance between thinking "I need to schedule this" and the event actually appearing on your calendar.

## Use Case: From Voice Note to Calendar Event

You are in a WhatsApp conversation when you remember an appointment. You send a voice note: "Dentist next Tuesday at 3pm." That is the entire interaction on your end.

Behind the scenes, the system interprets your message, extracts the event details, and generates a preview. When you open your dashboard, the preview is waiting: event title, date, start and end times, duration, and a brief explanation of how the system interpreted your words. You glance at it, confirm it looks right, and tap approve. The event appears in your Google Calendar. No form. No app-switching. No typing.

If you had said "holiday on March 15th" without mentioning a time, the system would have recognized it as an all-day event and set it up accordingly. If you had included a location -- "Lunch at Cafe Moro, Friday noon" -- the location would appear in the preview too.

## How It Helps

### Preview Before You Commit

Nothing reaches your calendar without your approval. Every event the system extracts from your words is presented as a preview first. You see the title, the start and end times, the calculated duration in plain language ("1 hour 30 minutes"), whether it is an all-day event, and any location or description the system detected. You also see the reasoning -- how the AI interpreted what you said -- so there are no surprises. Approve it, and the event is created. The AI is only involved once, during the preview. When you approve, the event is created directly from the preview data, with no second round of interpretation.

### Any Language, Any Phrasing

The system does not require English or any particular sentence structure. It understands relative date expressions in any language. A Polish speaker can say "nastepny czwartek o dziesiatej" -- next Thursday at ten -- and the system resolves the correct date, because it knows what day of the week "today" is and can count forward in any language. The same applies to informal phrasing, abbreviations, and conversational shorthand. You describe the event the way you would tell a friend, and the system figures out the rest.

### Your Existing Google Calendar

Calendar-agent works with the Google Calendar you already use. Your primary calendar is the default, but it also supports secondary and shared calendars. There is no new calendar system to learn, no migration, no parallel universe of events. Check your availability across multiple calendars, list upcoming events, update or cancel existing ones -- all through the same interface, all synced to Google.

### Availability at a Glance

Need to find a free slot? Query availability across one or more calendars for any time range. The system returns the busy periods for each calendar, so you can identify open windows without flipping between tabs.

### Events with Attendees

When you create or update an event, you can include attendee email addresses. Invitations are handled through Google Calendar's native system -- no separate notification mechanism.

### When the AI Cannot Figure It Out

Not every message contains enough information for an event. "Meeting sometime next week" is too vague -- there is no date, no time, no duration. Rather than discard these ambiguous requests, the system saves them to a review list. You can see what the AI attempted to extract, retry the ones that have enough detail, or dismiss the ones that do not. Nothing is lost to a silent failure.

## Key Benefits

- **Voice-to-calendar in seconds** -- Describe an event in natural language from WhatsApp and it appears as a preview, ready for approval
- **Preview before commit** -- See exactly what will be created, including duration and all-day detection, before anything touches your calendar
- **Multilingual understanding** -- Works with relative dates and natural phrasing in any language, including Polish
- **All-day event detection** -- Mention a date without a time and the system creates an all-day event automatically
- **Multi-calendar support** -- Access primary, secondary, and shared Google Calendars from one place
- **Availability checking** -- Query free/busy status across multiple calendars for any time range
- **Failed event recovery** -- Vague requests are saved for review, not silently discarded
- **No new system to learn** -- Events live in your existing Google Calendar

## Limitations

- **Google Calendar only** -- No support for Outlook, Apple Calendar, or other providers
- **Google account connection required** -- You must connect your Google account before calendar features work; a clear error explains what is missing if you have not
- **Google API rate limits** -- Subject to Google Calendar API quotas for high-volume usage
- **No recurring events** -- Single events only; recurring event patterns are not supported
- **No reminders** -- Reminder configuration is not available through the agent
- **No event colors** -- Color customization is not exposed
- **No attachments** -- File attachments on events are not supported

---

_Part of [IntexuraOS](../overview.md) -- Say it, it's on your calendar._
