# Mobile Notifications Service — Technical Debt

**Last updated:** 2026-07-29

## Current assessment

The service has one focused responsibility after the WhatsApp summary extraction: receive, store, query, filter, and delete Android notification events. Removed summary routes, LLM dependencies, schedulers, repositories, prompts, and publishers are not compatibility surfaces.

## Follow-up opportunities

| Priority | Area | Opportunity |
| --- | --- | --- |
| Medium | Platform support | Evaluate an iOS Shortcut or native companion source. |
| Medium | Device management | Support multiple named device connections without weakening one-time secret handling. |
| Medium | Privacy | Add user-visible bulk retention and erasure controls. |
| Low | Rich capture | Define an opt-in schema for images and notification actions. |
| Low | Organization | Add user-defined categories or labels without sending content to an LLM by default. |
| Low | Operations | Add content-free ingest lag and duplicate-rate dashboards. |

## Deliberate constraints

- The connection signature is displayed once and stored only as a hash.
- One active signature exists per user.
- Captured data is pull/query oriented; the service does not push to devices.
- WhatsApp summaries are owned by Message Digest Service and are not restored here.

## Related documentation

- [Features](features.md)
- [Technical reference](technical.md)
- [Message Digest Service](../message-digest-service/features.md)
