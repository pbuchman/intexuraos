import { randomUUID } from 'node:crypto';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
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
  ConversationAssistantResult,
  ConversationAssistantSession,
  ConversationAssistantTurn,
  CreateConversationAssistantSessionInput,
  CreateConversationAssistantSessionResult,
  SendConversationAssistantTurnInput,
} from './types.js';
import type { PrivateWhatsAppMessage } from '../whatsapp/index.js';
import {
  DEFAULT_CONVERSATION_ASSISTANT_MAX_MESSAGES,
  MAX_CONVERSATION_ASSISTANT_MAX_MESSAGES,
  MIN_CONVERSATION_ASSISTANT_MAX_MESSAGES,
} from './types.js';

export const conversationAssistantSystemClock = {
  now: (): string => new Date().toISOString(),
};

export const conversationAssistantRandomIds = {
  sessionId: (): string => `whatsapp_conv_session_${randomUUID()}`,
  turnId: (): string => `whatsapp_conv_turn_${randomUUID()}`,
};

const CONVERSATION_CONTEXT_RAW_SCAN_LIMIT = 5000;

export async function createConversationAssistantSession(
  input: CreateConversationAssistantSessionInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<CreateConversationAssistantSessionResult>> {
  const validation = validateCreateInput(input);
  if (validation !== null) {
    return err(validation);
  }

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
    return err({ code: 'INVALID_REQUEST', message: 'Conversation Assistant supports direct chats only' });
  }

  const maxMessages = input.maxMessages ?? DEFAULT_CONVERSATION_ASSISTANT_MAX_MESSAGES;
  const messages: PrivateWhatsAppMessage[] = [];
  let cursor: string | undefined;
  do {
    const messagesResult = await deps.privateWhatsAppRepository.findConversationContextMessages({
      sourceAccountId: accountResult.value.sourceAccountId,
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
    chat: chatResult.value,
    range: { from: input.from, to: input.to },
    messages,
    maxMessages,
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
    model: deps.model,
    transcriptSha256: context.transcriptSha256,
    transcriptMessageCount: context.messageCount,
    transcriptText: buildPrivateConversationTranscriptText(context.messages),
    omitted: context.omitted,
    title: deriveTitle(chatResult.value.displayName, input.from, input.to, input.question),
    createdAt: now,
    updatedAt: now,
  };
  if (chatResult.value.displayName !== undefined) {
    session.chatDisplayName = chatResult.value.displayName;
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

async function appendQuestionAndAssistantTurn(
  input: { session: ConversationAssistantSession; question: string },
  deps: ConversationAssistantDeps
): Promise<{ turns: ConversationAssistantTurn[] }> {
  const userTurn = createTurn(input.session, 'user', input.question, deps);
  await deps.repository.saveTurn(userTurn);

  const priorTurns = (await deps.repository.listTurnsBySessionId(input.session.id)).map((turn) => ({
    role: turn.role,
    text: turn.text,
  }));
  const promptInput: Parameters<typeof buildWhatsAppConversationAssistantMessages>[0] = {
    transcriptText: input.session.transcriptText,
    range: input.session.range,
    priorTurns: priorTurns.slice(0, -1),
    question: input.question,
  };
  if (input.session.chatDisplayName !== undefined) {
    promptInput.chatDisplayName = input.session.chatDisplayName;
  }

  const llmResult = await callConversationAssistantModel(input.session, promptInput, deps);

  const now = deps.clock.now();
  const assistantTurn: ConversationAssistantTurn =
    llmResult?.ok === true
      ? {
          id: deps.ids.turnId(),
          sessionId: input.session.id,
          userId: input.session.userId,
          role: 'assistant',
          text: llmResult.value.content,
          createdAt: now,
          usage: llmResult.value.usage,
        }
      : {
          id: deps.ids.turnId(),
          sessionId: input.session.id,
          userId: input.session.userId,
          role: 'assistant',
          text: 'The assistant could not answer because the model call failed.',
          createdAt: now,
          error: {
            code: 'LLM_ERROR',
            message: llmResult?.error.message ?? 'Chat message generation is unavailable',
          },
        };

  await deps.repository.saveTurn(assistantTurn);
  await deps.repository.saveSession({
    ...input.session,
    updatedAt: now,
    lastTurnAt: now,
  });

  return { turns: [userTurn, assistantTurn] };
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
  const maxMessages = input.maxMessages ?? DEFAULT_CONVERSATION_ASSISTANT_MAX_MESSAGES;
  if (
    !Number.isInteger(maxMessages) ||
    maxMessages < MIN_CONVERSATION_ASSISTANT_MAX_MESSAGES ||
    maxMessages > MAX_CONVERSATION_ASSISTANT_MAX_MESSAGES
  ) {
    return { code: 'INVALID_REQUEST', message: 'maxMessages must be between 1 and 5000' };
  }
  return null;
}

async function callConversationAssistantModel(
  session: ConversationAssistantSession,
  promptInput: Parameters<typeof buildWhatsAppConversationAssistantMessages>[0],
  deps: ConversationAssistantDeps
): Promise<
  | Awaited<
      ReturnType<
        NonNullable<
          ReturnType<ConversationAssistantDeps['llmClientFactory']['createLlmClientForUser']>['generateChat']
        >
      >
    >
  | undefined
> {
  try {
    const llmClient = deps.llmClientFactory.createLlmClientForUser(session.userId);
    return await llmClient.generateChat?.(
      buildWhatsAppConversationAssistantMessages(promptInput),
      {
        promptType: WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.promptType,
        sessionId: session.id,
        temperature: 0.2,
        correlation: { sessionId: session.id },
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
