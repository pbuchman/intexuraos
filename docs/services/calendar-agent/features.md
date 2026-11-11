# Calendar Agent

Say it, it's on your calendar. Calendar scheduling that starts in WhatsApp — where the thought actually occurs — and lands in the Google Calendar you already use.

## The Problem

You remember the dentist appointment while you are mid-conversation on WhatsApp. You remember the team lunch while walking to the car. You remember the parent-teacher meeting while cooking dinner. In each case, the thought arrives at the worst possible moment — when opening a calendar app, navigating to the right date, filling in a title, picking a start time, picking an end time, and hitting save feels like an unreasonable amount of effort for a single appointment.

So you tell yourself you will add it later. Sometimes you do. Often you do not. The appointment slips out of short-term memory and never makes it onto the calendar. The problem was never the calendar itself — it was the seven-step form standing between the thought and the event.

Scheduling can start with a short text in the conversation you already have open.

## Use Case: Plan And Adjust From WhatsApp

1. Send a text such as “Dentist next Tuesday at 15:00 for 45 minutes.”
2. Intex resolves missing details and presents the proposed event for confirmation. With no end or duration, it shows a 60-minute default in that confirmation.
3. Ask “What is on my calendar tomorrow?” or “How many meetings did I have last month?” for a bounded calendar query.
4. Ask to move an existing event or add an attendee. Intex first looks up the exact event, resolves ambiguous matches, and asks you to confirm the change.
5. Several identified event updates can share one confirmation. They remain independent operations, so a failure does not roll back earlier successful updates.

Intex accepts text for this flow; voice commands remain unsupported.

## Recent Changes

The existing daily lookahead now exposes its latest execution stage, final WhatsApp delivery status, and delivery confirmation time. This separates a request accepted by Matrix from a summary actually delivered through WhatsApp.

## How It Helps

### Review Intex Changes Before They Reach Your Calendar

Intex asks for missing title, date, or start details and displays a confirmation before creating or changing an event. Confirmed updates preserve fields you did not request to change and reject a stale event snapshot if the calendar changed after review. The separate internal preview API remains available for trusted callers; direct Calendar API callers own their own authorization and review flow.

### Write In Natural Language — "Pojutrze Rano" Works as Well as "Tomorrow at 9"

Natural-language parsing supports conversational English and Polish. It understands relative date expressions — "next Thursday," "this weekend," "in two days" — in supported phrasing. A Polish speaker can write "nastepny czwartek o dziesiatej" and the system resolves the correct date, because it knows what day of the week today is and can count forward accordingly.

The same applies to informal phrasing, abbreviations, and conversational shorthand. You describe the event the way you would tell a friend. The system figures out the structure.

**Example:** You say "Obiad z mama w sobote o pierwszej" — lunch with mom, Saturday at one. The system parses the Polish, identifies Saturday's date, sets a 1:00 PM start time, and presents the preview. No language toggle, no settings page, no translation layer you need to think about.

### Work With the Calendar You Already Have

Calendar Agent connects to the Google Calendar you already use. Your primary calendar is the default, but secondary and shared calendars are available too. There is no new calendar system to learn, no migration, no separate universe of events that you have to reconcile with your real schedule.

You can list upcoming events with filters — by calendar, by time range, by keyword. You can update an event with partial changes or delete one entirely. You can query free/busy status across multiple calendars at once to find open windows without flipping between tabs.

**Example:** You need to find a free hour for a call this week. You check availability across your primary calendar and the shared team calendar. The system shows you the busy periods on each, and you spot a clear window on Wednesday afternoon.

### Add Attendees Without Leaving the Flow

When you create or update an event through the dashboard, you can include attendee email addresses. Invitations go out through Google Calendar's native system — the same invitations your attendees are used to receiving, with the same accept/decline/maybe buttons.

**Example:** You create a "Product review Friday at 2pm" event and add your co-founder's email. The event lands on both calendars with a standard Google Calendar invitation.

### Receive A Daily Calendar Lookahead

Enable daily lookahead with a local time and IANA time zone. The schedule checks the private WhatsApp delivery setup and starts a new Intex session with a request for events in the next 24 hours. You can pause it without deleting your calendar events.

The lookahead uses the current time when Intex processes the request. Schedule settings show the latest run's progress and delivery outcome separately from connection readiness. A preparation acknowledgment does not count as a delivered summary; every part of the final reply needs delivery or read confirmation.

### Recover Failed Extractions

The Calendar API retains failed-event review and retry routes. Intex’s conversational path instead asks for missing information before requesting confirmation. These are separate entry points; an incomplete WhatsApp request is not automatically a failed-extraction dashboard record.

## Getting Connected

Connect your Google account through your IntexuraOS profile settings. Once linked, Calendar Agent can read and write to your calendars. If you have not connected yet, the system tells you clearly what is missing and how to fix it — no cryptic error, no silent failure.

## Key Benefits

- **Text to calendar** — describe an event and confirm the complete proposal in WhatsApp
- **Preview before commit** — see exactly what will be created, including duration, all-day detection, and the AI's reasoning, before anything touches your calendar
- **Natural phrasing** — describe dates conversationally, including in Polish
- **Your existing Google Calendar** — primary, secondary, and shared calendars with no migration and no parallel system
- **Availability across calendars** — query free/busy status across multiple calendars for any time range
- **Visible missing details** — Intex asks for clarification; failed API extractions have a separate recovery view

## Limitations

- **Built for Google Calendar** — deep integration with primary, secondary, and shared calendars; no support for Outlook, Apple Calendar, or other providers
- **Google account required** — you must connect your Google account before calendar features work; the system explains what is missing if you have not
- **Google-imposed volume limits** — if you send a very high volume of requests in a short period, Google may temporarily pause new calendar updates
- **No recurring events** — single events only; weekly standup patterns and similar repetitions are not supported
- **No event reminder editing** — daily lookahead is supported, but per-event reminder configuration is not exposed
- **No event colors** — color customization is not exposed
- **No file attachments** — you cannot attach files to events through the agent

---

_Part of [IntexuraOS](../overview.md) — Say it, it's on your calendar._
