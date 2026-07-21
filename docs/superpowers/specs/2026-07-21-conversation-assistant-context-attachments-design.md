# Conversation Assistant Context Attachments Design

## Goal

Let a user return to an existing Conversation Assistant analysis, freeze all newly available WhatsApp context through an explicit click, attach that immutable context update to one question, and continue the same analysis without rewriting its initial snapshot or historical turns.

The feature is complete only when it is covered by automated tests, reviewed independently, verified in real Google Chrome with the WhatsApp test account, published in a pull request to `development`, deployed as the same verified SHA to Hetzner, and smoke-tested there.

## User Story

A user analyzes a direct WhatsApp conversation from Monday through Thursday. On Saturday they reopen that analysis, type “How has this person's attitude changed?”, click `Include new messages`, inspect the newly frozen Thursday-to-Saturday material, and send the attachment with the question. The assistant confirms exactly what was added and then answers using the initial snapshot, earlier analysis turns, and the newly attached messages.

The context update is part of the new user turn. It is never a silent mutation of the initial transcript and never an orphan “update context” operation with no question.

## Current-State Evidence

- `ConversationAssistantSession` stores one initial range, one immutable transcript hash, one structured context snapshot id, and one transcript body.
- `ConversationAssistantTurn` stores only role, text, timestamps, usage, and error metadata.
- Both streaming and non-streaming follow-ups persist a plain user turn and rebuild the model prompt from the same initial transcript plus flat prior turns.
- The source query uses a stable half-open event-time range ordered by `(eventTimestamp, documentId)`, but it has no mutation journal.
- Client-side duplicate-send protection covers one browser tab only. Turn requests have no durable request id, sequence, backend lease, or recovery record.
- The context chunk store is already snapshot-id aware and can be extended for immutable attachment snapshots.
- PDF export currently reads the session and turns separately and exposes only initial snapshot counts.

## Product Decisions

1. The source interaction is `Include new messages`, not `Sync`, `Refresh context`, or `Add`, because it must not imply replacement or sending a WhatsApp message.
2. Clicking `Include new messages` fixes the server cutoff and creates an inspectable draft. `Send` does not recapture it.
3. A draft does not advance session watermarks. The attachment and question are committed atomically when sent.
4. The initial transcript, initial range, effective range, transcript hash, and initial structured snapshot never change.
5. `Added N` means exactly the analyzable message bodies newly supplied to the model. Omitted items and contextual corrections are reported separately.
6. A zero-message attachment is valid and can be sent with a question.
7. Content that becomes available after cutoff is excluded until the user explicitly refreshes or creates the next attachment.
8. No context is silently truncated. Large input has a visible warning and hard provider-safety rejection before any model call.
9. Sessions without reliable continuation watermarks do not guess; the UI offers `Start a new analysis`.
10. Late backfill earlier than the initial `range.from` is excluded unless a future feature explicitly expands the lower bound.
11. Normal source edits, Matrix redactions (including WhatsApp message removal as bridged by the production adapter), and reaction changes are represented as later correction records. A privacy-erasure operation physically removes affected assistant snapshots and source journal projections.
12. PDF exports the latest completed conversation revision and attachment summaries, not raw attachment transcripts.
13. The branch and pull request are linked to Linear issue `INT-1887`; the pull request body includes `Fixes INT-1887`.
14. One attachment may reference at most 400 persisted chunks. Exceeding that limit fails preparation with `ATTACHMENT_TOO_LARGE`; it never truncates data or attempts an unbounded Firestore transaction.

## Core Invariants

- Every initial and incremental snapshot is immutable after it becomes ready.
- A session has at most one active model operation.
- A ready attachment is based on one exact `contextVersion`, event frontier, change watermark, source cutoff sequence, and capture time.
- Removing, expiring, failing, or refreshing an uncommitted draft does not advance the session.
- A committed attachment is referenced by exactly one user turn.
- The attachment, user turn, new watermarks, revision, and request state become visible atomically.
- The model never receives attachment content that was not persisted and hashed first.
- Turn ordering uses an explicit monotonic `sequence`, never timestamp alone.
- `requestId + userId + sessionId` identifies one request body. Reuse with a different body is a conflict.
- The compact request fingerprint and deterministic turn ids live for the session lifetime; expiration cannot reopen an already used request id.
- Exactly-once external LLM execution is not promised; exactly-once visible user/assistant turns are required.
- Counts and ranges come from persisted metadata, never model inference.
- Source message bodies, questions, phone numbers, content hashes, speaker labels, and raw dynamic route identifiers never enter logs, metrics, or Sentry payloads; HTTP telemetry uses normalized route templates.

## UX Design

### Composer Flow

The composer exposes a full-label action above the textarea:

```text
[+ Include new messages]

┌ Latest WhatsApp messages                  View messages  Remove ┐
│ 18 messages ready to include · 2 excluded                      │
│ Messages: 17 Jul 2026, 18:49 → 19 Jul 2026, 10:09             │
│ Snapshot captured through 19 Jul 2026, 10:14                   │
└─────────────────────────────────────────────────────────────────┘

How has this person's attitude changed?                    [Send]
```

The user may type before, during, or after preparation. `Send` is disabled while the attachment is preparing, but the textarea remains editable. Once ready, the user can view, remove, refresh, or send it.

### Snapshot Timing

The capture cutoff is the server time fixed when the user clicks `Include new messages`. Messages or source changes committed after that cutoff are not part of the draft.

When later content is detected before send, the composer shows:

```text
3 newer messages arrived after this snapshot.
[Refresh attachment] [Keep current snapshot]
```

`Keep current snapshot` dismisses the notice; the normal composer `Send` remains the only action that sends. Refresh replaces the pending draft while preserving the question. It never changes a committed attachment. This `newer_available` state is distinct from `stale`: newer content does not invalidate the frozen snapshot, whereas a different tab committing the same base context does.

### Persistent Timeline

After send, the user bubble permanently renders the attachment above the instruction:

```text
New WhatsApp messages
18 included · 2 excluded
17 Jul 2026, 18:49 → 19 Jul 2026, 10:09
View messages

How has this person's attitude changed?
```

The header changes presentation from `Frozen context` to `Conversation context` once an update exists. The context viewer lists `Initial snapshot` followed by immutable update snapshots, each linked to its user turn.

### Required States

- `preparing`: loading card, editable question, send blocked, remove available.
- `restoring`: after reload, show `Restoring your question and attachment…`; Include and Send are blocked until both local draft and server attachment/request state are reconciled.
- `ready`: counts, actual event range, capture cutoff, inspect, remove, and send.
- `ready` with zero: explicit `0 included`, checked range, and omitted counts.
- `ready` with corrections only: `No new messages · 3 updates to earlier context`, followed by the persisted transcription/edit/redaction/reaction breakdown.
- `ready` with warning: show `This update contains 5,432 messages. It may take longer and could fail.` and require `Continue with this snapshot` before the normal Send becomes available.
- hard-size rejection: show `This update is too large to include in one question. Your question remains here.` with `Remove attachment` and `Start a new analysis`; Send stays blocked. Starting a new analysis opens separately (or requires an explicit navigation confirmation) and never silently discards or claims to transfer the current draft.
- `failed`: question preserved, `Try again` and `Remove` available.
- `expired`: after 30 minutes without commit, show `This attachment expired before it was sent. Your question is safe.` with `Capture again` and `Remove`.
- `newer_available`: the current snapshot remains sendable; offer `Refresh attachment` and `Keep current snapshot` without adding a second Send action.
- `stale`: another tab advanced the context; block Send and show `This analysis was updated in another tab. Your question is safe.` with `Capture again` and `Remove`.
- `committed`: permanent timeline card; it cannot be removed independently.
- active answer: next draft may be typed, but Include and Send remain unavailable until the active request completes.
- unsupported legacy session: explain that reliable continuation is unavailable and offer `Start a new analysis`.
- unavailable source chat/account: keep the historical analysis readable and explain why Include is disabled.

### Deterministic Acknowledgment

For included messages:

```text
Added 18 new messages sent between 17 July 2026, 18:49 and 19 July 2026, 10:09. The snapshot was captured at 10:14. 2 items were excluded because they had no analyzable content.
```

For an empty delta:

```text
Added 0 messages. I checked from 17 July 2026, 18:42 through 19 July 2026, 10:14 and found no new analyzable messages.
```

Corrections append a further deterministic sentence, for example `Also applied 1 completed transcription and 2 source corrections.` The application generates and persists this prefix. The prompt instructs the model to answer directly without repeating or changing it.

When there are no new message bodies but corrections exist, the acknowledgment begins `Added 0 new messages. Applied 3 updates to earlier context.` and then gives the checked range/cutoff and typed breakdown. It must not describe that attachment as empty.

Dates are formatted in the session's persisted IANA `displayTimeZone`. New web-created sessions send the browser timezone; legacy reads default to UTC but legacy sessions do not support attachments unless they have reliable watermarks.

### Accessibility And Responsive Requirements

- Include, View, Remove, Refresh, Retry, and Send have visible labels and at least 44-by-44-pixel targets.
- One polite live region announces preparation success; errors use `role="alert"`; loading uses `aria-busy`.
- The attachment is an accessible named group whose reading order is kind, counts, event range, cutoff, and omissions.
- Dialog/bottom-sheet focus is trapped, Escape closes it, and focus returns to `View messages`.
- Full localized date labels are available to screen readers; meaning never depends on color.
- The composer works at 320 CSS pixels, 200% zoom, an open mobile keyboard, and PWA safe-area insets without horizontal scrolling.
- Include does not move focus out of the textarea, readiness never steals focus, Remove returns focus to Include, and Retry/Refresh let typing continue. `Remove` remains a visible text label on mobile; an icon may supplement it but never replace it.

## Resolved Public UX Contract

The public session contract exposes one authoritative context summary instead of leaking the
internal continuation record:

```ts
type PublicContinuationAvailability =
  | { state: 'available'; displayTimeZone: string }
  | { state: 'legacy_session' | 'source_unavailable' };

interface PublicConversationContextSummary {
  availability: PublicContinuationAvailability;
  contextVersion: number;
  snapshotCount: number;
  totalAttachedMessageCount: number;
  totalAttachedOmittedCount: number;
  completedConversationRevision: number;
  activeTurn: null | { requestId: string; stateVersion: number };
}

interface PublicContextUpdateCounts {
  included: number;
  excluded: number;
  completedTranscriptions: number;
  edited: number;
  redacted: number;
  deleted?: 0; // temporary wire-compatibility field; never a separate public semantic
  reactionsChanged: number;
  lateIngested: number; // diagnostic subset, never added to the other counts
}

interface PublicConversationAssistantContextAttachment {
  id: string;
  status: 'preparing' | 'ready' | 'failed' | 'expired' | 'committed';
  compatibility: 'current' | 'stale';
  capturedAt: string;
  expiresAt?: string;
  captureRange?: { from: string; to: string };
  eventRange?: { from: string; to: string };
  counts?: PublicContextUpdateCounts;
  omitted?: PrivateConversationContextOmittedCounts;
  newerAvailableCount: number;
  newerAvailableCorrectionCount: number;
  requiresConfirmation: boolean;
  confirmationToken?: string;
  error?: {
    code: 'ATTACHMENT_TOO_LARGE' | 'PREPARATION_FAILED';
    message: string;
  };
}
```

`transcriptSha256`, source ids, generation ids, watermarks, context-chain hashes, claims, leases,
and storage snapshot ids are never public. Attachment preview returns a single cursor-paginated
`items` union (`included | excluded | correction`); correction rows expose the change kind and
safe before/after projections, while redaction never exposes removed content. Context
history returns `Initial snapshot` followed by ordered committed summaries with public selectors,
`contextVersion`, and linked turn ids. Public turns include sequence, conversation revision,
request id, kind, and their immutable attachment summary. Turn-request status includes a monotonic
`stateVersion`, persisted visible turns, stable error data, and `canRetryAnswer`.

The hard prompt-budget rejection code is `CONTEXT_WINDOW_EXCEEDED`; it never commits the user turn
or incurs a model call. Answer-only recovery uses
`POST /conversation-assistant/sessions/:sessionId/turn-requests/:requestId/answer/retry` and never
re-appends or recommits the attachment.

All composer and timeline labels use the correction-safe name `WhatsApp context update`, not
`Latest messages` or `New messages`. For the multiline composer, Enter inserts a newline and
Ctrl+Enter/Cmd+Enter sends. Pointer activation of Include/Refresh returns the caret to the textarea;
keyboard activation retains normal keyboard focus behavior. Preparation success uses one polite
live announcement, failures use an alert, and the attachment remains a named group in the agreed
reading order.

The local draft expiry is rolling 30 minutes, but when an attachment exists it is at least five
minutes later than the server attachment expiry: `max(lastEdit + 30m, attachment.expiresAt + 5m)`.
The allowlisted `sessionStorage` record may persist only ids, the unsent question, timestamps, and
the boolean `warningAcknowledged`; it never stores a confirmation token or WhatsApp/model content.
On reload the client reconciles every stored request with server state before enabling editing or
sending. A per-tab runtime nonce plus BroadcastChannel ownership handshake prevents a duplicated
tab from reusing an unstarted mutable request id; an already-started request is recovered instead
of regenerated.

## Domain Model

### Session Additions

```ts
interface ConversationAssistantSessionContinuation {
  sourceAccountId: string;
  contextVersion: number;
  contextEventThrough: string;
  contextChangeThrough: number;
  contextChainSha256: string;
  displayTimeZone: string;
  nextTurnSequence: number;
  nextConversationRevision: number;
  completedConversationRevision: number;
  attachmentCount: number;
  totalAttachedMessageCount: number;
  totalAttachedOmittedCount: number;
  activeTurnRequestId?: string;
  activeTurnLeaseExpiresAt?: string;
}
```

These fields are written for newly prepared sessions. Their absence makes an existing session continuation-ineligible.

### Context Attachment

```ts
type ContextAttachmentStatus =
  | 'queued'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'expired'
  | 'committed';

interface ConversationAssistantContextAttachment {
  id: string;
  sessionId: string;
  userId: string;
  sessionGenerationId: string;
  preparationRequestId: string;
  status: ContextAttachmentStatus;
  baseContextVersion: number;
  baseEventThrough: string;
  capturedAt: string;
  baseChangeSeq: number;
  cutoffChangeSeq: number;
  captureRange: { from: string; to: string };
  eventRange?: { from: string; to: string };
  counts: {
    included: number;
    omitted: number;
    newlyAvailable: number;
    edited: number;
    redacted: number;
    deleted: number; // internal compatibility slot, folded into redacted at every public boundary
    reactionsChanged: number;
    lateIngested: number;
  };
  omitted: PrivateConversationContextOmittedCounts;
  snapshotId?: string;
  deltaTranscriptSha256?: string;
  previousContextChainSha256?: string;
  resultingContextChainSha256?: string;
  estimatedInputTokens?: number;
  requiresConfirmation: boolean;
  confirmationToken?: string;
  preparationAttempt: number;
  preparationClaimId?: string;
  preparationLeaseExpiresAt?: string;
  preparationError?: { code: string; message: string };
  expiresAt?: string; // public/domain ISO representation
  committedTurnId?: string;
  committedAt?: string;
}
```

Public DTOs omit user id, generation id, source watermark values, hashes, claims, leases, and internal snapshot ids.

### Turn And Request Additions

```ts
interface ConversationAssistantTurn {
  sequence: number;
  conversationRevision: number;
  requestId: string;
  kind: 'message' | 'context_attachment_question';
  contextAttachmentId?: string;
  contextAttachment?: PublicConversationAssistantContextAttachmentSummary;
  // existing fields remain
}

interface ConversationAssistantTurnRequest {
  requestId: string;
  requestFingerprint: string;
  sessionId: string;
  userId: string;
  sessionGenerationId: string;
  status: 'in_progress' | 'completed' | 'failed';
  attempt: number;
  conversationRevision: number;
  userTurnId: string;
  assistantTurnId: string;
  contextAttachmentId?: string;
  claimId: string;
  attempt: number;
  leaseExpiresAt: string;
  stateVersion: number;
  createdAt: string;
  updatedAt: string;
}
```

## Source Change Journal

### Why Event Time Alone Is Insufficient

A query `[lastEventTime, capturedAt)` finds normal chronological additions but misses a late import with an older sent timestamp, a completed transcription on an existing media message, an edit, a redaction, and a reaction that changes the interpretation of an older message. A compound `(eventTimestamp, documentId)` cursor fixes timestamp ties but not those mutations.

### Chat Watermark

Each private chat stores `contextChangeSeq` and `contextChangedAt`. Every meaningful context projection change increments the sequence in the same Firestore transaction that writes the source mutation and immutable journal entry. Duplicate Matrix events and projection-identical updates are no-ops.

### Journal Projection

`whatsapp_private_context_changes` stores only the sanitized context projection needed by Conversation Assistant:

```ts
interface PrivateWhatsAppContextChange {
  userId: string;
  sourceAccountId: string;
  chatId: string;
  sequence: number;
  messageId: string;
  messageRevision: number;
  changeType:
    | 'created'
    | 'transcription_changed'
    | 'edited'
    | 'redacted'
    | 'deleted' // read-only compatibility for older stored rows; never emitted by current ingest
    | 'reaction_changed';
  changedAt: string;
  eventTimestamp: string;
  before: PrivateWhatsAppContextProjection;
  after: PrivateWhatsAppContextProjection;
}
```

The production source projection is `missing`, `included`, `omitted`, or `redacted`, with only normalized content, omission reason, direction, safe speaker label, message type, event/import dates, and normalized reaction summaries. Matrix exposes content removal through `m.room.redaction`; the WhatsApp bridge does not provide this ingestion path with a second trustworthy deletion category. Therefore the system never infers “deleted” from a reason, sender, or missing content. Older stored `deleted` tombstones are accepted only for compatibility and are normalized to `redacted` at every public boundary.

Message documents store their latest context revision sequence. Ingest, transcription updates, normalized replacements, redactions, and reaction changes all use the journal-writing repository transaction.

The Matrix sync adapter normalizes `m.replace`, `m.new_content`, `m.room.redaction`, and reaction relations before ingest. A relation arriving before its target is retained as an idempotent pending relation and applied through the same journal transaction when the target appears; replaying either event cannot allocate another sequence for an identical projection.

Pending relations are durable source-message documents, not memory-only work. Their deterministic id is derived from source account plus Matrix event id and their normalized relation contains target Matrix event id, relation kind, event time, and `applicationStatus: 'pending' | 'applied' | 'superseded'`. The relation event is the dedupe key; when it changes context, the journal entry's `messageId` and revision always identify the logical target. A target creation reads and deterministically applies pending relations in event order. The relation-target composite index, account erasure, and normal source retention cover these records.

### Stable Initial Snapshot

For a new session:

1. Read `startSeq` from the owned source chat.
2. Scan the selected event-time range with the existing stable cursor.
3. Read `cutoffSeq` after the scan.
4. Load journal events `(startSeq, cutoffSeq]`.
5. Collapse events by logical message id and apply their final `after` projections to the scan.
6. Persist the initial snapshot, `contextEventThrough = range.to`, `contextChangeThrough = cutoffSeq`, and the initial chain hash.

This closes the pagination race without mutating the resulting snapshot later.

### Attachment Snapshot

At click time, one Firestore transaction reads the owned session and the source chat document, writes the attachment, and uses Firestore commit/server time for `capturedAt`. Because every context change updates that same chat document, a concurrent change forces transaction retry; the stored `cutoffChangeSeq` and `capturedAt` therefore describe one serializable boundary. Preparation then computes the union of:

1. the chronological extension `[session.contextEventThrough, capturedAt)` for messages already stored outside the earlier selected range; and
2. journal changes `(session.contextChangeThrough, cutoffChangeSeq]` for late imports and mutations anywhere from the original `range.from` through `capturedAt`.

Changes are collapsed by logical message id and revision. New analyzable messages are sorted by `(eventTimestamp, messageId)`. Corrections retain source change sequence. Stable ids prevent duplicates between the two sets.

If a source document changes after the fixed cutoff while preparation scans it, the first immutable journal event after the cutoff provides the exact `before` projection needed to reconstruct cutoff-time state. The worker reads an observed end sequence after the scan and uses those post-cutoff events only for reconstruction; they are not committed into the attachment.

On send, the session may advance only when `contextVersion`, `contextEventThrough`, and `contextChangeThrough` still match the attachment base. The new values become `capturedAt`, `cutoffChangeSeq`, and `baseContextVersion + 1`.

## Attachment Preparation State Machine

1. Authenticated POST resolves source chat/account only from the owned session.
2. A deterministic attachment id is derived from session, generation, and preparation request id.
3. Creation records the fixed capture boundaries, status `queued`, and a short logical draft expiry, then publishes an attachment-preparation event on the existing WhatsApp webhook-process topic.
4. A successful worker claim moves `queued` or recoverable `preparing` to `preparing` with generation, attempt, claim, and lease fences. A definite publish failure uses compare-and-set `queued → failed`; retry preserves the cutoff.
5. It builds the delta, structured audit snapshot, exact transcript delta, counts, ranges, hash chain, and token estimate.
6. Snapshot chunks and a manifest of exact chunk ids/counts are persisted before metadata becomes `ready`. Preparation fails closed if the manifest would exceed 400 chunks.
7. Retry preserves the original boundaries. Refresh creates a new draft with new boundaries and expires the previous uncommitted draft.
8. Failed/expired drafts never affect the committed session. A queued item or expired preparation lease is recoverable idempotently with the original boundaries.
9. Committed attachments lose TTL and remain until session deletion or privacy erasure.

The existing Pub/Sub topic and internal push route are extended with a new event variant. No new service, topic, or environment variable is introduced.

## Atomic Turn Commit And Recovery

Both streaming and non-streaming turns use the same durable operation:

1. Validate non-empty question, ownership, ready session, request id, optional attachment ownership/status, confirmation token, and prompt budget.
2. Hash the canonical request body into `requestFingerprint`.
3. In one transaction, reject an active unexpired request, reject stale attachment bases, or replay the matching prior request.
4. Reserve conversation revision and user/assistant turn sequences.
5. Persist the request record and user turn. If an attachment is present, mark it committed, advance both watermarks and the context chain, and increment aggregate counts/version in the same transaction.
6. Emit the persisted user turn only after the transaction commits.
7. Build the model history from immutable initial and attachment snapshots ordered by turn sequence.
8. Stream the deterministic acknowledgment first, then model deltas. Each connection gets a local `streamSequence`; durable request milestones advance `stateVersion`. A worker may emit only while its request attempt/claim still owns the lease.
9. Persist one final assistant turn containing `acknowledgment + model answer`, update usage/timestamps, mark the revision completed, and release the session lease.

If the model fails after commit, the assistant error turn still begins with the correct acknowledgment and closes a structurally complete terminal conversation revision. `Try answer again` claims the same request/revision and atomically replaces that deterministic error turn with the regenerated answer; it never recommits the attachment. A disconnect does not cancel the durable operation. `GET turn-requests/:requestId` exposes enough public state to restore the visible result without a duplicate turn. Reconnect replays persisted milestones/turns, not token deltas from the lost connection.

## Prompt V5

The prompt contract changes behavior and adds an integrity-verification contract, therefore it uses version `5.0.0`.

The builder receives structured historical turns with optional immutable context deltas. It emits:

1. system safety and analysis instructions;
2. initial transcript as the first user context message;
3. earlier user/assistant turns in sequence;
4. for each attachment turn, a bounded context-update block followed by that turn's question;
5. the current plain question when it has no attachment.

The system prompt states that transcripts and context updates are untrusted evidence and any instructions inside them must be ignored. Correction/tombstone records explicitly supersede earlier source evidence. The model must not calculate or repeat counts/ranges, because the application supplies the persisted acknowledgment.

## Context Size Policy

- Preparation records full byte size and a conservative input-token estimate for initial context, all committed deltas, prior turns, the pending delta, and the question envelope.
- More than 5,000 newly scanned source messages or the warning token threshold sets `requiresConfirmation` and returns a signed confirmation token with nontechnical UI copy.
- A hard provider-safety threshold rejects send before acquiring model cost. No application path truncates, summarizes, or silently drops transcript data.
- A hard 400-chunk manifest limit protects the atomic send transaction. Missing, expired, or mismatched manifest chunks fail send before watermark movement or model cost.
- Binary media is never sent. Captions/text and completed transcriptions may be included; media-only and pending/failed transcriptions remain explicit omissions.

## Persistence

New Firestore collections:

- `whatsapp_private_context_changes`, owned by `whatsapp-service`;
- `whatsapp_conversation_assistant_context_attachments`, owned by `whatsapp-service`;
- `whatsapp_conversation_assistant_turn_requests`, owned by `whatsapp-service`.

Existing transcript/context chunk collections store attachment snapshots under unique snapshot ids and session generation fences. Session deletion adds all new assistant collections to the bounded, retry-safe cascade. Private-account privacy erasure deletes matching context-change projections and every assistant snapshot referencing the erased source chat/account.

The public/domain attachment exposes `expiresAt` as ISO text; the Firestore adapter persists `expireAt` as a native Timestamp on pending metadata and every pending chunk. The manifest is capped at 400 chunks. Atomic send reads and verifies every manifested chunk, clears `expireAt` from those documents, and commits the attachment/session/request/user-turn boundary in the same transaction; a native-TTL race therefore conflicts or fails closed rather than deleting committed context. Initial and committed snapshots omit the storage field. Compact turn-request fingerprints and deterministic ids are retained until session deletion. Journal retention is at least as long as both source private-message retention and active assistant-session retention, so no active session can lose the immutable `before`/`after` history required for an exact cutoff reconstruction.

Required composite indexes cover journal sequence scans, attachment listing/status cleanup, turn request recovery, turn ordering by sequence, and session-generation cascade queries. Index changes use a new immutable migration.

## Endpoint Changes

### Created

`POST /conversation-assistant/sessions/:sessionId/context-attachments`

Request:

```json
{ "requestId": "context-request-id", "replacesAttachmentId": "optional-old-draft" }
```

Returns HTTP 202 with a public attachment in `preparing`. The server chooses chat, base watermarks, cutoff sequence, and capture time. Reusing the same request id and fingerprint returns the same attachment; reusing it with different replacement intent returns `409 CONFLICT`.

`GET /conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId`

Returns public status, counts, ranges, cutoff, warning state, and error. It never returns internal hashes, claims, watermarks, or raw transcript text.

`GET /conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId/messages`

Returns ownership-scoped, cursor-paginated included/omitted audit projections for preview.

`DELETE /conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId`

Idempotently removes or expires only an uncommitted draft and its chunks. A committed attachment is not independently deletable.

`POST /conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId/preparation/retry`

Requeues a failed attachment with the same immutable boundaries.

`GET /conversation-assistant/sessions/:sessionId/turn-requests/:requestId`

Returns the public durable request status and any persisted turns for disconnect recovery.

`POST /conversation-assistant/sessions/:sessionId/turn-requests/:requestId/resume`

Reclaims an expired durable request lease and resumes the same request without appending another turn.

`POST /internal/whatsapp/private/accounts/:sourceAccountId/erasure`

Internal-authenticated, idempotent privacy workflow entry point. Body `{ userId, erasureRequestId }` creates a generation-fenced erasure request and publishes its bounded cascade on the existing webhook-process topic. It is deliberately separate from public `DELETE /private/account`, which remains a reversible mirror disconnect/disable operation.

`GET /internal/whatsapp/private/accounts/:sourceAccountId/erasure/:erasureRequestId`

Internal-authenticated status/recovery endpoint for the retry-safe cascade; it returns counts/status only and never deleted content.

### Modified

`POST /conversation-assistant/sessions`

- Accepts optional validated `displayTimeZone`.
- New prepared sessions persist continuation watermarks, context version, chain hash, and revision counters.
- The initial public response exposes `contextContinuationAvailable` and aggregate context summary.

`GET /conversation-assistant/sessions`

`GET /conversation-assistant/sessions/:sessionId`

- Public session DTOs expose continuation availability, context version, snapshot count, cumulative included/omitted counts, and latest completed revision.

`GET /conversation-assistant/sessions/:sessionId/context`

- Accepts an optional attachment id/snapshot selector and exposes immutable snapshot history summaries while preserving cursor pagination.

`GET /conversation-assistant/sessions/:sessionId/turns`

- Orders by turn `sequence` and returns public attachment summaries on context-attachment user turns.

`POST /conversation-assistant/sessions/:sessionId/turns`

`POST /conversation-assistant/sessions/:sessionId/turns/stream`

Request:

```json
{
  "requestId": "turn-request-id",
  "question": "How has this person's attitude changed?",
  "contextAttachmentId": "optional-ready-attachment",
  "confirmationToken": "required-only-for-large-context"
}
```

- Both paths use the same idempotent operation and atomic commit.
- SSE events include request id and connection-local monotonic `streamSequence`; persisted milestone events also include durable monotonic `stateVersion`.
- `user_turn` contains the public attachment summary; the first visible assistant text is the deterministic acknowledgment.

`GET /conversation-assistant/sessions/:sessionId/export.pdf`

- Exports the latest completed revision and attachment summaries, cumulative counts, capture/event ranges, and acknowledgment text.

`DELETE /conversation-assistant/sessions/:sessionId`

- Public contract is unchanged; implementation adds attachments, turn requests, and all attachment chunks to its generation-fenced cascade.

### Removed

No endpoint is removed.

### Unchanged

- `POST /conversation-assistant/context/check`
- `GET /conversation-assistant/session-requests/:requestId`
- `POST /conversation-assistant/sessions/:sessionId/preparation/retry`
- `DELETE /private/account` remains disable/disconnect only and never performs physical privacy erasure
- Existing authentication, envelope, and initial deletion-token behavior

## PDF Export

Every user and assistant turn shares a `conversationRevision`. Export reads the latest `completedConversationRevision` and includes only turns and committed attachments at or below it. This prevents an export from containing half of an active request.

The document includes:

- initial source/effective range and counts;
- cumulative snapshot count and counts;
- each update's capture time, checked range, actual event range, included/omitted/correction counts;
- the question, deterministic acknowledgment, answer, model, and safe usage metadata already supported.

It does not embed raw initial or attachment transcripts, source ids, phone numbers, hashes, or omitted private bodies.

## Privacy And Security

- All chat/account identity comes from the owned session. Clients cannot submit arbitrary chat ids, range starts, cutoffs, counts, hashes, or watermark values.
- All new endpoints require normal authentication and return the same not-found shape for absent and not-owned resources.
- Request fingerprints and signed warning tokens prevent body substitution.
- Attachment and turn writes are fenced by user, session generation, context version, preparation attempt/claim, and operation lease.
- Conversation Assistant sessions persist an internal immutable `sourceAccountId` so account erasure can find every dependent snapshot without trusting a client-supplied identifier.
- Context text is excluded from incoming-request logging and structured application logs.
- To survive a tab reload during preparation, the unsent question may be stored only in origin-scoped `sessionStorage` under a per-session key with a 30-minute rolling TTL. It is cleared after persisted `user_turn`, session deletion, logout, user/session change, or expiry. No WhatsApp body, attachment preview, source identity, acknowledgment, or model response is stored there.
- Prompt input treats all WhatsApp text as untrusted data and blocks transcript-based instruction injection.
- The explicit internal-authenticated private-account erasure operation runs a retry-safe, generation-fenced physical cascade over source messages/chats/relations/journal and every dependent assistant session, turn, attachment, request, and chunk before removing the account record. Reconnection creates a new generation and cannot revive erased snapshots. Public mirror disconnect remains non-destructive, and ordinary UI deletion of an assistant session does not delete the source WhatsApp chat.
- Shared HTTP logging and Sentry instrumentation use route templates such as `/sessions/:sessionId/...`; query strings and dynamic ids are not recorded for these endpoints.

## Failure Semantics

- Preparation failure: retain the question and failed draft; retry uses the same cutoff.
- Definite publication failure: compare-and-set queued attachment to failed; ambiguous delivery remains queued and is safely republished/reclaimed with the same id and cutoff.
- Attachment refresh: preserve question; old uncommitted snapshot expires and never advances session state.
- Stale two-tab attachment: return conflict, refresh session summary, preserve question, and offer recapture.
- Failure before atomic user-turn commit: no watermark movement and no visible turn.
- Failure after commit but before model result: attachment and user turn remain; persist one acknowledged assistant error turn.
- Disconnect: operation continues; status/replay recovers existing turns.
- Reload before commit: restore the locally TTL-bounded question, then reconcile attachment/request ids with server state before enabling Include or Send.
- Crash after external model completion but before persistence: a lease retry may incur duplicate provider cost, but visible ids/revision remain exactly once and telemetry records recovery.
- Lease loss while an older worker is still producing tokens: that attempt immediately loses emission/finalization authority; only the current attempt may advance state or write to its live connection.
- Deletion during preparation/answer: generation fences prevent orphan writes or writes into a replacement session.

## Observability

Low-cardinality, content-free metrics cover:

- preparation requests and outcomes;
- included, omitted, corrected, redacted, newly available, and late-ingested counts;
- preparation duration, snapshot bytes, estimated tokens, and prompt-budget rejection;
- idempotent replays, fingerprint conflicts, stale-version conflicts, lease recovery, and two-tab rejection;
- stream disconnects, model failures, answer recovery attempts, and time to first model delta;
- chain mismatch, orphan chunk cleanup, PDF revision, and deletion-cascade failures.

No metric or log dimension contains user id, session id, chat id, request id, source message id, hash, question, transcript content, speaker label, or phone number.

## Automated Verification

Tests are written before implementation and prove:

- journal no-op dedupe, sequence allocation, stable transactions, and sanitized projections;
- initial-scan reconciliation, concurrent inserts, identical timestamps, and post-cutoff reconstruction;
- normal chronological append, historical range extension, late ingest, pending/failed-to-completed transcription, edit, Matrix redaction, and reaction changes;
- zero included, only omitted, warning, hard rejection, and no silent truncation;
- attachment preparation claims, retries, refresh, expiry, cleanup, generation fences, and immutable boundaries;
- atomic commit, stale two-tab conflict, same-id replay, fingerprint collision, lease recovery, delete races, and turn sequence/revision ordering;
- disconnect before/after user acknowledgment, model failure, answer-only retry, and no duplicate visible turn;
- prompt version `5.0.0`, chronological context blocks, correction precedence, untrusted-data instruction, integrity verification, and no duplicate acknowledgment;
- prompt payload isolation against forged role markers, delimiter/XML/JSON/code-fence breakouts, Unicode bidi/control characters, and requests to falsify application counts/ranges;
- route authentication, validation, schemas, envelopes, logging registration, and SSE event ordering;
- API client, hook reducer/state transitions, reload recovery, session isolation, and draft preservation;
- desktop/mobile UI, keyboard, screen-reader states, cutoff copy, preview, refresh, zero/omitted/large/error/stale/legacy behavior;
- PDF completed-revision consistency and absence of raw context;
- collection registry, immutable migration, indexes, TTL, privacy erasure, and cascade cleanup;
- telemetry contains counts/outcomes but no private content.

Focused verification is followed by workspace verification, package-export verification, and a complete `pnpm run ci:tracked` before any commit.

## Live Chrome Acceptance

Use real Google Chrome and the existing secure test credentials from `~/.intexuraos/logins.md`; never print or paste passwords into logs or chat. Use the WhatsApp test account/chat `Test Number (WA)` and the configured Conversation Assistant model.

Local acceptance covers:

1. create an analysis ending before newer test messages;
2. click Include, verify count/range/cutoff and preview, send a sentiment-change question, and verify acknowledgment plus answer;
3. zero-message and only-omitted outcomes;
4. a message arriving after cutoff followed by explicit Refresh;
5. reload during preparation and after user-turn acknowledgment;
6. answer retry without duplicate attachment;
7. two tabs racing the same base version;
8. desktop and mobile/PWA viewport behavior;
9. Conversation context history and completed-revision PDF.

After the same SHA is deployed to Hetzner, repeat the critical happy path, recovery, context-history, and PDF smoke checks against `https://intexuraos.cloud`.

## Review And Delivery

- Independent subagents review UX, architecture, security/concurrency, tests, and the complete diff. Evidence-backed findings are fixed test-first and reviewed again.
- Full CI must pass before commit.
- Fetch and integrate the latest `origin/development`, rerun full CI, then commit and push the feature branch.
- Create a ready pull request targeting `development` linked to `INT-1887`, with `Fixes INT-1887` in the body. The body includes decisions, Endpoint Changes, automated evidence, Chrome evidence, risks, rollout, and deployment notes.
- From one frozen verified ref/SHA, apply and verify the approved Terraform TTL change, dispatch the Firestore migration/index target for migrations 124/125, wait until every required index is ready, and only then trigger the supported Hetzner application deployment without silently merging the PR. If any infrastructure path cannot prove the same source SHA/ref, stop before application rollout and surface the exact workflow constraint.
- Verify GitHub workflow status, deployed SHA, PM2/nginx/direct-origin health, and Chrome smoke behavior.

## Non-Goals

- Selecting arbitrary additional date ranges in the attachment flow.
- Automatically attaching context based only on natural-language intent.
- Mutating or replacing prior snapshots.
- Parallel model turns within one session.
- Sending binary media to the model.
- Silent summarization or truncation.
- Backfilling continuation support heuristically for unsafe legacy sessions.
- Automatically merging the pull request.

## Requirement Traceability

| Requirement | Design evidence |
| --- | --- |
| Context is added as a conversation message | Persistent Timeline and Atomic Turn Commit tie one immutable attachment to one user turn. |
| Initial context is not mutated | Product Decisions and Core Invariants keep all initial fields immutable. |
| User expresses one intent and one question | Composer Flow prepares on click and commits with normal Send. |
| Exact count and range in the answer | Deterministic Acknowledgment is generated from persisted metadata. |
| Thursday-to-Saturday comparison | Source algorithm extends event frontier and prompt chronology places the delta before the new question. |
| Late ingest and transcription completion | Source Change Journal and dual-watermark union cover source-time and change-time semantics. |
| Best UX verified independently | UX requirements incorporate the dedicated UX review and require another live review round. |
| Full planning, implementation, review, Chrome, PR, Hetzner | Automated Verification, Live Chrome Acceptance, and Review And Delivery define the complete gates. |
