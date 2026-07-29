# Mobile Notifications Service

Mobile Notifications Service captures Android notification events, stores them for the owning user, and makes the history searchable inside IntexuraOS.

## What users can do

- Connect one Android automation through a signature that is shown once.
- Forward notification metadata from Tasker, Automate, or a compatible client.
- Browse a paginated notification history.
- Filter by source, app package, device, or title text.
- Save and delete reusable filter presets.
- Delete individual notifications they own.

## Capture flow

Creating a connection replaces the user's previous signature. The service stores only its SHA-256 hash. A webhook event is mapped to the connected user, validated, deduplicated by the user's notification identity, stored in Firestore, and used to update available filter options.

Automatic retries from the phone are safe: an event with an already stored notification identity returns an ignored-duplicate result instead of creating another row.

## Platform access

Authenticated users access only their own notification history. Approved internal services can query a bounded user-scoped projection containing application, title, body, timestamp, and source.

WhatsApp Message Digests are independent of this service. They read the user's private WhatsApp source and are owned by [Message Digest Service](../message-digest-service/features.md).

## Limitations

- Capture requires Android automation; there is no native iOS source.
- The plaintext connection signature is returned only once.
- One active signature connection exists per user.
- Notification images, icons, and rich actions are not stored.
- The service captures notifications but does not push notifications back to the device.

## Related documentation

- [Technical reference](technical.md)
- [Tutorial](tutorial.md)
- [Agent interface](agent.md)
- [Technical debt](technical-debt.md)
