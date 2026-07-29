# WhatsApp Message Digests — Pre-send Delivery Lease Renewal Remediation

> **Execution:** Primary agent only. Follow `superpowers:systematic-debugging`,
> `superpowers:test-driven-development`, and `superpowers:executing-plans`. Review agents remain
> read-only.

## Goal

Close the final Task 7 authorization race before migration work. A Message Digest consumer that
blocked while reserving its outbound receipt must never call Meta after its authorization expired
and definition erasure started. The consumer must renew the durable, fenced authorization after
receipt reservation and immediately before the provider call, then fail closed unless the renewed
lease covers the provider's complete timeout window.

## Root cause and required contract

The current WhatsApp push handler acquires a two-minute authorization before reserving the outbound
receipt, discards the returned expiry, and sends after reservation without checking ownership again.
If reservation takes longer than the lease, erasure may legally pass the expired lease and delete the
definition before the stale handler reaches Meta.

The fixed contract is:

1. Keep the initial acquire before receipt reservation so an erased or unauthorized digest never
   creates an outbound receipt.
2. Treat another acquire by the same handler owner as a renewal while its lease is active: retain the
   fence and atomically move `expiresAt` to the service-owned renewal deadline.
3. After receipt reservation, reacquire/renew immediately before the provider call. Never send unless
   that response is authorized and its expiry is at least the WhatsApp provider timeout plus a small
   scheduling margin in the future.
4. If erasure started while reservation was blocked, renewal is denied, the reserved receipt becomes
   a terminal `DELIVERY_AUTHORIZATION_REVOKED` failure, the push is acknowledged, and Meta receives
   zero calls.
5. If renewal is busy, unavailable, invalid, or too short, the receipt becomes retryable
   `DELIVERY_AUTHORIZATION_UNAVAILABLE`, the push returns retryably, and the Message Digest run may
   later use its existing exact-payload retry flow.
6. Release only the latest locally held fence. A renewed same-owner lease keeps its fence; a reclaim
   after expiry may return a higher fence and replaces the local release identity.

## Files in scope

- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts`
- `apps/message-digest-service/src/domain/usecases/authorizeMessageDigestDelivery.test.ts`
- `apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.ts`
- `apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.test.ts`
- `apps/whatsapp-service/src/domain/whatsapp/ports/messageSender.ts`
- `apps/whatsapp-service/src/infra/whatsapp/sender.ts`
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- `apps/whatsapp-service/src/infra/firestore/outboundMessageRepository.ts`
- `apps/whatsapp-service/src/__tests__/infra/outboundMessageRepository.test.ts`
- `apps/whatsapp-service/src/__tests__/fakes.ts`
- this plan and the active execution GOAL evidence

No public API, schema migration, template payload, feature flag, deployment, or production state
change is in scope.

## Sequential RED → GREEN tasks

### 1. Reproduce the exact blocked-reservation race

1. Add a WhatsApp route test that starts a valid Message Digest push and blocks
   `reserveIdempotentDelivery` after the initial authorization.
2. Model lease expiry plus definition erasure by making the post-reservation acquire return denied.
3. Unblock reservation and assert RED on current code: it calls the sender without a second acquire.
4. Final GREEN assertions: acquire is called twice with the same per-handler owner, sender is never
   called, the receipt is marked `DELIVERY_AUTHORIZATION_REVOKED`, release is attempted only for the
   held lease, and the route acknowledges the terminally revoked delivery.

### 2. Prove renewal order and provider-window validity

1. Add a successful route test proving the order is initial acquire → receipt reservation → renewal
   → provider call.
2. Export one `WHATSAPP_MESSAGE_SEND_TIMEOUT_MS = 30_000` contract from the sender port and consume
   it in the Meta sender implementation and route guard.
3. Require the renewed expiry to cover that timeout plus a small fixed scheduling margin at the
   instant renewal returns.
4. Add focused denied/busy/unavailable/too-short renewal cases. All must produce zero provider calls;
   retryable cases record `DELIVERY_AUTHORIZATION_UNAVAILABLE` and return retryably.
5. Make default authorization test expiries relative to the test clock so successful fixtures are
   not accidentally stale.

### 3. Renew same-owner leases atomically in Firestore

1. Add a store test asserting an active same-owner claim retains its fence, updates `renewedAt`, and
   extends `expiresAt` to the newly requested deadline.
2. Add/extend the erasure test asserting the same owner is denied if erasure started after its prior
   lease expired; renewal cannot resurrect authorization.
3. Change the transaction's active same-owner branch to persist and return the new expiry. Leave
   different-owner busy behavior and expired-lease higher-fence reclaim unchanged.
4. Keep time and expiry service-owned through the existing authorization use case; add a use-case
   assertion that every acquire/renewal request receives the fixed two-minute deadline derived from
   its injected `now`.

### 4. Preserve exact retry semantics after a pre-provider renewal outage

1. Add `DELIVERY_AUTHORIZATION_UNAVAILABLE` to the WhatsApp outbound repository and fake repository
   retryable pre-provider failure allowlists.
2. Add the same code to the Message Digest run retry allowlist.
3. Add repository and retry-use-case tests proving byte-identical delivery can be reserved again and
   run retry remains available only for this transient authorization outcome; revoked authorization
   stays terminal.

### 5. Update existing route invariants

Successful Message Digest deliveries now acquire twice. Update focused expectations without
weakening them:

- normal delivery and redelivery call counts;
- concurrent handlers have one repeated owner for the winner's acquire/renew and one distinct owner
  for the loser;
- sender failures renew before sending;
- mapping, readiness, and reservation failures still stop after the initial acquire;
- every terminal/retry path releases at most the lease actually held by that handler.

### 6. Focused verification and review

Run only targeted gates:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts apps/whatsapp-service/src/__tests__/infra/outboundMessageRepository.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/domain/usecases/authorizeMessageDigestDelivery.test.ts apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.test.ts
pnpm --filter @intexuraos/whatsapp-service typecheck
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm exec eslint apps/whatsapp-service/src/domain/whatsapp/ports/messageSender.ts apps/whatsapp-service/src/infra/whatsapp/sender.ts apps/whatsapp-service/src/routes/pubsubRoutes.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts apps/whatsapp-service/src/infra/firestore/outboundMessageRepository.ts apps/whatsapp-service/src/__tests__/infra/outboundMessageRepository.test.ts apps/whatsapp-service/src/__tests__/fakes.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/domain/usecases/authorizeMessageDigestDelivery.test.ts apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.ts apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.test.ts
git diff --check
```

Then request fresh read-only backend and test reviews. Task 7 closes only with no unresolved Critical
or Important finding. Do not run workspace coverage/full CI, commit, deploy, or start migration while
this remediation remains open.
