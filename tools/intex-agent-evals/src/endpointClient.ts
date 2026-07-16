import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import {
  IntexAgentSessionEndReasonSchema,
  IntexAgentSessionEventTypeSchema,
  IntexAgentSessionStartReasonSchema,
  IntexAgentSessionStatusSchema,
  IntexAgentToolNameSchema,
  IntexAgentTransitionActionSchema,
  ScenarioSourceTypeSchema,
  type IntexAgentSessionEndReason,
  type IntexAgentSessionEventType,
  type IntexAgentSessionStartReason,
  type IntexAgentSessionStatus,
  type IntexAgentToolName,
  type IntexAgentTransitionAction,
} from './types.js';
import type { IntexEvalScenario } from './scenarioSchema.js';

const ENDPOINT_URL = 'http://127.0.0.1:8134/internal/intex-agent/test/conversation';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN = /^[a-z0-9._-]{1,96}$/u;
const USER_ID_PATTERN = /^test-intex-agent-[a-z0-9._-]{1,96}$/u;

export type EndpointFailureCode =
  | 'missing_internal_auth'
  | 'endpoint_timeout'
  | 'endpoint_transport_failed'
  | 'endpoint_http_failed'
  | 'malformed_endpoint_response'
  | 'endpoint_correlation_failed';

export class EndpointClientError extends Error {
  readonly code: EndpointFailureCode;
  readonly httpStatus?: number;

  constructor(code: EndpointFailureCode, httpStatus?: number) {
    super(code);
    this.name = 'EndpointClientError';
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

export interface SyntheticRunIdentity {
  runId: string;
  userId: string;
}

export interface EndpointClient {
  runScenario(
    scenario: IntexEvalScenario,
    identity: SyntheticRunIdentity
  ): Promise<EndpointConversationResponse>;
}

export interface EndpointTimer {
  set(callback: () => void, timeoutMs: number): unknown;
  clear(handle: unknown): void;
}

export type SanitizedWireValue = null | boolean | number | string | SanitizedWireRecord;

export interface SanitizedWireRecord {
  readonly [key: string]: SanitizedWireValue;
}

const BoundedStringSchema = z.string().min(1).max(4096);
const BoundedIdentifierSchema = z.string().min(1).max(512);
const OffsetDateTimeSchema = z.string().datetime({ offset: true });

const SanitizedWireValueSchema: z.ZodType<SanitizedWireValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    BoundedStringSchema,
    SanitizedWireRecordSchema,
  ])
);

const SanitizedWireRecordSchema: z.ZodType<SanitizedWireRecord> = z.record(
  z.string().min(1).max(200),
  SanitizedWireValueSchema
);

const EndpointMessageTurnRequestSchema = z
  .object({
    kind: z.literal('message'),
    messageId: BoundedIdentifierSchema,
    text: z.string().min(1).max(4000),
    timestamp: OffsetDateTimeSchema,
    sourceType: ScenarioSourceTypeSchema,
  })
  .strict();

const EndpointConfirmationTurnRequestSchema = z
  .object({
    kind: z.literal('confirmation_button'),
    previousTurnIndex: z.number().int().min(0).max(19),
    decision: z.enum(['accept', 'reject']),
    messageId: BoundedIdentifierSchema,
    timestamp: OffsetDateTimeSchema,
  })
  .strict();

const EndpointConversationTurnRequestSchema = z.discriminatedUnion('kind', [
  EndpointMessageTurnRequestSchema,
  EndpointConfirmationTurnRequestSchema,
]);

export type EndpointConversationTurnRequest = z.infer<typeof EndpointConversationTurnRequestSchema>;

const EndpointConversationRequestSchema = z
  .object({
    contractVersion: z.literal('2026-07-01'),
    mode: z.literal('live_llm_mock_tools'),
    userId: z.string().regex(USER_ID_PATTERN),
    runId: z.string().regex(RUN_ID_PATTERN),
    scenarioId: BoundedIdentifierSchema,
    currentDateTime: OffsetDateTimeSchema,
    timeZone: BoundedStringSchema,
    turns: z.array(EndpointConversationTurnRequestSchema).min(1).max(20),
  })
  .strict();

export type EndpointConversationRequest = z.infer<typeof EndpointConversationRequestSchema>;

const EndpointToolCallSchema = z
  .object({
    toolName: IntexAgentToolNameSchema,
    status: z.enum(['completed', 'failed']),
    argsSummary: SanitizedWireRecordSchema.optional(),
    resultSummary: SanitizedWireRecordSchema.optional(),
    error: BoundedStringSchema.optional(),
  })
  .strict();

export interface EndpointToolCall {
  toolName: IntexAgentToolName;
  status: 'completed' | 'failed';
  argsSummary?: SanitizedWireRecord;
  resultSummary?: SanitizedWireRecord;
  error?: string;
}

const EndpointAssistantReplySchema = z
  .object({
    userId: BoundedIdentifierSchema,
    message: BoundedStringSchema,
    replyToMessageId: BoundedIdentifierSchema,
    correlationId: BoundedIdentifierSchema,
    ctaUrl: z
      .object({ displayText: BoundedStringSchema, url: BoundedStringSchema })
      .strict()
      .optional(),
    buttons: z
      .array(
        z
          .object({
            type: z.literal('reply'),
            reply: z.object({ id: BoundedIdentifierSchema, title: BoundedStringSchema }).strict(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

export interface EndpointAssistantReply {
  userId: string;
  message: string;
  replyToMessageId: string;
  correlationId: string;
  ctaUrl?: { displayText: string; url: string };
  buttons?: { type: 'reply'; reply: { id: string; title: string } }[];
}

const EndpointTimelineEventSchema = z
  .object({
    sessionId: BoundedIdentifierSchema,
    id: BoundedIdentifierSchema,
    type: IntexAgentSessionEventTypeSchema,
    createdAt: OffsetDateTimeSchema,
    payload: SanitizedWireRecordSchema,
  })
  .strict();

export interface EndpointTimelineEvent {
  sessionId: string;
  id: string;
  type: IntexAgentSessionEventType;
  createdAt: string;
  payload: SanitizedWireRecord;
}

const EndpointSessionAfterTurnSchema = z
  .object({
    id: BoundedIdentifierSchema,
    status: IntexAgentSessionStatusSchema,
    startReason: IntexAgentSessionStartReasonSchema,
    endReason: IntexAgentSessionEndReasonSchema.optional(),
    activeTool: IntexAgentToolNameSchema.optional(),
  })
  .strict();

const EndpointTurnResultSchema = z
  .object({
    turnIndex: z.number().int().nonnegative(),
    kind: z.enum(['message', 'confirmation_button']),
    messageId: BoundedIdentifierSchema,
    sessionId: BoundedIdentifierSchema,
    submittedTextPreview: BoundedStringSchema.optional(),
    assistantReplies: z.array(EndpointAssistantReplySchema),
    toolCalls: z.array(EndpointToolCallSchema),
    sessionAfterTurn: EndpointSessionAfterTurnSchema,
    timelineEvents: z.array(EndpointTimelineEventSchema),
  })
  .strict();

export interface EndpointTurnResult {
  turnIndex: number;
  kind: 'message' | 'confirmation_button';
  messageId: string;
  sessionId: string;
  submittedTextPreview?: string;
  assistantReplies: EndpointAssistantReply[];
  toolCalls: EndpointToolCall[];
  sessionAfterTurn: {
    id: string;
    status: IntexAgentSessionStatus;
    startReason: IntexAgentSessionStartReason;
    endReason?: IntexAgentSessionEndReason;
    activeTool?: IntexAgentToolName;
  };
  timelineEvents: EndpointTimelineEvent[];
}

const EndpointSessionSchema = z
  .object({
    id: BoundedIdentifierSchema,
    userId: BoundedIdentifierSchema,
    channel: z.literal('whatsapp'),
    status: IntexAgentSessionStatusSchema,
    startedAt: OffsetDateTimeSchema,
    endedAt: OffsetDateTimeSchema.optional(),
    lastUserMessageAt: OffsetDateTimeSchema,
    lastAssistantMessageAt: OffsetDateTimeSchema.optional(),
    startReason: IntexAgentSessionStartReasonSchema,
    endReason: IntexAgentSessionEndReasonSchema.optional(),
    activeTool: IntexAgentToolNameSchema.optional(),
  })
  .strict();

const EndpointTransitionSchema = z
  .object({
    turnIndex: z.number().int().nonnegative(),
    action: IntexAgentTransitionActionSchema,
    sessionId: BoundedIdentifierSchema,
    previousSessionId: BoundedIdentifierSchema.optional(),
    previousEndReason: IntexAgentSessionEndReasonSchema.optional(),
  })
  .strict();

const EndpointAggregateEventSchema = EndpointTimelineEventSchema.omit({ sessionId: true });

const BehavioralTranscriptTurnSchema = z
  .object({
    turnIndex: z.number().int().nonnegative(),
    submittedTextPreview: BoundedStringSchema.optional(),
    assistantReplyPreviews: z.array(BoundedStringSchema),
    sessionAction: IntexAgentTransitionActionSchema,
    confirmationAction: z.enum(['accepted', 'rejected', 'stale']).optional(),
    toolOutcome: z
      .object({
        toolName: IntexAgentToolNameSchema,
        status: z.enum(['completed', 'failed']),
      })
      .strict()
      .optional(),
  })
  .strict();

const EndpointConversationResponseSchema = z
  .object({
    contractVersion: z.literal('2026-07-01'),
    mode: z.literal('live_llm_mock_tools'),
    runId: z.string().regex(RUN_ID_PATTERN),
    scenarioId: BoundedIdentifierSchema.optional(),
    userId: z.string().regex(USER_ID_PATTERN),
    finalSessionId: BoundedIdentifierSchema.nullable(),
    turns: z.array(EndpointTurnResultSchema).max(20),
    toolCalls: z.array(EndpointToolCallSchema),
    sessions: z.array(EndpointSessionSchema),
    sessionTransitions: z.array(EndpointTransitionSchema),
    eventsBySessionId: z.record(z.string().min(1).max(512), z.array(EndpointAggregateEventSchema)),
    behavioralTranscript: z.object({ turns: z.array(BehavioralTranscriptTurnSchema) }).strict(),
    sideEffectBoundary: z.literal('mocked_tools_no_downstream_writes'),
    warnings: z.array(BoundedStringSchema),
  })
  .strict();

const CorrelatableEndpointConversationResponseSchema = EndpointConversationResponseSchema.extend({
  contractVersion: BoundedStringSchema,
  mode: BoundedStringSchema,
  runId: BoundedIdentifierSchema,
  userId: BoundedIdentifierSchema,
  sideEffectBoundary: BoundedStringSchema,
});

type CorrelatableEndpointConversationResponse = z.infer<
  typeof CorrelatableEndpointConversationResponseSchema
>;

export interface EndpointConversationResponse {
  contractVersion: '2026-07-01';
  mode: 'live_llm_mock_tools';
  runId: string;
  scenarioId?: string;
  userId: string;
  finalSessionId: string | null;
  turns: EndpointTurnResult[];
  toolCalls: EndpointToolCall[];
  sessions: {
    id: string;
    userId: string;
    channel: 'whatsapp';
    status: IntexAgentSessionStatus;
    startedAt: string;
    endedAt?: string;
    lastUserMessageAt: string;
    lastAssistantMessageAt?: string;
    startReason: IntexAgentSessionStartReason;
    endReason?: IntexAgentSessionEndReason;
    activeTool?: IntexAgentToolName;
  }[];
  sessionTransitions: {
    turnIndex: number;
    action: IntexAgentTransitionAction;
    sessionId: string;
    previousSessionId?: string;
    previousEndReason?: IntexAgentSessionEndReason;
  }[];
  eventsBySessionId: Record<
    string,
    {
      id: string;
      type: IntexAgentSessionEventType;
      createdAt: string;
      payload: SanitizedWireRecord;
    }[]
  >;
  behavioralTranscript: {
    turns: {
      turnIndex: number;
      submittedTextPreview?: string;
      assistantReplyPreviews: string[];
      sessionAction: IntexAgentTransitionAction;
      confirmationAction?: 'accepted' | 'rejected' | 'stale';
      toolOutcome?: { toolName: IntexAgentToolName; status: 'completed' | 'failed' };
    }[];
  };
  sideEffectBoundary: 'mocked_tools_no_downstream_writes';
  warnings: string[];
}

const DiagnosticsSchema = z
  .object({
    requestId: BoundedIdentifierSchema,
    durationMs: z.number().finite().nonnegative().optional(),
    downstreamStatus: z.number().int().min(100).max(599).optional(),
    downstreamRequestId: BoundedIdentifierSchema.optional(),
    endpointCalled: BoundedStringSchema.optional(),
  })
  .strict();

const SuccessEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: CorrelatableEndpointConversationResponseSchema,
    diagnostics: DiagnosticsSchema.optional(),
  })
  .strict();

export function createSyntheticRunIdentity(
  scenarioId: string,
  createUuid: () => string = randomUUID
): SyntheticRunIdentity {
  const uuid = createUuid().toLowerCase();
  const runId = `${scenarioId}-${uuid}`;
  const userId = `test-intex-agent-${runId}`;
  if (
    !UUID_PATTERN.test(uuid) ||
    !RUN_ID_PATTERN.test(runId) ||
    !USER_ID_PATTERN.test(userId) ||
    userId !== `test-intex-agent-${runId}`
  ) {
    throw new Error('invalid synthetic run identity');
  }
  return { runId, userId };
}

export function materializeEndpointRequest(
  scenario: IntexEvalScenario,
  identity: SyntheticRunIdentity
): EndpointConversationRequest {
  assertIdentity(identity);
  const turns: EndpointConversationTurnRequest[] = scenario.turns.map((turn, turnIndex) => {
    const common = {
      messageId: `wamid-test-${identity.runId}-${String(turnIndex)}`,
      timestamp: timestampForTurn(scenario.currentDateTime, turnIndex),
    };
    if (turn.kind === 'message') {
      return {
        kind: 'message',
        ...common,
        text: turn.text,
        sourceType: turn.sourceType ?? 'whatsapp_text',
      };
    }
    return {
      kind: 'confirmation_button',
      ...common,
      previousTurnIndex: turn.previousTurnIndex,
      decision: turn.decision,
    };
  });

  return EndpointConversationRequestSchema.parse({
    contractVersion: '2026-07-01',
    mode: 'live_llm_mock_tools',
    userId: identity.userId,
    runId: identity.runId,
    scenarioId: scenario.id,
    currentDateTime: scenario.currentDateTime,
    timeZone: scenario.timeZone,
    turns,
  });
}

export function createEndpointClient(options: {
  internalAuthToken: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
  timer?: EndpointTimer;
}): EndpointClient {
  const fetchFn = options.fetchFn ?? fetch;
  const timer = options.timer ?? productionTimer;

  return {
    async runScenario(
      scenario: IntexEvalScenario,
      identity: SyntheticRunIdentity
    ): Promise<EndpointConversationResponse> {
      if (options.internalAuthToken.trim().length === 0) {
        throw new EndpointClientError('missing_internal_auth');
      }
      const request = materializeEndpointRequest(scenario, identity);
      const deadlineAt = performance.now() + options.timeoutMs;
      const controller = new AbortController();
      let rejectDeadline: ((error: EndpointClientError) => void) | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject;
      });
      const handle = timer.set(() => {
        controller.abort();
        rejectDeadline?.(new EndpointClientError('endpoint_timeout'));
      }, options.timeoutMs);

      try {
        const response = await Promise.race([
          fetchFn(ENDPOINT_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-internal-auth': options.internalAuthToken,
            },
            body: JSON.stringify(request),
            redirect: 'error',
            signal: controller.signal,
          }),
          deadline,
        ]);
        throwIfDeadlineExceeded(deadlineAt);
        if (response.status !== 200) {
          throw new EndpointClientError('endpoint_http_failed', response.status);
        }
        const body = await Promise.race([response.text(), deadline]);
        throwIfDeadlineExceeded(deadlineAt);
        let decoded: unknown;
        try {
          decoded = JSON.parse(body) as unknown;
        } catch {
          throwIfDeadlineExceeded(deadlineAt);
          throw new EndpointClientError('malformed_endpoint_response');
        }
        throwIfDeadlineExceeded(deadlineAt);
        const parsed = SuccessEnvelopeSchema.safeParse(decoded);
        throwIfDeadlineExceeded(deadlineAt);
        if (!parsed.success) {
          throw new EndpointClientError('malformed_endpoint_response');
        }
        const isResponseCorrelated = isCorrelated(request, parsed.data.data);
        throwIfDeadlineExceeded(deadlineAt);
        if (!isResponseCorrelated) {
          throw new EndpointClientError('endpoint_correlation_failed');
        }
        const correlated = EndpointConversationResponseSchema.safeParse(parsed.data.data);
        throwIfDeadlineExceeded(deadlineAt);
        if (!correlated.success) {
          throw new EndpointClientError('endpoint_correlation_failed');
        }
        const hasScenarioId = correlated.data.scenarioId !== undefined;
        throwIfDeadlineExceeded(deadlineAt);
        if (!hasScenarioId) {
          throw new EndpointClientError('endpoint_correlation_failed');
        }
        throwIfDeadlineExceeded(deadlineAt);
        return correlated.data as unknown as EndpointConversationResponse;
      } catch (error) {
        if (error instanceof EndpointClientError) throw error;
        if (controller.signal.aborted || performance.now() >= deadlineAt) {
          throw new EndpointClientError('endpoint_timeout');
        }
        throw new EndpointClientError('endpoint_transport_failed');
      } finally {
        timer.clear(handle);
      }
    },
  };
}

const productionTimer: EndpointTimer = {
  set(callback: () => void, timeoutMs: number): unknown {
    return setTimeout(callback, timeoutMs);
  },
  clear(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

function throwIfDeadlineExceeded(deadlineAt: number): void {
  if (performance.now() >= deadlineAt) {
    throw new EndpointClientError('endpoint_timeout');
  }
}

function assertIdentity(identity: SyntheticRunIdentity): void {
  if (
    !RUN_ID_PATTERN.test(identity.runId) ||
    !USER_ID_PATTERN.test(identity.userId) ||
    identity.userId !== `test-intex-agent-${identity.runId}`
  ) {
    throw new Error('invalid synthetic run identity');
  }
}

function timestampForTurn(base: string, turnIndex: number): string {
  return new Date(new Date(base).getTime() + turnIndex * 1_000).toISOString();
}

function isCorrelated(
  request: EndpointConversationRequest,
  response: CorrelatableEndpointConversationResponse
): boolean {
  if (
    response.contractVersion !== request.contractVersion ||
    response.mode !== request.mode ||
    response.runId !== request.runId ||
    response.scenarioId !== request.scenarioId ||
    response.userId !== request.userId ||
    response.sideEffectBoundary !== 'mocked_tools_no_downstream_writes' ||
    response.turns.length !== request.turns.length ||
    response.sessionTransitions.length !== request.turns.length
  ) {
    return false;
  }

  const seenTurnIndexes = new Set<number>();
  for (const [index, turn] of response.turns.entries()) {
    const requestTurn = request.turns[index];
    if (
      requestTurn === undefined ||
      seenTurnIndexes.has(turn.turnIndex) ||
      turn.turnIndex !== index ||
      turn.kind !== requestTurn.kind ||
      turn.messageId !== requestTurn.messageId ||
      turn.sessionAfterTurn.id !== turn.sessionId
    ) {
      return false;
    }
    seenTurnIndexes.add(turn.turnIndex);
    const matchingTransitions = response.sessionTransitions.filter(
      (transition) => transition.turnIndex === turn.turnIndex
    );
    if (matchingTransitions.length !== 1 || matchingTransitions[0]?.sessionId !== turn.sessionId) {
      return false;
    }
  }

  return response.finalSessionId === response.turns.at(-1)?.sessionId;
}
