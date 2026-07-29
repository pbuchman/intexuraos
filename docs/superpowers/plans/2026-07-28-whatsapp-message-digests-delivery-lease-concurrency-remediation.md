# WhatsApp Message Digests — Delivery Lease Concurrency Remediation

> **Execution:** Primary agent only. Follow `superpowers:systematic-debugging`,
> `superpowers:test-driven-development`, and `superpowers:executing-plans`. Review agents remain
> read-only.

## Goal

Close the final Task 7 delivery-authorization review findings before migration work: concurrent
redelivery of one Pub/Sub message must never share or prematurely release an authorization lease,
erasure must be proven against the real authorization store, expired leases must recover safely,
and every post-acquire route outcome must release only the lease owned by that handler.

## Root cause and fixed contract

`whatsapp-service` currently derives `ownerDigest` only from Pub/Sub `messageId` and the delivery
idempotency key. Two simultaneously executing pushes of the same event therefore present the same
owner. The Message Digest store correctly treats a repeated request from that owner as the same
lease, but the second HTTP handler can then release the first handler's lease when its receipt
reservation observes `duplicate_in_flight`.

Every HTTP handler invocation will instead generate an independent cryptographically random attempt
identifier and include it in the one-way `ownerDigest`. The first handler owns its lease until its
provider/receipt path settles. A concurrent duplicate receives `busy` from authorization and returns
retryably without reserving, sending, or releasing another handler's lease. Stable delivery
idempotency remains the responsibility of the outbound receipt and is unchanged.

## Files in scope

- `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts`
- this plan and the active execution GOAL evidence

No schema, public API, provider payload, migration, feature flag, or production state changes are in
scope.

## Sequential RED → GREEN tasks

### 1. Prove per-handler lease ownership under identical concurrent pushes

1. Add a route test that freezes one valid Message Digest Pub/Sub body, blocks the first provider
   send, and starts a second injection with the exact same `messageId` and payload.
2. Back the authorization mock with an in-memory active-owner model: first unique owner is
   authorized; a different active owner is busy; release must match owner and fence.
3. Assert RED on the current deterministic owner: the second handler shares the first owner and can
   reach/release the receipt path.
4. Include a fresh per-handler random attempt in `messageDigestDeliveryOwnerDigest`. Assert the two
   owner digests differ, the second response is retryable, exactly one provider call occurs, and the
   first lease remains held until its provider call settles.

### 2. Compose the real erasure and authorization store boundary

1. In the Firestore store suite, seed a real owned definition and completed pending-delivery run
   representing an already-published frozen delivery.
2. Invoke the real authorization use case once before deletion, release it, then call the real
   `startOrResumeDefinitionErasure`.
3. Invoke the real authorization use case for the delayed consumer identity after deletion starts.
4. Assert it is denied and erasure advances without any new lease. This composes real store
   transactions rather than a route-local boolean while the WhatsApp route tests separately prove
   that denial occurs before reservation/provider send.

### 3. Prove lease expiry recovery

1. Claim a lease and leave it unreleased.
2. Assert erasure remains quiesced strictly before expiry.
3. Assert erasure advances at expiry without an explicit release.
4. In a separate active-definition case, assert a new owner can acquire after expiry with an
   incremented fence and the stale owner/fence cannot release the replacement lease.

### 4. Close every post-acquire route outcome

Add focused Message Digest route tests for:

- an independently pre-reserved receipt producing `duplicate_in_flight`;
- `completeIdempotentDelivery` returning a persistence failure;
- `completeIdempotentDelivery` throwing;
- authorization release throwing on a settled path.

Each test must assert provider count, HTTP retry semantics, and exactly the appropriate release
attempt. The route-level `finally` remains the last-resort release; explicit paths must clear local
ownership so they cannot double-release.

### 5. Verification and review

Run only focused gates:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts
pnpm --filter @intexuraos/whatsapp-service typecheck
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm exec eslint apps/whatsapp-service/src/routes/pubsubRoutes.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts
git diff --check
```

Then request one fresh read-only backend/test review. Task 7 closes only with no unresolved Critical
or Important finding. Do not run workspace coverage again unless the changed coverage gate actually
regresses, and do not run full CI, commit, deploy, or start migration while this remediation is open.
