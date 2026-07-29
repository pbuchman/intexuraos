# WhatsApp Message Digests — MVP Backend Implementation Plan

> **For the primary agent:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute every
> task in order. Implementation subagents are forbidden; review subagents are read-only and may be
> used only after a bounded artifact is complete.

**Goal:** Deliver the smallest complete backend vertical slice for a user-owned group or direct
Private WhatsApp conversation: safe source reads, daily definition CRUD, preview, manual/scheduled
run, persisted history/state, exactly-once-aware WhatsApp delivery, and bounded definition deletion.

**Architecture:** `whatsapp-service` remains the sole owner of Private WhatsApp data and outbound
mapping/receipt state. A new `message-digest-service` owns definitions, runs, checkpoints, outbox,
and erasure state. It calls only typed internal clients, freezes every source window, persists exact
publish payload bytes, and delegates the final first-number lookup to `whatsapp-service`.

**Tech stack:** TypeScript, Fastify, Zod, Firestore transactions, Google Pub/Sub, existing
`@intexuraos/llm-*` packages, Vitest, Pino, pnpm workspaces.

**Authoritative input:**
`docs/superpowers/plans/2026-07-27-whatsapp-message-digests-execution-goal.md`. If this plan and that
file differ, stop and correct this plan before implementation.

## Global execution constraints

- Work only on `codex/whatsapp-message-digests`, created from `origin/development@42cfca136`.
- Execute sequentially in the primary agent. Do not delegate implementation or edit through a
  worktree.
- For every behavior: write one focused failing test, observe RED, make the smallest GREEN change,
  and refactor only while the same focused test stays green.
- Do not add a feature flag, dual read, shadow mode, deployment compatibility branch, selectable
  recipient, selectable model, or Mobile Notifications fallback.
- Do not commit or run `pnpm run ci:tracked` in this plan. Use only the focused commands listed here.
- Preserve all unrelated user changes and the five untracked `docs/superpowers/specs/` files named in
  the execution goal.
- Never place real user IDs, phones, source account IDs, chat IDs, Matrix IDs, private messages,
  prompts, tokens, or credentials in code, fixtures, logs, snapshots, or command output.
- Public APIs derive `userId` only from JWT. Internal APIs authenticate with the existing internal
  service contract. Foreign and missing resources return the same public `404`.
- An MVP checkpoint is not a release. No production mutation, migration apply, Git commit, PR, full
  CI, or browser other than the already-running system Chrome is permitted here.
- Until migration 128 is applied inside the coordinated cutover, local `message-digest-service`
  persists only to an isolated Firestore emulator namespace and publishes through the local Pub/Sub
  emulator/forwarder. The separately running WhatsApp owner service may use the already-authorized
  retained account for source/delivery verification. This avoids depending on unapplied production
  indexes while still exercising the real owner boundary; no real source chat is mutated.

## MVP contract to implement

### Source boundary types

Add these typed projections to `packages/internal-clients/src/whatsapp-service/types.ts` and mirror
them at the owner route boundary without exporting Firestore documents:

```ts
type DigestChatType = 'group' | 'direct';

interface ValidatePrivateDigestSourceInput {
  userId: string;
  chatId: string;
  expectedGenerationId?: string;
}

interface ValidatedPrivateDigestSource {
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: DigestChatType;
  displayName: string;
  messageCount: number;
  participantCount?: number;
  lastActivityAt?: string;
  sourceRevision: string;
}

interface QueryPrivateDigestMessagesInput {
  userId: string;
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: DigestChatType;
  windowStart: string;
  windowEnd: string;
  limit: number;
  cursor?: string;
}

interface PrivateDigestMessage {
  messageRef: string;
  eventTimestamp: string;
  direction: 'inbound' | 'outbound' | 'system';
  authorLabel: string;
  text: string;
  contentKind: 'text' | 'media_caption' | 'transcription' | 'reaction' | 'system';
}

interface QueryPrivateDigestMessagesResult {
  messages: PrivateDigestMessage[];
  sourceRevision: string;
  highWatermark: string | null;
  nextCursor: string | null;
}

interface WhatsAppDeliveryReadiness {
  status: 'ready' | 'mapping_missing' | 'disconnected' | 'delivery_disabled';
  maskedPrimaryNumber?: string;
  observationVersion: string;
  observedAt: string;
}

interface OutboundDeliveryState {
  status: 'pending' | 'sent' | 'ambiguous' | 'failed' | 'missing';
  acceptedAt?: string;
  failedAt?: string;
  failureCode?: string;
}
```

The source response may expose `sourceAccountId` and `generationId` only on the authenticated
internal route. `messageRef` is an opaque non-reversible digest. `authorLabel` is `You`, a bounded
display-safe group participant label, or `System`; it is never a phone or Matrix identifier.
`sourceRevision`, `highWatermark`, and `cursor` are authenticated encrypted opaque tokens rather than
client-assembled database positions.

The typed client and owner service use these exact authenticated internal paths:

- `POST /internal/whatsapp/private/digest-source/validate`;
- `POST /internal/whatsapp/private/digest-source/messages/query`;
- `POST /internal/whatsapp/delivery-readiness/get`;
- `POST /internal/whatsapp/outbound-deliveries/get`.

### Snapshot semantics

- Reuse `whatsapp_private_context_changes` as the mutation journal; do not introduce a second
  snapshot collection. The first page freezes an inclusive message high watermark and initial
  context-change sequence.
- Each page reads the current chat head and that page's messages in one consistent Firestore
  transaction, then validates every journal entry from the previously validated sequence through
  the captured head before returning data.
- New append-only events strictly after the watermark do not invalidate subsequent pages.
- A late insertion, edit, redaction, reaction, transcription completion, or other mutation affecting
  membership or effective content at/below the watermark returns `409 SOURCE_CHANGED` with no data.
- Redacted messages are omitted; an edit replaces the earlier visible text; a reaction is represented
  once against its effective target; media contributes only a safe caption/type marker;
  transcription contributes completed text once; unsupported records remain bounded system markers.
- Every page is ordered by `(eventTimestamp, documentId)` and the half-open window is
  `[windowStart, windowEnd)`.
- Cursor and revision tokens are encrypted and authenticated with AES-256-GCM. Derive a dedicated
  key from the internal-auth secret with HKDF; encode token version, owner, account generation, chat,
  window, watermark, page position, validated journal sequence, issue time, and expiry. Bind all
  route parameters as authenticated data. Tampering, expiry, key rotation, or context mismatch
  returns a safe restart-required error without leaking token contents.

### MVP aggregate output

Create `packages/llm-prompts/src/message-digest/` with a strict result:

```ts
interface MessageDigestAggregate {
  headline: string;
  summaryMarkdown: string;
  evidenceMessageRefs: string[];
  continuityMemoryMarkdown: string;
}
```

The service owns identity, window, source count, timestamps, prompt/model version, and cost metadata.
The LLM may produce only the four fields above. Evidence refs must be a subset of supplied refs;
Markdown is sanitized; malformed or invented data gets one bounded repair attempt, then a safe
failure.

### MVP persistence model

Implement the six collections already fixed in the execution goal, but create only ordinary MVP
records in the first five. `message_digest_migration_activations` is registered now and remains empty
until the migration plan.

- `message_digest_definitions`: opaque `md_*` ID, owner, `active|paused|deleting`, revision, source
  fence/snapshot, instructions snapshot, `daily` schedule, implicit WhatsApp delivery, timestamps,
  internal normalized `nameSortKey`, and separate last-observed
  `listStatus=active|paused|needs_attention` plus safe `attentionCode`. The projection enables bounded
  filters and is refreshed by readiness/source observations; it never authorizes a run.
- `message_digest_runs`: deterministic ID, trigger `manual|scheduled`, immutable snapshots, lease,
  half-open window, generation and delivery stage/status, aggregate output, safe failure code.
- `message_digest_states`: definition ID, revision, checkpoint, bounded continuity, preceding run
  hash, optional single pending window.
- `message_digest_dispatch_outbox`: deterministic ID, `run_request|whatsapp_delivery`, exact
  `payloadJson`, SHA-256, `pending|published|terminal`, attempts and next retry.
- `message_digest_erasure_requests`: idempotency-key ID, stage/cursor/counts, terminal content-free
  tombstone with 30-day expiry.
- `message_digest_migration_activations`: registered owner only; no MVP write path.

The Firestore port must expose atomic intent-level methods rather than leaking transactions:

```ts
interface MessageDigestStore {
  createDefinition(input: CreateDefinitionRecord): Promise<CreateDefinitionResult>;
  getOwnedDefinition(userId: string, definitionId: string): Promise<MessageDigestDefinition | null>;
  listOwnedDefinitions(input: ListDefinitionsInput): Promise<ListDefinitionsResult>;
  listDueDefinitions(input: ListDueDefinitionsInput): Promise<ListDueDefinitionsResult>;
  updateDefinition(input: UpdateDefinitionInput): Promise<UpdateDefinitionResult>;
  reserveRun(input: ReserveRunInput): Promise<ReserveRunResult>;
  claimRunLease(input: ClaimRunLeaseInput): Promise<ClaimRunLeaseResult>;
  renewRunLease(input: RenewRunLeaseInput): Promise<RenewRunLeaseResult>;
  completeRun(input: CompleteRunInput): Promise<CompleteRunResult>;
  failRun(input: FailRunInput): Promise<void>;
  getOwnedRun(input: OwnedRunInput): Promise<MessageDigestRun | null>;
  listOwnedRuns(input: ListRunsInput): Promise<ListRunsResult>;
  claimDispatch(input: ClaimDispatchInput): Promise<ClaimDispatchResult>;
  recordDispatchResult(input: RecordDispatchResultInput): Promise<void>;
  startOrResumeDefinitionErasure(input: DefinitionErasureInput): Promise<DefinitionErasureResult>;
}
```

`listDueDefinitions({ now, cursor, limit })` uses an explicit bounded index/order and excludes paused
or deleting records; its opaque cursor is stable under concurrent updates and has a query
fingerprint. Readiness is deliberately not read inside a local Firestore transaction. Create,
resume, and either trigger first obtain a versioned WhatsApp readiness observation. `reserveRun`
then transactionally checks the persisted observation fence, owner/status, erasure epoch, one pending
window, definition/state revisions, and deterministic request ID; creates the run plus exact
run-request outbox; and advances `nextRunAt` to the first cadence boundary strictly after the
reserved boundary for both manual and scheduled runs without advancing `checkpointAt`.
`completeRun` alone advances the checkpoint and clears the matching reservation. The worker
revalidates delivery readiness after claiming the run and before any LLM/provider effect. A mapping
change in the cross-service gap creates a safe terminal pre-provider failure with no generation or
send. Failed runs otherwise keep the reservation and same run ID.

### MVP public endpoints

Implement these exact routes and envelopes:

- `GET /message-digests`
- `POST /message-digests`
- `GET /message-digests/:definitionId`
- `PATCH /message-digests/:definitionId`
- `DELETE /message-digests/:definitionId`
- `GET /message-digests/erasures/:erasureRequestId`
- `GET /message-digests/delivery-readiness`
- `POST /message-digests/schedule-preview`
- `POST /message-digests/preview`
- `POST /message-digests/:definitionId/run/prepare`
- `POST /message-digests/:definitionId/run`
- `GET /message-digests/:definitionId/runs`
- `GET /message-digests/:definitionId/runs/:runId`

The list grammar is exactly `cursor`, `limit=1..50` (default 25), normalized `query` prefix,
`chatType=group|direct`, effective `status=active|paused|needs_attention`,
`sort=name|updatedAt|nextRunAt`, and `direction=asc|desc`; with no query, default order is
`updatedAt desc, definitionId desc`. A non-empty query requires `sort=name` (default `name asc`), may
combine with both filters, and rejects another sort. History uses `cursor`, `limit=1..50` (default
25), inclusive local
`fromDate`/`toDate` (`YYYY-MM-DD`) interpreted in the definition time zone,
`generationStatus=queued|processing|completed|failed|skipped_no_activity`,
`deliveryStatus=not_sent|pending|sent|ambiguous|failed`, `sort=windowStart`, and
`direction=asc|desc`; default is `windowStart desc, runId desc`. Every cursor is opaque,
authenticated, and bound to the normalized filter/sort fingerprint; mismatch returns `400
INVALID_CURSOR`. Persisted lifecycle status is only `active|paused|deleting`; `needs_attention` is a
separate last-observed `listStatus` projection. Runs persist the coarse generation status above plus
`processingStage=queued|reading_messages|aggregating|repairing|completed|failed|skipped_no_activity`;
erasure state is a separate DTO.

`GET /delivery-readiness` returns the current display-safe observation. `POST /schedule-preview`
accepts the same schedule shape as create/edit and returns backend-calculated prior/next windows
without writing. `POST /run/prepare` returns the exact checkpoint/window/time zone/readiness and a
short-lived authenticated token bound to owner, definition/state revision, erasure epoch, and
window. `POST /run` must consume that token plus a client request ID; a stale/expired token returns a
conflict that instructs the UI to refresh and saves/reserves/sends nothing.

PATCH uses `expectedRevision`; it may replace `source.chatId` only before any run exists, revalidates
it, and resets the unopened checkpoint atomically. Create and manual run use a client request ID.
Missing readiness stores create as paused with `activationAdjusted=delivery_setup_required`;
resume/manual run reject safely. Repeated DELETE with the same request ID advances bounded erasure
batches; GET is read-only reload recovery and returns `nextAction=resume_delete` when another DELETE
is required.

Implement local internal endpoints:

- `POST /internal/message-digests/scheduler/tick`
- `POST /internal/message-digests/pubsub/run`

The Terraform scheduler/subscription is deliberately deferred to the migration/removal plan.

## File inventory

### Create

- `apps/message-digest-service/package.json`
- `apps/message-digest-service/tsconfig.json`
- `apps/message-digest-service/Dockerfile`
- `apps/message-digest-service/src/config.ts`
- `apps/message-digest-service/src/index.ts`
- `apps/message-digest-service/src/server.ts`
- `apps/message-digest-service/src/services.ts`
- `apps/message-digest-service/src/domain/models/messageDigestDefinition.ts`
- `apps/message-digest-service/src/domain/models/messageDigestRun.ts`
- `apps/message-digest-service/src/domain/models/messageDigestErasure.ts`
- `apps/message-digest-service/src/domain/ports/messageDigestStore.ts`
- `apps/message-digest-service/src/domain/ports/messageDigestClients.ts`
- `apps/message-digest-service/src/domain/schedules/messageDigestSchedule.ts`
- `apps/message-digest-service/src/domain/usecases/createMessageDigest.ts`
- `apps/message-digest-service/src/domain/usecases/updateMessageDigest.ts`
- `apps/message-digest-service/src/domain/usecases/queryMessageDigests.ts`
- `apps/message-digest-service/src/domain/usecases/queryMessageDigestRuns.ts`
- `apps/message-digest-service/src/domain/usecases/getMessageDigestDeliveryReadiness.ts`
- `apps/message-digest-service/src/domain/usecases/previewMessageDigestSchedule.ts`
- `apps/message-digest-service/src/domain/usecases/previewMessageDigest.ts`
- `apps/message-digest-service/src/domain/usecases/prepareMessageDigestRun.ts`
- `apps/message-digest-service/src/domain/usecases/reserveMessageDigestRun.ts`
- `apps/message-digest-service/src/domain/usecases/processMessageDigestRun.ts`
- `apps/message-digest-service/src/domain/usecases/reconcileMessageDigestDelivery.ts`
- `apps/message-digest-service/src/domain/usecases/eraseMessageDigest.ts`
- `apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.ts`
- `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts`
- `apps/message-digest-service/src/infra/http/whatsappDigestClient.ts`
- `apps/message-digest-service/src/infra/llm/messageDigestAggregator.ts`
- `apps/message-digest-service/src/infra/pubsub/frozenPayloadPublisher.ts`
- `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.ts`
- `apps/message-digest-service/src/routes/messageDigestSchemas.ts`
- `apps/message-digest-service/src/routes/messageDigestRoutes.ts`
- `apps/message-digest-service/src/routes/internalMessageDigestRoutes.ts`
- `apps/message-digest-service/src/routes/routeErrors.ts`
- focused `*.test.ts` files beside each domain/infra module and route tests under
  `apps/message-digest-service/src/__tests__/`
- `apps/message-digest-service/src/__tests__/localPubSubForwarding.test.ts`
- `packages/llm-prompts/src/message-digest/types.ts`
- `packages/llm-prompts/src/message-digest/schemas.ts`
- `packages/llm-prompts/src/message-digest/templates.ts`
- `packages/llm-prompts/src/message-digest/aggregatePrompt.ts`
- `packages/llm-prompts/src/message-digest/repairPrompt.ts`
- `packages/llm-prompts/src/message-digest/index.ts`
- `packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts`
- `apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsAppDigestSource.ts`
- `apps/whatsapp-service/src/domain/whatsapp/ports/privateWhatsAppDigestSourceRepository.ts`
- `apps/whatsapp-service/src/domain/whatsapp/usecases/readPrivateWhatsAppDigestSource.ts`
- `apps/whatsapp-service/src/infra/firestore/privateWhatsAppDigestSourceRepository.ts`
- `apps/whatsapp-service/src/routes/privateDigestSourceRoutes.ts`
- `apps/whatsapp-service/src/routes/outboundDeliveryRoutes.ts`
- `apps/whatsapp-service/src/infra/security/privateDigestSourceToken.ts`
- `apps/whatsapp-service/src/__tests__/domain/whatsapp/privateWhatsAppDigestSource.test.ts`
- `apps/whatsapp-service/src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts`
- `apps/whatsapp-service/src/__tests__/privateDigestSourceRoutes.test.ts`
- `apps/whatsapp-service/src/__tests__/outboundDeliveryRoutes.test.ts`
- `apps/whatsapp-service/src/__tests__/infra/privateDigestSourceToken.test.ts`
- `scripts/__tests__/pubsub-publish-test.test.ts`

### Modify

- `apps/whatsapp-service/src/domain/whatsapp/ports/privateWhatsAppRepository.ts`
- `apps/whatsapp-service/src/domain/whatsapp/ports/outboundMessageRepository.ts`
- `apps/whatsapp-service/src/infra/firestore/privateWhatsAppRepository.ts`
- `apps/whatsapp-service/src/infra/firestore/outboundMessageRepository.ts`
- `apps/whatsapp-service/src/routes/routes.ts`
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- `apps/whatsapp-service/src/services.ts`
- `apps/whatsapp-service/src/server.ts`
- related WhatsApp repository/PubSub/OpenAPI tests
- `packages/internal-clients/src/whatsapp-service/types.ts`
- `packages/internal-clients/src/whatsapp-service/client.ts`
- `packages/internal-clients/src/whatsapp-service/index.ts`
- `packages/internal-clients/src/whatsapp-service/__tests__/client.test.ts`
- `packages/llm-prompts/src/index.ts`
- `packages/whatsapp-pubsub-client/src/types.ts`
- `packages/whatsapp-pubsub-client/src/whatsappSendPublisher.ts`
- `packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts`
- `firestore-collections.json`
- `scripts/build-all-services.mjs`
- `tools/pubsub-ui/server.mjs`
- `tools/pubsub-ui/index.html`
- `tools/pubsub-ui/README.md`
- `scripts/pubsub-publish-test.mjs`
- `pnpm-lock.yaml`

No Mobile Notifications file is modified in this plan; complete removal occurs only after Fishing
and migration compatibility exist.

## Sequential TDD tasks

### Task 1: Freeze outbound event construction and extend the typed WhatsApp client

1. Add tests to `packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts` proving
   a caller-supplied timestamp and idempotency key survive unchanged and two builds serialize
   identically. Run only that file; observe RED because timestamp is not accepted/exported.
2. Export a pure validated event builder, accept an optional caller timestamp, and ensure the
   implementation method's explicit parameter type includes `idempotencyKey`. Keep the generated
   current timestamp default for existing callers. Re-run; expect GREEN.
3. Add WhatsApp internal-client tests for source validation, paged query, readiness, and receipt
   state. Include strict-envelope rejection, timeout, 409 `SOURCE_CHANGED`, and no raw-field response.
   Observe RED on missing methods.
4. Add the types and client methods using the existing `createInternalHttpClient`; validate every
   success body with strict Zod schemas and map downstream failures to typed safe errors. Re-run;
   expect GREEN.

Focused command:

```bash
pnpm exec vitest run packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts packages/internal-clients/src/whatsapp-service/__tests__/client.test.ts
```

### Task 2: Implement the owner-side safe source model

1. Add domain tests for group/direct validation, generation mismatch, unsupported chat type,
   normalization, effective edit/redaction/reaction/media/transcription behavior, and output privacy.
   Observe RED on missing model/use case.
2. Implement the pure projection and use case with exhaustive discriminated unions. Do not reuse the
   Conversation Assistant direct-only policy. Re-run domain tests; expect GREEN.
3. Add Firestore adapter tests with at least two pages, equal timestamps ordered by document ID,
   half-open boundaries, append-after-watermark stability, relevant late mutation conflict, cursor
   tampering/expiry/key rotation, ownership rejection, and no unbounded read. Assert the first page
   freezes message watermark plus context-journal sequence; each next page transactionally captures
   chat head/page data and validates intervening `whatsapp_private_context_changes`; a mutation or
   late insertion at/below the watermark conflicts while a strict append above it does not. Observe
   RED.
4. Add token-helper tests for AES-256-GCM authentication, HKDF domain separation from the internal
   auth secret, route-parameter authenticated data, version/issued-at/expiry, and safe failures with
   no decoded token logging. Observe RED, implement `privateDigestSourceToken.ts`, then expect GREEN.
5. Implement the dedicated repository query against owned Private WhatsApp collections and existing
   context-change journal. Use the current account/generation fence and encrypted cursor state;
   never return raw documents or add a snapshot collection. Re-run; expect GREEN.
6. Add Warsaw 23-hour and 25-hour source-window tests using explicit ISO boundaries supplied by the
   digest service. Verify the owner repository performs no fixed-24-hour calculation.

Focused command:

```bash
cd apps/whatsapp-service && pnpm exec vitest run src/__tests__/domain/whatsapp/privateWhatsAppDigestSource.test.ts src/__tests__/infra/privateDigestSourceToken.test.ts src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts
```

### Task 3: Expose source, readiness, and truthful receipt routes

1. Add route tests for internal auth, strict bodies, owned/foreign/missing chat behavior, generation
   conflicts, paging fences, readiness statuses/masked number, and receipt statuses. Observe RED on
   route registration.
2. Register `privateDigestSourceRoutes` and `outboundDeliveryRoutes`, wire services, and document
   their schemas in OpenAPI. Return only safe error codes; do not log input bodies.
3. Add Pub/Sub consumer tests proving reservation precedes every send decision and persists terminal
   `failed` for missing mapping, disconnected/disabled delivery, and definitive pre-provider errors;
   preserve `ambiguous` after an uncertain provider effect. Observe the existing missing-receipt
   failure.
4. Extend the outbound repository and consumer to satisfy those tests without changing first-number
   resolution. Re-run route and Pub/Sub tests; expect GREEN.

Focused command:

```bash
cd apps/whatsapp-service && pnpm exec vitest run src/__tests__/privateDigestSourceRoutes.test.ts src/__tests__/outboundDeliveryRoutes.test.ts src/__tests__/pubsubRoutes.test.ts
cd apps/whatsapp-service && pnpm typecheck
pnpm --filter @intexuraos/internal-clients typecheck
```

### Task 4: Add strict generic Message Digest prompts

1. Add prompt tests for fishing/direct templates, user-instruction delimiting, untrusted source
   delimiting, previous-three-summary ordering, output schema, evidence subset validation, and one
   repair prompt. Observe RED on missing exports.
2. Implement the templates and builders. Do not copy the legacy output shape or hard-code the fishing
   group key. Export through the package root.
3. Re-run prompt tests and package typecheck; expect GREEN.

Focused command:

```bash
pnpm exec vitest run packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts
pnpm --filter @intexuraos/llm-prompts typecheck
```

### Task 5: Scaffold the standalone service and daily schedule domain

1. Add config tests for port `8135` default and the exact required environment contract:
   `INTEXURAOS_GCP_PROJECT_ID`, auth JWKS/issuer/audience, `INTEXURAOS_INTERNAL_AUTH_TOKEN`,
   `INTEXURAOS_WHATSAPP_SERVICE_URL`, `INTEXURAOS_LLM_USAGE_SERVICE_URL`,
   `INTEXURAOS_OPENROUTER_APP_API_KEY`, the moved `INTEXURAOS_DIGEST_LLM_MODEL`,
   `INTEXURAOS_PUBSUB_MESSAGE_DIGEST_RUN_TOPIC`, `INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC`, and
   `INTEXURAOS_WEB_APP_URL`. Cover the explicit local Firestore/Pub/Sub emulator wiring and a hard
   guard that forbids the MVP local mode from silently falling through to production storage.
   Observe RED on missing app.
2. Add schedule tests for daily preceding boundary, next boundary, manual boundary, invalid time/zone,
   Warsaw winter/summer, spring 23-hour day, and autumn 25-hour day. Observe RED.
3. Add the package/scaffold and implement schedule calculations with `Intl`/IANA calendar parts,
   never fixed milliseconds. Register health and OpenAPI using existing service conventions.
4. Add service composition tests proving every route dependency is supplied and secrets health
   reports missing config safely. Re-run; expect GREEN.
5. Register the app in `scripts/build-all-services.mjs`, install workspace dependencies once with
   `pnpm install` so the new workspace package is linked under the repository's non-hoisted pnpm
   layout, and do not change runtime routing yet.

Focused command:

```bash
pnpm exec vitest run apps/message-digest-service/src/config.test.ts apps/message-digest-service/src/domain/schedules/messageDigestSchedule.test.ts apps/message-digest-service/src/services.test.ts apps/message-digest-service/src/server.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
```

### Task 6: Implement the Firestore store and atomic lifecycle primitives

1. Add document codec tests that reject unknown fields, raw content, recipient numbers, invalid
   transitions, stale revisions, oversized continuity, and invalid cursor/timestamps. Observe RED.
2. Implement codecs and collection constants; register all six owners in
   `firestore-collections.json`.
3. Add store tests for idempotent create, owner-isolated list/get, CAS update, pre-first-run source
   replacement, post-run lock, one pending reservation, simultaneous manual/tick winner, lease
   acquire/renew/fence, completion checkpoint, retained failed reservation, exact payload/hash,
   dispatch claim, exact public history filtering/query fingerprints, and bounded erasure. Add
   `listDueDefinitions` RED cases for limit/cursor order, concurrent updates, and exclusion of
   paused/deleting records. Observe RED before each primitive.
4. Implement one primitive at a time in `FirestoreMessageDigestStore`, using transactions for every
   cross-document invariant. Re-run the single test after each GREEN change, then the store file.
5. Prove emulator queries are bounded and document IDs/cursors are opaque. Do not create migration
   activation records.

Focused command:

```bash
pnpm exec vitest run apps/message-digest-service/src/infra/firestore/messageDigestDocuments.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts
pnpm run verify:firestore
```

### Task 7: Implement definition CRUD and bounded deletion

1. Add use-case tests for group/direct create, multiple definitions per chat, missing readiness
   downgrade, active create, list/search/filter/sort, owner 404, revision conflict, prospective edit,
   source replacement before first run, source lock afterwards, pause/resume readiness recheck, and
   delete idempotency. Test readiness as an external versioned precheck, persisted observation fence,
   and worker revalidation—not as a cross-service transaction. Observe RED in one test at a time.
2. Implement create/update/query/erase use cases against ports. Initialization uses the immediately
   preceding daily cadence boundary.
3. Add route tests for auth, exact request/response schemas, idempotency headers/IDs, static
   foreign/missing 404, validation, conflict, pagination, and deletion recovery. Observe RED.
4. Implement public routes and safe route-error mapping, including delivery readiness, schedule
   preview, exact list/history grammar, and `run/prepare`. Erasure first increments a monotonic
   `erasureEpoch`, marks the definition deleting, and quiesces claimed work. Every worker commit,
   retry, dispatch claim, and receipt reconciliation is fenced by status plus epoch. Safely terminalize
   pending outboxes, wait rather than guess when an external effect is uncertain, delete bounded
   definition-owned batches, and end with a content-free request tombstone; never touch source chats.
   Repeated DELETE advances work, while GET only reports progress/recovery.
5. Re-run use-case and route tests; expect GREEN.

Focused command:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/createMessageDigest.test.ts apps/message-digest-service/src/domain/usecases/updateMessageDigest.test.ts apps/message-digest-service/src/domain/usecases/queryMessageDigests.test.ts apps/message-digest-service/src/domain/usecases/eraseMessageDigest.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts
```

### Task 8: Implement non-persistent preview and aggregation

1. Add aggregator tests for zero messages, a small group, a direct conversation, deterministic
   chunks, previous-three-summary context, prompt injection, malformed output, one repair, invented
   evidence, token/source-too-large failure, and application-owned metadata. Observe RED.
2. Implement the LLM adapter with the fixed platform model and usage sink. Never log request/output.
   Chunk deterministically by stable message order and explicit token budget; never silently drop a
   source message.
3. Add preview tests proving source/readiness validation, preceding cadence-sized window, frozen
   paging, no definition/run/state/outbox write, no delivery, empty result without LLM, and safe
   aggregate response. Observe RED.
4. Implement preview and its route. Re-run; expect GREEN.

Focused command:

```bash
pnpm exec vitest run apps/message-digest-service/src/infra/llm/messageDigestAggregator.test.ts apps/message-digest-service/src/domain/usecases/previewMessageDigest.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts
```

### Task 9: Implement run reservation, processing, outbox, and delivery reconciliation

1. Add run use-case tests for deterministic manual/scheduled IDs, duplicate request, concurrent
   reservation, exact byte-stable run request, duplicate Pub/Sub, renewable lease/fence, full source
   paging, append-after-watermark, `SOURCE_CHANGED` restart, empty skip, aggregation success/failure,
   checkpoint commit, manual and scheduled `nextRunAt` advancement, versioned readiness revalidation,
   mapping change before generation, delete-vs-process/retry/publish fencing, and crash boundaries.
   Observe RED incrementally.
2. Implement reserve/process/tick with one pending window and transactional state fences. Internal
   run requests are serialized once into outbox `payloadJson`; unknown publish acknowledgement leaves
   them pending for identical-byte retry.
3. Add frozen publisher tests using an injected Google Pub/Sub topic. Assert published `Buffer`
   exactly equals persisted UTF-8 `payloadJson` for initial and retry paths. Implement the smallest
   adapter over `@google-cloud/pubsub`.
4. Add format/delivery tests for bounded WhatsApp-safe text, `important=true`, canonical run CTA,
   frozen event timestamp, stable run-derived idempotency key, exact bytes, ready/missing status,
   definitive failed receipt, pending reconciliation, sent label, and ambiguous no-retry. Observe RED.
5. Implement formatting, external outbox publish, and receipt reconciliation. Do not call a provider
   or select a phone; publish only `userId` through the existing topic.
6. Register `message-digest-runs` consistently in the local Pub/Sub server, UI, README, and publish
   smoke script. Wire its emulator subscription/forwarder to
   `/internal/message-digests/pubsub/run`. Add an integration test proving the exact persisted UTF-8
   bytes reach that route and a duplicate forward stays idempotent.
7. Add internal-route tests for scheduler auth, bounded due-definition paging, Pub/Sub envelope
   validation, idempotent duplicate, misconfiguration, and safe no-op. Implement routes and re-run
   all task tests; expect GREEN.

Focused command:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/reserveMessageDigestRun.test.ts apps/message-digest-service/src/domain/usecases/processMessageDigestRun.test.ts apps/message-digest-service/src/domain/usecases/reconcileMessageDigestDelivery.test.ts apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.test.ts apps/message-digest-service/src/infra/pubsub/frozenPayloadPublisher.test.ts apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts apps/message-digest-service/src/__tests__/internalMessageDigestRoutes.test.ts apps/message-digest-service/src/__tests__/localPubSubForwarding.test.ts scripts/__tests__/pubsub-publish-test.test.ts
```

### Task 10: Close the backend MVP gate

1. Run service package coverage and inspect uncovered business branches. Add focused tests only for
   genuinely missing behavior; do not lower thresholds or add coverage ignores.
2. Run the focused WhatsApp, clients, prompts, and service suites below, then their typechecks and
   targeted lint. Fix only observed failures and repeat the affected command.
3. Run workspace ownership/export validation for the touched packages and `git diff --check`.
4. Self-review every backend acceptance item in the execution goal. Then request one bounded
   read-only backend/security review. Fix every accepted Critical/Important finding with RED/GREEN
   tests and repeat only affected focused gates.
5. Record privacy-safe MVP backend evidence in the execution goal checkpoint section. Do not commit
   and do not run full CI.

Commands:

```bash
pnpm --filter @intexuraos/message-digest-service test:coverage
cd apps/whatsapp-service && pnpm exec vitest run src/__tests__/domain/whatsapp/privateWhatsAppDigestSource.test.ts src/__tests__/infra/privateDigestSourceToken.test.ts src/__tests__/infra/privateWhatsAppDigestSourceRepository.test.ts src/__tests__/privateDigestSourceRoutes.test.ts src/__tests__/outboundDeliveryRoutes.test.ts src/__tests__/pubsubRoutes.test.ts
pnpm exec vitest run packages/internal-clients/src/whatsapp-service/__tests__/client.test.ts packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/whatsapp-service typecheck
pnpm --filter @intexuraos/internal-clients typecheck
pnpm --filter @intexuraos/llm-prompts typecheck
pnpm exec eslint apps/message-digest-service/src apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsAppDigestSource.ts apps/whatsapp-service/src/domain/whatsapp/ports/privateWhatsAppDigestSourceRepository.ts apps/whatsapp-service/src/domain/whatsapp/usecases/readPrivateWhatsAppDigestSource.ts apps/whatsapp-service/src/infra/firestore/privateWhatsAppDigestSourceRepository.ts apps/whatsapp-service/src/routes/privateDigestSourceRoutes.ts apps/whatsapp-service/src/routes/outboundDeliveryRoutes.ts packages/internal-clients/src/whatsapp-service packages/llm-prompts/src/message-digest packages/whatsapp-pubsub-client/src --max-warnings 0
pnpm run verify:workspace:tracked -- message-digest-service
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:package-exports
pnpm run verify:firestore
git diff --check
```

## Plan completion gate

This plan is complete only when the source boundary and backend MVP are locally green, no
Critical/Important review finding remains, and all emitted evidence is privacy-safe. Continue
directly to `2026-07-27-whatsapp-message-digests-mvp-web.md`; do not commit, deploy, migrate, or run
full CI.
