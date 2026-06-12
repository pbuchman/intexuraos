# Mobile Notifications Service

Your phone's notifications, inside the platform — captured, structured, and ready for analysis alongside everything else. Now with AI-generated daily digests that distill WhatsApp group chatter into actionable summaries and provide Fishing Assistant with grounded digest and message history.

## The Problem

Dozens of notifications arrive on your phone each day — banking alerts, delivery updates, fitness milestones, app reminders. Each one is a data point about your life. But they scroll past in seconds, trapped in a notification shade with no search, no filtering, and no connection to anything else.

The real loss is not individual alerts. It is the pattern. When notifications from different apps never meet in one place, the connections stay invisible. These patterns only emerge when the data is collected, structured, and available for analysis.

High-traffic WhatsApp groups make this worse. Hundreds of messages pile up daily. Catching up means scrolling through noise, missing important threads, and losing context. Manual summarization is impractical.

## Use Case: Turning Alerts into Insight

You run a small business. Payment confirmations, supplier alerts, delivery updates, and scheduling reminders arrive on your phone all day. You connect your phone to the platform once, and from that point every notification flows into IntexuraOS automatically — filterable by app, searchable by title, browsable in full.

The real value emerges when you combine notifications with the platform's analysis tools. The AI queries your history directly — pulling banking alerts alongside a sales spreadsheet, surfacing a correlation between supplier timing and cash flow dips you never noticed from the alerts alone.

## How It Helps

### WhatsApp Group Digest Pipeline

Subscribe to a WhatsApp group, and every morning an AI-generated digest lands in your WhatsApp. The LLM reads the day's messages, tracks conversation threads, identifies moderator posts, spots activity outliers, and produces a headline-and-bullets summary. Each digest builds on persistent group state — the AI remembers who is who, which threads are open, and what was discussed yesterday.

**Example:** A fishing community group sends 200 messages a day. Instead of scrolling, you receive a digest with a headline like "New tournament rules announced; debate on catch limits continues" followed by 3-7 bullet points covering the key topics, plus a link to the full digest in the web app.

### Fishing Assistant Evidence

Fishing Assistant can ask this service which digest groups a user is subscribed to, search persisted digest summaries, retrieve the latest group state, and query cleaned WhatsApp group messages by date range. That lets the chat answer questions from both curated daily summaries and supporting message history, while keeping subscription ownership and raw notification access inside mobile-notifications-service.

**Example:** You ask the Fishing Assistant what the fishing group discussed about a lake between two dates. The assistant lists your digest subscriptions, searches matching digests and cleaned group messages, and cites the returned digest or message evidence in its answer.

### One-Time Connection, Continuous Capture

Connect your phone once. The setup returns a secure credential shown exactly once — store it, and every future notification arrives automatically. Creating a new connection replaces the previous one, keeping one active link per user.

**Example:** You set up a Tasker profile that fires whenever WhatsApp receives a message. The notification is forwarded to the webhook endpoint using your device signature. From that point, every WhatsApp notification is captured automatically with no daily action required.

### Automatic Deduplication

Every notification is stored with its source, device, app name, title, content, and timestamp. Duplicates are silently ignored, keeping your history clean even when device automations retry on network failure.

**Example:** A Tasker task fires twice due to a network timeout. The first delivery creates the record; the second is silently ignored with `status: "ignored", reason: "duplicate"`. The dashboard shows the notification exactly once.

### Flexible Filtering and Search

Filter by source, app, or device, combine several at once, search by title with partial matching, and page through results at your own pace. Filter options populate automatically as notifications arrive — no setup required.

**Example:** You want to see only banking notifications. Set `app=com.abnamro.nl.mobile` and the list narrows instantly. Add `title=payment` to find specific transaction alerts.

### Saved Filter Presets

Name and save filter combinations you use often — "Banking Alerts" for your finance app, "Deliveries" for logistics notifications. Retrieve or delete them at any time.

**Example:** A user creates a saved filter called "Work Chats" targeting `app=["com.slack", "com.microsoft.teams"]`. Opening the dashboard with that filter instantly shows only work messaging notifications, regardless of how many unrelated alerts have come in.

### Digest Backfill

Missed digests for past days? Start a backfill run specifying a date range, and the service chains through each day sequentially — generating one digest per day, tracking progress, and reporting failures per-date.

**Example:** You subscribe to the digest pipeline on a Wednesday and want summaries going back to the previous Monday. You trigger a backfill for that date range, and three digests appear one by one, each building on the previous day's group state for continuity.

### Platform-Wide Data Access

Notification data is not locked inside this service. The platform's analysis tools query your notifications directly via an internal endpoint, turning your alert stream into a data source for trend detection and visualization.

**Example:** An AI agent queries all notifications from `com.whatsapp` and `com.telegram` for a user. The service returns the filtered list, which can be used to generate a daily communication summary.

## Key Benefits

- Passive capture — once connected, notifications flow in with no daily action required
- AI-powered daily digests — WhatsApp group messages distilled into headline-and-bullets summaries delivered to your WhatsApp
- Persistent group memory — the digest pipeline tracks participant identities, open threads, and moderator activity across days
- Clean history — duplicates detected and ignored automatically
- Multi-app filtering — filter by any combination of app, source, or title keyword
- Saved presets — name and save filter configurations you use repeatedly
- AI-ready data — structured for direct use by the platform's analysis and visualization tools
- Fishing Assistant support — internal digest evidence endpoints expose only owned digest subscriptions, summaries, state, and cleaned group messages
- Ownership controls — delete individual notifications at any time; only owners access their own data

## Limitations

- Android only — requires a compatible automation app on Android to forward notifications
- Credential shown once — losing the connection credential requires reconnecting, which invalidates the previous one
- No push back to device — captures notifications from your phone but does not send alerts to it
- Text-based only — notification images, icons, and rich media are not captured
- Single active connection — only one device credential is active per user at a time
- Digest subscriptions are hard-coded — adding a new WhatsApp group requires a code change (no self-service yet)
- Digest pipeline is CET-anchored — day boundaries are computed in the Europe/Warsaw timezone
- Fishing Assistant evidence is digest-subscription scoped — users without a matching hard-coded subscription receive no digest or group-message evidence from this service

---

_Part of [IntexuraOS](../overview.md) — Your phone's notifications, structured and ready for analysis._
