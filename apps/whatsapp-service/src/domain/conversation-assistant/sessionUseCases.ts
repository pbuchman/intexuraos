import { randomUUID } from 'node:crypto';
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
import {
  buildPrivateConversationTranscriptText,
  projectPrivateConversationContext,
} from './transcriptFormatting.js';
import type { ConversationAssistantDeps } from './ports.js';
import type {
  CheckConversationAssistantContextInput,
  CheckConversationAssistantContextResult,
  ConversationAssistantResult,
  ConversationAssistantSession,
  ConversationAssistantStreamEvent,
  ConversationAssistantTurn,
  CreateConversationAssistantSessionInput,
  CreateConversationAssistantSessionResult,
  ExportConversationAssistantPdfInput,
  ExportConversationAssistantPdfResult,
  SendConversationAssistantTurnInput,
} from './types.js';
import {
  CONVERSATION_ASSISTANT_LARGE_CONTEXT_WARNING_THRESHOLD,
} from './types.js';
import type { PrivateWhatsAppChat, PrivateWhatsAppMessage } from '../whatsapp/index.js';

export const conversationAssistantSystemClock = {
  now: (): string => new Date().toISOString(),
};

export const conversationAssistantRandomIds = {
  sessionId: (): string => `whatsapp_conv_session_${randomUUID()}`,
  turnId: (): string => `whatsapp_conv_turn_${randomUUID()}`,
};

const CONVERSATION_CONTEXT_RAW_SCAN_LIMIT = 5000;

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

  const chatLoadResult = await loadOwnedDirectChat(input, deps);
  if (!chatLoadResult.ok) {
    return chatLoadResult;
  }

  const messages: PrivateWhatsAppMessage[] = [];
  let cursor: string | undefined;
  do {
    const messagesResult = await deps.privateWhatsAppRepository.findConversationContextMessages({
      sourceAccountId: chatLoadResult.value.sourceAccountId,
      chatId: input.chatId,
      from: input.from,
      to: input.to,
      limit: CONVERSATION_CONTEXT_RAW_SCAN_LIMIT,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    if (!messagesResult.ok) {
      return err(toPersistenceError(messagesResult.error.message));
    }
    messages.push(...messagesResult.value.messages);
    cursor = messagesResult.value.nextCursor;
  } while (cursor !== undefined);

  if (messages.length === 0) {
    return err({ code: 'EMPTY_TRANSCRIPT', message: 'Selected range contains no textual messages' });
  }

  const context = projectPrivateConversationContext({
    chat: chatLoadResult.value.chat,
    range: { from: input.from, to: input.to },
    messages,
    ...(input.maxMessages !== undefined ? { maxMessages: input.maxMessages } : {}),
  });
  if (context.messages.length === 0) {
    return err({ code: 'EMPTY_TRANSCRIPT', message: 'Selected range contains no textual messages' });
  }

  const now = deps.clock.now();
  const session: ConversationAssistantSession = {
    id: deps.ids.sessionId(),
    userId: input.userId,
    chatId: input.chatId,
    status: 'active',
    range: { from: input.from, to: input.to },
    effectiveRange: deriveEffectiveRange(context.messages, {
      from: input.from,
      to: input.to,
    }),
    model: selectedModel,
    transcriptSha256: context.transcriptSha256,
    transcriptMessageCount: context.messageCount,
    transcriptText: buildPrivateConversationTranscriptText(context.messages),
    omitted: context.omitted,
    title: deriveTitle(chatLoadResult.value.chat.displayName, input.from, input.to, input.question),
    createdAt: now,
    updatedAt: now,
  };
  if (chatLoadResult.value.chat.displayName !== undefined) {
    session.chatDisplayName = chatLoadResult.value.chat.displayName;
  }

  await deps.repository.saveSession(session);

  const turns: ConversationAssistantTurn[] = [];
  const question = input.question?.trim();
  if (question !== undefined && question.length > 0) {
    const turnResult = await appendQuestionAndAssistantTurn({ session, question }, deps);
    turns.push(...turnResult.turns);
  }

  return ok({ session, turns, context });
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

  const result = await appendQuestionAndAssistantTurn({ session, question }, deps);
  return ok(result.turns);
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

  const userTurn = createTurn(session, 'user', question, deps);
  await deps.repository.saveTurn(userTurn);
  onEvent({ type: 'user_turn', turn: userTurn });

  const promptInput = await buildPromptInputAfterUserTurn({ session, question }, deps);
  const llmResult = await callConversationAssistantModelStream(
    session,
    promptInput,
    deps,
    onEvent
  );
  const assistantTurn = createAssistantTurnFromModelResult(
    session,
    llmResult,
    deps,
    'Chat message streaming is unavailable'
  );

  if (assistantTurn.error !== undefined) {
    onEvent({
      type: 'error',
      error: { code: 'LLM_ERROR', message: assistantTurn.error.message },
    });
  }

  await persistAssistantTurnAndTouchSession(session, assistantTurn, deps);
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

export async function listConversationAssistantTurns(
  input: { userId: string; sessionId: string },
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<ConversationAssistantTurn[]>> {
  const session = await deps.repository.getSessionById(input.sessionId);
  if (!isOwnedSession(session, input.userId)) {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant session not found' });
  }
  return ok(await deps.repository.listTurnsBySessionId(input.sessionId));
}

export async function exportConversationAssistantSessionPdf(
  input: ExportConversationAssistantPdfInput,
  deps: ConversationAssistantDeps
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

  const turns = snapshot.turns;
  const orderedTurns = [...turns].sort((a, b) => {
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

  const exportResult = await deps.pdfExporter.exportConversation({
    title: session.title,
    modelName: getConversationAssistantModelDisplayName(session.model),
    initialPrompt,
    generatedAt: deps.clock.now(),
    sourceRange: session.range,
    messageCounts: {
      included: session.transcriptMessageCount,
      excluded,
    },
    omittedBreakdown: { ...omittedBreakdown },
    messages: orderedTurns.map((turn) => ({
      role: turn.role,
      createdAt: turn.createdAt,
      text: turn.text,
    })),
  });

  if (!exportResult.ok) {
    return err({ code: 'INTERNAL_ERROR', message: exportResult.error.message });
  }

  return ok({
    ...exportResult.value,
    fileName: appendSessionIdToPdfFileName(exportResult.value.fileName, session.id),
  });
}

async function appendQuestionAndAssistantTurn(
  input: { session: ConversationAssistantSession; question: string },
  deps: ConversationAssistantDeps
): Promise<{ turns: ConversationAssistantTurn[] }> {
  const userTurn = createTurn(input.session, 'user', input.question, deps);
  await deps.repository.saveTurn(userTurn);

  const promptInput = await buildPromptInputAfterUserTurn(input, deps);
  const llmResult = await callConversationAssistantModel(input.session, promptInput, deps);
  const assistantTurn = createAssistantTurnFromModelResult(
    input.session,
    llmResult,
    deps,
    'Chat message generation is unavailable'
  );

  await persistAssistantTurnAndTouchSession(input.session, assistantTurn, deps);

  return { turns: [userTurn, assistantTurn] };
}

async function loadOwnedDirectChat(
  input: { userId: string; chatId: string },
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<{ sourceAccountId: string; chat: PrivateWhatsAppChat }>> {
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

  return ok({ sourceAccountId: accountResult.value.sourceAccountId, chat: chatResult.value });
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
  deps: ConversationAssistantDeps,
  fallbackMessage: string
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
      message: llmResult?.error.message ?? fallbackMessage,
    },
  };
}

async function persistAssistantTurnAndTouchSession(
  session: ConversationAssistantSession,
  assistantTurn: ConversationAssistantTurn,
  deps: ConversationAssistantDeps
): Promise<void> {
  await deps.repository.saveTurn(assistantTurn);
  await deps.repository.saveSession({
    ...session,
    updatedAt: assistantTurn.createdAt,
    lastTurnAt: assistantTurn.createdAt,
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
  return null;
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
        sessionId: session.id,
        temperature: 0.2,
        reasoning: { enabled: true },
        correlation: { sessionId: session.id },
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
        sessionId: session.id,
        temperature: 0.2,
        reasoning: { enabled: true },
        correlation: { sessionId: session.id },
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
  to: string,
  question: string | undefined
): string {
  const firstQuestion = question?.trim();
  if (firstQuestion !== undefined && firstQuestion.length > 0) {
    return firstQuestion.length > 80 ? `${firstQuestion.slice(0, 77)}...` : firstQuestion;
  }
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
