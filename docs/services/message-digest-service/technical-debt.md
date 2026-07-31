# Message Digest Service — Technical Debt

**Last updated:** 2026-07-29

## Current assessment

The standalone service has strict unit coverage around schedules, source fencing, leases, retries, recovery, erasure, legacy compatibility, and delivery authorization. The first release intentionally keeps a small product surface: one private WhatsApp conversation per definition and one automatic WhatsApp destination per user.

## Follow-up opportunities

| Priority | Area | Opportunity |
| --- | --- | --- |
| Medium | Destination transparency | Show a masked representation of the resolved first mapped phone without making it configurable in the digest. |
| Medium | Prompt assistance | Add more reviewed prompt templates and clearer guidance for sensitive inference. |
| Medium | Schedule flexibility | Consider custom recurrence only after daily, weekdays, and weekly behavior has production evidence. |
| Medium | Run observability | Add aggregate latency and stage-duration dashboards without adding content-bearing logs. |
| Low | History exploration | Add richer filters and comparison between completed runs. |
| Low | Source repair | Guide users through explicit source re-selection after account generation or chat revision changes. |

## Deliberate constraints, not debt

- Delivery uses the first mapped WhatsApp phone and is not separately configurable.
- A definition summarizes exactly one group or direct chat.
- Preview never persists or sends.
- Empty windows do not generate a WhatsApp notification.
- Migration archives remain read-only evidence and are not a second runtime source.
- Mobile Notifications Service does not retain compatibility routes for digest generation.

## Operational follow-up

After the first production cutover, review anonymized counts for completed, failed, no-activity, ambiguous-delivery, and retry outcomes. Do not introduce prompt, summary, phone, chat, or source-message content into metrics while improving observability.

## Related documentation

- [Features](features.md)
- [Technical reference](technical.md)
- [Production runbook](../../runbooks/whatsapp-message-digests.md)
