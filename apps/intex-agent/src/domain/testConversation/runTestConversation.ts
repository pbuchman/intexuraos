import {
  handleIncomingMessage,
  type IdGenerator,
  type IntexAgentRunner,
} from '../messages/handleIncomingMessage.js';
import type { IntexIncomingMessage } from '../ports/incomingMessageHandler.js';
import type { SessionRepository } from '../ports/sessionRepository.js';
import type { IntexAgentSession, IntexAgentSessionEvent } from '../sessions/types.js';
import {
  buildBehavioralTranscript,
  previewText,
  sanitizeAssistantReplies,
  sanitizeEventsBySessionId,
  sanitizeSessionAfterTurn,
  sanitizeSessions,
  sanitizeToolCalls,
  sanitizeTurnTimelineEvents,
} from './testConversationSanitizer.js';
import { createCapturedReplyPublisher } from './testToolMocks.js';
import {
  TEST_CONVERSATION_CONTRACT_VERSION,
  TEST_CONVERSATION_SIDE_EFFECT_BOUNDARY,
  type CapturedAssistantReply,
  type CapturedToolCall,
  type RunTestConversationInput,
  type TestConversationResponse,
  type TestConversationSessionTransition,
  type TestConversationTurnInput,
  type TestConversationTurnResult,
} from './testConversationTypes.js';

export interface TestConversationRunner {
  run(input: RunTestConversationInput): Promise<TestConversationResponse>;
}

export interface RunTestConversationDeps {
  sessionRepository: SessionRepository;
  runner: IntexAgentRunner;
  sessionTimeoutMs: number;
  ids: IdGenerator;
  toolCalls: CapturedToolCall[];
  logger: {
    info(value: Record<string, unknown>, message?: string): void;
    warn(value: Record<string, unknown>, message?: string): void;
    error(value: Record<string, unknown>, message?: string): void;
  };
}

export async function runTestConversation(
  input: RunTestConversationInput,
  deps: RunTestConversationDeps
): Promise<TestConversationResponse> {
  deps.logger.info(
    { runId: input.runId, userId: input.userId, turnCount: input.turns.length },
    'Running Intex Agent test conversation'
  );

  const replies: CapturedAssistantReply[] = [];
  const replyPublisher = createCapturedReplyPublisher(replies);
  const turns: TestConversationTurnResult[] = [];
  const transitions: TestConversationSessionTransition[] = [];
  const touchedSessionIds = new Set<string>();
  const turnEventsByTurnIndex: Record<number, readonly IntexAgentSessionEvent[]> = {};
  const toolCallsByTurnIndex: Record<number, readonly CapturedToolCall[]> = {};
  let stoppedBeforeTurn: TestConversationResponse['stoppedBeforeTurn'];

  for (const [index, turn] of input.turns.entries()) {
    const turnNow = turn.timestamp ?? timestampForTurn(input.currentDateTime, index);
    const message = buildIncomingMessage(input, turn, index, turns, turnNow);
    if (message === null) {
      stoppedBeforeTurn = { turnIndex: index, reason: 'confirmation_button_unavailable' };
      break;
    }
    const beforeSession = await deps.sessionRepository.findContinuableSession(input.userId);
    const eventBaselines = new Map<string, number>();
    if (beforeSession !== null) {
      const beforeEvents = await deps.sessionRepository.listEvents(beforeSession.id, input.userId);
      eventBaselines.set(beforeSession.id, beforeEvents.length);
    }
    const beforeReplyCount = replies.length;
    const beforeToolCallCount = deps.toolCalls.length;
    const result = await handleIncomingMessage(message, {
      sessionRepository: deps.sessionRepository,
      runner: deps.runner,
      replyPublisher,
      clock: { now: () => turnNow },
      resolveTimeZone: () => Promise.resolve(input.timeZone ?? 'UTC'),
      ids: deps.ids,
      sessionTimeoutMs: deps.sessionTimeoutMs,
    });
    const affectedSessionIds = orderedUniqueSessionIds(beforeSession?.id, result.sessionId);
    for (const sessionId of affectedSessionIds) touchedSessionIds.add(sessionId);
    const transition = await describeTransition(
      deps.sessionRepository,
      input.userId,
      index,
      result.sessionId,
      beforeSession
    );
    transitions.push(transition);
    const rawTurnEvents: IntexAgentSessionEvent[] = [];
    for (const sessionId of affectedSessionIds) {
      const eventsAfterTurn = await deps.sessionRepository.listEvents(sessionId, input.userId);
      rawTurnEvents.push(...eventsAfterTurn.slice(eventBaselines.get(sessionId) ?? 0));
    }
    turnEventsByTurnIndex[index] = rawTurnEvents;
    const assistantReplies = sanitizeAssistantReplies(replies.slice(beforeReplyCount));
    const turnToolCalls = sanitizeToolCalls(deps.toolCalls.slice(beforeToolCallCount));
    toolCallsByTurnIndex[index] = turnToolCalls;
    const resultSession = await deps.sessionRepository.getSession(result.sessionId, input.userId);
    if (resultSession === null) {
      throw new Error('test conversation result session missing');
    }
    turns.push({
      turnIndex: index,
      kind: turn.kind,
      messageId: message.messageId,
      sessionId: result.sessionId,
      ...(turn.kind === 'message' ? { submittedTextPreview: previewText(turn.text) } : {}),
      assistantReplies,
      toolCalls: turnToolCalls,
      sessionAfterTurn: sanitizeSessionAfterTurn(resultSession),
      timelineEvents: sanitizeTurnTimelineEvents(rawTurnEvents),
    });
  }

  const sessions = await loadTouchedSessions(deps.sessionRepository, input.userId, touchedSessionIds);
  const rawEventsBySessionId = await loadEventsBySessionId(
    deps.sessionRepository,
    input.userId,
    touchedSessionIds
  );
  const sanitizedToolCalls = sanitizeToolCalls(deps.toolCalls);
  const finalSessionId = turns.at(-1)?.sessionId ?? null;

  return {
    contractVersion: TEST_CONVERSATION_CONTRACT_VERSION,
    mode: 'live_llm_mock_tools',
    runId: input.runId,
    ...(input.scenarioId !== undefined ? { scenarioId: input.scenarioId } : {}),
    userId: input.userId,
    finalSessionId,
    ...(stoppedBeforeTurn !== undefined ? { stoppedBeforeTurn } : {}),
    turns,
    toolCalls: sanitizedToolCalls,
    sessions: sanitizeSessions(sessions),
    sessionTransitions: transitions,
    eventsBySessionId: sanitizeEventsBySessionId(rawEventsBySessionId),
    behavioralTranscript: buildBehavioralTranscript({
      turns,
      sessionTransitions: transitions,
      eventsBySessionId: rawEventsBySessionId,
      toolCalls: sanitizedToolCalls,
      turnEventsByTurnIndex,
      toolCallsByTurnIndex,
    }),
    sideEffectBoundary: TEST_CONVERSATION_SIDE_EFFECT_BOUNDARY,
    warnings: [],
  };
}

function orderedUniqueSessionIds(
  previousSessionId: string | undefined,
  returnedSessionId: string
): string[] {
  if (previousSessionId === undefined || previousSessionId === returnedSessionId) {
    return [returnedSessionId];
  }
  return [previousSessionId, returnedSessionId];
}

function buildIncomingMessage(
  input: RunTestConversationInput,
  turn: TestConversationTurnInput,
  index: number,
  previousTurns: readonly TestConversationTurnResult[],
  timestamp: string
): IntexIncomingMessage | null {
  if (turn.kind === 'confirmation_button') {
    const previous = previousTurns[turn.previousTurnIndex];
    if (previous?.kind !== 'message') {
      throw new Error(
        'confirmation_button previousTurnIndex does not reference an executed message turn'
      );
    }
    const button = findConfirmationButton(previous, turn.decision);
    if (button === null) {
      return null;
    }
    return {
      type: 'intex.message.ingest',
      userId: input.userId,
      messageId: turn.messageId ?? `wamid-test-${input.runId}-${String(index)}`,
      text: '',
      sourceType: 'whatsapp_button',
      timestamp,
      buttonResponse: {
        buttonId: button.reply.id,
        buttonTitle: button.reply.title,
        replyToWamid: previous.messageId,
      },
    };
  }

  return {
    type: 'intex.message.ingest',
    userId: input.userId,
    messageId: turn.messageId ?? `wamid-test-${input.runId}-${String(index)}`,
    text: turn.text,
    sourceType: turn.sourceType ?? 'whatsapp_text',
    timestamp,
    ...(turn.sourceUrl !== undefined ? { sourceUrl: turn.sourceUrl } : {}),
    ...(turn.whatsappSender !== undefined ? { whatsappSender: turn.whatsappSender } : {}),
    ...(turn.replyContext !== undefined ? { replyContext: turn.replyContext } : {}),
  };
}

function findConfirmationButton(
  turn: TestConversationTurnResult,
  decision: 'accept' | 'reject'
): NonNullable<CapturedAssistantReply['buttons']>[number] | null {
  const suffix = decision === 'accept' ? ':yes' : ':no';
  for (const reply of turn.assistantReplies) {
    const button = reply.buttons?.find((candidate) => candidate.reply.id.endsWith(suffix));
    if (button !== undefined) {
      return button;
    }
  }
  return null;
}

async function describeTransition(
  repository: SessionRepository,
  userId: string,
  turnIndex: number,
  sessionId: string,
  beforeSession: IntexAgentSession | null
): Promise<TestConversationSessionTransition> {
  if (beforeSession === null) {
    return { turnIndex, action: 'started', sessionId };
  }
  if (beforeSession.id === sessionId) {
    return { turnIndex, action: 'continued', sessionId };
  }
  const previous = await repository.getSession(beforeSession.id, userId);
  const previousEndReason = previous?.endReason;
  const action = previousEndReason === 'timeout' ? 'expired_previous' : 'superseded_previous';
  return {
    turnIndex,
    action,
    sessionId,
    previousSessionId: beforeSession.id,
    /* v8 ignore start -- upstream: handleIncomingMessage guarantees switched open sessions are closed before transition description @preserve */
    ...(previousEndReason !== undefined ? { previousEndReason } : {}),
    /* v8 ignore stop @preserve */
  };
}

async function loadTouchedSessions(
  repository: SessionRepository,
  userId: string,
  ids: ReadonlySet<string>
): Promise<IntexAgentSession[]> {
  const sessions: IntexAgentSession[] = [];
  for (const sessionId of ids) {
    const session = await repository.getSession(sessionId, userId);
    /* v8 ignore start -- upstream: defensive guard for repository races that cannot happen in normal conversation execution @preserve */
    if (session !== null) {
      sessions.push(session);
    }
    /* v8 ignore stop @preserve */
  }
  return sessions;
}

async function loadEventsBySessionId(
  repository: SessionRepository,
  userId: string,
  ids: ReadonlySet<string>
): Promise<Record<string, IntexAgentSessionEvent[]>> {
  const eventsBySessionId: Record<string, IntexAgentSessionEvent[]> = {};
  for (const sessionId of ids) {
    eventsBySessionId[sessionId] = await repository.listEvents(sessionId, userId);
  }
  return eventsBySessionId;
}

function timestampForTurn(base: string, turnIndex: number): string {
  return new Date(new Date(base).getTime() + turnIndex * 1_000).toISOString();
}
