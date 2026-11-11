# Calendar Agent Technical Debt

## Current Watch Points

- Keep calendar event creation and failed-event recovery tested against Google API failures.
- Preserve explicit clarification behavior when Intex does not have enough event detail.
- Keep preview storage isolated from retired async topic flows.

## Release Watch Points

- Preserve optimistic ETag checks and complete attendee reads before confirmed updates; multi-event updates can partially succeed.
- Keep daily schedule DST calculations, local-date deduplication, delivery setup failures, leases, and retry recovery covered.
- Preserve current-time lookahead, receipt reconciliation, six-hour pending expiry, and the distinction between Matrix acceptance, readiness, execution stage, and final WhatsApp delivery. Acknowledgments must never satisfy final delivery.
- Preserve durable scheduler heartbeats and change-driven monitoring watches when adding schedule writers.
- Do not conflate daily lookahead with per-event reminder editing or restore retired voice/async preview flows.

## Future Work

- Revisit whether stored preview records are still needed for current dashboard flows.
- Add stronger timezone diagnostics for ambiguous natural-language event requests.

