import type { IntexIncomingMessage, IncomingMessageHandlerResult } from '../ports/incomingMessageHandler.js';
import type { SessionRepository } from '../ports/sessionRepository.js';
import {
  decideSessionTransition,
  type SessionTransitionDecision,
} from '../sessions/sessionController.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEndReason,
  IntexAgentSessionEvent,
  IntexAgentSessionEventType,
  IntexAgentSessionStatus,
  IntexAgentToolName,
} from '../sessions/types.js';
import { normalizeSessionTimestamp } from '../sessions/sessionTimestamps.js';

export type IntexAgentRunnerResult =
  | {
      outcome: 'completed';
      reply: string;
      summary?: string;
      toolName?: IntexAgentToolName;
    }
  | {
      outcome: 'needs_clarification';
      reply: string;
    }
  | {
      outcome: 'unsupported';
      reply: string;
    };

export interface IntexAgentRunner {
  run(input: {
    session: IntexAgentSession;
    events: IntexAgentSessionEvent[];
    message: string;
    messageId?: string;
  }): Promise<IntexAgentRunnerResult>;
}

export interface WhatsAppReplyPublisher {
  publishReply(input: {
    userId: string;
    message: string;
    replyToMessageId: string;
    correlationId: string;
  }): Promise<void>;
}

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  sessionId(): string;
  eventId(): string;
}

export interface HandleIncomingMessageDeps {
  sessionRepository: SessionRepository;
  runner: IntexAgentRunner;
  replyPublisher: WhatsAppReplyPublisher;
  clock: Clock;
  ids: IdGenerator;
  sessionTimeoutMs: number;
}

export async function handleIncomingMessage(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps
): Promise<IncomingMessageHandlerResult> {
  const now = deps.clock.now();
  const normalizedUserTimestamp = normalizeSessionTimestamp(input.timestamp);
  const currentSession = await deps.sessionRepository.findOpenSession(input.userId);
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
    const reply = prefixForDecision(decision) + newSessionReadyText();
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
  });
  await deps.sessionRepository.updateSession(session.id, {
    status: 'active',
    lastUserMessageAt: normalizedUserTimestamp,
  });

  const events = await deps.sessionRepository.listEvents(session.id, input.userId);
  const runnerResult = await deps.runner.run({
    session,
    events,
    message: effectiveMessage,
    messageId: input.messageId,
  });
  await applyRunnerResult(input, deps, session, runnerResult, prefixForDecision(decision));

  return { sessionId: session.id };
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
  runnerResult: IntexAgentRunnerResult,
  replyPrefix: string
): Promise<void> {
  if (runnerResult.outcome === 'needs_clarification') {
    const reply = replyPrefix + stripDuplicateSessionPrefix(runnerResult.reply);
    await appendEvent(deps, session, 'clarification_requested', { message: reply });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.outcome === 'unsupported') {
    const reply = replyPrefix + runnerResult.reply;
    await appendEvent(deps, session, 'unsupported_request', { message: runnerResult.reply });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await closeSession(session, deps, 'unsupported', 'unsupported_request', {
      lastAssistantMessageAt: assistantAt,
      summary: summarizeUserMessage(input.text),
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  const reply = replyPrefix + runnerResult.reply;
  await appendEvent(deps, session, 'tool_call_completed', {
    ...(runnerResult.toolName !== undefined ? { toolName: runnerResult.toolName } : {}),
  });
  const assistantAt = await appendAssistantMessage(session, deps, reply);
  const endedAt = deps.clock.now();
  await deps.sessionRepository.updateSession(session.id, {
    status: 'completed',
    endedAt,
    lastAssistantMessageAt: assistantAt,
    endReason: 'tool_completed',
    ...(runnerResult.toolName !== undefined ? { activeTool: runnerResult.toolName } : {}),
    ...(runnerResult.summary !== undefined ? { summary: runnerResult.summary } : {}),
  });
  await appendEvent(deps, session, 'session_closed', {
    status: 'completed',
    reason: 'tool_completed',
  }, endedAt);
  await publishReply(input, deps, session.id, reply);
}

async function closeSession(
  session: IntexAgentSession,
  deps: HandleIncomingMessageDeps,
  status: IntexAgentSessionStatus,
  endReason: IntexAgentSessionEndReason,
  metadata: { lastAssistantMessageAt: string; summary: string }
): Promise<void> {
  const endedAt = deps.clock.now();
  await deps.sessionRepository.updateSession(session.id, {
    status,
    endedAt,
    lastAssistantMessageAt: metadata.lastAssistantMessageAt,
    endReason,
    summary: metadata.summary,
  });
  await appendEvent(deps, session, 'session_closed', {
    status,
    reason: endReason,
  }, endedAt);
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
  message: string
): Promise<void> {
  await deps.replyPublisher.publishReply({
    userId: input.userId,
    message,
    replyToMessageId: input.messageId,
    correlationId: sessionId,
  });
}

function prefixForDecision(decision: SessionTransitionDecision): string {
  if (decision.action === 'continue') {
    return '';
  }

  if (decision.closeCurrentSession?.status === 'superseded') {
    return 'Previous session superseded. New session started.\n\n';
  }

  if (decision.closeCurrentSession?.status === 'expired') {
    return 'Previous session expired. New session started.\n\n';
  }

  return 'New session started.\n\n';
}

function newSessionReadyText(): string {
  return 'What would you like me to help with? I can create notes and calendar events.';
}

function stripDuplicateSessionPrefix(text: string): string {
  return text.replace(/^New session started\.\s*/i, '').trimStart();
}

function summarizeUserMessage(message: string): string {
  const normalized = message.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}
