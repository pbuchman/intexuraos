# Intex Agent Tutorial

## Create A Note

Send a WhatsApp text message such as:

```text
Save a note: review the Q4 report before Friday
```

Intex calls `create_note` and replies with the result.

## Create A Calendar Event

Use complete event details:

```text
Schedule dentist appointment next Tuesday from 15:00 to 16:00
```

If the event is missing a title, date, start, or end, Intex asks a clarification before calling the calendar tool.

## Create A Code Task

Use a message like:

```text
Create a code task to fix the login redirect on Safari
```

The created task defaults to planning mode so the design can be reviewed before implementation.

## Save A Bookmark

Send a bare URL or ask to save a link:

```text
https://example.com/article
```

Intex routes the message to `create_link`. Words inside the URL do not count as commands for another tool.

## Continue A Session

After Intex replies, send a follow-up in the same WhatsApp conversation. The same session stays open, so clarification answers and short follow-ups are processed with the previous timeline. To force a fresh session, send:

```text
new session
```

## Unsupported Requests

Messages without explicit create/save intent or a bounded read-only calendar query do not receive tool access. For example, asking how many notes were created last month returns an unsupported reply because Intex Agent reads calendar events only.
