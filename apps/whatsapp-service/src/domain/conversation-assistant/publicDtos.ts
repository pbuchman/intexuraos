import { createHash } from 'node:crypto';
import type {
  ConversationAssistantContextAttachmentPreviewPage,
  PublicConversationAssistantContextAttachmentPreviewItem,
  PublicConversationAssistantCorrectionProjection,
  PublicConversationAssistantExcludedPreviewMessage,
  PublicConversationAssistantIncludedPreviewMessage,
  PublicConversationAssistantPreviewReaction,
} from './contextAttachmentPreview.js';
import type {
  ConversationAssistantTurnRequestExecutionResult,
  ConversationAssistantTurnRequestStreamEvent,
  GetConversationAssistantTurnRequestResult,
  PublicConversationAssistantTurnRequest,
} from './turnRequestUseCases.js';
import type { TurnRequestConversationTurn } from './turnRequestPorts.js';
import type {
  ConversationAssistantContextResult,
  ConversationAssistantContextSnapshotSummary,
  ConversationAssistantSession,
  ConversationAssistantStreamEvent,
  ConversationAssistantTurn,
  ConversationAssistantTurnContextAttachmentSummary,
  PublicConversationAssistantContextAttachment,
  PublicConversationAssistantContextAttachmentCounts,
  PublicConversationAssistantContextMessage,
  PublicConversationAssistantContextReaction,
  PublicConversationAssistantContextResult,
  PublicConversationAssistantContextSummary,
  PublicConversationAssistantOmittedContextMessage,
  PublicConversationAssistantSession,
  PublicConversationAssistantTurn,
  PublicConversationAssistantTurnContextAttachmentSummary,
  PublicConversationAssistantUsage,
} from './types.js';
import { CONVERSATION_ASSISTANT_PUBLIC_LLM_ERROR_MESSAGE } from './types.js';

export interface PublicConversationAssistantSessionComputedFields {
  deletionToken: string;
  deletionPending: boolean;
  modelDisplayName: string;
  contextSummary: PublicConversationAssistantContextSummary;
}

export interface PublicConversationAssistantTurnRequestRecovery {
  request: PublicConversationAssistantTurnRequest;
  turns: PublicConversationAssistantTurn[];
  canRetryAnswer: boolean;
}

export type PublicConversationAssistantSseEvent =
  | {
      type: 'request_state';
      requestId: string;
      streamSequence: number;
      request: PublicConversationAssistantTurnRequest;
    }
  | {
      type: 'context_attached';
      requestId: string;
      streamSequence: number;
      attachmentId: string;
    }
  | {
      type: 'user_turn';
      requestId?: string;
      streamSequence?: number;
      turn: PublicConversationAssistantTurn;
    }
  | {
      type: 'assistant_delta';
      requestId?: string;
      streamSequence?: number;
      text: string;
    }
  | {
      type: 'usage';
      requestId?: string;
      streamSequence?: number;
      usage: PublicConversationAssistantUsage;
    }
  | {
      type: 'error';
      requestId?: string;
      streamSequence?: number;
      error: { code: string; message: string };
    }
  | {
      type: 'assistant_turn';
      requestId?: string;
      streamSequence?: number;
      turn: PublicConversationAssistantTurn;
    }
  | { type: 'done'; requestId?: string; streamSequence?: number };

export function toPublicConversationAssistantSessionDto(
  session: ConversationAssistantSession,
  computed: PublicConversationAssistantSessionComputedFields
): PublicConversationAssistantSession {
  const result: PublicConversationAssistantSession = {
    id: session.id,
    status: session.status,
    range: toPublicDateRange(session.range),
    effectiveRange: toPublicDateRange(session.effectiveRange),
    model: session.model,
    transcriptMessageCount: session.transcriptMessageCount,
    assistantRoleLabel: session.assistantRoleLabel,
    omitted: toPublicOmittedCounts(session.omitted),
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    deletionToken: computed.deletionToken,
    deletionPending: computed.deletionPending,
    modelDisplayName: computed.modelDisplayName,
    contextSummary: toPublicContextSummary(computed.contextSummary),
  };
  if (session.chatDisplayName !== undefined) result.chatDisplayName = session.chatDisplayName;
  if (session.preparationStage !== undefined) result.preparationStage = session.preparationStage;
  if (session.preparationAttempt !== undefined) {
    result.preparationAttempt = session.preparationAttempt;
  }
  if (session.preparationError !== undefined) {
    result.preparationError = toPublicPreparationError(session.preparationError);
  }
  if (session.lastTurnAt !== undefined) result.lastTurnAt = session.lastTurnAt;
  return result;
}

export function toPublicConversationAssistantContextDto(
  context: ConversationAssistantContextResult
): PublicConversationAssistantContextResult {
  const result: PublicConversationAssistantContextResult = {
    sessionId: context.sessionId,
    messages: context.messages.map((message) =>
      toPublicInitialContextMessage(context.sessionId, message)
    ),
    omittedMessages: context.omittedMessages.map((message) =>
      toPublicInitialOmittedContextMessage(context.sessionId, message)
    ),
    messageCount: context.messageCount,
    omittedMessageCount: context.omittedMessageCount,
    snapshotAvailable: context.snapshotAvailable,
    omitted: toPublicOmittedCounts(context.omitted),
  };
  if (context.nextMessageCursor !== undefined) {
    result.nextMessageCursor = context.nextMessageCursor;
  }
  if (context.nextOmittedCursor !== undefined) {
    result.nextOmittedCursor = context.nextOmittedCursor;
  }
  return result;
}

export function toPublicConversationAssistantTurnDto(
  turn: ConversationAssistantTurn | TurnRequestConversationTurn,
  options: { canRetryAnswer?: boolean } = {}
): PublicConversationAssistantTurn {
  const result: PublicConversationAssistantTurn = {
    id: turn.id,
    sessionId: turn.sessionId,
    role: turn.role,
    text: turn.text,
    createdAt: turn.createdAt,
  };
  if (turn.sequence !== undefined) result.sequence = turn.sequence;
  if (turn.conversationRevision !== undefined) {
    result.conversationRevision = turn.conversationRevision;
  }
  if (turn.requestId !== undefined) result.requestId = turn.requestId;
  if (options.canRetryAnswer !== undefined) {
    result.canRetryAnswer = options.canRetryAnswer;
  }
  if (turn.kind !== undefined) result.kind = turn.kind;
  if (turn.contextAttachmentId !== undefined) {
    result.contextAttachmentId = turn.contextAttachmentId;
  }
  if (turn.contextAttachment !== undefined) {
    result.contextAttachment = toPublicTurnContextAttachment(turn.contextAttachment);
  }
  if (turn.acknowledgment !== undefined) result.acknowledgment = turn.acknowledgment;
  if (turn.usage !== undefined) result.usage = toPublicUsage(turn.usage);
  if (turn.error !== undefined) result.error = toPublicError(turn.error);
  return result;
}

export function toPublicConversationAssistantTurnRequestDto(
  request: PublicConversationAssistantTurnRequest
): PublicConversationAssistantTurnRequest {
  const result: PublicConversationAssistantTurnRequest = {
    id: request.id,
    sessionId: request.sessionId,
    status: request.status,
    attempt: request.attempt,
    stateVersion: request.stateVersion,
    conversationRevision: request.conversationRevision,
  };
  if (request.contextAttachmentId !== undefined) {
    result.contextAttachmentId = request.contextAttachmentId;
  }
  if (request.completedAt !== undefined) result.completedAt = request.completedAt;
  if (request.error !== undefined) result.error = toPublicError(request.error);
  return result;
}

export function toPublicConversationAssistantTurnRequestRecoveryDto(
  result: GetConversationAssistantTurnRequestResult
): PublicConversationAssistantTurnRequestRecovery {
  return {
    request: toPublicConversationAssistantTurnRequestDto(result.request),
    turns: result.turns.map((turn) =>
      toPublicConversationAssistantTurnDto(turn, {
        canRetryAnswer: turn.role === 'assistant' && result.canRetryAnswer,
      })
    ),
    canRetryAnswer: result.canRetryAnswer,
  };
}

export function toPublicConversationAssistantExecutionRecoveryDto(
  result: ConversationAssistantTurnRequestExecutionResult
): PublicConversationAssistantTurnRequestRecovery {
  const turns: PublicConversationAssistantTurn[] = [
    toPublicConversationAssistantTurnDto(result.userTurn, { canRetryAnswer: false }),
  ];
  if (result.assistantTurn !== undefined) {
    turns.push(
      toPublicConversationAssistantTurnDto(result.assistantTurn, {
        canRetryAnswer: result.canRetryAnswer,
      })
    );
  }
  return {
    request: toPublicConversationAssistantTurnRequestDto(result.request),
    turns,
    canRetryAnswer: result.canRetryAnswer,
  };
}

export function toPublicConversationAssistantSseEvent(
  event:
    | ConversationAssistantStreamEvent
    | ConversationAssistantTurnRequestStreamEvent
    | {
        type: 'error';
        requestId: string;
        streamSequence: number;
        error: { code: string; message: string };
      }
): PublicConversationAssistantSseEvent {
  const requestId = 'requestId' in event ? event.requestId : undefined;
  const streamSequence = 'streamSequence' in event ? event.streamSequence : undefined;
  switch (event.type) {
    case 'request_state':
      return {
        type: event.type,
        requestId: event.requestId,
        streamSequence: event.streamSequence,
        request: toPublicConversationAssistantTurnRequestDto(event.request),
      };
    case 'context_attached':
      return {
        type: event.type,
        requestId: event.requestId,
        streamSequence: event.streamSequence,
        attachmentId: event.attachmentId,
      };
    case 'user_turn':
    case 'assistant_turn': {
      const canRetryAnswer =
        event.type === 'assistant_turn' && 'canRetryAnswer' in event
          ? event.canRetryAnswer
          : false;
      const projected: Extract<
        PublicConversationAssistantSseEvent,
        { type: 'user_turn' | 'assistant_turn' }
      > = {
        type: event.type,
        turn: toPublicConversationAssistantTurnDto(event.turn, { canRetryAnswer }),
      };
      if (requestId !== undefined) projected.requestId = requestId;
      if (streamSequence !== undefined) projected.streamSequence = streamSequence;
      return projected;
    }
    case 'assistant_delta': {
      const projected: Extract<
        PublicConversationAssistantSseEvent,
        { type: 'assistant_delta' }
      > = { type: event.type, text: event.text };
      if (requestId !== undefined) projected.requestId = requestId;
      if (streamSequence !== undefined) projected.streamSequence = streamSequence;
      return projected;
    }
    case 'usage': {
      const projected: Extract<PublicConversationAssistantSseEvent, { type: 'usage' }> = {
        type: event.type,
        usage: toPublicUsage(event.usage),
      };
      if (requestId !== undefined) projected.requestId = requestId;
      if (streamSequence !== undefined) projected.streamSequence = streamSequence;
      return projected;
    }
    case 'error': {
      const projected: Extract<PublicConversationAssistantSseEvent, { type: 'error' }> = {
        type: event.type,
        error: toPublicError(event.error),
      };
      if (requestId !== undefined) projected.requestId = requestId;
      if (streamSequence !== undefined) projected.streamSequence = streamSequence;
      return projected;
    }
    case 'done': {
      const projected: Extract<PublicConversationAssistantSseEvent, { type: 'done' }> = {
        type: event.type,
      };
      if (requestId !== undefined) projected.requestId = requestId;
      if (streamSequence !== undefined) projected.streamSequence = streamSequence;
      return projected;
    }
  }
}

export function toPublicConversationAssistantContextAttachmentDto(
  attachment: PublicConversationAssistantContextAttachment
): PublicConversationAssistantContextAttachment {
  const result: PublicConversationAssistantContextAttachment = {
    id: attachment.id,
    status: attachment.status,
    compatibility: attachment.compatibility,
    capturedAt: attachment.capturedAt,
    requiresConfirmation: attachment.requiresConfirmation,
    newerAvailableCount: attachment.newerAvailableCount,
    newerAvailableCorrectionCount: attachment.newerAvailableCorrectionCount,
  };
  if (attachment.captureRange !== undefined) {
    result.captureRange = toPublicDateRange(attachment.captureRange);
  }
  if (attachment.eventRange !== undefined) {
    result.eventRange = toPublicDateRange(attachment.eventRange);
  }
  if (attachment.counts !== undefined) {
    result.counts = toPublicAttachmentCounts(attachment.counts);
  }
  if (attachment.omitted !== undefined) {
    result.omitted = toPublicOmittedCounts(attachment.omitted);
  }
  if (attachment.confirmationToken !== undefined) {
    result.confirmationToken = attachment.confirmationToken;
  }
  if (attachment.error !== undefined) {
    result.error = {
      code: attachment.error.code,
      message: attachment.error.message,
    };
  }
  if (attachment.expiresAt !== undefined) result.expiresAt = attachment.expiresAt;
  return result;
}

export function toPublicConversationAssistantContextHistoryDto(
  snapshots: readonly ConversationAssistantContextSnapshotSummary[]
): { snapshots: ConversationAssistantContextSnapshotSummary[] } {
  return { snapshots: snapshots.map(toPublicContextSnapshotSummary) };
}

export function toPublicConversationAssistantAttachmentPreviewDto(
  page: ConversationAssistantContextAttachmentPreviewPage
): ConversationAssistantContextAttachmentPreviewPage {
  const result: ConversationAssistantContextAttachmentPreviewPage = {
    items: page.items.map(toPublicPreviewItem),
  };
  if (page.nextCursor !== undefined) result.nextCursor = page.nextCursor;
  return result;
}

function toPublicInitialContextMessage(
  sessionId: string,
  message: ConversationAssistantContextResult['messages'][number]
): PublicConversationAssistantContextMessage {
  const result: PublicConversationAssistantContextMessage = {
    id: createDisplayReference('context-item', 'session', sessionId, message.id),
    eventTimestamp: message.eventTimestamp,
    importedAt: message.importedAt,
    direction: message.direction,
    speakerLabel: message.speakerLabel,
    messageType: message.messageType,
    contentKind: message.contentKind,
    content: message.content,
  };
  if (message.reactions !== undefined) {
    result.reactions = message.reactions.map((reaction) =>
      toPublicInitialContextReaction(sessionId, reaction)
    );
  }
  return result;
}

function toPublicInitialOmittedContextMessage(
  sessionId: string,
  message: ConversationAssistantContextResult['omittedMessages'][number]
): PublicConversationAssistantOmittedContextMessage {
  const result: PublicConversationAssistantOmittedContextMessage = {
    id: createDisplayReference('context-item', 'session', sessionId, message.id),
    eventTimestamp: message.eventTimestamp,
    importedAt: message.importedAt,
    direction: message.direction,
    speakerLabel: message.speakerLabel,
    messageType: message.messageType,
    omissionReason: message.omissionReason,
  };
  if (message.contentKind !== undefined) result.contentKind = message.contentKind;
  if (message.content !== undefined) result.content = message.content;
  if (message.reactions !== undefined) {
    result.reactions = message.reactions.map((reaction) =>
      toPublicInitialContextReaction(sessionId, reaction)
    );
  }
  if (message.reaction !== undefined) {
    const target = message.reaction.targetMessageId ?? message.reaction.targetMatrixEventId;
    result.reaction = { emoji: message.reaction.emoji };
    if (target !== undefined) {
      result.reaction.targetReference = createDisplayReference(
        'context-item',
        'session',
        sessionId,
        target
      );
    }
  }
  return result;
}

function toPublicInitialContextReaction(
  sessionId: string,
  reaction: NonNullable<
    ConversationAssistantContextResult['messages'][number]['reactions']
  >[number]
): PublicConversationAssistantContextReaction {
  const result: PublicConversationAssistantContextReaction = {
    id: createDisplayReference('context-reaction', 'session', sessionId, reaction.id),
    emoji: reaction.emoji,
    direction: reaction.direction,
    eventTimestamp: reaction.eventTimestamp,
  };
  if (reaction.senderDisplayName !== undefined) {
    result.senderDisplayName = reaction.senderDisplayName;
  }
  return result;
}

function toPublicTurnContextAttachment(
  attachment: ConversationAssistantTurnContextAttachmentSummary
): PublicConversationAssistantTurnContextAttachmentSummary {
  const result: PublicConversationAssistantTurnContextAttachmentSummary = {
    id: attachment.id,
    capturedAt: attachment.capturedAt,
    captureRange: toPublicDateRange(attachment.captureRange),
    counts: toPublicAttachmentCounts(attachment.counts),
    omitted: toPublicOmittedCounts(attachment.omitted),
  };
  if (attachment.eventRange !== undefined) {
    result.eventRange = toPublicDateRange(attachment.eventRange);
  }
  return result;
}

function toPublicContextSnapshotSummary(
  snapshot: ConversationAssistantContextSnapshotSummary
): ConversationAssistantContextSnapshotSummary {
  const result: ConversationAssistantContextSnapshotSummary = {
    kind: snapshot.kind,
    contextVersion: snapshot.contextVersion,
    capturedAt: snapshot.capturedAt,
    messageCount: snapshot.messageCount,
    excludedCount: snapshot.excludedCount,
    correctionCount: snapshot.correctionCount,
    omitted: toPublicOmittedCounts(snapshot.omitted),
  };
  if (snapshot.attachmentId !== undefined) result.attachmentId = snapshot.attachmentId;
  if (snapshot.linkedTurnId !== undefined) result.linkedTurnId = snapshot.linkedTurnId;
  if (snapshot.captureRange !== undefined) {
    result.captureRange = toPublicDateRange(snapshot.captureRange);
  }
  if (snapshot.eventRange !== undefined) {
    result.eventRange = toPublicDateRange(snapshot.eventRange);
  }
  return result;
}

function toPublicPreviewItem(
  item: PublicConversationAssistantContextAttachmentPreviewItem
): PublicConversationAssistantContextAttachmentPreviewItem {
  if (item.kind === 'included') {
    return { kind: item.kind, message: toPublicIncludedPreviewMessage(item.message) };
  }
  if (item.kind === 'excluded') {
    return { kind: item.kind, message: toPublicExcludedPreviewMessage(item.message) };
  }
  return {
    kind: item.kind,
    changeKind: item.changeKind,
    targetReference: item.targetReference,
    before: toPublicCorrectionProjection(item.before),
    after: toPublicCorrectionProjection(item.after),
  };
}

function toPublicIncludedPreviewMessage(
  message: PublicConversationAssistantIncludedPreviewMessage
): PublicConversationAssistantIncludedPreviewMessage {
  const result: PublicConversationAssistantIncludedPreviewMessage = {
    id: message.id,
    eventTimestamp: message.eventTimestamp,
    importedAt: message.importedAt,
    direction: message.direction,
    speakerLabel: message.speakerLabel,
    messageType: message.messageType,
    contentKind: message.contentKind,
    content: message.content,
  };
  if (message.reactions !== undefined) {
    result.reactions = message.reactions.map(toPublicPreviewReaction);
  }
  return result;
}

function toPublicExcludedPreviewMessage(
  message: PublicConversationAssistantExcludedPreviewMessage
): PublicConversationAssistantExcludedPreviewMessage {
  const result: PublicConversationAssistantExcludedPreviewMessage = {
    id: message.id,
    eventTimestamp: message.eventTimestamp,
    importedAt: message.importedAt,
    direction: message.direction,
    speakerLabel: message.speakerLabel,
    messageType: message.messageType,
    omissionReason: message.omissionReason,
  };
  if (message.contentKind !== undefined) result.contentKind = message.contentKind;
  if (message.content !== undefined) result.content = message.content;
  if (message.reactions !== undefined) {
    result.reactions = message.reactions.map(toPublicPreviewReaction);
  }
  return result;
}

function toPublicCorrectionProjection(
  projection: PublicConversationAssistantCorrectionProjection
): PublicConversationAssistantCorrectionProjection {
  if (!('eventTimestamp' in projection)) {
    return { state: projection.state };
  }
  if (projection.state === 'included') {
    return {
      state: projection.state,
      eventTimestamp: projection.eventTimestamp,
      importedAt: projection.importedAt,
      direction: projection.direction,
      speakerLabel: projection.speakerLabel,
      messageType: projection.messageType,
      contentKind: projection.contentKind,
      content: projection.content,
      reactions: projection.reactions.map(toPublicPreviewReaction),
    };
  }
  if (projection.state === 'omitted') {
    return {
      state: projection.state,
      eventTimestamp: projection.eventTimestamp,
      importedAt: projection.importedAt,
      direction: projection.direction,
      speakerLabel: projection.speakerLabel,
      messageType: projection.messageType,
      omissionReason: projection.omissionReason,
      reactions: projection.reactions.map(toPublicPreviewReaction),
    };
  }
  return {
    state: projection.state,
    eventTimestamp: projection.eventTimestamp,
    importedAt: projection.importedAt,
    direction: projection.direction,
    speakerLabel: projection.speakerLabel,
    messageType: projection.messageType,
  };
}

function toPublicPreviewReaction(
  reaction: PublicConversationAssistantPreviewReaction
): PublicConversationAssistantPreviewReaction {
  const result: PublicConversationAssistantPreviewReaction = {
    emoji: reaction.emoji,
    direction: reaction.direction,
    eventTimestamp: reaction.eventTimestamp,
  };
  if (reaction.senderDisplayName !== undefined) {
    result.senderDisplayName = reaction.senderDisplayName;
  }
  return result;
}

function toPublicAttachmentCounts(
  counts: {
    included: number;
    excluded: number;
    completedTranscriptions: number;
    edited: number;
    redacted: number;
    deleted?: number;
    reactionsChanged: number;
    lateIngested: number;
  }
): PublicConversationAssistantContextAttachmentCounts {
  const result: PublicConversationAssistantContextAttachmentCounts = {
    included: counts.included,
    excluded: counts.excluded,
    completedTranscriptions: counts.completedTranscriptions,
    edited: counts.edited,
    redacted: counts.redacted + (counts.deleted ?? 0),
    reactionsChanged: counts.reactionsChanged,
    lateIngested: counts.lateIngested,
  };
  return result;
}

function toPublicContextSummary(
  summary: PublicConversationAssistantContextSummary
): PublicConversationAssistantContextSummary {
  return {
    displayTimeZone: summary.displayTimeZone,
    availability:
      summary.availability.state === 'available'
        ? {
            state: summary.availability.state,
            displayTimeZone: summary.availability.displayTimeZone,
          }
        : { state: summary.availability.state },
    contextVersion: summary.contextVersion,
    snapshotCount: summary.snapshotCount,
    totalAttachedMessageCount: summary.totalAttachedMessageCount,
    totalAttachedOmittedCount: summary.totalAttachedOmittedCount,
    completedConversationRevision: summary.completedConversationRevision,
    activeTurn:
      summary.activeTurn === null
        ? null
        : {
            requestId: summary.activeTurn.requestId,
            stateVersion: summary.activeTurn.stateVersion,
          },
  };
}

function toPublicOmittedCounts(input: {
  mediaOnly: number;
  failedTranscriptions: number;
  pendingTranscriptions: number;
  nonText: number;
  overLimit: number;
}): {
  mediaOnly: number;
  failedTranscriptions: number;
  pendingTranscriptions: number;
  nonText: number;
  overLimit: number;
} {
  return {
    mediaOnly: input.mediaOnly,
    failedTranscriptions: input.failedTranscriptions,
    pendingTranscriptions: input.pendingTranscriptions,
    nonText: input.nonText,
    overLimit: input.overLimit,
  };
}

function toPublicDateRange(range: { from: string; to: string }): { from: string; to: string } {
  return { from: range.from, to: range.to };
}

function toPublicUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
}): PublicConversationAssistantUsage {
  const result: PublicConversationAssistantUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: usage.costUsd,
  };
  if (usage.cachedTokens !== undefined) result.cachedTokens = usage.cachedTokens;
  if (usage.cacheWriteTokens !== undefined) result.cacheWriteTokens = usage.cacheWriteTokens;
  return result;
}

function toPublicError(error: { code: string; message: string }): {
  code: string;
  message: string;
} {
  return {
    code: error.code,
    message:
      error.code === 'LLM_ERROR'
        ? CONVERSATION_ASSISTANT_PUBLIC_LLM_ERROR_MESSAGE
        : error.message,
  };
}

function toPublicPreparationError(
  error: NonNullable<ConversationAssistantSession['preparationError']>
): NonNullable<PublicConversationAssistantSession['preparationError']> {
  const result: NonNullable<PublicConversationAssistantSession['preparationError']> = {
    code: error.code,
    message: error.message,
  };
  if (error.estimatedPromptTokens !== undefined) {
    result.estimatedPromptTokens = error.estimatedPromptTokens;
  }
  if (error.promptTokenBudget !== undefined) result.promptTokenBudget = error.promptTokenBudget;
  if (error.recommendedRange !== undefined) {
    result.recommendedRange = toPublicDateRange(error.recommendedRange);
  }
  return result;
}

function createDisplayReference(
  prefix: 'context-item' | 'context-reaction',
  scopeKind: 'session',
  scopeId: string,
  sourceReference: string
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ version: 1, scopeKind, scopeId, sourceReference }))
    .digest('base64url');
  return `${prefix}-${digest.slice(0, 24)}`;
}
