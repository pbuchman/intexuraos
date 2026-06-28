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
  run(input: {
    session: IntexAgentSession;
    events: IntexAgentSessionEvent[];
    message: string;
    replyContext?: IntexIncomingMessage['replyContext'];
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
  const currentSession = await deps.sessionRepository.findContinuableSession(input.userId);
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
    ...(input.replyContext !== undefined ? { replyContext: input.replyContext } : {}),
  });
  await deps.sessionRepository.updateSession(session.id, {
    status: 'active',
    lastUserMessageAt: normalizedUserTimestamp,
  });

  const events = await deps.sessionRepository.listEvents(session.id, input.userId);
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
    currentDateTime: now,
    messageId: input.messageId,
  });
  await applyRunnerResult(input, deps, session, runnerResult);

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
    await applyUnsupportedRunnerResult(input, deps, session, malformedRunnerResult());
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
  }
): Promise<void> {
  await deps.replyPublisher.publishReply({
    userId: input.userId,
    message,
    replyToMessageId: input.messageId,
    correlationId: sessionId,
    ...(ctaUrl !== undefined ? { ctaUrl } : {}),
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

function malformedRunnerResult(): Extract<IntexAgentRunnerResult, { outcome: 'unsupported' }> {
  return {
    outcome: 'unsupported',
    reply: buildUnsupportedCapabilitiesReply(),
  };
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
