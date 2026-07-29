# message-digest-service — Agent Interface

## Identity

| Attribute | Value |
| --- | --- |
| Name | `message-digest-service` |
| Role | Scheduled WhatsApp group and direct-chat summaries |
| Port | `8135` |
| Public prefix | `/api/message-digests` |
| Canonical source | Scoped private WhatsApp messages |
| Delivery | WhatsApp Service to the user's first mapped number |

## Use this service when

- managing a user's digest definition, cadence, instructions, or lifecycle;
- previewing a digest or schedule;
- preparing or queuing a manual run;
- reading run history or retry state;
- querying canonical digest evidence from Fishing Assistant.

Do not use Mobile Notifications Service for any digest operation. Use WhatsApp Service directly for raw private message source queries and delivery readiness.

## Public capabilities

All public capabilities require the user's bearer JWT. Never accept a caller-supplied `userId`; derive ownership from the token.

| Capability | Endpoint | Key constraints |
| --- | --- | --- |
| List definitions | `GET /` | Owned definitions only. |
| Create definition | `POST /` | Requires an idempotency key and validated source fence. |
| Update definition | `PATCH /:definitionId` | Source identity cannot be silently broadened. |
| Delete definition | `DELETE /:definitionId` | Starts generation-fenced physical erasure. |
| Delivery readiness | `GET /delivery-readiness` | Returns metadata, never a configurable destination. |
| Preview schedule | `POST /schedule-preview` | No persistence or delivery. |
| Preview summary | `POST /preview` | Bounded read, no persisted run, no send. |
| Prepare run | `POST /:definitionId/run/prepare` | Freezes the run window and returns a short-lived token. |
| Queue run | `POST /:definitionId/run` | Requires preparation token and idempotency key. |
| List runs | `GET /:definitionId/runs` | Cursor-paginated owned history. |
| Get run | `GET /:definitionId/runs/:runId` | Includes processing and delivery state. |
| Retry run | `POST /:definitionId/runs/:runId/retry` | Only eligible failed states. |

## Internal capabilities

All internal calls require `X-Internal-Auth`. Preserve user and source scoping exactly.

### Query definitions

`POST /internal/message-digests/definitions/query`

Use for a bounded compatibility lookup of the caller's available digest definitions. Fishing Assistant uses this instead of Mobile Notifications digest subscriptions.

### Query runs

`POST /internal/message-digests/runs/query`

Use for bounded canonical summary evidence. Filter by the owned definition and requested date range; do not broaden to unrelated runs.

### Scheduler and worker

- `POST /internal/message-digests/scheduler/tick` reserves due windows.
- `POST /internal/message-digests/pubsub/run` processes one Pub/Sub envelope.

These are runtime entry points, not agent exploration tools. Never call them without an approved operational workflow.

### Delivery authorization

- `POST /internal/message-digests/delivery-authorizations/acquire`
- `POST /internal/message-digests/delivery-authorizations/release`

Only WhatsApp Service should use these routes. Authorization binds one frozen payload to one run attempt and prevents duplicate or stale sends.

## Definition input

```typescript
interface MessageDigestDefinitionInput {
  name: string;
  source: {
    type: 'private_whatsapp';
    chatType: 'group' | 'direct';
    sourceAccountId: string;
    sourceGeneration: number;
    sourceRevision: string;
    chatId: string;
  };
  schedule:
    | { kind: 'daily'; localTime: string; timeZone: string }
    | { kind: 'weekdays'; localTime: string; timeZone: string }
    | {
        kind: 'weekly';
        weekday: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
        localTime: string;
        timeZone: string;
      };
  instructions: {
    templateId: 'fishing_group' | 'direct_sentiment' | 'custom';
    text: string;
  };
  delivery: { type: 'whatsapp_primary' };
}
```

Callers obtain source fence values from WhatsApp validation; they must not invent or log them.

## Safety rules

- Never log or copy message bodies, prompt text, summaries, phone numbers, or chat identifiers into operational evidence.
- Never expose a destination selector; WhatsApp Service resolves the first mapped phone.
- Never deliver a preview.
- Never reuse a preparation token for a different definition, revision, or window.
- Treat `ambiguous` delivery as potentially sent until reconciliation completes.
- Treat source generation or revision mismatch as a hard stop.
- Prefer `skipped_no_activity` over generating content for an empty source window.

## Failure handling

Return standardized error responses. Retry only documented transient states. Authentication, ownership, invalid source fences, deleted definitions, and preparation-token mismatches are terminal until the caller changes its input. Provider ambiguity requires reconciliation, not a blind retry.
