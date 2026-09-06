import { createHash } from 'node:crypto';
import {
  isWhatsAppPuppetSender,
  type MatrixClient,
  type MatrixTimelineEvent,
} from '../live/matrixClient.js';

export type MatrixCorpusTurnTerminal =
  | { readonly status: 'pending' }
  | {
      readonly status: 'completed';
      readonly replyCount: number;
      readonly replyDigests: readonly string[];
    }
  | { readonly status: 'failed'; readonly failureCode: string };

export const MATRIX_CORPUS_MAX_REPLIES_PER_TURN = 5;

export interface MatrixCorpusReplyEvidencePort {
  getTurnTerminal(input: {
    runId: string;
    scenarioId: string;
    turnIndex: number;
    sessionId: string;
  }): Promise<MatrixCorpusTurnTerminal>;
}

export interface CorrelatedMatrixReply {
  readonly eventId: string;
  readonly originServerTs: number;
  readonly body: string;
  readonly digest: string;
}

type UnhashedMatrixReply = Omit<CorrelatedMatrixReply, 'digest'>;

export type MatrixCorpusExpectedReplyRendering = 'plain' | 'whatsapp_confirmation_buttons';

export const MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX =
  '\n\n<Yes> - <No>\nUse the WhatsApp app to click buttons';

export type MatrixCorpusCorrelationFailureCode =
  | 'matrix_sync_failed'
  | 'matrix_sync_invalid'
  | 'matrix_timeline_limited'
  | 'outbound_event_mismatch'
  | 'outbound_event_timeout'
  | 'reply_timeout'
  | 'wrong_puppet'
  | 'invalid_reply_event'
  | 'reply_overflow'
  | 'unbound_reply'
  | 'turn_processing_failed';

export type MatrixCorpusCursorResult =
  | { readonly ok: true; readonly cursor: string }
  | { readonly ok: false; readonly code: MatrixCorpusCorrelationFailureCode };

export type MatrixCorpusCorrelatedRepliesResult =
  | {
      readonly ok: true;
      readonly cursor: string;
      readonly replies: readonly CorrelatedMatrixReply[];
    }
  | { readonly ok: false; readonly code: MatrixCorpusCorrelationFailureCode };

export type MatrixCorpusOutboundProofResult =
  | {
      readonly ok: true;
      readonly cursor: string;
      readonly eventsAfterOutbound: readonly MatrixTimelineEvent[];
    }
  | { readonly ok: false; readonly code: MatrixCorpusCorrelationFailureCode };

export interface MatrixCorpusMatrixContext {
  readonly homeserverUrl: string;
  readonly accessToken: string;
  readonly targetRoomId: string;
}

export async function captureMatrixCorpusCursor(input: {
  matrix: MatrixClient;
  context: MatrixCorpusMatrixContext;
  signal: AbortSignal;
}): Promise<MatrixCorpusCursorResult> {
  const result = await input.matrix.syncTargetRoom({
    ...input.context,
    timeoutMs: 0,
    signal: input.signal,
  });
  if (!result.ok) return { ok: false, code: mapSyncFailure(result.reason, input.signal) };
  // An initial /sync may legitimately truncate historical events in an active room.
  // Its next_batch still represents the current cursor. Incremental polls below keep
  // rejecting limited timelines because missing new events there would be unsafe.
  return { ok: true, cursor: result.nextBatch };
}

export async function proveMatrixCorpusOutboundEvent(input: {
  matrix: MatrixClient;
  context: MatrixCorpusMatrixContext;
  cursor: string;
  matrixUserId: string;
  matrixEventId: string;
  messageText: string;
  signal: AbortSignal;
}): Promise<MatrixCorpusOutboundProofResult> {
  let cursor = input.cursor;
  for (;;) {
    if (input.signal.aborted) return { ok: false, code: 'outbound_event_timeout' };
    const sync = await input.matrix.syncTargetRoom({
      ...input.context,
      since: cursor,
      timeoutMs: 30_000,
      signal: input.signal,
    });
    if (!sync.ok) return { ok: false, code: mapSyncFailure(sync.reason, input.signal) };
    if (sync.limited) return { ok: false, code: 'matrix_timeline_limited' };
    cursor = sync.nextBatch;
    for (const [eventIndex, event] of sync.events.entries()) {
      const isExpectedId = event.eventId === input.matrixEventId;
      const isSameSelfAuthoredText =
        event.sender === input.matrixUserId && event.content?.body === input.messageText;
      if (!isExpectedId && !isSameSelfAuthoredText) continue;
      if (
        !isExpectedId ||
        event.type !== 'm.room.message' ||
        event.sender !== input.matrixUserId ||
        event.content?.msgtype !== 'm.text' ||
        event.content.body !== input.messageText ||
        event.content['m.relates_to']?.rel_type === 'm.replace' ||
        event.unsigned?.redacted_because !== undefined
      )
        return { ok: false, code: 'outbound_event_mismatch' };
      return {
        ok: true,
        cursor,
        eventsAfterOutbound: sync.events.slice(eventIndex + 1),
      };
    }
  }
}

export async function collectCorrelatedReplies(input: {
  matrix: MatrixClient;
  evidence: MatrixCorpusReplyEvidencePort;
  context: MatrixCorpusMatrixContext;
  cursor: string;
  initialEvents?: readonly MatrixTimelineEvent[];
  matrixUserId: string;
  expectedPuppetSender: string;
  outboundMatrixEventId: string;
  outboundMessageText: string;
  runId: string;
  scenarioId: string;
  turnIndex: number;
  sessionId: string;
  expectedReplyRendering: MatrixCorpusExpectedReplyRendering;
  signal: AbortSignal;
}): Promise<MatrixCorpusCorrelatedRepliesResult> {
  let cursor = input.cursor;
  const replyState = createReplyCollectionState();
  const replies = replyState.replies;
  let initialEvents = input.initialEvents;
  let completedReplyDeficitPolls = 0;

  for (;;) {
    if (input.signal.aborted) return { ok: false, code: 'reply_timeout' };
    let events: readonly MatrixTimelineEvent[];
    if (initialEvents === undefined) {
      const sync = await input.matrix.syncTargetRoom({
        ...input.context,
        since: cursor,
        timeoutMs: 30_000,
        signal: input.signal,
      });
      if (!sync.ok) return { ok: false, code: mapSyncFailure(sync.reason, input.signal) };
      if (sync.limited) return { ok: false, code: 'matrix_timeline_limited' };
      cursor = sync.nextBatch;
      events = sync.events;
    } else {
      events = initialEvents;
      initialEvents = undefined;
    }

    const collected = collectReplyEvents(
      events,
      replyState,
      input.matrixUserId,
      input.expectedPuppetSender
    );
    if (!collected.ok) return collected;

    const terminal = await input.evidence.getTurnTerminal({
      runId: input.runId,
      scenarioId: input.scenarioId,
      turnIndex: input.turnIndex,
      sessionId: input.sessionId,
    });
    if (terminal.status === 'failed') return { ok: false, code: 'turn_processing_failed' };
    if (terminal.status === 'pending') continue;
    if (
      !Number.isInteger(terminal.replyCount) ||
      terminal.replyCount < 0 ||
      terminal.replyCount > MATRIX_CORPUS_MAX_REPLIES_PER_TURN ||
      terminal.replyDigests.length !== terminal.replyCount ||
      new Set(terminal.replyDigests).size !== terminal.replyDigests.length
    ) {
      return { ok: false, code: 'matrix_sync_invalid' };
    }
    if (replies.length > terminal.replyCount) return { ok: false, code: 'unbound_reply' };
    if (replies.some((reply) => !terminal.replyDigests.includes(reply.digest))) {
      return { ok: false, code: 'unbound_reply' };
    }
    if (replies.length < terminal.replyCount) {
      if (completedReplyDeficitPolls === 0) {
        completedReplyDeficitPolls += 1;
        continue;
      }
      const recovered = await recoverRepliesFromRecentTimeline({
        matrix: input.matrix,
        context: input.context,
        matrixUserId: input.matrixUserId,
        expectedPuppetSender: input.expectedPuppetSender,
        outboundMatrixEventId: input.outboundMatrixEventId,
        outboundMessageText: input.outboundMessageText,
        terminal,
        signal: input.signal,
      });
      if (recovered !== undefined) {
        return recovered.ok
          ? { ok: true, cursor: recovered.cursor, replies: recovered.replies }
          : recovered;
      }
      continue;
    }
    if (replies.some((reply, index) => reply.digest !== terminal.replyDigests[index])) {
      return { ok: false, code: 'unbound_reply' };
    }
    return { ok: true, cursor, replies };
  }
}

async function recoverRepliesFromRecentTimeline(input: {
  matrix: MatrixClient;
  context: MatrixCorpusMatrixContext;
  matrixUserId: string;
  expectedPuppetSender: string;
  outboundMatrixEventId: string;
  outboundMessageText: string;
  terminal: Extract<MatrixCorpusTurnTerminal, { status: 'completed' }>;
  signal: AbortSignal;
}): Promise<
  | {
      readonly ok: true;
      readonly cursor: string;
      readonly replies: readonly CorrelatedMatrixReply[];
    }
  | { readonly ok: false; readonly code: MatrixCorpusCorrelationFailureCode }
  | undefined
> {
  const recent = await input.matrix.syncTargetRoom({
    ...input.context,
    timeoutMs: 0,
    signal: input.signal,
  });
  if (!recent.ok) return undefined;

  const anchorIndex = recent.events.findIndex(
    (event) => event.eventId === input.outboundMatrixEventId
  );
  if (anchorIndex < 0) return undefined;
  const anchor = recent.events[anchorIndex];
  if (
    anchor?.type !== 'm.room.message' ||
    anchor.sender !== input.matrixUserId ||
    anchor.content?.msgtype !== 'm.text' ||
    anchor.content.body !== input.outboundMessageText ||
    anchor.content['m.relates_to']?.rel_type === 'm.replace' ||
    anchor.unsigned?.redacted_because !== undefined
  ) {
    return { ok: false, code: 'outbound_event_mismatch' };
  }

  const eventsAfterAnchor = recent.events.slice(anchorIndex + 1);
  const nextOutboundIndex = eventsAfterAnchor.findIndex(
    (event) =>
      event.type === 'm.room.message' &&
      event.sender === input.matrixUserId &&
      event.content?.msgtype === 'm.text' &&
      event.content['m.relates_to']?.rel_type !== 'm.replace' &&
      event.unsigned?.redacted_because === undefined
  );
  const boundedEvents =
    nextOutboundIndex < 0 ? eventsAfterAnchor : eventsAfterAnchor.slice(0, nextOutboundIndex);
  const replyState = createReplyCollectionState();
  const collected = collectReplyEvents(
    boundedEvents,
    replyState,
    input.matrixUserId,
    input.expectedPuppetSender
  );
  if (!collected.ok) return collected;
  const { replies } = replyState;

  if (replies.length > input.terminal.replyCount) {
    return { ok: false, code: 'unbound_reply' };
  }
  if (replies.some((reply) => !input.terminal.replyDigests.includes(reply.digest))) {
    return { ok: false, code: 'unbound_reply' };
  }
  if (replies.length < input.terminal.replyCount) {
    return nextOutboundIndex < 0 ? undefined : { ok: false, code: 'unbound_reply' };
  }
  if (replies.some((reply, index) => reply.digest !== input.terminal.replyDigests[index])) {
    return { ok: false, code: 'unbound_reply' };
  }
  return { ok: true, cursor: recent.nextBatch, replies };
}

interface ReplyCollectionState {
  readonly replies: CorrelatedMatrixReply[];
  readonly byEventId: Map<string, CorrelatedMatrixReply>;
  readonly rawBodiesByEventId: Map<string, string>;
  readonly redactedEventIds: Set<string>;
}

function createReplyCollectionState(): ReplyCollectionState {
  return {
    replies: [],
    byEventId: new Map(),
    rawBodiesByEventId: new Map(),
    redactedEventIds: new Set(),
  };
}

function collectReplyEvents(
  events: readonly MatrixTimelineEvent[],
  state: ReplyCollectionState,
  matrixUserId: string,
  expectedPuppetSender: string
):
  | { readonly ok: true }
  | { readonly ok: false; readonly code: MatrixCorpusCorrelationFailureCode } {
  for (const event of events) {
    if (event.type === 'm.room.redaction') {
      if (event.eventId === undefined || event.redacts === undefined) {
        return { ok: false, code: 'matrix_sync_invalid' };
      }
      state.redactedEventIds.add(event.redacts);
      if (state.byEventId.has(event.redacts)) return { ok: false, code: 'unbound_reply' };
      continue;
    }
    const candidate = classifyReplyEvent(event, matrixUserId, expectedPuppetSender);
    if (candidate.kind === 'ignore') continue;
    if (candidate.kind === 'failure') return { ok: false, code: candidate.code };
    if (state.redactedEventIds.has(candidate.reply.eventId)) {
      return { ok: false, code: 'unbound_reply' };
    }
    const previousRawBody = state.rawBodiesByEventId.get(candidate.reply.eventId);
    if (previousRawBody !== undefined && previousRawBody !== candidate.reply.body) {
      return { ok: false, code: 'unbound_reply' };
    }
    const canonicalBody = canonicalMatrixReplyBody(candidate.reply.body);
    if (canonicalBody === undefined) return { ok: false, code: 'unbound_reply' };
    const previous = state.byEventId.get(candidate.reply.eventId);
    if (previous !== undefined) {
      if (
        previous.body !== canonicalBody ||
        previous.originServerTs !== candidate.reply.originServerTs
      ) {
        return { ok: false, code: 'unbound_reply' };
      }
      continue;
    }
    const reply = {
      ...candidate.reply,
      body: canonicalBody,
      digest: digestMatrixReply(canonicalBody, state.replies.length),
    };
    state.rawBodiesByEventId.set(reply.eventId, candidate.reply.body);
    state.byEventId.set(reply.eventId, reply);
    state.replies.push(reply);
    if (state.replies.length > MATRIX_CORPUS_MAX_REPLIES_PER_TURN) {
      return { ok: false, code: 'reply_overflow' };
    }
  }
  return { ok: true };
}

function canonicalMatrixReplyBody(body: string): string | undefined {
  if (!body.endsWith(MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX)) return body;
  const canonicalBody = body.slice(0, -MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX.length);
  return canonicalBody.length === 0 ? undefined : canonicalBody;
}

function classifyReplyEvent(
  event: MatrixTimelineEvent,
  matrixUserId: string,
  expectedPuppetSender: string
):
  | { readonly kind: 'ignore' }
  | { readonly kind: 'failure'; readonly code: MatrixCorpusCorrelationFailureCode }
  | { readonly kind: 'reply'; readonly reply: UnhashedMatrixReply } {
  if (
    event.type !== 'm.room.message' ||
    event.sender === matrixUserId ||
    event.content?.msgtype !== 'm.text' ||
    event.content['m.relates_to']?.rel_type === 'm.replace' ||
    event.unsigned?.redacted_because !== undefined
  ) {
    return { kind: 'ignore' };
  }
  const body = event.content.body;
  if (body === undefined || body.length === 0) return { kind: 'ignore' };
  if (isWhatsAppPuppetSender(event.sender) && event.sender !== expectedPuppetSender) {
    return { kind: 'failure', code: 'wrong_puppet' };
  }
  if (event.sender !== expectedPuppetSender) return { kind: 'ignore' };
  if (event.eventId === undefined || event.originServerTs === undefined) {
    return { kind: 'failure', code: 'invalid_reply_event' };
  }
  return {
    kind: 'reply',
    reply: {
      eventId: event.eventId,
      originServerTs: event.originServerTs,
      body,
    },
  };
}

function mapSyncFailure(
  reason: 'unauthorized' | 'timeout' | 'unavailable' | 'invalid_response',
  signal: AbortSignal
): MatrixCorpusCorrelationFailureCode {
  if (reason === 'timeout' && signal.aborted) return 'reply_timeout';
  return reason === 'invalid_response' ? 'matrix_sync_invalid' : 'matrix_sync_failed';
}

export function digestMatrixReply(body: string, replyIndex = 0): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'matrix_corpus_reply',
        replyIndex,
        text: body.normalize('NFC'),
        version: 1,
      }),
      'utf8'
    )
    .digest('hex');
}
