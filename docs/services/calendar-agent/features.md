# Calendar Agent

Say it, it's on your calendar. Calendar scheduling that starts in WhatsApp — where the thought actually occurs — and lands in the Google Calendar you already use.

## The Problem

You remember the dentist appointment while you are mid-conversation on WhatsApp. You remember the team lunch while walking to the car. You remember the parent-teacher meeting while cooking dinner. In each case, the thought arrives at the worst possible moment — when opening a calendar app, navigating to the right date, filling in a title, picking a start time, picking an end time, and hitting save feels like an unreasonable amount of effort for a single appointment.

So you tell yourself you will add it later. Sometimes you do. Often you do not. The appointment slips out of short-term memory and never makes it onto the calendar. The problem was never the calendar itself — it was the seven-step form standing between the thought and the event.

What if scheduling took exactly as long as saying the words out loud?

## Use Case: A Week of Voice Scheduling

You are a founder who splits time between Warsaw and London, switches between Polish and English without thinking about it, and treats WhatsApp as your primary inbox.

1. Monday morning, mid-conversation, you send a voice note: "Dentist next Tuesday at 3pm." That is the entire interaction on your end.
2. The system interprets your message, extracts the event details, and builds a preview. When you check your dashboard, the preview is waiting — event title, date, start and end times, duration in plain language, and a short explanation of how the AI read your words. You glance at it, confirm it looks right, and approve. The event appears in your Google Calendar.
3. Tuesday, you dictate in Polish: "Nastepny czwartek o dziesiatej, spotkanie z Markiem." The system knows what day it is, counts forward to Thursday, and presents a preview with the correct date and a 10:00 start time. No translation step, no confusion about relative dates.
4. Wednesday, you say "Holiday on March 15th" without mentioning a time. The system recognizes there is no time component and sets it up as an all-day event.
5. Thursday, you say "Lunch at Cafe Moro, Friday noon." The preview includes the location — Cafe Moro — alongside the date and time. You approve, and the event lands in your calendar with the location field filled in.
6. Friday, you mumble something vague into a voice note: "Meeting sometime next week." There is no date, no time, no duration — not enough to build an event. Rather than discard it, the system saves the attempt to a review list where you can see what the AI tried to extract, retry it with more detail, or dismiss it.

Six moments across a week. None of them required opening a calendar app, tapping through a form, or typing a single character.

## How It Helps

### Preview Everything Before It Touches Your Calendar

Nothing reaches your Google Calendar without your say-so. Every event the system extracts from your words is presented as a preview first. You see the title, the proposed start and end times, the calculated duration in plain language — "1 hour 30 minutes" rather than a pair of timestamps — whether it is flagged as an all-day event, and any location or description the system picked up. You also see the AI's reasoning: how it interpreted your phrasing, why it chose a particular date, what assumptions it made.

This is not a rubber-stamp step. It is where you catch mistakes before they happen. If the system read "next Tuesday" as the wrong Tuesday, you see it in the preview and correct it — before the event exists.

The agent commits to a single interpretation rather than asking clarifying questions — the preview exists precisely so you can reject a bad parse without the agent needing to query you mid-flow. When you approve, the event is created directly from the preview data. There is no second round of interpretation, no chance for the system to change its mind between your approval and the calendar entry.

**Example:** You say "Coffee with Anna, Thursday 4pm, Blue Bottle on Broad Street." The preview shows the title ("Coffee with Anna"), the date (this Thursday), the start time (4:00 PM), and the location (Blue Bottle on Broad Street). You approve it in one tap.

### Speak Any Language — "Pojutrze Rano" Works as Well as "Tomorrow at 9"

The system does not require English, formal grammar, or any particular sentence structure. It understands relative date expressions — "next Thursday," "this weekend," "in two days" — in any language. A Polish speaker can say "nastepny czwartek o dziesiatej" and the system resolves the correct date, because it knows what day of the week today is and can count forward accordingly.

The same applies to informal phrasing, abbreviations, and conversational shorthand. You describe the event the way you would tell a friend. The system figures out the structure.

**Example:** You say "Obiad z mama w sobote o pierwszej" — lunch with mom, Saturday at one. The system parses the Polish, identifies Saturday's date, sets a 1:00 PM start time, and presents the preview. No language toggle, no settings page, no translation layer you need to think about.

### Work With the Calendar You Already Have

Calendar Agent connects to the Google Calendar you already use. Your primary calendar is the default, but secondary and shared calendars are available too. There is no new calendar system to learn, no migration, no separate universe of events that you have to reconcile with your real schedule.

You can list upcoming events with filters — by calendar, by time range, by keyword. You can update an event with partial changes or delete one entirely. You can query free/busy status across multiple calendars at once to find open windows without flipping between tabs.

**Example:** You need to find a free hour for a call this week. You check availability across your primary calendar and the shared team calendar. The system shows you the busy periods on each, and you spot a clear window on Wednesday afternoon.

### Add Attendees Without Leaving the Flow

When you create or update an event through the dashboard, you can include attendee email addresses. Invitations go out through Google Calendar's native system — the same invitations your attendees are used to receiving, with the same accept/decline/maybe buttons.

**Example:** You create a "Product review Friday at 2pm" event and add your co-founder's email. The event lands on both calendars with a standard Google Calendar invitation.

### Recover What the AI Could Not Parse

Not every voice note contains enough information for a calendar event. Some are too vague. Some trail off mid-sentence. Rather than discard these, the system saves them to a review list. You can see what the AI attempted to extract — maybe it caught a title and a rough date but no time — and decide what to do. If the start and end times are present, you can retry. If the message was genuinely useless, you dismiss it. Nothing disappears into a silent failure.

Most voice scheduling tools silently drop what they cannot parse. You never know the message was lost until you realize the event is not on your calendar — days later, if at all. Calendar Agent takes the opposite approach: every attempt is visible, every failure is recoverable, and you decide what to do with the ambiguous ones.

**Example:** You said "Catch up with Jakub sometime next week" — no day, no time. The system saves it with the AI's best attempt: it extracted the title and a rough week, but no specific slot. You dismiss it from the review list and send a new voice note with more detail: "Catch up with Jakub, Wednesday 11am." This time, the preview generates cleanly.

## Getting Connected

Connect your Google account through your IntexuraOS profile settings. Once linked, Calendar Agent can read and write to your calendars. If you have not connected yet, the system tells you clearly what is missing and how to fix it — no cryptic error, no silent failure.

## Key Benefits

- **Voice to calendar in seconds** — describe an event in natural language and it appears as a preview, ready for one-tap approval
- **Preview before commit** — see exactly what will be created, including duration, all-day detection, and the AI's reasoning, before anything touches your calendar
- **Any language, any phrasing** — relative dates and natural expressions work in any language, including Polish
- **Your existing Google Calendar** — primary, secondary, and shared calendars with no migration and no parallel system
- **Availability across calendars** — query free/busy status across multiple calendars for any time range
- **Nothing silently lost** — vague or incomplete requests are saved for review, not discarded

## Limitations

- **Built for Google Calendar** — deep integration with primary, secondary, and shared calendars; no support for Outlook, Apple Calendar, or other providers
- **Google account required** — you must connect your Google account before calendar features work; the system explains what is missing if you have not
- **Google-imposed volume limits** — if you send a very high volume of requests in a short period, Google may temporarily pause new calendar updates
- **No recurring events** — single events only; weekly standup patterns and similar repetitions are not supported
- **No reminders** — reminder configuration is not available through the agent
- **No event colors** — color customization is not exposed
- **No file attachments** — you cannot attach files to events through the agent

---

_Part of [IntexuraOS](../overview.md) — Say it, it's on your calendar._
