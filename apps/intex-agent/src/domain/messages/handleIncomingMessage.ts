import { getErrorMessage } from '@intexuraos/common-core';
import type { WhatsAppInteractiveButton } from '@intexuraos/whatsapp-pubsub-client';
import type { IntexIncomingMessage, IncomingMessageHandlerResult } from '../ports/incomingMessageHandler.js';
import type { SessionRepository } from '../ports/sessionRepository.js';
import {
  decideSessionTransition,
  type SessionTransitionDecision,
} from '../sessions/sessionController.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
  IntexAgentSessionEventType,
  IntexAgentToolName,
} from '../sessions/types.js';
import { normalizeSessionTimestamp } from '../sessions/sessionTimestamps.js';
import {
  buildNewSessionReadyText,
  buildUnsupportedCapabilitiesReply,
  detectIntexAgentReplyLanguage,
} from '../agent/capabilities.js';

export type IntexAgentRunnerResult =
  | {
      outcome: 'completed';
      reply: string;
      summary?: string;
      toolName?: IntexAgentToolName;
      toolResult?: Record<string, unknown>;
      ctaUrl?: {
        displayText: string;
        url: string;
      };
    }
  | {
      outcome: 'needs_confirmation';
      reply: string;
      toolName: IntexAgentToolName;
      toolArgs: Record<string, unknown>;
      summary?: string;
    }
  | {
      outcome: 'tool_failed';
      reply: string;
      toolName: IntexAgentToolName;
      error: string;
    }
  | {
      outcome: 'needs_clarification';
      reply: string;
    }
  | {
      outcome: 'no_action';
      reply: string;
    }
  | {
      outcome: 'unsupported';
      reply: string;
    };

export interface IntexAgentRunner {
  executeConfirmed(input: {
    session: IntexAgentSession;
    toolName: IntexAgentToolName;
    toolArgs: Record<string, unknown>;
    currentDateTime: string;
    messageId?: string;
  }): Promise<IntexAgentRunnerResult>;
  run(input: {
    session: IntexAgentSession;
    events: IntexAgentSessionEvent[];
    message: string;
    replyContext?: IntexIncomingMessage['replyContext'];
    sourceType?: string;
    sourceUrl?: string;
    currentDateTime: string;
    messageId?: string;
  }): Promise<IntexAgentRunnerResult>;
}

export interface WhatsAppReplyPublisher {
  publishReply(input: {
    userId: string;
    message: string;
    replyToMessageId: string;
    correlationId: string;
    ctaUrl?: {
      displayText: string;
      url: string;
    };
    buttons?: WhatsAppInteractiveButton[];
  }): Promise<void>;
}

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  sessionId(): string;
  eventId(): string;
  confirmationId(): string;
}

export interface HandleIncomingMessageDeps {
  sessionRepository: SessionRepository;
  runner: IntexAgentRunner;
  replyPublisher: WhatsAppReplyPublisher;
  clock: Clock;
  ids: IdGenerator;
  sessionTimeoutMs: number;
}

const CONFIRMABLE_TOOL_NAMES = new Set<IntexAgentToolName>([
  'create_note',
  'create_calendar_event',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);

export async function handleIncomingMessage(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps
): Promise<IncomingMessageHandlerResult> {
  const now = deps.clock.now();
  const normalizedUserTimestamp = normalizeSessionTimestamp(input.timestamp);
  const currentSession = await deps.sessionRepository.findContinuableSession(input.userId);

  if (input.sourceType === 'whatsapp_button') {
    return await handleConfirmationButton(input, deps, currentSession, now, normalizedUserTimestamp);
  }

  const decision = decideSessionTransition({
    currentSession,
    now,
    userMessageText: input.text,
    sessionTimeoutMs: deps.sessionTimeoutMs,
  });

  await closePreviousSessionIfNeeded(decision, deps);

  const session = await resolveSession(decision, input, deps, normalizedUserTimestamp);
  const effectiveMessage = decision.effectiveUserMessageText;

  if (effectiveMessage === null) {
    const reply = newSessionReadyText();
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, session.id, reply);
    return { sessionId: session.id };
  }

  await appendEvent(deps, session, 'user_message', {
    messageId: input.messageId,
    text: effectiveMessage,
    sourceType: input.sourceType,
    ...(input.sourceUrl !== undefined ? { hasSourceUrl: true } : {}),
    ...(input.replyContext !== undefined ? { replyContext: input.replyContext } : {}),
    ...(input.buttonResponse !== undefined ? { buttonResponse: input.buttonResponse } : {}),
  });
  await deps.sessionRepository.updateSession(session.id, {
    status: 'active',
    lastUserMessageAt: normalizedUserTimestamp,
  });

  const events = await deps.sessionRepository.listEvents(session.id, input.userId);
  await supersedePendingConfirmationIfNeeded(session, deps, events);
  const missingLinkReply = buildMissingLinkReply(effectiveMessage, events);
  if (missingLinkReply !== null) {
    const assistantAt = await appendAssistantMessage(session, deps, missingLinkReply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, session.id, missingLinkReply);
    return { sessionId: session.id };
  }

  const runnerResult = await deps.runner.run({
    session,
    events: excludeCurrentUserMessage(events, input.messageId),
    message: effectiveMessage,
    ...(input.replyContext !== undefined ? { replyContext: input.replyContext } : {}),
    sourceType: input.sourceType,
    ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
    currentDateTime: now,
    messageId: input.messageId,
  });
  await applyRunnerResult(input, deps, session, runnerResult);

  return { sessionId: session.id };
}

async function handleConfirmationButton(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  currentSession: IntexAgentSession | null,
  now: string,
  normalizedUserTimestamp: string
): Promise<IncomingMessageHandlerResult> {
  if (currentSession === null) {
    await deps.replyPublisher.publishReply({
      userId: input.userId,
      message: staleConfirmationReply(),
      replyToMessageId: input.messageId,
      correlationId: input.messageId,
    });
    return { sessionId: input.messageId };
  }

  const buttonResponse = input.buttonResponse;
  const parsedButton =
    buttonResponse === undefined ? null : parseConfirmationButtonId(buttonResponse.buttonId);
  const events = await deps.sessionRepository.listEvents(currentSession.id, input.userId);

  await appendEvent(deps, currentSession, 'user_message', {
    messageId: input.messageId,
    text: input.text,
    sourceType: input.sourceType,
    ...(buttonResponse !== undefined ? { buttonResponse } : {}),
  });
  await deps.sessionRepository.updateSession(currentSession.id, {
    status: 'active',
    lastUserMessageAt: normalizedUserTimestamp,
  });

  const pendingConfirmation = findLatestPendingConfirmation(events);
  if (
    buttonResponse === undefined ||
    parsedButton === null ||
    parsedButton.confirmationId !== pendingConfirmation?.confirmationId
  ) {
    const reply = staleConfirmationReply();
    const assistantAt = await appendAssistantMessage(currentSession, deps, reply);
    await deps.sessionRepository.updateSession(currentSession.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, currentSession.id, reply);
    return { sessionId: currentSession.id };
  }

  await appendEvent(deps, currentSession, 'confirmation_resolved', {
    confirmationId: pendingConfirmation.confirmationId,
    resolution: parsedButton.decision === 'yes' ? 'accepted' : 'rejected',
    buttonId: buttonResponse.buttonId,
    buttonTitle: buttonResponse.buttonTitle,
    replyToWamid: buttonResponse.replyToWamid,
  });

  if (parsedButton.decision === 'no') {
    const reply = 'Okej, nie wykonuję tej akcji.';
    const assistantAt = await appendAssistantMessage(currentSession, deps, reply);
    await deps.sessionRepository.updateSession(currentSession.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, currentSession.id, reply);
    return { sessionId: currentSession.id };
  }

  let executionResult: IntexAgentRunnerResult;
  try {
    executionResult = await deps.runner.executeConfirmed({
      session: currentSession,
      toolName: pendingConfirmation.toolName,
      toolArgs: pendingConfirmation.toolArgs,
      currentDateTime: now,
      messageId: input.messageId,
    });
  } catch (error) {
    executionResult = {
      outcome: 'tool_failed',
      reply: `Nie udało się wykonać tej akcji: ${getErrorMessage(
        error,
        'Unknown tool execution error'
      )}. Spróbuj ponownie później.`,
      toolName: pendingConfirmation.toolName,
      error: getErrorMessage(error, 'Unknown tool execution error'),
    };
  }

  await applyRunnerResult(input, deps, currentSession, executionResult);
  return { sessionId: currentSession.id };
}

async function closePreviousSessionIfNeeded(
  decision: SessionTransitionDecision,
  deps: HandleIncomingMessageDeps
): Promise<void> {
  if (decision.action !== 'start_new' || decision.closeCurrentSession === undefined) {
    return;
  }

  const close = decision.closeCurrentSession;
  const session = await deps.sessionRepository.updateSession(close.id, {
    status: close.status,
    endedAt: close.endedAt,
    endReason: close.endReason,
  });
  await appendEvent(deps, session, 'session_closed', {
    status: close.status,
    reason: close.endReason,
  }, close.endedAt);
}

async function resolveSession(
  decision: SessionTransitionDecision,
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  normalizedUserTimestamp: string
): Promise<IntexAgentSession> {
  if (decision.action === 'continue') {
    return decision.session;
  }

  const startedAt = deps.clock.now();
  const session: IntexAgentSession = await deps.sessionRepository.createSession({
    id: deps.ids.sessionId(),
    userId: input.userId,
    channel: 'whatsapp',
    status: 'active',
    startedAt,
    lastUserMessageAt: normalizedUserTimestamp,
    startReason: decision.startReason,
  });
  await appendEvent(deps, session, 'session_started', {
    reason: decision.startReason,
    explicit: decision.isExplicitNewSession,
  }, startedAt);
  return session;
}

async function applyRunnerResult(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  session: IntexAgentSession,
  runnerResult: IntexAgentRunnerResult
): Promise<void> {
  if (runnerResult.outcome === 'no_action') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.outcome === 'needs_clarification') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    await appendEvent(deps, session, 'clarification_requested', { message: reply });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.outcome === 'needs_confirmation') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    const confirmationId = deps.ids.confirmationId();
    await appendEvent(deps, session, 'confirmation_requested', {
      confirmationId,
      toolName: runnerResult.toolName,
      toolArgs: runnerResult.toolArgs,
      message: reply,
      sourceMessageId: input.messageId,
      ...(runnerResult.summary !== undefined ? { summary: runnerResult.summary } : {}),
    });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
      activeTool: runnerResult.toolName,
      ...(runnerResult.summary !== undefined ? { summary: runnerResult.summary } : {}),
    });
    await publishReply(input, deps, session.id, reply, undefined, confirmationButtons(confirmationId));
    return;
  }

  if (runnerResult.outcome === 'tool_failed') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    await appendEvent(deps, session, 'tool_call_failed', {
      toolName: runnerResult.toolName,
      error: runnerResult.error,
    });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
      activeTool: runnerResult.toolName,
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.outcome === 'unsupported') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    await appendEvent(deps, session, 'unsupported_request', { message: runnerResult.reply });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
      summary: summarizeUserMessage(input.text),
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.toolName === undefined) {
    await applyUnsupportedRunnerResult(input, deps, session, malformedRunnerResult(input.text));
    return;
  }

  const reply = stripDuplicateSessionPrefix(runnerResult.reply);
  await appendEvent(deps, session, 'tool_call_completed', {
    toolName: runnerResult.toolName,
    ...(runnerResult.toolResult !== undefined ? { result: runnerResult.toolResult } : {}),
  });
  const assistantAt = await appendAssistantMessage(session, deps, reply);
  await deps.sessionRepository.updateSession(session.id, {
    status: 'waiting_for_user',
    lastAssistantMessageAt: assistantAt,
    activeTool: runnerResult.toolName,
    ...(runnerResult.summary !== undefined ? { summary: runnerResult.summary } : {}),
  });
  await publishReply(input, deps, session.id, reply, runnerResult.ctaUrl);
}

async function appendAssistantMessage(
  session: IntexAgentSession,
  deps: HandleIncomingMessageDeps,
  text: string
): Promise<string> {
  return await appendEvent(deps, session, 'assistant_message', { text });
}

async function appendEvent(
  deps: HandleIncomingMessageDeps,
  session: IntexAgentSession,
  type: IntexAgentSessionEventType,
  payload: Record<string, unknown>,
  createdAt = deps.clock.now()
): Promise<string> {
  await deps.sessionRepository.appendEvent({
    id: deps.ids.eventId(),
    sessionId: session.id,
    userId: session.userId,
    type,
    payload,
    createdAt,
  });
  return createdAt;
}

async function publishReply(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  sessionId: string,
  message: string,
  ctaUrl?: {
    displayText: string;
    url: string;
  },
  buttons?: WhatsAppInteractiveButton[]
): Promise<void> {
  await deps.replyPublisher.publishReply({
    userId: input.userId,
    message,
    replyToMessageId: input.messageId,
    correlationId: sessionId,
    ...(ctaUrl !== undefined ? { ctaUrl } : {}),
    ...(buttons !== undefined ? { buttons } : {}),
  });
}

function newSessionReadyText(): string {
  return buildNewSessionReadyText();
}

function stripDuplicateSessionPrefix(text: string): string {
  return text
    .replace(/^(Previous session (?:superseded|expired)\. )?New session started\.\s*/i, '')
    .trimStart();
}

async function applyUnsupportedRunnerResult(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  session: IntexAgentSession,
  runnerResult: Extract<IntexAgentRunnerResult, { outcome: 'unsupported' }>
): Promise<void> {
  const reply = stripDuplicateSessionPrefix(runnerResult.reply);
  await appendEvent(deps, session, 'unsupported_request', { message: runnerResult.reply });
  const assistantAt = await appendAssistantMessage(session, deps, reply);
  await deps.sessionRepository.updateSession(session.id, {
    status: 'waiting_for_user',
    lastAssistantMessageAt: assistantAt,
    summary: summarizeUserMessage(input.text),
  });
  await publishReply(input, deps, session.id, reply);
}

function summarizeUserMessage(message: string): string {
  const normalized = message.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

function malformedRunnerResult(
  message: string
): Extract<IntexAgentRunnerResult, { outcome: 'unsupported' }> {
  return {
    outcome: 'unsupported',
    reply: buildUnsupportedCapabilitiesReply(detectIntexAgentReplyLanguage(message)),
  };
}

interface ParsedConfirmationButton {
  confirmationId: string;
  decision: 'yes' | 'no';
}

interface PendingConfirmation {
  confirmationId: string;
  toolName: IntexAgentToolName;
  toolArgs: Record<string, unknown>;
}

function confirmationButtons(confirmationId: string): WhatsAppInteractiveButton[] {
  return [
    {
      type: 'reply',
      reply: {
        id: `intex_confirm:${confirmationId}:yes`,
        title: 'Tak',
      },
    },
    {
      type: 'reply',
      reply: {
        id: `intex_confirm:${confirmationId}:no`,
        title: 'Nie',
      },
    },
  ];
}

function parseConfirmationButtonId(buttonId: string): ParsedConfirmationButton | null {
  const match = /^intex_confirm:([^:]+):(yes|no)$/u.exec(buttonId);
  if (match === null) {
    return null;
  }
  const confirmationId = match[1];
  const decision = match[2];
  /* v8 ignore start -- schema: successful confirmation button regex cannot omit id or yes/no decision captures @preserve */
  if (confirmationId === undefined || (decision !== 'yes' && decision !== 'no')) {
    return null;
  }
  /* v8 ignore stop @preserve */
  return {
    confirmationId,
    decision,
  };
}

function findLatestPendingConfirmation(
  events: IntexAgentSessionEvent[]
): PendingConfirmation | null {
  const resolvedConfirmationIds = new Set<string>();
  for (const event of events) {
    if (event.type !== 'confirmation_resolved') {
      continue;
    }
    const confirmationId = event.payload['confirmationId'];
    if (typeof confirmationId === 'string') {
      resolvedConfirmationIds.add(confirmationId);
    }
  }

  for (const event of [...events].reverse()) {
    if (event.type !== 'confirmation_requested') {
      continue;
    }
    const confirmationId = event.payload['confirmationId'];
    const toolName = event.payload['toolName'];
    const toolArgs = event.payload['toolArgs'];
    if (
      typeof confirmationId !== 'string' ||
      resolvedConfirmationIds.has(confirmationId) ||
      !isConfirmableToolName(toolName) ||
      !isRecord(toolArgs)
    ) {
      continue;
    }
    return {
      confirmationId,
      toolName,
      toolArgs,
    };
  }

  return null;
}

async function supersedePendingConfirmationIfNeeded(
  session: IntexAgentSession,
  deps: HandleIncomingMessageDeps,
  events: IntexAgentSessionEvent[]
): Promise<void> {
  const pendingConfirmation = findLatestPendingConfirmation(events);
  if (pendingConfirmation === null) {
    return;
  }

  await appendEvent(deps, session, 'confirmation_resolved', {
    confirmationId: pendingConfirmation.confirmationId,
    resolution: 'superseded',
  });
}

function staleConfirmationReply(): string {
  return 'To potwierdzenie nie jest już aktualne. Wyślij prośbę jeszcze raz.';
}

function isConfirmableToolName(value: unknown): value is IntexAgentToolName {
  return typeof value === 'string' && CONFIRMABLE_TOOL_NAMES.has(value as IntexAgentToolName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildMissingLinkReply(message: string, events: IntexAgentSessionEvent[]): string | null {
  if (!isMissingLinkFollowUp(message)) {
    return null;
  }

  const resourceUrl = findLastToolResourceUrl(events);
  if (resourceUrl === null) {
    return 'Nie widzę zapisanego linku z poprzedniej akcji. Poproś mnie jeszcze raz wprost, a utworzę zasób od nowa.';
  }

  return `Link z poprzedniej akcji: ${resourceUrl}`;
}

function isMissingLinkFollowUp(message: string): boolean {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return (
    normalized.includes('link') &&
    (normalized.includes('nie dost') ||
      normalized.includes('brak') ||
      normalized.includes('no link') ||
      normalized.includes('did not get') ||
      normalized.includes("didn't get"))
  );
}

function findLastToolResourceUrl(events: IntexAgentSessionEvent[]): string | null {
  for (const event of [...events].reverse()) {
    if (event.type !== 'tool_call_completed') {
      continue;
    }

    const result = event.payload['result'];
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      continue;
    }

    const record = result as Record<string, unknown>;
    const resourceUrl = record['resourceUrl'] ?? record['htmlLink'] ?? record['url'];
    if (typeof resourceUrl === 'string' && resourceUrl.trim() !== '') {
      return resourceUrl;
    }
  }

  return null;
}

function excludeCurrentUserMessage(
  events: IntexAgentSessionEvent[],
  messageId: string
): IntexAgentSessionEvent[] {
  return events.filter(
    (event) => event.type !== 'user_message' || event.payload['messageId'] !== messageId
  );
}
