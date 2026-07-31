# Message Digest Pub/Sub `deliveryAttempt` Production Hotfix Plan

## Goal

Restore production Message Digest run processing without creating a second run or sending a
duplicate WhatsApp message. The hotfix must accept the documented Google Pub/Sub push envelope
used when a subscription has a dead-letter policy, preserve strict validation for every other
top-level field, deploy the exact tested commit, and resume the existing queued production run.

## Incident evidence and scope

- Production release `92e27d6226e1fed82a62762b531a5a3fc12df767` is healthy, but the first
  UI-triggered migrated Fishing run remains `queued` with zero generation attempts and
  `delivery.status=not_sent`.
- Its frozen `run_request` outbox was published exactly once and is terminally recorded as
  `published`; therefore scheduler outbox recovery correctly will not publish it again.
- The production push endpoint returns Fastify validation `400 FST_ERR_VALIDATION` because the
  real envelope contains the top-level integer `deliveryAttempt` field.
- Google Pub/Sub documents `deliveryAttempt` on wrapped push bodies when dead-letter forwarding
  is configured. The production source subscription has a dead-letter policy with five attempts.
- A repository-wide Pub/Sub route audit found that other services already accept this field
  because their top-level schemas are not closed. Only Message Digest combines the documented
  push endpoint with top-level `additionalProperties: false` and is affected.
- No generation, LLM call, WhatsApp delivery, or duplicate run occurred.

This change is deliberately narrow: keep the Message Digest push envelope closed and add only
the documented optional field. Do not log, persist, or use `deliveryAttempt` in business logic.

## Post-deployment continuation: nested Pub/Sub message metadata

The first deployed fix exposed the next validation error from the same real envelope:
`body/message must NOT have additional properties`. A selected DLQ replay and a second publish of
the exact frozen payload without explicit operator attributes both reproduced it before the run
processor. The run therefore remains `queued`, generation attempts remain zero, delivery remains
`not_sent`, and the original selected DLQ message remains unacknowledged.

Google's wrapped `PubsubMessage` contract permits optional string `attributes` and an optional
`orderingKey`. Complete the same closed-envelope fix as follows before another replay:

1. RED — extend the route regression test with top-level `deliveryAttempt`, a bounded string
   attributes map, and an ordering key. Require HTTP 200 and one processor call. In the same test,
   prove an unrelated nested message field is still HTTP 400 and does not invoke the processor
   again.
2. Confirm the deployed-equivalent schema fails the new valid envelope with HTTP 400.
3. GREEN — add optional `attributes` and `orderingKey` to the TypeScript envelope and JSON schema.
   Bound attributes to Pub/Sub's key/value/count limits, keep both message-level and top-level
   `additionalProperties: false`, and neither log nor pass the metadata into business logic.
4. Repeat focused tests, read-only review, the one required final `ci:tracked` gate, PR, exact-tree
   deployment, and only then resume the selected one-message recovery.
5. After the exact run has one terminal WhatsApp receipt, ACK the original selected DLQ record and
   classify/ACK only the operator-created poison replay copies with the same payload hash; never
   replay those copies again.

## Files

- Modify `apps/message-digest-service/src/__tests__/internalMessageDigestRoutes.test.ts`.
- Modify `apps/message-digest-service/src/routes/internalMessageDigestRoutes.ts`.
- Add this incident plan only. Do not stage the protected untracked `2026-07-14` specification
  files.

## Test-first implementation

1. RED — add a route regression test that sends the normal valid run request inside a Pub/Sub
   envelope with top-level `deliveryAttempt: 1`. Require HTTP 200 and the same single
   `processMessageDigestRun` call/worker identity as the envelope without the field. Also prove an
   unrelated top-level field is still rejected with HTTP 400.
2. Run only the route test and capture the expected current failure: the documented envelope is
   rejected with HTTP 400 rather than 200.
3. GREEN — extend `PubSubPushBody` with `deliveryAttempt?: number` and add the optional schema
   property `{ type: 'integer', minimum: 0 }`. Retain `additionalProperties: false`; do not pass
   the field to the use case and do not add logging.
4. Re-run the focused route test, Message Digest service tests/coverage, typecheck, and lint.
5. Audit every Pub/Sub push schema again to verify there is no second closed schema requiring the
   same contract fix.

Focused commands:

```bash
pnpm --filter @intexuraos/message-digest-service exec vitest run src/__tests__/internalMessageDigestRoutes.test.ts
pnpm --filter @intexuraos/message-digest-service test
pnpm --filter @intexuraos/message-digest-service test:coverage
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/message-digest-service lint:local
```

## Review and release gates

1. Ask one subagent for read-only review of the bounded diff, specifically schema strictness,
   Pub/Sub contract accuracy, regression coverage, privacy, and duplicate-delivery risk. Apply any
   valid findings locally and repeat focused tests.
2. Run the single required repository gate once after the patch is final:

   ```bash
   pnpm run ci:tracked
   ```

3. Confirm the branch still descends from the current `origin/development`, stage only the three
   intended files, commit, push, and open a PR to `development`.
4. Wait for required checks, merge, and wait for the automatic production deployment. Verify
   `/deployment.json` reports the merge commit and that the Message Digest, WhatsApp, Fishing
   Assistant, and Mobile Notifications processes are healthy with zero restarts.

## Existing queued run recovery

The already-published outbox cannot be recovered by the five-minute scheduler because its status
is correctly `published`. The UI retry endpoint also correctly rejects `queued` work. Recovery
therefore uses the repository DLQ runbook after the fixed consumer is deployed:

1. Inspect source and dedicated Message Digest DLQ subscription backlog without printing payload
   data.
2. Pull exactly one message from
   `intexuraos-message-digest-runs-prod-hetzner-dlq-sub` without `--auto-ack`, into a mode-0600
   file inside a mode-0700 temporary directory. Record only source subscription, message ID,
   publish time, encoded byte length, routing attributes, and SHA-256 hash. Keep its acknowledgement
   lease alive, extending it before expiry until the exact-run terminal and receipt checks finish,
   so the selected DLQ record cannot be redelivered during manual replay.
3. Match it to the safe queued run identifier by decoding only inside a local validation process;
   never emit the decoded payload.
4. Recheck Firestore immediately before replay: the exact run is still `queued`, generation
   attempts are zero, delivery is `not_sent`, and no other outbox or delivery exists.
5. Republish only that selected original message bytes to the original Message Digest run topic,
   preserving routing attributes and adding an operator replay marker. Do not create a new run.
6. Verify the exact run reaches one terminal generation result and at most one WhatsApp delivery.
   Only after successful consumption ACK the individually selected DLQ message. If processing
   fails, do not ACK it.
7. Reload the existing run page and repeat the read-only refresh gesture to prove no second run or
   message is created.

The run processor, run lease, frozen run ID, and WhatsApp idempotency key provide the duplicate
guards; evidence must still prove exactly one terminal delivery receipt.

## Production acceptance continuation

Use Computer Use only with the already-running system Google Chrome and its existing
`kontakt@pbuchman.com` session; do not launch another browser or profile.

1. Resume the exact migrated Fishing run page, verify completed/sent state, then use WhatsApp Web
   in the same Chrome process to verify exactly one digest and that its CTA opens this exact run.
2. Continue the main goal's UI matrix: history, filtering, sorting, pagination where data permits,
   cadence edit, pause/resume, reload/focus behavior, dark theme, 200% zoom, and mobile-width
   overflow.
3. Create one temporary direct-conversation sentiment digest through the UI, run it once, verify
   exactly one WhatsApp delivery and CTA, and request explicit user confirmation immediately
   before the permanent delete action.
4. Reverify Fishing Assistant isolation and complete absence of digest behavior and endpoints from
   Mobile Notifications.
5. Finish with a privacy-safe production log audit and repository status. Do not retain private
   prompts, summaries, chat names, phone fragments, screenshots, or decoded Pub/Sub payloads.

## Endpoint Changes

### Modified

- `POST /internal/message-digests/pubsub/run`: the wrapped Google Pub/Sub request body now permits
  the documented optional top-level non-negative integer `deliveryAttempt` plus bounded optional
  `message.attributes` and `message.orderingKey` metadata. The decoded business payload,
  authentication, status mapping, and response contract are unchanged.

### Created

- None.

### Removed

- None.

### Unchanged

- All public Message Digest endpoints and response payloads.
- WhatsApp delivery and authorization contracts.
- Fishing Assistant contracts and storage.
- Mobile Notifications contracts; its removed digest routes remain absent.
