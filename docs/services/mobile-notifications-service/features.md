# Mobile Notifications Service

Capture and store mobile device notifications through a secure webhook pipeline with signature-based authentication.

## The Problem

Important notifications arrive on your phone throughout the day -- messages, app alerts, system events -- but they vanish from your notification shade and are impossible to search or analyze later. There is no centralized way to capture, persist, and query the stream of notifications flowing through a mobile device. Traditional approaches require installing heavyweight apps or giving up privacy to third-party services.

## How It Helps

### Secure Device Pairing via Signature Tokens

Connect any Android device with a single API call. The service generates a crypto-secure 256-bit token, returns it once, and stores only the SHA-256 hash. The device uses this token as a header on every webhook call, and the service validates it by hash comparison -- plaintext is never stored.

**Example:** A user pairs their Pixel phone by calling the connect endpoint. They receive a signature token, configure it in Tasker, and every notification from that phone is now securely routed to their account.

### Automatic Notification Capture via Webhooks

Mobile automation apps (Tasker, Automate) send notification data to a webhook endpoint. The service validates the signature, deduplicates by device-provided notification ID, and persists the notification in Firestore -- all in a single request.

**Example:** WhatsApp messages, Slack notifications, and calendar reminders are all captured as they appear on the device, with full metadata (app name, title, body, timestamp, device name).

### Filtered Browsing with Saved Presets

Users can list notifications with filters (by app, source, device, or title search) and save frequently-used filter combinations as named presets. Filter options auto-populate from received notifications, so the UI always reflects available data.

**Example:** A user creates a "Work Chats" saved filter for Slack and Teams notifications. When they open the notification view, they select this preset and see only work-related messages.

### Internal Query API for Data Aggregation

Other services (such as data-insights-agent) query notifications via an internal endpoint for composite feeds and analytics, without direct Firestore access.

**Example:** The data-insights-agent pulls the latest 50 WhatsApp notifications to generate a daily communication summary.

## Use Case

A user installs Tasker on their Android phone and pairs it with IntexuraOS by calling `POST /mobile-notifications/connect`. They receive a signature token, which they configure in Tasker's HTTP Request task. From that point, every notification that appears on the phone is forwarded to the webhook endpoint with the signature header.

When the user opens the IntexuraOS dashboard, they see a paginated feed of all captured notifications. They filter by app to see only WhatsApp messages, then save this filter as "WhatsApp" for quick access. Meanwhile, the data-insights-agent uses the internal query endpoint to build a daily activity summary from the same notification data.

## Key Benefits

- Zero-knowledge security: plaintext signature shown once, only SHA-256 hash stored
- Automatic deduplication via device-provided notification IDs
- Self-populating filter options require no manual configuration
- Paginated browsing with cursor-based navigation for large notification volumes
- Full audit trail with server-side timestamps for every captured notification

## Limitations

- **Android only** -- requires Tasker or Automate app; no iOS support yet
- **Signature shown once** -- lost tokens require creating a new connection (which replaces the previous one)
- **No push-back** -- captures and stores notifications but does not push them back to devices
- **No media attachments** -- stores text content only; images and rich media are not captured
- **Single signature per user** -- creating a new connection deletes any previous signature

---

_Part of [IntexuraOS](../overview.md) -- Capture your mobile notifications, anywhere they happen._
