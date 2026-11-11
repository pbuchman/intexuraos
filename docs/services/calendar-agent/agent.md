# Calendar Agent Reference

Calendar Agent owns Google Calendar creation/query/update, daily lookahead schedules, connection checks, failed-event recovery, and internal preview data.

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

## Calendar Queries And Confirmed Updates

- `POST /internal/calendar/events/query` supports bounded list/count requests.
- `PATCH /internal/calendar/events/:eventId` updates identified events, including attendee additions/removals and supported event fields.
- Intex owns clarification and user confirmation. The update contract checks the confirmed event’s ETag and rejects stale snapshots with `CONFLICT`; unspecified fields are preserved.
- Multi-event Intex updates call the singular endpoint per event; they do not provide atomic rollback.

## Daily Lookahead

- `GET /schedules/calendar-daily-lookahead` reads the authenticated user’s schedule and delivery status.
- `PUT /schedules/calendar-daily-lookahead` accepts `enabled`, `localTime`, and `timeZone`.
- `POST /internal/calendar/schedules/tick` claims due schedules with leases and sends the fixed next-24-hours calendar request through WhatsApp’s Matrix outbound path with `startNewSession: true`.
- Scheduling follows the configured IANA zone, including DST. A per-schedule/local-date idempotency key prevents duplicate outbound requests; transport failures retry after 15 minutes, while setup-required outcomes are recorded without that transient retry.
- The lookahead starts from processing time. Read `latestRun.stage`, `latestRun.deliveryStatus`, and `latestRun.deliveredAt` separately from Matrix readiness in `delivery`; `status: sent` alone records trigger acceptance.
- Acknowledgments do not prove final delivery. Every final reply part requires delivered/read confirmation. The tick reconciles existing receipts and expires still-pending runs after six hours.
- `GET /internal/monitoring/status` requires internal auth and exposes durable tick heartbeats, notification state, and Firestore monitoring diagnostics. Status inspection does not authorize a tick or replay.

Do not reintroduce retired async preview topics or removed action orchestration callers.

