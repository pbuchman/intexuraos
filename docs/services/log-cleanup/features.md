# Log Cleanup

The quiet janitor that keeps IntexuraOS running lean. Every night, while no one is watching, it sweeps out old execution logs so the system stays fast, storage costs stay low, and no one ever has to think about it.

## The Problem

Every time an AI agent runs a task — researching a topic, writing code, answering a question — it generates execution logs. These logs are useful for debugging and accountability, but they accumulate relentlessly. A busy week can produce thousands of log entries. Left unchecked, they bloat the database, slow down queries, degrade performance, and quietly inflate cloud storage bills.

The insidious part is that log growth is invisible until it becomes a crisis. One day the dashboard loads in two seconds; six months later, it takes twelve. No single log entry caused the problem. The sheer volume did.

Manual cleanup is not a realistic option. It requires remembering to do it, knowing what is safe to delete, and having the discipline to do it regularly. In practice, no one does. The logs just pile up.

## Use Case: 3 AM, Every Night

It is three in the morning. The system's users are asleep. The AI agents are idle.

Log Cleanup wakes up on schedule. It identifies execution logs older than the retention window — records that have served their purpose and are no longer needed for debugging or auditing. It deletes them in controlled batches, logs the results, and goes back to sleep.

By morning, the database is lighter. Queries run the same speed they did last week. Storage costs have not crept up. No one had to lift a finger, open a terminal, or remember that log retention was even a concern.

If something goes wrong — the deletion service is temporarily unavailable, a batch fails partway through — the job retries automatically. The next night, it picks up where it left off. Logs that survived one cycle get caught in the next.

## How It Helps

### Costs That Never Spiral

Cloud database storage is priced by volume. Execution logs are write-heavy and read-rarely — the worst combination for cost efficiency. By enforcing a retention window automatically, Log Cleanup ensures the system only pays to store data that still has diagnostic value. Old logs are disposed of before they become expensive dead weight.

### Performance That Does Not Degrade

Database queries slow down as collections grow. Indexes get larger, scans take longer, and response times creep upward in ways that are hard to attribute to any single cause. Nightly cleanup keeps collection sizes bounded, so the system performs as well on day three hundred as it did on day one.

### Operations No One Has to Manage

The entire process is hands-off. There is no configuration to maintain, no schedule to remember, no runbook to follow. It runs every night with sensible defaults. For teams that want finer control, retention period and batch sizes are adjustable — but the defaults work well enough that most users will never need to touch them.

## Key Benefits

- **Automatic retention** — Old execution logs are removed on a nightly schedule with no manual intervention required
- **Controlled deletion** — Logs are removed in batches, not all at once, so the cleanup process itself does not strain the system
- **Self-healing** — If a nightly run fails, the next run catches what was missed. No logs slip through permanently
- **Configurable** — Retention window and batch sizes can be tuned for teams with specific compliance or debugging needs

## Limitations

- **Dependent on the code agent** — Log Cleanup delegates the actual deletion to the code agent service. If that service is down, cleanup is deferred until the next successful run.
- **No real-time alerts** — Failures are logged but do not trigger notifications. Persistent failures require checking logs to discover.
- **No dry-run mode** — There is no way to preview what would be deleted before it happens. The retention window is the only safeguard.
- **Nightly cadence only** — Cleanup runs once per day. During periods of unusually high activity, logs may accumulate faster than a single nightly pass can clear.

---

_Part of [IntexuraOS](../overview.md) — Automated housekeeping that keeps the system fast and the bills low._
