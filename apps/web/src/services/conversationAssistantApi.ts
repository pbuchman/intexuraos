import { config } from '@/config';
import type {
  ConversationAssistantContextAttachment,
  ConversationAssistantContextAttachmentExcludedPreviewMessage,
  ConversationAssistantContextAttachmentIncludedPreviewMessage,
  ConversationAssistantContextAttachmentPreviewItem,
  ConversationAssistantContextAttachmentPreviewResponse,
  ConversationAssistantContextAttachmentPreviewReaction,
  ConversationAssistantContextCheckRequest,
  ConversationAssistantContextCheckResponse,
  ConversationAssistantContextSummary,
  ConversationAssistantContextCorrectionProjection,
  ConversationAssistantContextHistoryResponse,
  ConversationAssistantContextMessage,
  ConversationAssistantContextReaction,
  ConversationAssistantContextResponse,
  ConversationAssistantPdfDownload,
  ConversationAssistantSession,
  ConversationAssistantOmittedContextMessage,
  ConversationAssistantStreamEvent,
  ConversationAssistantSessionsResponse,
  ConversationAssistantTurnsResponse,
  ConversationAssistantTurn,
  ConversationAssistantTurnContextAttachmentSummary,
  ConversationAssistantTurnRequest,
  ConversationAssistantTurnRequestResponse,
  ConversationAssistantUsage,
  CreateConversationAssistantContextAttachmentRequest,
  CreateConversationAssistantSessionRequest,
  SendConversationAssistantTurnRequest,
} from '@/types';
import { ApiError, apiRequest } from './apiClient.js';
import { newRequestId } from './requestId.js';

const CONVERSATION_ASSISTANT_SESSIONS_PATH = '/conversation-assistant/sessions';
const CONVERSATION_ASSISTANT_CONTEXT_CHECK_PATH = '/conversation-assistant/context/check';

type ConversationAssistantSessionWire = Omit<ConversationAssistantSession, 'contextSummary'> & {
  contextSummary?: unknown;
};

interface ConversationAssistantSessionResponse {
  session: ConversationAssistantSessionWire;
}

interface CreateConversationAssistantSessionResponse {
  session: ConversationAssistantSessionWire;
}

interface ConversationAssistantSessionsWireResponse {
  sessions: ConversationAssistantSessionWire[];
}

interface ConversationAssistantContextAttachmentResponse {
  attachment: ConversationAssistantContextAttachment;
}

function getSessionPath(sessionId: string): string {
  return `${CONVERSATION_ASSISTANT_SESSIONS_PATH}/${encodeURIComponent(sessionId)}`;
}

function getContextAttachmentPath(sessionId: string, attachmentId?: string): string {
  const base = `${getSessionPath(sessionId)}/context-attachments`;
  return attachmentId === undefined ? base : `${base}/${encodeURIComponent(attachmentId)}`;
}

function getTurnRequestPath(sessionId: string, requestId: string): string {
  return `${getSessionPath(sessionId)}/turn-requests/${encodeURIComponent(requestId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function legacyContextSummary(): ConversationAssistantContextSummary {
  return {
    displayTimeZone: 'UTC',
    availability: { state: 'legacy_session' },
    contextVersion: 0,
    snapshotCount: 0,
    totalAttachedMessageCount: 0,
    totalAttachedOmittedCount: 0,
    completedConversationRevision: 0,
    activeTurn: null,
  };
}

function toPublicContextSummary(value: unknown): ConversationAssistantContextSummary {
  if (!isRecord(value) || !isRecord(value['availability'])) return legacyContextSummary();

  const availabilityValue = value['availability'];
  const availabilityState = availabilityValue['state'];
  const displayTimeZone =
    typeof value['displayTimeZone'] === 'string'
      ? value['displayTimeZone']
      : availabilityState === 'available' &&
          typeof availabilityValue['displayTimeZone'] === 'string'
        ? availabilityValue['displayTimeZone']
        : 'UTC';
  let availability: ConversationAssistantContextSummary['availability'] | undefined;
  if (
    availabilityState === 'available' &&
    typeof availabilityValue['displayTimeZone'] === 'string'
  ) {
    availability = {
      state: 'available',
      displayTimeZone: availabilityValue['displayTimeZone'],
    };
  } else if (
    availabilityState === 'legacy_session' ||
    availabilityState === 'source_unavailable'
  ) {
    availability = { state: availabilityState };
  }
  const activeTurnValue = value['activeTurn'];
  const activeTurn =
    activeTurnValue === null
      ? null
      : isRecord(activeTurnValue) &&
          typeof activeTurnValue['requestId'] === 'string' &&
          isNonNegativeInteger(activeTurnValue['stateVersion'])
        ? {
            requestId: activeTurnValue['requestId'],
            stateVersion: activeTurnValue['stateVersion'],
          }
        : undefined;

  if (
    availability === undefined ||
    !isNonNegativeInteger(value['contextVersion']) ||
    !isNonNegativeInteger(value['snapshotCount']) ||
    !isNonNegativeInteger(value['totalAttachedMessageCount']) ||
    !isNonNegativeInteger(value['totalAttachedOmittedCount']) ||
    !isNonNegativeInteger(value['completedConversationRevision']) ||
    activeTurn === undefined
  ) {
    return legacyContextSummary();
  }

  return {
    displayTimeZone,
    availability,
    contextVersion: value['contextVersion'],
    snapshotCount: value['snapshotCount'],
    totalAttachedMessageCount: value['totalAttachedMessageCount'],
    totalAttachedOmittedCount: value['totalAttachedOmittedCount'],
    completedConversationRevision: value['completedConversationRevision'],
    activeTurn,
  };
}

function toPublicSession(session: ConversationAssistantSessionWire): ConversationAssistantSession {
  const result: ConversationAssistantSession = {
    id: session.id,
    status: session.status,
    range: { from: session.range.from, to: session.range.to },
    effectiveRange: {
      from: session.effectiveRange.from,
      to: session.effectiveRange.to,
    },
    model: session.model,
    modelDisplayName: session.modelDisplayName,
    assistantRoleLabel: session.assistantRoleLabel,
    transcriptMessageCount: session.transcriptMessageCount,
    omitted: toPublicOmittedCounts(session.omitted),
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    contextSummary: toPublicContextSummary(session.contextSummary),
  };
  if (session.chatDisplayName !== undefined) result.chatDisplayName = session.chatDisplayName;
  if (session.preparationStage !== undefined) result.preparationStage = session.preparationStage;
  if (session.preparationAttempt !== undefined) {
    result.preparationAttempt = session.preparationAttempt;
  }
  if (session.preparationError !== undefined) {
    result.preparationError = {
      code: session.preparationError.code,
      message: session.preparationError.message,
    };
  }
  if (session.lastTurnAt !== undefined) result.lastTurnAt = session.lastTurnAt;
  if (session.deletionToken !== undefined) result.deletionToken = session.deletionToken;
  if (session.deletionPending !== undefined) result.deletionPending = session.deletionPending;
  return result;
}

function toPublicOmittedCounts(
  omitted: ConversationAssistantContextResponse['omitted']
): ConversationAssistantContextResponse['omitted'] {
  return {
    mediaOnly: omitted.mediaOnly,
    failedTranscriptions: omitted.failedTranscriptions,
    pendingTranscriptions: omitted.pendingTranscriptions,
    nonText: omitted.nonText,
    overLimit: omitted.overLimit,
  };
}

function toPublicContextReaction(
  reaction: ConversationAssistantContextReaction
): ConversationAssistantContextReaction {
  const result: ConversationAssistantContextReaction = {
    id: reaction.id,
    emoji: reaction.emoji,
    direction: reaction.direction,
    eventTimestamp: reaction.eventTimestamp,
  };
  if (reaction.senderDisplayName !== undefined) {
    result.senderDisplayName = reaction.senderDisplayName;
  }
  return result;
}

function toPublicContextMessage(
  message: ConversationAssistantContextMessage
): ConversationAssistantContextMessage {
  const result: ConversationAssistantContextMessage = {
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
    result.reactions = message.reactions.map(toPublicContextReaction);
  }
  return result;
}

function toPublicOmittedContextMessage(
  message: ConversationAssistantOmittedContextMessage
): ConversationAssistantOmittedContextMessage {
  const result: ConversationAssistantOmittedContextMessage = {
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
    result.reactions = message.reactions.map(toPublicContextReaction);
  }
  if (message.reaction !== undefined) {
    result.reaction = { emoji: message.reaction.emoji };
    if (message.reaction.targetReference !== undefined) {
      result.reaction.targetReference = message.reaction.targetReference;
    }
  }
  return result;
}

function toPublicContextResponse(
  response: ConversationAssistantContextResponse
): ConversationAssistantContextResponse {
  const result: ConversationAssistantContextResponse = {
    sessionId: response.sessionId,
    messages: response.messages.map(toPublicContextMessage),
    omittedMessages: response.omittedMessages.map(toPublicOmittedContextMessage),
    messageCount: response.messageCount,
    omittedMessageCount: response.omittedMessageCount,
    snapshotAvailable: response.snapshotAvailable,
    omitted: toPublicOmittedCounts(response.omitted),
  };
  if (response.nextMessageCursor !== undefined) {
    result.nextMessageCursor = response.nextMessageCursor;
  }
  if (response.nextOmittedCursor !== undefined) {
    result.nextOmittedCursor = response.nextOmittedCursor;
  }
  return result;
}

function toPublicContextAttachment(
  attachment: ConversationAssistantContextAttachment
): ConversationAssistantContextAttachment {
  const result: ConversationAssistantContextAttachment = {
    id: attachment.id,
    status: attachment.status,
    compatibility: attachment.compatibility,
    capturedAt: attachment.capturedAt,
    requiresConfirmation: attachment.requiresConfirmation,
    newerAvailableCount: attachment.newerAvailableCount,
    newerAvailableCorrectionCount: attachment.newerAvailableCorrectionCount,
  };
  if (attachment.expiresAt !== undefined) result.expiresAt = attachment.expiresAt;
  if (attachment.captureRange !== undefined) {
    result.captureRange = {
      from: attachment.captureRange.from,
      to: attachment.captureRange.to,
    };
  }
  if (attachment.eventRange !== undefined) {
    result.eventRange = { from: attachment.eventRange.from, to: attachment.eventRange.to };
  }
  if (attachment.counts !== undefined) {
    result.counts = {
      included: attachment.counts.included,
      excluded: attachment.counts.excluded,
      completedTranscriptions: attachment.counts.completedTranscriptions,
      edited: attachment.counts.edited,
      redacted: attachment.counts.redacted,
      reactionsChanged: attachment.counts.reactionsChanged,
      lateIngested: attachment.counts.lateIngested,
    };
  }
  if (attachment.omitted !== undefined) {
    result.omitted = toPublicOmittedCounts(attachment.omitted);
  }
  if (attachment.confirmationToken !== undefined) {
    result.confirmationToken = attachment.confirmationToken;
  }
  if (attachment.error !== undefined) {
    result.error = { code: attachment.error.code, message: attachment.error.message };
  }
  return result;
}

function toPublicPreviewReaction(
  reaction: ConversationAssistantContextAttachmentPreviewReaction
): ConversationAssistantContextAttachmentPreviewReaction {
  const result: ConversationAssistantContextAttachmentPreviewReaction = {
    emoji: reaction.emoji,
    direction: reaction.direction,
    eventTimestamp: reaction.eventTimestamp,
  };
  if (reaction.senderDisplayName !== undefined) {
    result.senderDisplayName = reaction.senderDisplayName;
  }
  return result;
}

function toPublicIncludedPreviewMessage(
  message: ConversationAssistantContextAttachmentIncludedPreviewMessage
): ConversationAssistantContextAttachmentIncludedPreviewMessage {
  const result: ConversationAssistantContextAttachmentIncludedPreviewMessage = {
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
  message: ConversationAssistantContextAttachmentExcludedPreviewMessage
): ConversationAssistantContextAttachmentExcludedPreviewMessage {
  const result: ConversationAssistantContextAttachmentExcludedPreviewMessage = {
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
  projection: ConversationAssistantContextCorrectionProjection
): ConversationAssistantContextCorrectionProjection {
  switch (projection.state) {
    case 'missing':
    case 'unavailable':
      return { state: projection.state };
    case 'included':
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
    case 'omitted':
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
    case 'redacted':
    case 'deleted':
      return {
        state: projection.state,
        eventTimestamp: projection.eventTimestamp,
        importedAt: projection.importedAt,
        direction: projection.direction,
        speakerLabel: projection.speakerLabel,
        messageType: projection.messageType,
      };
  }
}

function toPublicAttachmentPreviewItem(
  item: ConversationAssistantContextAttachmentPreviewItem
): ConversationAssistantContextAttachmentPreviewItem {
  if (item.kind === 'included') {
    return {
      kind: 'included',
      message: toPublicIncludedPreviewMessage(item.message),
    };
  }
  if (item.kind === 'excluded') {
    return {
      kind: 'excluded',
      message: toPublicExcludedPreviewMessage(item.message),
    };
  }
  return {
    kind: 'correction',
    changeKind: item.changeKind,
    targetReference: item.targetReference,
    before: toPublicCorrectionProjection(item.before),
    after: toPublicCorrectionProjection(item.after),
  };
}

function toPublicTurnContextAttachmentSummary(
  attachment: ConversationAssistantTurnContextAttachmentSummary
): ConversationAssistantTurnContextAttachmentSummary {
  const result: ConversationAssistantTurnContextAttachmentSummary = {
    id: attachment.id,
    capturedAt: attachment.capturedAt,
    captureRange: { from: attachment.captureRange.from, to: attachment.captureRange.to },
    counts: {
      included: attachment.counts.included,
      excluded: attachment.counts.excluded,
      completedTranscriptions: attachment.counts.completedTranscriptions,
      edited: attachment.counts.edited,
      redacted: attachment.counts.redacted,
      reactionsChanged: attachment.counts.reactionsChanged,
      lateIngested: attachment.counts.lateIngested,
    },
    omitted: toPublicOmittedCounts(attachment.omitted),
  };
  if (attachment.eventRange !== undefined) {
    result.eventRange = { from: attachment.eventRange.from, to: attachment.eventRange.to };
  }
  return result;
}

function toPublicUsage(usage: ConversationAssistantUsage): ConversationAssistantUsage {
  const result: ConversationAssistantUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: usage.costUsd,
  };
  if (usage.cachedTokens !== undefined) result.cachedTokens = usage.cachedTokens;
  if (usage.cacheWriteTokens !== undefined) result.cacheWriteTokens = usage.cacheWriteTokens;
  return result;
}

function toPublicTurn(turn: ConversationAssistantTurn): ConversationAssistantTurn {
  const result: ConversationAssistantTurn = {
    id: turn.id,
    sessionId: turn.sessionId,
    role: turn.role,
    text: turn.text,
    createdAt: turn.createdAt,
  };
  if (turn.usage !== undefined) result.usage = toPublicUsage(turn.usage);
  if (turn.error !== undefined) {
    result.error = { code: turn.error.code, message: turn.error.message };
  }
  if (turn.sequence !== undefined) result.sequence = turn.sequence;
  if (turn.conversationRevision !== undefined) {
    result.conversationRevision = turn.conversationRevision;
  }
  if (turn.requestId !== undefined) result.requestId = turn.requestId;
  if (turn.canRetryAnswer !== undefined) result.canRetryAnswer = turn.canRetryAnswer;
  if (turn.kind !== undefined) result.kind = turn.kind;
  if (turn.contextAttachmentId !== undefined) {
    result.contextAttachmentId = turn.contextAttachmentId;
  }
  if (turn.contextAttachment !== undefined) {
    result.contextAttachment = toPublicTurnContextAttachmentSummary(turn.contextAttachment);
  }
  if (turn.acknowledgment !== undefined) result.acknowledgment = turn.acknowledgment;
  return result;
}

function toPublicTurnRequest(
  request: ConversationAssistantTurnRequest
): ConversationAssistantTurnRequest {
  const result: ConversationAssistantTurnRequest = {
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
  if (request.error !== undefined) {
    result.error = { code: request.error.code, message: request.error.message };
  }
  return result;
}

function toPublicTurnRequestResponse(
  response: ConversationAssistantTurnRequestResponse
): ConversationAssistantTurnRequestResponse {
  return {
    request: toPublicTurnRequest(response.request),
    turns: response.turns.map(toPublicTurn),
    canRetryAnswer: response.canRetryAnswer,
  };
}

function toPublicStreamEvent(
  event: ConversationAssistantStreamEvent
): ConversationAssistantStreamEvent {
  switch (event.type) {
    case 'request_state':
      return {
        type: event.type,
        requestId: event.requestId,
        streamSequence: event.streamSequence,
        request: toPublicTurnRequest(event.request),
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
      const result: Extract<
        ConversationAssistantStreamEvent,
        { type: 'user_turn' | 'assistant_turn' }
      > = { type: event.type, turn: toPublicTurn(event.turn) };
      if (event.requestId !== undefined) result.requestId = event.requestId;
      if (event.streamSequence !== undefined) result.streamSequence = event.streamSequence;
      return result;
    }
    case 'assistant_delta': {
      const result: Extract<ConversationAssistantStreamEvent, { type: 'assistant_delta' }> = {
        type: event.type,
        text: event.text,
      };
      if (event.requestId !== undefined) result.requestId = event.requestId;
      if (event.streamSequence !== undefined) result.streamSequence = event.streamSequence;
      return result;
    }
    case 'usage': {
      const result: Extract<ConversationAssistantStreamEvent, { type: 'usage' }> = {
        type: event.type,
        usage: toPublicUsage(event.usage),
      };
      if (event.requestId !== undefined) result.requestId = event.requestId;
      if (event.streamSequence !== undefined) result.streamSequence = event.streamSequence;
      return result;
    }
    case 'error': {
      const result: Extract<ConversationAssistantStreamEvent, { type: 'error' }> = {
        type: event.type,
        error: { code: event.error.code, message: event.error.message },
      };
      if (event.requestId !== undefined) result.requestId = event.requestId;
      if (event.streamSequence !== undefined) result.streamSequence = event.streamSequence;
      return result;
    }
    case 'done': {
      const result: Extract<ConversationAssistantStreamEvent, { type: 'done' }> = {
        type: event.type,
      };
      if (event.requestId !== undefined) result.requestId = event.requestId;
      if (event.streamSequence !== undefined) result.streamSequence = event.streamSequence;
      return result;
    }
  }
}

function parseAttachmentFilename(contentDisposition: string | null): string | null {
  if (contentDisposition === null) return null;

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8Match?.[1] !== undefined) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const filenameMatch = /filename="([^"]+)"|filename=([^;]+)/i.exec(contentDisposition);
  const filename = filenameMatch?.[1] ?? filenameMatch?.[2]?.trim();
  return filename === undefined || filename === '' ? null : filename;
}

export async function listConversationAssistantSessions(
  accessToken: string
): Promise<ConversationAssistantSessionsResponse> {
  const response = await apiRequest<ConversationAssistantSessionsWireResponse>(
    config.whatsappServiceUrl,
    CONVERSATION_ASSISTANT_SESSIONS_PATH,
    accessToken
  );
  return { sessions: response.sessions.map(toPublicSession) };
}

export async function createConversationAssistantSession(
  accessToken: string,
  request: CreateConversationAssistantSessionRequest
): Promise<ConversationAssistantSession> {
  const response = await apiRequest<CreateConversationAssistantSessionResponse>(
    config.whatsappServiceUrl,
    CONVERSATION_ASSISTANT_SESSIONS_PATH,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
  return toPublicSession(response.session);
}

export async function checkConversationAssistantContext(
  accessToken: string,
  request: ConversationAssistantContextCheckRequest
): Promise<ConversationAssistantContextCheckResponse> {
  return await apiRequest<ConversationAssistantContextCheckResponse>(
    config.whatsappServiceUrl,
    CONVERSATION_ASSISTANT_CONTEXT_CHECK_PATH,
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function getConversationAssistantSession(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantSession> {
  const response = await apiRequest<ConversationAssistantSessionResponse>(
    config.whatsappServiceUrl,
    getSessionPath(sessionId),
    accessToken
  );
  return toPublicSession(response.session);
}

export async function deleteConversationAssistantSession(
  accessToken: string,
  sessionId: string,
  deletionToken: string
): Promise<void> {
  await apiRequest<{ deleted: true }>(
    config.whatsappServiceUrl,
    getSessionPath(sessionId),
    accessToken,
    {
      method: 'DELETE',
      headers: { 'X-Conversation-Assistant-Deletion-Token': deletionToken },
    }
  );
}

export async function getConversationAssistantContext(
  accessToken: string,
  sessionId: string,
  cursors?: { messageCursor: number; omittedCursor: number }
): Promise<ConversationAssistantContextResponse> {
  const search = new URLSearchParams();
  if (cursors !== undefined) {
    search.set('messageCursor', String(cursors.messageCursor));
    search.set('omittedCursor', String(cursors.omittedCursor));
  }
  const query = search.size === 0 ? '' : `?${search.toString()}`;
  const response = await apiRequest<ConversationAssistantContextResponse>(
    config.whatsappServiceUrl,
    `${getSessionPath(sessionId)}/context${query}`,
    accessToken
  );
  return toPublicContextResponse(response);
}

export async function getConversationAssistantSessionByRequest(
  accessToken: string,
  requestId: string
): Promise<ConversationAssistantSession> {
  const response = await apiRequest<ConversationAssistantSessionResponse>(
    config.whatsappServiceUrl,
    `/conversation-assistant/session-requests/${encodeURIComponent(requestId)}`,
    accessToken
  );
  return toPublicSession(response.session);
}

export async function retryConversationAssistantPreparation(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantSession> {
  const response = await apiRequest<ConversationAssistantSessionResponse>(
    config.whatsappServiceUrl,
    `${getSessionPath(sessionId)}/preparation/retry`,
    accessToken,
    { method: 'POST' }
  );
  return toPublicSession(response.session);
}

export async function listConversationAssistantTurns(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantTurnsResponse> {
  const response = await apiRequest<ConversationAssistantTurnsResponse>(
    config.whatsappServiceUrl,
    `${getSessionPath(sessionId)}/turns`,
    accessToken
  );
  return { turns: response.turns.map(toPublicTurn) };
}

export async function createConversationAssistantContextAttachment(
  accessToken: string,
  sessionId: string,
  request: CreateConversationAssistantContextAttachmentRequest,
  signal?: AbortSignal
): Promise<ConversationAssistantContextAttachment> {
  const response = await apiRequest<ConversationAssistantContextAttachmentResponse>(
    config.whatsappServiceUrl,
    getContextAttachmentPath(sessionId),
    accessToken,
    {
      method: 'POST',
      body: {
        requestId: request.requestId,
        ...(request.replacesAttachmentId === undefined
          ? {}
          : { replacesAttachmentId: request.replacesAttachmentId }),
      },
      ...(signal === undefined ? {} : { signal }),
    }
  );
  return toPublicContextAttachment(response.attachment);
}

export async function getConversationAssistantContextAttachment(
  accessToken: string,
  sessionId: string,
  attachmentId: string,
  signal?: AbortSignal
): Promise<ConversationAssistantContextAttachment> {
  const response = await apiRequest<ConversationAssistantContextAttachmentResponse>(
    config.whatsappServiceUrl,
    getContextAttachmentPath(sessionId, attachmentId),
    accessToken,
    signal === undefined ? {} : { signal }
  );
  return toPublicContextAttachment(response.attachment);
}

export async function getConversationAssistantContextAttachmentPreview(
  accessToken: string,
  sessionId: string,
  attachmentId: string,
  pagination: { cursor?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<ConversationAssistantContextAttachmentPreviewResponse> {
  const search = new URLSearchParams();
  if (pagination.cursor !== undefined) search.set('cursor', pagination.cursor);
  if (pagination.limit !== undefined) search.set('limit', String(pagination.limit));
  const suffix = search.size === 0 ? '' : `?${search.toString()}`;
  const response = await apiRequest<ConversationAssistantContextAttachmentPreviewResponse>(
    config.whatsappServiceUrl,
    `${getContextAttachmentPath(sessionId, attachmentId)}/messages${suffix}`,
    accessToken,
    signal === undefined ? {} : { signal }
  );
  const result: ConversationAssistantContextAttachmentPreviewResponse = {
    items: response.items.map(toPublicAttachmentPreviewItem),
  };
  if (response.nextCursor !== undefined) result.nextCursor = response.nextCursor;
  return result;
}

export async function removeConversationAssistantContextAttachment(
  accessToken: string,
  sessionId: string,
  attachmentId: string,
  signal?: AbortSignal
): Promise<void> {
  await apiRequest<{ deleted: true }>(
    config.whatsappServiceUrl,
    getContextAttachmentPath(sessionId, attachmentId),
    accessToken,
    { method: 'DELETE', ...(signal === undefined ? {} : { signal }) }
  );
}

export async function retryConversationAssistantContextAttachment(
  accessToken: string,
  sessionId: string,
  attachmentId: string,
  signal?: AbortSignal
): Promise<ConversationAssistantContextAttachment> {
  const response = await apiRequest<ConversationAssistantContextAttachmentResponse>(
    config.whatsappServiceUrl,
    `${getContextAttachmentPath(sessionId, attachmentId)}/preparation/retry`,
    accessToken,
    { method: 'POST', ...(signal === undefined ? {} : { signal }) }
  );
  return toPublicContextAttachment(response.attachment);
}

export async function getConversationAssistantContextHistory(
  accessToken: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<ConversationAssistantContextHistoryResponse> {
  const response = await apiRequest<ConversationAssistantContextHistoryResponse>(
    config.whatsappServiceUrl,
    `${getSessionPath(sessionId)}/context/history`,
    accessToken,
    signal === undefined ? {} : { signal }
  );
  return {
    snapshots: response.snapshots.map((snapshot) => {
      const projected: ConversationAssistantContextHistoryResponse['snapshots'][number] = {
        kind: snapshot.kind,
        contextVersion: snapshot.contextVersion,
        capturedAt: snapshot.capturedAt,
        messageCount: snapshot.messageCount,
        excludedCount: snapshot.excludedCount,
        correctionCount: snapshot.correctionCount,
        omitted: {
          mediaOnly: snapshot.omitted.mediaOnly,
          failedTranscriptions: snapshot.omitted.failedTranscriptions,
          pendingTranscriptions: snapshot.omitted.pendingTranscriptions,
          nonText: snapshot.omitted.nonText,
          overLimit: snapshot.omitted.overLimit,
        },
      };
      if (snapshot.attachmentId !== undefined) projected.attachmentId = snapshot.attachmentId;
      if (snapshot.linkedTurnId !== undefined) projected.linkedTurnId = snapshot.linkedTurnId;
      if (snapshot.captureRange !== undefined) {
        projected.captureRange = {
          from: snapshot.captureRange.from,
          to: snapshot.captureRange.to,
        };
      }
      if (snapshot.eventRange !== undefined) {
        projected.eventRange = {
          from: snapshot.eventRange.from,
          to: snapshot.eventRange.to,
        };
      }
      return projected;
    }),
  };
}

export async function getConversationAssistantTurnRequest(
  accessToken: string,
  sessionId: string,
  requestId: string,
  signal?: AbortSignal
): Promise<ConversationAssistantTurnRequestResponse> {
  const response = await apiRequest<ConversationAssistantTurnRequestResponse>(
    config.whatsappServiceUrl,
    getTurnRequestPath(sessionId, requestId),
    accessToken,
    signal === undefined ? {} : { signal }
  );
  return toPublicTurnRequestResponse(response);
}

export async function retryConversationAssistantTurnAnswer(
  accessToken: string,
  sessionId: string,
  requestId: string,
  signal?: AbortSignal
): Promise<ConversationAssistantTurnRequestResponse> {
  const response = await apiRequest<ConversationAssistantTurnRequestResponse>(
    config.whatsappServiceUrl,
    `${getTurnRequestPath(sessionId, requestId)}/answer/retry`,
    accessToken,
    { method: 'POST', ...(signal === undefined ? {} : { signal }) }
  );
  return toPublicTurnRequestResponse(response);
}

export async function resumeConversationAssistantTurnRequest(
  accessToken: string,
  sessionId: string,
  requestId: string,
  signal?: AbortSignal
): Promise<ConversationAssistantTurnRequestResponse> {
  const response = await apiRequest<ConversationAssistantTurnRequestResponse>(
    config.whatsappServiceUrl,
    `${getTurnRequestPath(sessionId, requestId)}/resume`,
    accessToken,
    { method: 'POST', ...(signal === undefined ? {} : { signal }) }
  );
  return toPublicTurnRequestResponse(response);
}

export async function exportConversationAssistantSessionPdf(
  accessToken: string,
  sessionId: string
): Promise<ConversationAssistantPdfDownload> {
  const response = await fetch(
    `${config.whatsappServiceUrl}${getSessionPath(sessionId)}/export.pdf`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Request-Id': newRequestId(),
      },
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    throw await toApiError(response);
  }

  return {
    blob: await response.blob(),
    filename:
      parseAttachmentFilename(response.headers.get('Content-Disposition')) ??
      `conversation-assistant-${sessionId}.pdf`,
  };
}

export async function streamConversationAssistantTurn(
  accessToken: string,
  sessionId: string,
  request: SendConversationAssistantTurnRequest,
  onEvent: (event: ConversationAssistantStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(
    `${config.whatsappServiceUrl}${getSessionPath(sessionId)}/turns/stream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Request-Id': newRequestId(),
      },
      body: JSON.stringify(request),
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    }
  );

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.body === null) {
    throw new ApiError('SERVICE_UNAVAILABLE', 'Streaming response was empty', response.status);
  }

  await readConversationAssistantEventStream(response.body, onEvent);
}

async function readConversationAssistantEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ConversationAssistantStreamEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const receivedEventTypes = new Set<ConversationAssistantStreamEvent['type']>();
  const trackEvent = (event: ConversationAssistantStreamEvent): void => {
    receivedEventTypes.add(event.type);
    onEvent(event);
  };

  let next = await reader.read();
  while (!next.done) {
    buffer += decoder.decode(next.value, { stream: true });
    buffer = dispatchCompleteSseFrames(buffer, trackEvent);
    next = await reader.read();
  }

  buffer += decoder.decode();
  if (buffer.trim() !== '') {
    dispatchSseFrame(buffer, trackEvent);
  }
  if (
    !receivedEventTypes.has('done') ||
    (receivedEventTypes.has('user_turn') && !receivedEventTypes.has('assistant_turn'))
  ) {
    throw new ApiError(
      'SERVICE_UNAVAILABLE',
      'Assistant response stream ended before completion',
      503
    );
  }
}

function dispatchCompleteSseFrames(
  buffer: string,
  onEvent: (event: ConversationAssistantStreamEvent) => void
): string {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const frames = normalized.split('\n\n');
  const remainder = frames.pop() ?? '';
  for (const frame of frames) {
    dispatchSseFrame(frame, onEvent);
  }
  return remainder;
}

function dispatchSseFrame(
  frame: string,
  onEvent: (event: ConversationAssistantStreamEvent) => void
): void {
  const lines = frame.split('\n');
  const eventType = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length);
  const data = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('\n');
  if (eventType === undefined || data === '') return;
  onEvent(toPublicStreamEvent(JSON.parse(data) as ConversationAssistantStreamEvent));
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as {
      error?: { code?: unknown; message?: unknown; details?: Record<string, unknown> };
    };
    const code = typeof payload.error?.code === 'string' ? payload.error.code : 'UNKNOWN';
    const message =
      typeof payload.error?.message === 'string'
        ? payload.error.message
        : `Unexpected response from server (${String(response.status)})`;
    return new ApiError(code, message, response.status, payload.error?.details);
  } catch {
    return new ApiError(
      'SERVICE_UNAVAILABLE',
      `Unexpected response from server (${String(response.status)})`,
      response.status
    );
  }
}

export async function sendConversationAssistantTurn(
  accessToken: string,
  sessionId: string,
  request: SendConversationAssistantTurnRequest,
  signal?: AbortSignal
): Promise<ConversationAssistantTurnsResponse> {
  const response = await apiRequest<ConversationAssistantTurnsResponse>(
    config.whatsappServiceUrl,
    `${getSessionPath(sessionId)}/turns`,
    accessToken,
    {
      method: 'POST',
      body: request,
      ...(signal === undefined ? {} : { signal }),
    }
  );
  return { turns: response.turns.map(toPublicTurn) };
}
