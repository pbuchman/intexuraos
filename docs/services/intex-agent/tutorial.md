# Intex Agent Tutorial

## Send A Supported Text Message

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

