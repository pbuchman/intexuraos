import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { GenerateChatResult, LLMError } from '@intexuraos/llm-factory';
import {
  getConversationAssistantModelDisplayName,
  isConversationAssistantModel,
} from '@intexuraos/llm-contract';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_PROMPT,
  buildWhatsAppConversationAssistantMessages,
} from '@intexuraos/llm-prompts';
import { DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL } from './roleInference.js';
import {
  buildPrivateConversationTranscriptText,
  projectPrivateConversationContext,
} from './transcriptFormatting.js';
import { reconcileConversationContextAtCutoff } from './contextReconciliation.js';
import { isLatestRetryableConversationAssistantAnswer } from './answerRetryCapability.js';
import {
  recordConversationAssistantTelemetry,
  type ConversationAssistantTelemetryInput,
} from './operationalTelemetry.js';
import type { ConversationAssistantDeps } from './ports.js';
import type {
  CheckConversationAssistantContextInput,
  CheckConversationAssistantContextResult,
  ConversationAssistantError,
  ConversationAssistantResult,
  ConversationAssistantSession,
  ConversationAssistantStreamEvent,
  ConversationAssistantTurn,
  CreateConversationAssistantSessionInput,
  CreateConversationAssistantSessionResult,
  DeleteConversationAssistantSessionInput,
  ExportConversationAssistantPdfInput,
  ExportConversationAssistantPdfResult,
  GetConversationAssistantContextInput,
  GetConversationAssistantSessionByRequestInput,
  SendConversationAssistantTurnInput,
  ConversationAssistantContextResult,
  PrepareConversationAssistantSessionInput,
  PrepareConversationAssistantSessionResult,
} from './types.js';
import {
  CONVERSATION_ASSISTANT_PUBLIC_LLM_ERROR_MESSAGE,
  CONVERSATION_ASSISTANT_LARGE_CONTEXT_WARNING_THRESHOLD,
} from './types.js';
import type {
  PrivateWhatsAppChat,
  PrivateWhatsAppContextChange,
  PrivateWhatsAppMessage,
} from '../whatsapp/index.js';

export const conversationAssistantSystemClock = {
  now: (): string => new Date().toISOString(),
};

export const conversationAssistantRandomIds = {
  sessionId: (input?: { userId: string; requestId: string }): string =>
    input === undefined
      ? `whatsapp_conv_session_${randomUUID()}`
      : `whatsapp_conv_session_${createHash('sha256')
          .update(`${input.userId}:${input.requestId}`)
          .digest('hex')
          .slice(0, 32)}`,
  sessionGenerationId: (): string => randomUUID(),
  turnId: (): string => `whatsapp_conv_turn_${randomUUID()}`,
};

const CONVERSATION_CONTEXT_RAW_SCAN_LIMIT = 5000;
const CONVERSATION_CONTEXT_PAGE_SIZE = 100;
const CONVERSATION_PREPARATION_LEASE_MS = 5 * 60 * 1000;

export function deriveEffectiveRange(
  messages: readonly { eventTimestamp: string }[],
  fallback: { from: string; to: string }
): { from: string; to: string } {
  const first = messages[0];
  const last = messages.at(-1);
  if (first === undefined || last === undefined) {
    return fallback;
  }
  return { from: first.eventTimestamp, to: last.eventTimestamp };
}

export async function createConversationAssistantSession(
  input: CreateConversationAssistantSessionInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<CreateConversationAssistantSessionResult>> {
  const validation = validateCreateInput(input);
  if (validation !== null) {
    return err(validation);
  }

  const selectedModel = input.model ?? deps.defaultModel;
  if (!isConversationAssistantModel(selectedModel)) {
    return err({
      code: 'INVALID_REQUEST',
      message: 'Unsupported Conversation Assistant model',
    });
  }

  const trimmedRequestId = input.requestId?.trim();
  const creationRequestId =
    trimmedRequestId === undefined || trimmedRequestId === '' ? randomUUID() : trimmedRequestId;
  const sessionId = deps.ids.sessionId({ userId: input.userId, requestId: creationRequestId });
  const chatLoadResult = await loadOwnedDirectChat(input, deps);
  if (!chatLoadResult.ok) {
    return chatLoadResult;
  }

  const now = deps.clock.now();
  const session: ConversationAssistantSession = {
    id: sessionId,
    userId: input.userId,
    chatId: input.chatId,
    sourceAccountId: chatLoadResult.value.sourceAccountId,
    sourceAccountGeneration: chatLoadResult.value.accountGeneration,
    status: 'preparing',
    preparationStage: 'queued',
    preparationAttempt: 1,
    range: { from: input.from, to: input.to },
    effectiveRange: { from: input.from, to: input.to },
    model: selectedModel,
    transcriptSha256: '',
    transcriptMessageCount: 0,
    transcriptText: '',
    assistantRoleLabel: DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
    omitted: emptyOmittedCounts(),
    title: deriveTitle(chatLoadResult.value.chat.displayName, input.from, input.to),
    createdAt: now,
    updatedAt: now,
    creationRequestId,
    generationId: deps.ids.sessionGenerationId(),
    preparationDisplayTimeZone: input.displayTimeZone ?? 'UTC',
  };
  if (chatLoadResult.value.chat.displayName !== undefined) {
    session.chatDisplayName = chatLoadResult.value.chat.displayName;
  }
  if (input.maxMessages !== undefined) {
    session.maxMessages = input.maxMessages;
  }

  const creation = await deps.repository.createSessionIfAbsent(session);
  if (creation.status === 'source_unavailable') {
    return err({ code: 'NOT_FOUND', message: 'Private WhatsApp mirror is not configured' });
  }
  if (creation.status === 'existing') {
    return await reuseOrRequeueConversationAssistantSession(
      creation.session,
      input.userId,
      creationRequestId,
      deps
    );
  }
  return ok({ session: await publishQueuedConversationAssistantPreparation(session, deps) });
}

export async function deleteConversationAssistantSession(
  input: DeleteConversationAssistantSessionInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<{ deleted: true }>> {
  const startedAt = performance.now();
  try {
    await deps.repository.deleteSession(input);
    await recordConversationAssistantTelemetry(deps.telemetry, {
      operation: 'session_cleanup',
      outcome: 'completed',
      durationMs: performance.now() - startedAt,
    });
    return ok({ deleted: true });
  } catch (error) {
    await recordConversationAssistantTelemetry(deps.telemetry, {
      operation: 'session_cleanup',
      outcome: 'failed',
      durationMs: performance.now() - startedAt,
    });
    throw error;
  }
}

export async function prepareConversationAssistantSession(
  input: PrepareConversationAssistantSessionInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<PrepareConversationAssistantSessionResult>> {
  const session = await deps.repository.getSessionById(input.sessionId);
  if (!isOwnedSession(session, input.userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  if (session.generationId !== input.generationId) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  if (isSessionReady(session)) {
    return ok({ session });
  }
  const attempt = input.attempt ?? session.preparationAttempt ?? 1;
  const trimmedClaimId = input.claimId?.trim();
  const claimId =
    trimmedClaimId === undefined || trimmedClaimId === '' ? randomUUID() : trimmedClaimId;
  const now = deps.clock.now();
  const claim = await deps.repository.claimPreparation({
    sessionId: session.id,
    userId: input.userId,
    attempt,
    claimId,
    now,
    leaseExpiresAt: new Date(Date.parse(now) + CONVERSATION_PREPARATION_LEASE_MS).toISOString(),
    ...(session.generationId !== undefined
      ? { expectedGenerationId: session.generationId }
      : {}),
  });
  if (claim.status === 'not_found') {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  if (claim.status === 'busy') {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: 'Conversation Assistant preparation is already in progress',
    });
  }
  if (claim.status === 'stale') {
    return ok({ session: claim.session });
  }

  let workingSession = claim.session;

  const chatLoadResult = await loadOwnedDirectChat(
    { userId: workingSession.userId, chatId: workingSession.chatId },
    deps
  );
  if (!chatLoadResult.ok) {
    const saved = await markClaimedConversationAssistantPreparationFailed(
      workingSession,
      chatLoadResult.error,
      attempt,
      claimId,
      deps
    );
    if (!saved) return await currentPreparationResult(session.id, input.userId, deps);
    return chatLoadResult;
  }

  const messagesResult = await loadReconciledConversationAssistantMessages(
    workingSession,
    chatLoadResult.value.sourceAccountId,
    deps
  );
  if (!messagesResult.ok) {
    const saved = await markClaimedConversationAssistantPreparationFailed(
      workingSession,
      messagesResult.error,
      attempt,
      claimId,
      deps
    );
    if (!saved) return await currentPreparationResult(session.id, input.userId, deps);
    return messagesResult;
  }

  workingSession = {
    ...workingSession,
    preparationStage: 'building_context',
    updatedAt: deps.clock.now(),
  };
  const savedBuildingStage = await deps.repository.saveClaimedPreparationSession({
    session: workingSession,
    attempt,
    claimId,
    now: deps.clock.now(),
  });
  if (!savedBuildingStage) {
    return await currentPreparationResult(session.id, input.userId, deps);
  }

  const context = projectPrivateConversationContext({
    chat: chatLoadResult.value.chat,
    range: workingSession.range,
    messages: messagesResult.value.messages,
    captureOmittedMessages: true,
    ...(workingSession.generationId === undefined
      ? {}
      : {
          referenceScope: {
            sessionId: workingSession.id,
            sessionGenerationId: workingSession.generationId,
          },
        }),
    ...(workingSession.maxMessages !== undefined
      ? { maxMessages: workingSession.maxMessages }
      : {}),
  });
  if (context.messages.length === 0) {
    const emptyError = {
      code: 'EMPTY_TRANSCRIPT' as const,
      message: 'Selected range contains no textual messages',
    };
    const saved = await markClaimedConversationAssistantPreparationFailed(
      workingSession,
      emptyError,
      attempt,
      claimId,
      deps
    );
    if (!saved) return await currentPreparationResult(session.id, input.userId, deps);
    return err(emptyError);
  }

  const contextSnapshotId = createContextSnapshotId(workingSession.id, attempt, claimId);
  try {
    const contextSaved = await deps.repository.saveContextSnapshot(
      workingSession.id,
      workingSession.userId,
      contextSnapshotId,
      { messages: context.messages, omittedMessages: context.omittedMessages },
      workingSession.generationId
    );
    if (!contextSaved) {
      return await currentPreparationResult(session.id, input.userId, deps);
    }
  } catch (error) {
    await deps.repository.deleteContextSnapshot(
      workingSession.id,
      workingSession.userId,
      contextSnapshotId,
      workingSession.generationId
    );
    throw error;
  }

  const readySession: ConversationAssistantSession = {
    ...workingSession,
    status: 'ready',
    preparationStage: 'ready',
    effectiveRange: deriveEffectiveRange(context.messages, workingSession.range),
    transcriptSha256: context.transcriptSha256,
    contextSnapshotId,
    transcriptMessageCount: context.messageCount,
    transcriptText: buildPrivateConversationTranscriptText(
      context.messages,
      workingSession.generationId === undefined
        ? undefined
        : {
            sessionId: workingSession.id,
            sessionGenerationId: workingSession.generationId,
          }
    ),
    omitted: context.omitted,
    continuation: {
      sourceAccountId: chatLoadResult.value.sourceAccountId,
      contextVersion: 0,
      contextEventThrough: workingSession.range.to,
      contextChangeThrough: messagesResult.value.cutoffSequence,
      contextChainSha256: createInitialContextChainSha256(context.transcriptSha256),
      displayTimeZone: workingSession.preparationDisplayTimeZone ?? 'UTC',
      nextTurnSequence: 1,
      nextConversationRevision: 1,
      completedConversationRevision: 0,
      attachmentCount: 0,
      totalAttachedMessageCount: 0,
      totalAttachedOmittedCount: 0,
    },
    updatedAt: deps.clock.now(),
  };
  delete readySession.preparationError;
  delete readySession.preparationClaimId;
  delete readySession.preparationLeaseExpiresAt;
  delete readySession.preparationDisplayTimeZone;
  let savedReadySession: boolean;
  try {
    savedReadySession = await deps.repository.saveClaimedPreparationSession({
      session: readySession,
      attempt,
      claimId,
      now: deps.clock.now(),
    });
  } catch (error) {
    await deps.repository.deleteContextSnapshot(
      workingSession.id,
      workingSession.userId,
      contextSnapshotId,
      workingSession.generationId
    );
    throw error;
  }
  if (!savedReadySession) {
    await deps.repository.deleteContextSnapshot(
      workingSession.id,
      workingSession.userId,
      contextSnapshotId,
      workingSession.generationId
    );
    return await currentPreparationResult(session.id, input.userId, deps);
  }
  return ok({ session: readySession, context });
}

export async function getConversationAssistantSessionByRequest(
  input: GetConversationAssistantSessionByRequestInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ConversationAssistantSession>> {
  const requestId = input.requestId.trim();
  if (requestId.length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'Request id is required' });
  }
  const sessionId = deps.ids.sessionId({ userId: input.userId, requestId });
  const session = await deps.repository.getSessionById(sessionId);
  if (
    !isOwnedSession(session, input.userId) ||
    session.creationRequestId !== requestId
  ) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  return ok(session);
}

export async function retryConversationAssistantPreparation(
  input: PrepareConversationAssistantSessionInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ConversationAssistantSession>> {
  const session = await deps.repository.getSessionById(input.sessionId);
  if (!isOwnedSession(session, input.userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  if (isSessionReady(session)) {
    return err({ code: 'INVALID_REQUEST', message: 'Conversation context is already ready' });
  }
  if (session.status !== 'failed') {
    return err({ code: 'INVALID_REQUEST', message: 'Conversation context is already preparing' });
  }
  const requeued = await requeueConversationAssistantPreparation(session, deps);
  if (requeued === null) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  return ok(requeued);
}

export async function checkConversationAssistantContext(
  input: CheckConversationAssistantContextInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<CheckConversationAssistantContextResult>> {
  const validation = validateCreateInput(input);
  if (validation !== null) {
    return err(validation);
  }

  const chatLoadResult = await loadOwnedDirectChat(input, deps);
  if (!chatLoadResult.ok) {
    return chatLoadResult;
  }

  const messagesResult = await deps.privateWhatsAppRepository.findConversationContextMessages({
    sourceAccountId: chatLoadResult.value.sourceAccountId,
    chatId: input.chatId,
    from: input.from,
    to: input.to,
    limit: 1,
  });
  if (!messagesResult.ok) {
    return err(toPersistenceError(messagesResult.error.message));
  }

  const messageCount = messagesResult.value.totalCount;
  return ok({
    messageCount,
    warningThreshold: CONVERSATION_ASSISTANT_LARGE_CONTEXT_WARNING_THRESHOLD,
    requiresConfirmation: messageCount > CONVERSATION_ASSISTANT_LARGE_CONTEXT_WARNING_THRESHOLD,
  });
}

export async function sendConversationAssistantTurn(
  input: SendConversationAssistantTurnInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ConversationAssistantTurn[]>> {
  const question = input.question.trim();
  if (question.length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'Question is required' });
  }

  const session = await deps.repository.getSessionById(input.sessionId);
  if (!isOwnedSession(session, input.userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  if (!isSessionReady(session)) {
    return err({
      code: 'CONTEXT_NOT_READY',
      message: 'Conversation context is not ready yet',
    });
  }

  const result = await appendQuestionAndAssistantTurn({ session, question }, deps);
  return result.ok ? ok(result.value.turns) : result;
}

export async function streamConversationAssistantTurn(
  input: SendConversationAssistantTurnInput,
  deps: ConversationAssistantDeps,
  onEvent: (event: ConversationAssistantStreamEvent) => void
): Promise<ConversationAssistantResult<ConversationAssistantTurn[]>> {
  const question = input.question.trim();
  if (question.length === 0) {
    return err({ code: 'INVALID_REQUEST', message: 'Question is required' });
  }

  const session = await deps.repository.getSessionById(input.sessionId);
  if (!isOwnedSession(session, input.userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  if (!isSessionReady(session)) {
    return err({
      code: 'CONTEXT_NOT_READY',
      message: 'Conversation context is not ready yet',
    });
  }

  const userTurn = createTurn(session, 'user', question, deps);
  if (!(await deps.repository.saveTurnIfSessionExists(userTurn, session.generationId))) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  onEvent({ type: 'user_turn', turn: userTurn });

  const promptInput = await buildPromptInputAfterUserTurn({ session, question }, deps);
  const llmResult = await callConversationAssistantModelStream(
    session,
    promptInput,
    deps,
    onEvent
  );
  const assistantTurn = createAssistantTurnFromModelResult(session, llmResult, deps);

  if (assistantTurn.error !== undefined) {
    onEvent({
      type: 'error',
      error: { code: 'LLM_ERROR', message: assistantTurn.error.message },
    });
  }

  if (!(await persistAssistantTurnAndTouchSession(session, assistantTurn, deps))) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  onEvent({ type: 'assistant_turn', turn: assistantTurn });
  onEvent({ type: 'done' });

  return ok([userTurn, assistantTurn]);
}

export async function listConversationAssistantSessions(
  userId: string,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ConversationAssistantSession[]>> {
  return ok(await deps.repository.listSessionsByUserId(userId));
}

export async function getConversationAssistantSession(
  input: { userId: string; sessionId: string },
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ConversationAssistantSession>> {
  const session = await deps.repository.getSessionById(input.sessionId);
  if (!isOwnedSession(session, input.userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  return ok(session);
}

export async function getConversationAssistantContext(
  input: GetConversationAssistantContextInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ConversationAssistantContextResult>> {
  const session = await deps.repository.getSessionById(input.sessionId);
  if (!isOwnedSession(session, input.userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  if (!isSessionReady(session)) {
    return err({
      code: 'CONTEXT_NOT_READY',
      message: 'Conversation context is not ready yet',
    });
  }
  const messageCursor = input.messageCursor ?? 0;
  const omittedCursor = input.omittedCursor ?? 0;
  if (!isValidContextCursor(messageCursor) || !isValidContextCursor(omittedCursor)) {
    return err({ code: 'INVALID_REQUEST', message: 'Context cursor must be a non-negative integer' });
  }
  const omittedMessageCount = totalOmittedCount(session.omitted);
  const snapshot =
    session.contextSnapshotId === undefined
      ? { messages: [], omittedMessages: [], snapshotAvailable: false }
      : await deps.repository.getContextPage(session.id, session.contextSnapshotId, {
          messageCursor,
          omittedCursor,
          limit: CONVERSATION_CONTEXT_PAGE_SIZE,
          messageCount: session.transcriptMessageCount,
          omittedMessageCount,
        });
  const messages = snapshot.messages;
  const omittedMessages = snapshot.omittedMessages;
  const result: ConversationAssistantContextResult = {
    sessionId: session.id,
    messages,
    omittedMessages,
    messageCount: session.transcriptMessageCount,
    omittedMessageCount,
    snapshotAvailable: snapshot.snapshotAvailable,
    omitted: { ...session.omitted },
    transcriptSha256: session.transcriptSha256,
  };
  const nextMessageCursor = messageCursor + messages.length;
  if (
    snapshot.snapshotAvailable &&
    messages.length > 0 &&
    nextMessageCursor < session.transcriptMessageCount
  ) {
    result.nextMessageCursor = nextMessageCursor;
  }
  const nextOmittedCursor = omittedCursor + omittedMessages.length;
  if (
    snapshot.snapshotAvailable &&
    omittedMessages.length > 0 &&
    nextOmittedCursor < omittedMessageCount
  ) {
    result.nextOmittedCursor = nextOmittedCursor;
  }
  return ok(result);
}

export interface ConversationAssistantTurnHistoryItem {
  turn: ConversationAssistantTurn;
  canRetryAnswer: boolean;
}

export async function listConversationAssistantTurns(
  input: { userId: string; sessionId: string },
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ConversationAssistantTurnHistoryItem[]>> {
  const session = await deps.repository.getSessionById(input.sessionId);
  if (!isOwnedSession(session, input.userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  const completedConversationRevision = session.continuation?.completedConversationRevision;
  const turns = await deps.repository.listTurnsBySessionId(input.sessionId);
  return ok(
    turns.map((turn) => ({
      turn,
      canRetryAnswer: isLatestRetryableConversationAssistantAnswer({
        failed:
          turn.role === 'assistant' &&
          turn.requestId !== undefined &&
          turn.error !== undefined,
        errorCode: turn.error?.code,
        conversationRevision: turn.conversationRevision,
        completedConversationRevision,
        activeTurnRequestId: session.continuation?.activeTurnRequestId,
        activeTurnLeaseExpiresAt: session.continuation?.activeTurnLeaseExpiresAt,
        now: deps.clock.now(),
      }),
    }))
  );
}

export async function exportConversationAssistantSessionPdf(
  input: ExportConversationAssistantPdfInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ExportConversationAssistantPdfResult>> {
  const startedAt = performance.now();
  const telemetryState: { completedConversationRevision?: number } = {};
  try {
    const result = await exportConversationAssistantSessionPdfWithoutTelemetry(
      input,
      deps,
      telemetryState
    );
    await recordConversationAssistantTelemetry(
      deps.telemetry,
      pdfRevisionTelemetryInput(result, telemetryState, performance.now() - startedAt)
    );
    return result;
  } catch (error) {
    await recordConversationAssistantTelemetry(deps.telemetry, {
      operation: 'pdf_revision',
      outcome: 'failed',
      durationMs: performance.now() - startedAt,
      ...(telemetryState.completedConversationRevision === undefined
        ? {}
        : { count: telemetryState.completedConversationRevision }),
    });
    throw error;
  }
}

async function exportConversationAssistantSessionPdfWithoutTelemetry(
  input: ExportConversationAssistantPdfInput,
  deps: ConversationAssistantDeps,
  telemetryState: { completedConversationRevision?: number }
): Promise<ConversationAssistantResult<ExportConversationAssistantPdfResult>> {
  if (deps.pdfExporter === undefined) {
    return err({
      code: 'INTERNAL_ERROR',
      message: 'Conversation Assistant PDF exporter is not configured',
    });
  }

  const snapshot = await deps.repository.getSessionSnapshotById({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  if (snapshot === null) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  const session = snapshot.session;

  const completedConversationRevision = session.continuation?.completedConversationRevision;
  if (completedConversationRevision !== undefined) {
    telemetryState.completedConversationRevision = completedConversationRevision;
  }
  const completedTurns = snapshot.turns.filter(
    (turn) =>
      completedConversationRevision === undefined ||
      turn.conversationRevision === undefined ||
      turn.conversationRevision <= completedConversationRevision
  );
  const orderedTurns = [...completedTurns].sort((a, b) => {
    if (a.sequence !== undefined && b.sequence !== undefined) {
      const sequenceComparison = a.sequence - b.sequence;
      if (sequenceComparison !== 0) return sequenceComparison;
    }
    const createdComparison = a.createdAt.localeCompare(b.createdAt);
    if (createdComparison !== 0) {
      return createdComparison;
    }
    const roleComparison = turnRoleSortValue(a.role) - turnRoleSortValue(b.role);
    return roleComparison === 0 ? a.id.localeCompare(b.id) : roleComparison;
  });
  const omittedBreakdown = session.omitted;
  const excluded =
    omittedBreakdown.mediaOnly +
    omittedBreakdown.failedTranscriptions +
    omittedBreakdown.pendingTranscriptions +
    omittedBreakdown.nonText +
    omittedBreakdown.overLimit;
  const initialPrompt = orderedTurns.find((turn) => turn.role === 'user')?.text;
  if (initialPrompt === undefined || initialPrompt.trim().length === 0) {
    return err({
      code: 'EMPTY_TRANSCRIPT',
      message: 'Conversation Assistant session has no initial user prompt',
    });
  }

  const completedAttachments = orderedTurns.flatMap((turn) =>
    turn.contextAttachment === undefined ? [] : [turn.contextAttachment]
  );
  const cumulativeContext = completedAttachments.reduce(
    (summary, attachment) => ({
      snapshotCount: summary.snapshotCount + 1,
      counts: {
        included: summary.counts.included + attachment.counts.included,
        omitted: summary.counts.omitted + attachment.counts.excluded,
        completedTranscriptions:
          summary.counts.completedTranscriptions + attachment.counts.completedTranscriptions,
        edited: summary.counts.edited + attachment.counts.edited,
        redacted: summary.counts.redacted + normalizedRedactionCount(attachment.counts),
        deleted: 0,
        reactionsChanged: summary.counts.reactionsChanged + attachment.counts.reactionsChanged,
        lateIngested: summary.counts.lateIngested + attachment.counts.lateIngested,
      },
    }),
    {
      snapshotCount: 1,
      counts: {
        included: session.transcriptMessageCount,
        omitted: excluded,
        completedTranscriptions: 0,
        edited: 0,
        redacted: 0,
        deleted: 0,
        reactionsChanged: 0,
        lateIngested: 0,
      },
    }
  );

  const exportResult = await deps.pdfExporter.exportConversation({
    title: session.title,
    modelName: getConversationAssistantModelDisplayName(session.model),
    assistantRoleLabel: session.assistantRoleLabel,
    initialPrompt,
    generatedAt: deps.clock.now(),
    sourceRange: session.range,
    effectiveRange: session.effectiveRange,
    messageCounts: {
      included: session.transcriptMessageCount,
      excluded,
    },
    cumulativeContext,
    omittedBreakdown: { ...omittedBreakdown },
    ...(completedConversationRevision === undefined
      ? {}
      : { completedConversationRevision }),
    messages: orderedTurns.map((turn) => {
      const attachment = turn.contextAttachment;
      return {
        role: turn.role,
        createdAt: turn.createdAt,
        text: turn.text,
        ...(turn.conversationRevision === undefined
          ? {}
          : { conversationRevision: turn.conversationRevision }),
        ...(attachment === undefined
          ? {}
          : {
              contextAttachment: {
                capturedAt: attachment.capturedAt,
                captureRange: attachment.captureRange,
                ...(attachment.eventRange === undefined
                  ? {}
                  : { eventRange: attachment.eventRange }),
                counts: {
                  included: attachment.counts.included,
                  excluded: attachment.counts.excluded,
                  completedTranscriptions: attachment.counts.completedTranscriptions,
                  edited: attachment.counts.edited,
                  redacted: normalizedRedactionCount(attachment.counts),
                  deleted: 0,
                  reactionsChanged: attachment.counts.reactionsChanged,
                  lateIngested: attachment.counts.lateIngested,
                },
              },
            }),
        ...(turn.acknowledgment === undefined
          ? {}
          : { acknowledgment: turn.acknowledgment }),
      };
    }),
  });

  if (!exportResult.ok) {
    return err({ code: 'INTERNAL_ERROR', message: exportResult.error.message });
  }

  return ok({
    ...exportResult.value,
    fileName: appendSessionIdToPdfFileName(exportResult.value.fileName, session.id),
  });
}

function normalizedRedactionCount(counts: { redacted: number; deleted: number }): number {
  return counts.redacted + counts.deleted;
}

function pdfRevisionTelemetryInput(
  result: ConversationAssistantResult<ExportConversationAssistantPdfResult>,
  state: { completedConversationRevision?: number },
  durationMs: number
): ConversationAssistantTelemetryInput {
  return {
    operation: 'pdf_revision',
    outcome: result.ok
      ? 'completed'
      : result.error.code === 'INTERNAL_ERROR'
        ? 'failed'
        : 'rejected',
    durationMs,
    ...(state.completedConversationRevision === undefined
      ? {}
      : { count: state.completedConversationRevision }),
  };
}

async function appendQuestionAndAssistantTurn(
  input: { session: ConversationAssistantSession; question: string },
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<{ turns: ConversationAssistantTurn[] }>> {
  const userTurn = createTurn(input.session, 'user', input.question, deps);
  if (!(await deps.repository.saveTurnIfSessionExists(userTurn, input.session.generationId))) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }

  const promptInput = await buildPromptInputAfterUserTurn(input, deps);
  const llmResult = await callConversationAssistantModel(input.session, promptInput, deps);
  const assistantTurn = createAssistantTurnFromModelResult(input.session, llmResult, deps);

  if (!(await persistAssistantTurnAndTouchSession(input.session, assistantTurn, deps))) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }

  return ok({ turns: [userTurn, assistantTurn] });
}

async function reuseOrRequeueConversationAssistantSession(
  session: ConversationAssistantSession,
  userId: string,
  creationRequestId: string,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<CreateConversationAssistantSessionResult>> {
  if (session.deletionStartedAt !== undefined) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  if (!isOwnedSession(session, userId) || session.creationRequestId !== creationRequestId) {
    return err({ code: 'INTERNAL_ERROR', message: 'Conversation Assistant request collision' });
  }
  if (isSessionReady(session) || session.status === 'preparing') {
    return ok({ session });
  }
  const requeued = await requeueConversationAssistantPreparation(session, deps);
  if (requeued === null) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  return ok({ session: requeued });
}

async function requeueConversationAssistantPreparation(
  session: ConversationAssistantSession,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantSession | null> {
  const result = await deps.repository.requeueFailedPreparation({
    sessionId: session.id,
    userId: session.userId,
    expectedAttempt: session.preparationAttempt ?? 0,
    updatedAt: deps.clock.now(),
    ...(session.generationId !== undefined
      ? { expectedGenerationId: session.generationId }
      : {}),
  });
  if (result.status === 'not_found') {
    return null;
  }
  if (result.status === 'stale') {
    return result.session;
  }
  return await publishQueuedConversationAssistantPreparation(result.session, deps);
}

async function publishQueuedConversationAssistantPreparation(
  session: ConversationAssistantSession,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantSession> {
  const publishResult = await deps.preparationPublisher.publish({
    type: 'whatsapp.conversation-assistant.prepare',
    sessionId: session.id,
    userId: session.userId,
    attempt: session.preparationAttempt ?? 1,
    ...(session.generationId !== undefined ? { generationId: session.generationId } : {}),
  });
  if (publishResult.ok) {
    return session;
  }
  const failure = await deps.repository.failQueuedPreparation({
    sessionId: session.id,
    userId: session.userId,
    attempt: session.preparationAttempt ?? 1,
    error: publishResult.error,
    updatedAt: deps.clock.now(),
    ...(session.generationId !== undefined
      ? { expectedGenerationId: session.generationId }
      : {}),
  });
  return failure.status === 'not_found' ? session : failure.session;
}

async function loadConversationAssistantMessages(
  session: ConversationAssistantSession,
  sourceAccountId: string,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<PrivateWhatsAppMessage[]>> {
  const messages: PrivateWhatsAppMessage[] = [];
  let cursor: string | undefined;
  do {
    const messagesResult = await deps.privateWhatsAppRepository.findConversationContextMessages({
      sourceAccountId,
      chatId: session.chatId,
      from: session.range.from,
      to: session.range.to,
      limit: CONVERSATION_CONTEXT_RAW_SCAN_LIMIT,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    if (!messagesResult.ok) {
      return err(toPersistenceError(messagesResult.error.message));
    }
    messages.push(...messagesResult.value.messages);
    cursor = messagesResult.value.nextCursor;
  } while (cursor !== undefined);

  return ok(messages);
}

async function loadReconciledConversationAssistantMessages(
  session: ConversationAssistantSession,
  sourceAccountId: string,
  deps: ConversationAssistantDeps
): Promise<
  ConversationAssistantResult<{ messages: PrivateWhatsAppMessage[]; cutoffSequence: number }>
> {
  const ownedChat = {
    userId: session.userId,
    sourceAccountId,
    chatId: session.chatId,
  };
  const startHead = await deps.privateWhatsAppRepository.getConversationContextJournalHead(
    ownedChat
  );
  if (!startHead.ok) {
    return err(toPersistenceError(startHead.error.message));
  }
  const scanned = await loadConversationAssistantMessages(session, sourceAccountId, deps);
  if (!scanned.ok) return scanned;
  const cutoffHead = await deps.privateWhatsAppRepository.getConversationContextJournalHead(
    ownedChat
  );
  if (!cutoffHead.ok) {
    return err(toPersistenceError(cutoffHead.error.message));
  }
  const changesResult = await loadConversationContextJournalRange(
    {
      ...ownedChat,
      afterSequence: startHead.value,
      throughSequence: cutoffHead.value,
    },
    deps
  );
  if (!changesResult.ok) return changesResult;
  const reconciled = reconcileConversationContextAtCutoff({
    ...ownedChat,
    range: session.range,
    startSequence: startHead.value,
    cutoffSequence: cutoffHead.value,
    scannedMessages: scanned.value,
    changes: changesResult.value,
  });
  if (!reconciled.ok) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Private WhatsApp context journal is incomplete at sequence ${String(reconciled.expectedSequence)}`,
    });
  }
  return ok({ messages: reconciled.messages, cutoffSequence: cutoffHead.value });
}

async function loadConversationContextJournalRange(
  input: {
    userId: string;
    sourceAccountId: string;
    chatId: string;
    afterSequence: number;
    throughSequence: number;
  },
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<PrivateWhatsAppContextChange[]>> {
  const changes: PrivateWhatsAppContextChange[] = [];
  let afterSequence = input.afterSequence;
  while (afterSequence < input.throughSequence) {
    const page = await deps.privateWhatsAppRepository.findConversationContextJournalEntries({
      userId: input.userId,
      sourceAccountId: input.sourceAccountId,
      chatId: input.chatId,
      afterSequence,
      throughSequence: input.throughSequence,
      limit: 400,
    });
    if (!page.ok) {
      return err(toPersistenceError(page.error.message));
    }
    changes.push(...page.value.entries);
    const next = page.value.nextAfterSequence;
    if (next === undefined) break;
    if (next <= afterSequence) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: 'Private WhatsApp context journal cursor did not advance',
      });
    }
    afterSequence = next;
  }
  return ok(changes);
}

function createInitialContextChainSha256(transcriptSha256: string): string {
  return createHash('sha256')
    .update(`conversation-assistant-context-chain:v1\0initial\0${transcriptSha256}`)
    .digest('hex');
}

async function markClaimedConversationAssistantPreparationFailed(
  session: ConversationAssistantSession,
  error: ConversationAssistantError,
  attempt: number,
  claimId: string,
  deps: ConversationAssistantDeps
): Promise<boolean> {
  const failedSession: ConversationAssistantSession = {
    ...session,
    status: 'failed',
    preparationStage: 'failed',
    preparationError: { code: error.code, message: error.message },
    updatedAt: deps.clock.now(),
  };
  delete failedSession.preparationClaimId;
  delete failedSession.preparationLeaseExpiresAt;
  return await deps.repository.saveClaimedPreparationSession({
    session: failedSession,
    attempt,
    claimId,
    now: deps.clock.now(),
  });
}

async function currentPreparationResult(
  sessionId: string,
  userId: string,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<PrepareConversationAssistantSessionResult>> {
  const current = await deps.repository.getSessionById(sessionId);
  if (!isOwnedSession(current, userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  return ok({ session: current });
}

function emptyOmittedCounts(): ConversationAssistantSession['omitted'] {
  return {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  };
}

function totalOmittedCount(omitted: ConversationAssistantSession['omitted']): number {
  return (
    omitted.mediaOnly +
    omitted.failedTranscriptions +
    omitted.pendingTranscriptions +
    omitted.nonText +
    omitted.overLimit
  );
}

function isValidContextCursor(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function createContextSnapshotId(sessionId: string, attempt: number, claimId: string): string {
  return createHash('sha256')
    .update(`${sessionId}:${String(attempt)}:${claimId}`)
    .digest('hex');
}

function isSessionReady(session: ConversationAssistantSession): boolean {
  return session.status === 'ready' || session.status === 'active';
}

async function loadOwnedDirectChat(
  input: { userId: string; chatId: string },
  deps: ConversationAssistantDeps
): Promise<
  ConversationAssistantResult<{
    sourceAccountId: string;
    accountGeneration: string;
    chat: PrivateWhatsAppChat;
  }>
> {
  const accountResult = await deps.privateWhatsAppRepository.getAccountByUserId(input.userId);
  if (!accountResult.ok) {
    return err(toPersistenceError(accountResult.error.message));
  }
  if (accountResult.value?.status !== 'active') {
    return err({ code: 'NOT_FOUND', message: 'Private WhatsApp mirror is not configured' });
  }

  const chatResult = await deps.privateWhatsAppRepository.getChatById({
    sourceAccountId: accountResult.value.sourceAccountId,
    chatId: input.chatId,
  });
  if (!chatResult.ok) {
    return err(toPersistenceError(chatResult.error.message));
  }
  if (chatResult.value === null) {
    return err({ code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' });
  }
  if (chatResult.value.chatType !== 'direct') {
    return err({
      code: 'INVALID_REQUEST',
      message: 'Conversation Assistant supports direct chats only',
    });
  }

  return ok({
    sourceAccountId: accountResult.value.sourceAccountId,
    accountGeneration:
      accountResult.value.generationId ?? accountResult.value.sourceAccountId,
    chat: chatResult.value,
  });
}

async function buildPromptInputAfterUserTurn(
  input: { session: ConversationAssistantSession; question: string },
  deps: ConversationAssistantDeps
): Promise<Parameters<typeof buildWhatsAppConversationAssistantMessages>[0]> {
  const priorTurns = (await deps.repository.listTurnsBySessionId(input.session.id)).map((turn) => ({
    role: turn.role,
    text: turn.text,
  }));
  const promptInput: Parameters<typeof buildWhatsAppConversationAssistantMessages>[0] = {
    transcriptText: input.session.transcriptText,
    range: input.session.range,
    effectiveRange: input.session.effectiveRange,
    priorTurns: priorTurns.slice(0, -1),
    question: input.question,
  };
  if (input.session.chatDisplayName !== undefined) {
    promptInput.chatDisplayName = input.session.chatDisplayName;
  }
  return promptInput;
}

function createAssistantTurnFromModelResult(
  session: ConversationAssistantSession,
  llmResult: Result<GenerateChatResult, LLMError> | undefined,
  deps: ConversationAssistantDeps
): ConversationAssistantTurn {
  const now = deps.clock.now();
  if (llmResult?.ok === true) {
    return {
      id: deps.ids.turnId(),
      sessionId: session.id,
      userId: session.userId,
      role: 'assistant',
      text: llmResult.value.content,
      createdAt: now,
      usage: llmResult.value.usage,
    };
  }

  return {
    id: deps.ids.turnId(),
    sessionId: session.id,
    userId: session.userId,
    role: 'assistant',
    text: 'The assistant could not answer because the model call failed.',
    createdAt: now,
    error: {
      code: 'LLM_ERROR',
      message: CONVERSATION_ASSISTANT_PUBLIC_LLM_ERROR_MESSAGE,
    },
  };
}

async function persistAssistantTurnAndTouchSession(
  session: ConversationAssistantSession,
  assistantTurn: ConversationAssistantTurn,
  deps: ConversationAssistantDeps
): Promise<boolean> {
  return await deps.repository.saveAssistantTurnAndTouchSession({
    session,
    turn: assistantTurn,
  });
}

function createTurn(
  session: ConversationAssistantSession,
  role: 'user' | 'assistant',
  text: string,
  deps: ConversationAssistantDeps
): ConversationAssistantTurn {
  return {
    id: deps.ids.turnId(),
    sessionId: session.id,
    userId: session.userId,
    role,
    text,
    createdAt: deps.clock.now(),
  };
}

function validateCreateInput(
  input: CreateConversationAssistantSessionInput
): { code: 'INVALID_REQUEST'; message: string } | null {
  const fromTime = parseIsoUtcTimestamp(input.from);
  const toTime = parseIsoUtcTimestamp(input.to);
  if (fromTime === null || toTime === null) {
    return { code: 'INVALID_REQUEST', message: 'from and to must be ISO timestamps' };
  }
  if (fromTime >= toTime) {
    return { code: 'INVALID_REQUEST', message: 'from must be before to' };
  }
  if (input.displayTimeZone !== undefined && !isValidIanaTimeZone(input.displayTimeZone)) {
    return { code: 'INVALID_REQUEST', message: 'displayTimeZone must be a valid IANA time zone' };
  }
  return null;
}

function isValidIanaTimeZone(value: string): boolean {
  if (value.trim() === '' || value !== value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

async function callConversationAssistantModel(
  session: ConversationAssistantSession,
  promptInput: Parameters<typeof buildWhatsAppConversationAssistantMessages>[0],
  deps: ConversationAssistantDeps
): Promise<Result<GenerateChatResult, LLMError> | undefined> {
  try {
    const llmClientResult = await deps.llmClientFactory.createLlmClientForUser(
      session.userId,
      session.model
    );
    if (!llmClientResult.ok) {
      return err({ code: 'API_ERROR', message: llmClientResult.error.message });
    }
    const llmClient = llmClientResult.value;
    return await llmClient.generateChat?.(
      buildWhatsAppConversationAssistantMessages(promptInput),
      {
        promptType: WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.promptType,
        temperature: 0.2,
        reasoning: { enabled: true },
      }
    );
  } catch (error) {
    return err({ code: 'API_ERROR', message: getErrorMessage(error) });
  }
}

async function callConversationAssistantModelStream(
  session: ConversationAssistantSession,
  promptInput: Parameters<typeof buildWhatsAppConversationAssistantMessages>[0],
  deps: ConversationAssistantDeps,
  onEvent: (event: ConversationAssistantStreamEvent) => void
): Promise<Result<GenerateChatResult, LLMError> | undefined> {
  try {
    const llmClientResult = await deps.llmClientFactory.createLlmClientForUser(
      session.userId,
      session.model
    );
    if (!llmClientResult.ok) {
      return err({ code: 'API_ERROR', message: llmClientResult.error.message });
    }
    const llmClient = llmClientResult.value;
    return await llmClient.generateChatStream?.(
      buildWhatsAppConversationAssistantMessages(promptInput),
      {
        promptType: WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.promptType,
        temperature: 0.2,
        reasoning: { enabled: true },
      },
      (event) => {
        if (event.type === 'delta') {
          onEvent({ type: 'assistant_delta', text: event.text });
          return;
        }
        onEvent({ type: 'usage', usage: event.usage });
      }
    );
  } catch (error) {
    return err({ code: 'API_ERROR', message: getErrorMessage(error) });
  }
}

function parseIsoUtcTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const canonical = new Date(parsed).toISOString();
  return canonical === value || canonical.replace('.000Z', 'Z') === value ? parsed : null;
}

function deriveTitle(
  chatDisplayName: string | undefined,
  from: string,
  to: string
): string {
  return `${chatDisplayName ?? 'WhatsApp chat'} (${from.slice(0, 10)} to ${to.slice(0, 10)})`;
}

function toPersistenceError(message: string): { code: 'PERSISTENCE_ERROR'; message: string } {
  return { code: 'PERSISTENCE_ERROR', message };
}

function isOwnedSession(
  session: ConversationAssistantSession | null,
  userId: string
): session is ConversationAssistantSession {
  return session !== null && session.userId === userId;
}

function appendSessionIdToPdfFileName(fileName: string, sessionId: string): string {
  const baseName = fileName.endsWith('.pdf') ? fileName.slice(0, -4) : fileName;
  const normalizedBaseName = baseName.trim().length > 0 ? baseName.trim() : 'conversation-assistant-export';
  return `${normalizedBaseName}-${sessionId}.pdf`;
}

function turnRoleSortValue(role: ConversationAssistantTurn['role']): number {
  return role === 'user' ? 0 : 1;
}
