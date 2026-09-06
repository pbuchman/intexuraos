# Conversation Assistant Context Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Apply superpowers:test-driven-development for every behavioral change. Subagents may review completed increments but must not share a writable task with another agent.

**Goal:** Let a user freeze all newly available WhatsApp context, inspect it as an immutable attachment, send it atomically with one follow-up question, receive a deterministic count/range acknowledgment and a context-aware answer, and carry that auditable history through PDF export, reload recovery, PR delivery, and deployment of the exact verified SHA to Hetzner.

**Architecture:** Keep the initial analysis immutable. Add a per-chat monotonic context-change journal beside the event-time frontier, create immutable attachment snapshots behind fenced asynchronous preparation, and atomically consume one ready attachment with an idempotent turn request before invoking the LLM. The shared Web/PWA client treats the attachment as a composer draft until send and then renders it permanently on the user turn. Existing WhatsApp Pub/Sub, service, authentication, transcript/context chunk stores, and deployment workflow are extended; no new service, topic, or environment variable is introduced.

**Tech Stack:** TypeScript, Fastify, Firestore transactions and TTL, Google Pub/Sub, React 19, React Router, TailwindCSS, Server-Sent Events, Vitest, Testing Library, PDFKit through `@intexuraos/infra-pdf-export`, real Google Chrome, GitHub Actions, and Hetzner/PM2/nginx.

## Accepted Product Decisions

- `Include new messages` is an explicit full-label composer action. It fixes a server cutoff and prepares a draft without changing the session.
- `Send` atomically attaches that immutable snapshot to the question and only then advances the session's event and change watermarks.
- The acknowledgment is deterministic application text. `Added N` counts only analyzable message bodies actually supplied to the model; omissions and corrections are separate persisted counts.
- Zero included messages is valid. Post-cutoff messages require explicit refresh. The typed question always survives prepare, remove, retry, refresh, stale-version, reload, and connectivity failures through an origin-scoped per-session `sessionStorage` draft with a 30-minute rolling TTL; no WhatsApp content is stored there.
- When an attachment exists, the draft expires no earlier than `attachment.expiresAt + 5 minutes`; the allowlist may additionally contain only `warningAcknowledged: boolean`, never the server confirmation token. A per-tab runtime nonce and BroadcastChannel handshake prevent duplicated tabs from reusing an unstarted mutable request id.
- The source-of-truth correctness model is a chronological frontier plus a per-chat monotonic change sequence with immutable sanitized `before`/`after` projections.
- Initial and attached contexts are immutable and hash chained. No path silently truncates, summarizes, or mutates context.
- One model operation may be active per session. Durable request ids, fingerprints, leases, deterministic turn ids, explicit sequence numbers, and completed revisions provide retry and disconnect recovery.
- Legacy sessions without reliable watermarks cannot attach context and offer `Start a new analysis`.
- Pending attachment metadata and chunks share a native Firestore TTL. A manifest hard-capped at 400 chunks lets atomic send verify every chunk and clear its TTL inside the commit transaction. Compact turn-request fingerprints and deterministic ids live until session deletion. Committed snapshots live until session deletion or privacy erasure.
- The pull request targets `development`, does not require a Linear issue id, is not implicitly merged, and the exact verified feature SHA is manually deployed through the supported Hetzner workflow.

## Global Engineering Gates

- Begin from the already verified clean `origin/development` branch point on `codex/conversation-assistant-include-new-messages`.
- Add a failing test before every production behavior. Observe the intended failure, implement only enough to pass, then refactor with the focused suite green.
- Backend domain and repository branches require complete coverage. Tests use fakes or isolated emulators and never shared Firestore data.
- Do not expose message text, questions, labels, phone numbers, ids, hashes, or credentials in logs, metrics, screenshots, PR text, or this plan.
- Prompt behavior and integrity-contract changes require `CONVERSATION_ASSISTANT_PROMPT_VERSION = '5.0.0'` and prompt-version verification.
- Register migration 124 without altering its immutable file, then add migration 125 and regenerate indexes/manifest checksums through repository tooling.
- Make one intentional feature commit only after a complete successful `pnpm run ci:tracked` run. Rebase/fetch integration requires the same gate again before push.

## Endpoint Changes

### Created

| Method | Path | Contract |
| --- | --- | --- |
| POST | `/api/whatsapp/conversation-assistant/sessions/:sessionId/context-attachments` | Body `{ requestId, replacesAttachmentId? }`; returns `202` and server-selected immutable capture boundaries. Same id/body replays; changed body returns `409 CONFLICT`. |
| GET | `/api/whatsapp/conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId` | Returns ownership-scoped public preparation state, counts, event range, cutoff, warning, and error. |
| GET | `/api/whatsapp/conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId/messages` | Returns cursor-paginated included and omitted audit projections, never internal hashes or raw Matrix data. |
| DELETE | `/api/whatsapp/conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId` | Idempotently removes only an uncommitted draft and its chunks. |
| POST | `/api/whatsapp/conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId/preparation/retry` | Requeues a failed attachment with the same cutoff and watermarks. |
| GET | `/api/whatsapp/conversation-assistant/sessions/:sessionId/turn-requests/:requestId` | Returns durable public request state and persisted turns for stream-disconnect recovery. |
| POST | `/api/whatsapp/conversation-assistant/sessions/:sessionId/turn-requests/:requestId/answer/retry` | Reclaims only a terminal failed answer and atomically replaces its deterministic error turn; never appends the question or attachment again. |
| POST | `/internal/whatsapp/private/accounts/:sourceAccountId/erasure` | Internal-authenticated idempotent start for a generation-fenced physical privacy cascade using `erasureRequestId`; separate from public disconnect. |
| GET | `/internal/whatsapp/private/accounts/:sourceAccountId/erasure/:erasureRequestId` | Internal-authenticated status/recovery for the bounded cascade; returns no deleted content. |

### Modified

- `POST /api/whatsapp/conversation-assistant/sessions` accepts validated `displayTimeZone`; prepared sessions persist continuation watermarks, chain hash, sequences, and revisions.
- Session list/detail/context responses add continuation availability, context version, snapshot summaries, cumulative counts, and latest completed revision.
- `GET .../turns` orders by explicit sequence and returns an immutable attachment summary on attachment-question turns.
- Public DTOs use an authoritative `available | legacy_session | source_unavailable` context state, remove `transcriptSha256`, and expose no source ids, watermarks, hashes, generation ids, claims, leases, or storage ids. Attachment status separately reports frozen counts, `completedTranscriptions`, and post-cutoff message/correction counts.
- Attachment preview is one opaque-cursor `included | excluded | correction` item stream; context history is `Initial snapshot` followed by committed update summaries. The stable hard-limit code is `CONTEXT_WINDOW_EXCEEDED`, and answer-only recovery is `POST .../turn-requests/:requestId/answer/retry`.
- `POST .../turns` and `POST .../turns/stream` accept `{ requestId, question, contextAttachmentId?, confirmationToken? }` and share one idempotent atomic operation. New clients always send `requestId`. For rolling compatibility only, the server accepts the old exact plain body `{ question }` and generates a durable compatibility id; omitting `requestId` is rejected whenever attachment or confirmation fields are present.
- SSE events add `request_state` and `context_attached`; every event carries `requestId` plus connection-local monotonic `streamSequence`, while persisted milestones carry durable `stateVersion`. Recovery guarantees persisted milestone/turn replay by request id, not token-delta replay.
- PDF exports exactly the latest completed revision with attachment summaries and deterministic acknowledgments.
- Session deletion cascades through attachment metadata, request records, and all attachment chunks.

### Removed

- None.

### Unchanged

- Authentication and response envelopes.
- Initial context check, request lookup, initial preparation retry, model selection, and deletion-token contract.
- Public `DELETE /private/account` remains a reversible disable/disconnect operation and does not trigger physical erasure.
- Public clients cannot choose chat/account ids, cutoff time, source ranges, watermarks, counts, hashes, or sequence values.

---

### Task 1: Normalize Matrix source relations and define journal contracts

**Files:**
- Modify: `tools/whatsapp-private-matrix-sync/src/server.mjs`
- Modify: `tools/whatsapp-private-matrix-sync/src/server.test.mjs`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsApp.ts`
- Create: `apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsAppContextJournal.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/privateWhatsAppRepository.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/index.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/ingestPrivateWhatsAppEvents.ts`
- Test: `apps/whatsapp-service/src/__tests__/usecases/ingestPrivateWhatsAppEvents.test.ts`

**Interfaces:**

```ts
export type PrivateWhatsAppContextChangeType =
  | 'created'
  | 'transcription_changed'
  | 'edited'
  | 'redacted'
  | 'deleted' // read-only compatibility for older stored rows; current ingest never emits it
  | 'reaction_changed';

export interface PrivateWhatsAppContextChange {
  userId: string;
  sourceAccountId: string;
  chatId: string;
  sequence: number;
  messageId: string;
  messageRevision: number;
  changeType: PrivateWhatsAppContextChangeType;
  changedAt: Date;
  eventTimestamp: Date;
  before: PrivateWhatsAppContextProjection;
  after: PrivateWhatsAppContextProjection;
}
```

Pending relation events remain deterministic private-message documents with normalized `relation: { kind, targetMatrixEventId, applicationStatus }`. The relation event id is the dedupe key; a resulting journal entry always revisions the logical target message.

- [ ] Add Matrix adapter tests for `m.replace`/`m.new_content`, `m.room.redaction`, reaction target relations, ordinary messages, malformed relations, and a relation arriving before its target. Confirm the new relation assertions fail while existing message tests remain green.
- [ ] Normalize source events into explicit `relation: { kind, targetMatrixEventId, applicationStatus }` plus replacement content; do not pass raw Matrix payloads, URLs, or sender phone numbers into journal projections.
- [ ] Add domain projection, journal, relation, context-state, revision, and latest-change-sequence types. Keep all new fields additive for stored legacy documents.
- [ ] Add failing ingest tests for edit, redaction, reaction update, out-of-order relation replay, duplicate event replay, and projection-identical no-op.
- [ ] Extend ingest to call one repository mutation boundary for creations and relations; persist an idempotent pending relation as the deterministic source-message document when the target is absent, then apply pending relations in event order when the target appears.
- [ ] Run `pnpm exec vitest run tools/whatsapp-private-matrix-sync/src/server.test.mjs apps/whatsapp-service/src/__tests__/usecases/ingestPrivateWhatsAppEvents.test.ts` and require every test to pass.

### Task 2: Persist an atomic source change journal and dual watermarks

**Files:**
- Modify: `apps/whatsapp-service/src/infra/firestore/privateWhatsAppRepository.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/privateWhatsAppRepository.test.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/privateStoredMediaTranscription.ts`
- Modify: `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/fakes.ts`

**Repository contract:**

```ts
getConversationContextJournalHead(input: OwnedChatInput): Promise<number>;
findConversationContextJournalEntries(input: OwnedChatInput & {
  afterSequence: number;
  throughSequence: number;
}): Promise<PrivateWhatsAppContextChange[]>;
findConversationContextMessagesByIds(input: OwnedChatInput & {
  messageIds: string[];
}): Promise<PrivateWhatsAppMessage[]>;
```

- [ ] Write repository tests proving one Firestore transaction updates the source projection, increments the owned chat sequence, and writes one immutable journal event for create, transcription completion, edit, Matrix redaction, and reaction changes.
- [ ] Prove identical retries do not increment sequence; concurrent changes allocate strict contiguous sequences; the journal query is ownership-scoped and ordered; a transaction failure changes neither source nor journal.
- [ ] Implement a single projection-diff helper and transaction primitive used by normal ingest, relation application, reaction resolution, and transcription update.
- [ ] Store sanitized `before` and `after` projections sufficient to reconstruct cutoff state; explicitly exclude raw Matrix events, media URLs/binaries, phone numbers, and provider payloads.
- [ ] On Matrix redaction, scrub target text, transcription text/summary/content-bearing error, media names/URIs/paths, and raw Matrix content while retaining only the sanitized tombstone needed for ordering and dedupe. Do not infer a second deletion category: the production WhatsApp bridge exposes message removal only as `m.room.redaction`; normalize any older stored `deleted` tombstone to `redacted` at public boundaries.
- [ ] Add transcription route/use-case tests showing pending/failed to completed changes journal once and a replay with identical text is a no-op; update the repository return signature so callers can distinguish changed from unchanged.
- [ ] Add bounded journal reads and message-id hydration with stable ordering and ownership checks.
- [ ] Run `pnpm exec vitest run apps/whatsapp-service/src/__tests__/infra/privateWhatsAppRepository.test.ts apps/whatsapp-service/src/__tests__/usecases/ingestPrivateWhatsAppEvents.test.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts` and require all branches to pass.

### Task 3: Reconcile initial snapshots and build exact-cutoff deltas

**Files:**
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`

**Algorithm:**

```ts
const startSeq = await source.getConversationContextJournalHead(ownedChat);
const scanned = await source.findConversationContext(range);
const cutoffSeq = await source.getConversationContextJournalHead(ownedChat);
const changes = await source.findConversationContextJournalEntries({
  ...ownedChat,
  afterSequence: startSeq,
  throughSequence: cutoffSeq,
});
const reconciled = reconcileContextAtCutoff(scanned, changes, cutoffSeq);
```

- [ ] Add failing tests for initial-scan concurrent insert/update, equal event timestamps, duplicate ids, journal no-op, and stable persisted `contextEventThrough`, `contextChangeThrough`, `contextVersion = 0`, sequence/revision counters, and chain hash.
- [ ] Implement initial scan reconciliation without changing the existing half-open range contract or immutable initial transcript bytes.
- [ ] Add pure delta-builder tests covering chronological extension, late ingest inside the original lower bound, transcription completion, edit, Matrix redaction tombstone, legacy deleted-to-redacted public normalization, reaction correction, overlap dedupe, zero, omitted-only, and a post-cutoff mutation observed during scan.
- [ ] Implement exact-cutoff reconstruction: union event frontier and journal range, collapse by logical message/revision, and use the earliest post-cutoff event's `before` projection when a document changed after click.
- [ ] Ensure late backfill before original `range.from` remains excluded and output ordering is deterministic by event timestamp/message id with corrections ordered by source sequence.
- [ ] Run the two focused domain suites and verify 100% branch coverage for the new reconciliation helpers.

### Task 4: Add immutable attachment storage and fenced preparation

**Files:**
- Create: `apps/whatsapp-service/src/domain/conversation-assistant/contextAttachmentUseCases.ts`
- Create: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/contextAttachmentUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/fakes.ts`

**State and transaction contracts:**

```ts
type ContextAttachmentStatus =
  | 'queued'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'expired'
  | 'committed';

createContextAttachment(input): Promise<
  | { kind: 'created'; attachment: ConversationAssistantContextAttachment }
  | { kind: 'replay'; attachment: ConversationAssistantContextAttachment }
  | { kind: 'conflict' | 'not_found' | 'unsupported' }
>;
```

- [ ] Write use-case tests proving the attachment transaction reads the owned session and source chat together, commit/server time supplies `capturedAt`, a concurrent source mutation retries the transaction, and `cutoffChangeSeq` has neither gap nor duplicate; also cover deterministic same-request replay, fingerprint conflict, unsupported legacy session, deleted/stale generation, two drafts at one base, replacement intent, fixed-boundary retry, and zero-delta readiness.
- [ ] Write repository tests for create-if-absent, preparation attempt/claim/lease fencing, chunk-first publication, lost-fence orphan cleanup, cursor preview, expiry, remove, and generation-fenced session deletion.
- [ ] Implement attachment creation without advancing session watermarks; publish only after the create transaction commits.
- [ ] Reuse transcript/context chunk formats with unique attachment snapshot ids and `sessionGenerationId`; expose domain/public `expiresAt` as ISO while the Firestore adapter stores identical native-Timestamp `expireAt` on pending metadata and chunks.
- [ ] Build and persist transcript delta, structured preview, actual event range, omission/correction breakdown, input estimate, previous/result chain hashes, opaque attachment-bound warning confirmation token, and exact chunk-id manifest before fenced `ready` transition.
- [ ] Fail preparation with `ATTACHMENT_TOO_LARGE` when the manifest would exceed 400 chunks; test exactly 400, 401, a missing chunk, expiry during prepare, and native-TTL deletion racing send. Never truncate.
- [ ] Implement remove/expiry cleanup and ensure committed documents cannot be removed independently.
- [ ] Run the two focused suites and inspect repository coverage before continuing.

### Task 5: Expose attachment preparation through existing Pub/Sub and HTTP

**Files:**
- Modify: `apps/whatsapp-service/src/domain/whatsapp/events/events.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/events/index.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/eventPublisher.ts`
- Modify: `apps/whatsapp-service/src/infra/pubsub/publisher.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/pubsubPublisher.test.ts`
- Modify: `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- Modify: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`
- Modify: `apps/whatsapp-service/src/services.ts`

**Event:**

```ts
interface ConversationAssistantContextAttachmentPreparationRequestedEvent {
  type: 'whatsapp.conversation-assistant.context-attachment.prepare';
  userId: string;
  sessionId: string;
  sessionGenerationId: string;
  attachmentId: string;
  attempt: number;
}
```

- [ ] Add failing publisher tests proving the new event uses the existing webhook-process topic and reports a missing configured topic through the current failure contract.
- [ ] Add failing Pub/Sub route tests for validation, claim success, stale generation, duplicate delivery, lost lease, preparation failure, and no private payload logging.
- [ ] Add `queued` publication tests: successful claim moves queued to preparing, definite publish failure compare-and-sets queued to failed, ambiguous duplicate delivery is idempotent, and expired claim recovery preserves the original cutoff.
- [ ] Add route/OpenAPI tests for every created attachment endpoint: auth, body/path validation, ownership-not-found equivalence, `202`, replay, `409`, cursor preview, retry, idempotent delete, and public DTO field allowlist.
- [ ] Implement the event publisher/handler and routes using the same dependencies and response-envelope conventions as initial preparation.
- [ ] Ensure the client never submits source ids, cutoff, count, watermark, range, hash, generation, or claim values.
- [ ] Run publisher, Pub/Sub, and conversation-assistant route suites together.

### Task 6: Make turn send durable, atomic, idempotent, and recoverable

**Files:**
- Create: `apps/whatsapp-service/src/domain/conversation-assistant/turnRequestUseCases.ts`
- Create: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/turnRequestUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts`
- Modify: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`

**Atomic begin result:**

```ts
type BeginTurnRequestResult =
  | { kind: 'started'; request: ConversationAssistantTurnRequest; userTurn: ConversationAssistantTurn }
  | { kind: 'replay'; request: ConversationAssistantTurnRequest; turns: ConversationAssistantTurn[] }
  | { kind: 'conflict'; code: 'REQUEST_BODY_CONFLICT' | 'TURN_IN_PROGRESS' | 'STALE_CONTEXT_ATTACHMENT' }
  | { kind: 'not_found' };
```

- [ ] Write failing use-case tests for plain and attached turn start, attachment/question/request fingerprint, identical replay, changed-body conflict, one active lease, stale attachment, large-context confirmation, lease reclaim, deterministic ids, delete race, and no model call before commit.
- [ ] Write repository transaction tests proving atomic request + user turn + two sequence reservations + revision reservation + attachment commit + verification/TTL clearing of every manifested chunk + both watermark advances + aggregate updates + active lease, with a 400-chunk cap and fail-closed missing/expired chunk behavior.
- [ ] Implement `beginTurnRequest`, `renewTurnRequestLease`, and fenced `completeTurnRequest`/`failTurnRequest`; exactly-once visible turns are required even when the external model call repeats.
- [ ] Keep generation, request, claim, lease, deletion marker, and conversation revision fences in every finalization transaction.
- [ ] Add tests proving a failed model creates one persisted acknowledged assistant error turn, `Try answer again` regenerates only the answer, and a later success does not append/consume the attachment again.
- [ ] Add SSE tests for `request_state`, `context_attached`, `user_turn`, deterministic acknowledgment deltas, model deltas, usage, assistant turn, and done; every event has request id and connection-local `streamSequence`, while persisted milestones advance `stateVersion`.
- [ ] Prove an old attempt that loses its lease cannot emit or finalize after reclaim; the replacement attempt replays persisted milestones and owns all later stream output.
- [ ] Prove socket disconnect does not cancel work, socket writes stop safely, request-status lookup recovers persisted turns, and completed replay does not promise token-delta replay. Retain the compact fingerprint/idempotency record for the full session lifetime.
- [ ] Define an acknowledged assistant error as a structurally terminal completed revision; test PDF during failure and atomically replace the deterministic error turn on same-request answer retry without recommitting the attachment.
- [ ] Run turn use-case, repository, and route suites together with backend branch coverage enabled.

### Task 7: Build Prompt V5, deterministic acknowledgment, PDF revision, and privacy cleanup

**Files:**
- Modify: `packages/llm-prompts/src/shared/types.ts`
- Modify: `packages/llm-prompts/src/types.ts`
- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts`
- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/index.ts`
- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts`
- Modify: `packages/infra-pdf-export/src/types.ts`
- Modify: `packages/infra-pdf-export/src/conversationPdfExporter.ts`
- Modify: `packages/infra-pdf-export/src/__tests__/conversationPdfExporter.test.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`

**Prompt builder:**

```ts
export interface PromptBuilder<
  TInput,
  TDeps extends PromptDeps = PromptDeps,
  TOutput = string,
> {
  build(input: TInput, deps: TDeps): TOutput;
}
```

- [ ] Add prompt tests asserting version `5.0.0`, byte-stable initial transcript block, chronological initial/turn/attachment history, correction/tombstone precedence, untrusted-evidence instruction, integrity verification, no model-generated count/range, and no duplicate acknowledgment.
- [ ] Add adversarial prompt tests for forged system/user/assistant markers, delimiter/XML/JSON/code-fence closures, Unicode bidi/control characters, and transcript instructions to falsify persisted count/range; normalize unsafe control characters and keep all snapshot text exclusively in a data-role block.
- [ ] Implement structured prompt history so every committed attachment is loaded from its immutable snapshot linked to its user turn; never read the current source chat during model generation.
- [ ] Add acknowledgment formatter tests for included, zero, omitted-only, transcription, edits/redactions/reactions, IANA timezone, and invalid legacy timezone fallback; persist its exact text with the assistant turn.
- [ ] Add conservative prompt-size tests for warning, signed confirmation, hard rejection before lease/model cost, and absence of silent truncation.
- [ ] Add PDF tests for one coherent `completedConversationRevision`, active-request exclusion, attachment summaries, acknowledgment, and absence of raw transcripts, source ids, hashes, and private bodies.
- [ ] Implement a repository snapshot read pinned to completed revision and update the exporter without embedding attachment bodies.
- [ ] Persist immutable internal `sourceAccountId` on new assistant sessions. Extend assistant-session deletion and authenticated private-account erasure tests to cover source messages/chats/pending relations/journal plus every dependent assistant session, request fingerprint, turn, attachment, and chunk; cover prepare/model races, partial-crash retry, reconnect generation, and no data revival. Preserve ordinary assistant-session deletion semantics for source WhatsApp data.
- [ ] Run prompt, PDF, formatting, session, and repository suites; run `pnpm run verify:prompt-versions`.

### Task 8: Add Web API contracts and a reload-safe attachment/turn state machine

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/conversationAssistantApi.ts`
- Modify: `apps/web/src/services/__tests__/conversationAssistantApi.test.ts`
- Modify: `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`
- Modify: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`

**Public hook state:**

```ts
type PendingContextAttachmentState =
  | { phase: 'idle' }
  | { phase: 'restoring' }
  | { phase: 'preparing'; attachment: PublicContextAttachment }
  | { phase: 'ready'; attachment: PublicContextAttachment }
  | { phase: 'newer_available'; attachment: PublicContextAttachment }
  | { phase: 'failed'; attachment: PublicContextAttachment; error: string }
  | { phase: 'expired'; attachment: PublicContextAttachment }
  | { phase: 'stale'; attachment: PublicContextAttachment };
```

- [ ] Add API-client tests for all six new endpoints, encoded ids, bearer auth, request bodies, `202`/replay/`409`, cursor envelopes, abort/disconnect behavior, and public response parsing.
- [ ] Add hook tests for restore/create/poll/ready/zero/corrections-only/failed/retry/remove/refresh/newer-available/expired/stale/unsupported states and preservation of the typed draft in every path.
- [ ] Add send tests proving question plus ready attachment share one request id; draft and attachment clear only after persisted `user_turn`; network retry reuses the same ids/fingerprint.
- [ ] Add reload tests that store request/attachment ids plus only the unsent question in a per-session `sessionStorage` record with a 30-minute rolling TTL; restore behind a `restoring` phase; clear on persisted `user_turn`, session deletion, logout, user/session change, and expiry; never store WhatsApp bodies, previews, source identity, acknowledgment, or answers; ignore stale responses from another session.
- [ ] Add two-tab conflict and active-request tests; reconcile from server truth without duplicate visible turns.
- [ ] Implement API types/client and hook reducer. Keep plain-question behavior backward compatible for continuation-eligible and legacy sessions.
- [ ] Run Web API and hook suites and require all state-transition branches to pass.

### Task 9: Implement responsive, accessible composer and immutable timeline UX

**Files:**
- Modify: `apps/web/src/components/whatsapp/ConversationAssistantComposer.tsx`
- Modify: `apps/web/src/components/whatsapp/ConversationAssistantContextModal.tsx`
- Create: `apps/web/src/components/whatsapp/ConversationAssistantContextAttachmentCard.tsx`
- Create: `apps/web/src/components/whatsapp/ConversationAssistantTurnBubble.tsx`
- Create: `apps/web/src/components/whatsapp/__tests__/ConversationAssistantContextAttachmentCard.test.tsx`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantSessionPage.tsx`
- Modify: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantSeparatedPages.test.tsx`

- [ ] Write component/page tests for the full-label Include action, restoring/preparing states, editable textarea, send gating, ready counts/range/cutoff, preview, visible-text Remove, refresh, retry, zero, corrections-only, omissions, newer-available, expired, stale conflict, unsupported legacy copy, and unavailable source state.
- [ ] Add large-context tests for exact warning copy, `Continue with this snapshot`, disabled normal Send before confirmation, persisted confirmation across reload, and hard rejection copy `This update is too large to include in one question.` with only `Remove attachment` and `Start a new analysis`; the latter opens separately or confirms navigation so the current draft is never silently discarded or falsely described as transferred.
- [ ] Add timeline tests proving committed cards sit above their exact question, cannot be removed, remain after reload, and open the immutable snapshot instead of current chat data.
- [ ] Add context-history tests showing `Initial snapshot` followed by ordered update snapshots linked to turns, while preserving current initial-context pagination.
- [ ] Add accessibility tests for named group order, visible labels, 44-pixel targets, polite success live region, alert errors, `aria-busy`, dialog focus trap/Escape/focus return, Include/readiness/Remove/Retry/Refresh inline focus rules, keyboard send, and color-independent meaning.
- [ ] Add responsive tests for 320 CSS pixels, 200% zoom-compatible layout, mobile keyboard/safe-area spacing, no horizontal overflow, and shared PWA/Desktop behavior.
- [ ] Split turn and attachment rendering out of the session page, implement the tested UI, and keep the question intact through every attachment action.
- [ ] Run card and separated-page suites, then `pnpm run verify:workspace:tracked -- web`.

### Task 10: Register collections, immutable indexes, TTL, telemetry, and operating docs

**Files:**
- Modify: `firestore-collections.json`
- Modify: `firestore.indexes.json`
- Modify: `terraform/modules/firestore/ttl.tf`
- Modify: `migrations/manifest.json`
- Create: `migrations/125_whatsapp-conversation-assistant-context-attachments-indexes.mjs`
- Create: `migrations/__tests__/125-whatsapp-conversation-assistant-context-attachments-indexes.test.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/privateWhatsAppRepository.ts`
- Modify: `apps/whatsapp-service/src/routes/privateReadRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/privateSyncRoutes.test.ts`
- Modify: `packages/common-http/src/http/logger.ts`
- Modify: `packages/common-http/src/__tests__/logger.test.ts`
- Modify: `packages/infra-sentry/src/fastify.ts`
- Modify: `packages/infra-sentry/src/__tests__/fastify.test.ts`
- Modify: relevant Conversation Assistant documentation discovered by `rg -n "Conversation Assistant" docs apps/whatsapp-service/README.md apps/web/README.md`

- [ ] Add a failing migration test for journal sequence scan, attachment cleanup/listing, turn-request recovery, and turn ordering indexes.
- [ ] Register existing immutable migration 124 in the manifest with its computed checksum without editing migration 124, then reserve and implement migration 125 through repository migration tooling.
- [ ] Register `whatsapp_private_context_changes`, `whatsapp_conversation_assistant_context_attachments`, and `whatsapp_conversation_assistant_turn_requests` with `whatsapp-service` ownership; add the relation-target index to the existing private-message collection.
- [ ] Configure TTL only for pending attachment metadata and existing chunk collections on native Timestamp `expireAt`. Verify committed writes remove it from metadata and every manifested chunk atomically; turn-request fingerprints remain until session deletion.
- [ ] Add an explicit internal-authenticated, idempotent privacy-erasure request/status workflow on the existing webhook-process topic, with `sourceAccountId` dependency lookup, generation fencing, bounded cascade progress, and recovery after partial failure. Keep public `DELETE /private/account` disable-only.
- [ ] Normalize logged/Sentry URLs to route templates and strip dynamic ids/query strings for the new assistant and account-erasure endpoints; add regression tests proving ids and request bodies are absent.
- [ ] Add content-free metrics for preparation outcomes/counts/duration, estimated size, conflicts/replays/lease recovery, disconnects, PDF revision, cleanup, and chain mismatch. Assert forbidden ids, hashes, labels, questions, and text never become dimensions or structured log properties.
- [ ] Document endpoint changes, state machine, recovery contract, privacy behavior, limits, rollout/rollback, manual same-SHA deployment, and operational signals.
- [ ] Run `pnpm run verify:migrations`, migration tests, collection ownership checks, and Terraform formatting/validation commands already used by `ci:tracked`.

### Task 11: Run independent reviews and complete automated verification

**Files:**
- Modify only files justified by evidence-backed findings; add a failing regression test before each behavioral correction.

- [ ] Dispatch five independent read-only reviews over the complete diff: UX/accessibility, architecture/data lifecycle, security/privacy/prompt injection, concurrency/idempotency/SSE, and test/requirement coverage.
- [ ] Triage each finding against code and tests. Fix accepted findings test-first; record rejected findings with concrete evidence; rerun the relevant reviewer after material corrections.
- [ ] Run focused test groups for Matrix sync, WhatsApp source repository/ingest/transcription, assistant domain/repositories/routes/PubSub, prompts, PDF, Web API/hook/components/pages, and migrations.
- [ ] Run `pnpm run verify:workspace:tracked -- whatsapp-service`, `pnpm run verify:workspace:tracked -- web`, `pnpm run verify:workspace:tracked -- llm-prompts`, and `pnpm run verify:workspace:tracked -- infra-pdf-export`.
- [ ] Run package export verification and `pnpm run verify:prompt-versions` plus `pnpm run verify:migrations`.
- [ ] Run the complete `pnpm run ci:tracked` from a clean process environment. Preserve the fresh exit-code/test-count evidence and fix every failure before claiming success.

### Task 12: Verify the complete feature in real local Google Chrome

**Files:**
- Modify only tests/code justified by a reproducible Chrome defect. Never alter or expose `~/.intexuraos/logins.md`.

- [ ] Read the Chrome-control skill and environment login instructions; start the required local stack using the documented commands and navigate only through `http://localhost:3000/#/login`.
- [ ] Sign in with the secure test credentials without printing them, open the WhatsApp test account/chat `Test Number (WA)`, and create an analysis ending before newer test messages with the configured model.
- [ ] Prove the Thursday-to-Saturday happy path: Include, persisted count/event range/cutoff, preview, question send, deterministic acknowledgment, and context-aware answer.
- [ ] Prove zero, corrections-only, and omitted-only snapshots; a post-cutoff arrival enters `newer_available`, remains excluded until Refresh, and refresh preserves the question without introducing a second Send action.
- [ ] Prove warning confirmation survives reload, hard rejection blocks send, expiry preserves/restores the question, and stale two-tab state blocks send until recapture.
- [ ] Reload during preparation and after user-turn acknowledgment; recover by ids without duplicates. Retry answer only and verify the attachment is not appended twice.
- [ ] Race two tabs from the same context version and confirm one atomic success plus one understandable stale conflict with preserved question.
- [ ] Verify Conversation context history and completed-revision PDF, including absence of raw attachment transcript in the PDF.
- [ ] Repeat critical interactions at desktop and mobile/PWA viewport, keyboard-only, 200% zoom, and 320 CSS pixels; check focus restoration, live announcements, touch targets, safe area, and no horizontal overflow.
- [ ] Stop local processes after capturing privacy-safe acceptance evidence.

### Task 13: Integrate latest development, publish PR, deploy exact SHA, and smoke production

**Files:**
- Review the final tracked diff and PR metadata only. Do not merge the pull request.

- [ ] Read the verification, review, and commit/push skills before their respective gates.
- [ ] Fetch `origin/development`, inspect divergence, integrate it without discarding user work, resolve conflicts test-first, and rerun the complete `pnpm run ci:tracked`.
- [ ] Confirm `git diff --check`, migration/prompt verification, clean intended scope, no credentials/private messages, and no untracked generated artifacts.
- [ ] Stage only intended files and create one descriptive feature commit. Record the verified commit SHA.
- [ ] Push `codex/conversation-assistant-include-new-messages` and create a ready pull request to `development` with product decisions, Endpoint Changes, data/TTL/privacy model, automated evidence, Chrome matrix, risks, rollout, rollback, and deployment notes. Explicitly note that no Linear id is required.
- [ ] Watch required GitHub checks to successful completion. If a check changes the commit or reveals a defect, correct it test-first, rerun all gates, push, and use the new verified SHA.
- [ ] Freeze the verified ref/SHA. From that same ref, run the approved Terraform plan/apply for attachment/chunk TTL and verify the resulting policy. Stop before application rollout if the Terraform path cannot prove the frozen source ref or requires missing authority.
- [ ] Dispatch `.github/workflows/deploy.yml` for its Firestore target from the frozen ref, applying registered migrations 124/125 and indexes; verify actual workflow head/source SHA and wait until every required index reports ready.
- [ ] Only then dispatch `.github/workflows/deploy.yml` for `target=hetzner-prod` from the same frozen ref/SHA without merging the PR. Stop and report if GitHub cannot resolve that exact ref.
- [ ] Wait for deployment success and verify the deployed SHA, artifact/build publication, PM2 online state, nginx validation, direct-origin and public health, and privacy-safe logs.
- [ ] In real Google Chrome against `https://intexuraos.cloud`, repeat critical Include → preview → send → acknowledgment/answer, reload recovery, context history, and PDF smoke checks with the test WhatsApp account.
- [ ] Verify rollback compatibility with queued/preparing attachment events (old code may not process them; forward recovery must retain their cutoff), clean up only the test analyses created during acceptance, and never delete the source test chat.
- [ ] Report the ready PR URL, verified/deployed SHA, Terraform and Firestore/app workflow runs, environment, automated evidence, Chrome evidence, known limits, and rollback path. Mark the Goal complete only when the exact same SHA is verified across infrastructure and application production state.

## Requirement-to-Task Traceability

| Requirement | Tasks |
| --- | --- |
| Immutable context addition as a conversation attachment | 3, 4, 6, 9 |
| Exact new-message count/range/cutoff and follow-up answer | 3, 6, 7, 12 |
| Late ingest, transcription, edits, redactions, reactions | 1, 2, 3 |
| Atomic commit, idempotency, two tabs, SSE recovery | 4, 5, 6, 8 |
| Best Web/PWA UX and accessibility | 8, 9, 12 |
| PDF, TTL, cleanup, privacy, observability | 7, 10 |
| Independent review and full CI | 11 |
| Fresh development base, ready PR, same-SHA Hetzner deploy | 13 |
