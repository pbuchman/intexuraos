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
- Save images, pasted text, and explicitly shared links to an external processing/storage endpoint.

## WhatsApp Session Continuity

After a reply, the session returns to `waiting_for_user` instead of closing. Follow-up messages reuse the same session until the user starts a new session or the configured timeout expires. The session transcript includes prior user messages, assistant replies, clarification requests, and completed tool summaries.

Users can start fresh with `/new`, `new session`, `start new session`, `start over`, or `forget this and start over`.

## Intent Gate

Intex Agent exposes tools only when the message has explicit create/save intent for one supported resource. Bare `http://` and `https://` URL shares are the exception and route to bookmark creation. Messages that say "save externally", "upload externally", "save for processing", "zapisz zewnętrznie", "prześlij zewnętrznie", or "zapisz do przetworzenia" route to external save instead. Read-only calendar list/count questions route only through `query_calendar_events`; other read-only personal-data requests return an unsupported reply instead of being converted into another action.

## External Save

External Save is configured in Intex Agent Configuration. The user needs an endpoint URL, Cloudflare Access Client ID, Cloudflare Access Client Secret, and source label. The default source label is `ios-shortcuts`.

When enabled, WhatsApp image messages are automatically saved externally. If the image has a caption, the caption is sent as `message`; otherwise Intex sends `Image shared via WhatsApp.`. Shared links with external-save intent are passed as `source_url` without fetching or inspecting the URL.

## Current Limits

Voice messages are not supported yet. WhatsApp audio receives an explicit text reply asking the user to send text. General approval workflows, reminders, standalone project-tracker issue creation, and broad assistant actions are also outside the current Intex tool boundary.
