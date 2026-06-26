# Intex Agent

Intex Agent powers WhatsApp text conversations. It keeps a per-user session open, turns a supported message into one direct tool call, and returns a clear WhatsApp reply to the user.

## What It Can Do

- Create notes from text messages.
- Create Google Calendar events when the title, date, start, and end are clear.
- List existing Google Calendar events for bounded date questions such as next week.
- Count matching Google Calendar events for bounded date questions such as last month.
- Create research drafts for multi-model review.
- Save links as bookmarks.
- Create code tasks, defaulting to planning mode.

## WhatsApp Session Continuity

After a reply, the session returns to `waiting_for_user` instead of closing. Follow-up messages reuse the same session until the user starts a new session or the configured timeout expires. The session transcript includes prior user messages, assistant replies, clarification requests, and completed tool summaries.

Users can start fresh with `/new`, `new session`, `start new session`, `start over`, or `forget this and start over`.

## Intent Gate

Intex Agent exposes tools only when the message has explicit create/save intent for one supported resource. Bare `http://` and `https://` URL shares are the exception and route to bookmark creation. Read-only calendar list/count questions route only through `query_calendar_events`; other read-only personal-data requests return an unsupported reply instead of being converted into another action.

## Current Limits

Voice messages are not supported yet. WhatsApp audio receives an explicit text reply asking the user to send text. General approval workflows, reminders, standalone project-tracker issue creation, and broad assistant actions are also outside the current Intex tool boundary.
