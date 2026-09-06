import {
  INTEX_AGENT_TEST_RUN_MAX_REPLIES_PER_TURN,
  intexAgentToolNameV1Schema,
  publicTestRunHeaderV1Schema,
  publicTestRunScenarioSummaryV1Schema,
  publicTestTimelineEventV1Schema,
  safeToolFactV1Schema,
  sanitizeIntexAgentReplyText,
  testRunDtoV1Schema,
  testScenarioDtoV1Schema,
  type PublicTestRunHeaderV1,
  type PublicTestRunScenarioSummaryV1,
  type PublicTestTimelineEventV1,
  type TestRunDtoV1,
  type TestScenarioDtoV1,
} from '@intexuraos/http-contracts';

import type { IntexAgentSessionEvent } from '../sessions/types.js';
import type {
  IntexAgentTestRunRecordV1,
  TestRunScenarioFoundationV1,
  TestRunScenarioProjectionV1,
  TestVerdict,
} from './types.js';

export function mapPublicTestRunHeader(
  record: IntexAgentTestRunRecordV1
): PublicTestRunHeaderV1 {
  return publicTestRunHeaderV1Schema.parse({
    schemaVersion: 1,
    runId: record.runId,
    revision: record.revision,
    corpusId: record.corpusId,
    corpusVersion: record.corpusVersion,
    transport: record.transport,
    executionMode: record.executionMode,
    lifecycle: record.lifecycle,
    verdict: record.verdict,
    artifactDelivery: structuredClone(record.artifactDelivery),
    agentModel: record.agentModel,
    evaluatorModel: record.evaluatorModel,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt,
    currentScenarioNumber: record.currentScenarioNumber,
    totals: structuredClone(record.totals),
    cost: structuredClone(record.cost),
  });
}

export function mapPublicTestRunScenarioSummary(
  scenario: TestRunScenarioFoundationV1
): PublicTestRunScenarioSummaryV1 {
  return publicTestRunScenarioSummaryV1Schema.parse({
    scenarioId: scenario.scenarioId,
    scenarioNumber: scenario.scenarioNumber,
    scenarioLabel: scenario.scenarioLabel,
    scenarioRevision: scenario.scenarioRevision,
    lifecycle: scenario.lifecycle,
    verdict: scenario.verdict,
    plannedTurns: scenario.plannedTurns,
    completedTurns: scenario.completedTurns,
    expectedReplies: scenario.expectedReplies,
    completedReplies: scenario.completedReplies,
    selectedTools: [...scenario.selectedTools],
    deterministicVerdict: scenario.deterministicVerdict,
    semanticVerdict: scenario.semanticVerdict,
    startedAt: scenario.startedAt,
    finishedAt: scenario.finishedAt,
    durationMs: scenario.durationMs,
  });
}

export function mapPublicTestRun(record: IntexAgentTestRunRecordV1): TestRunDtoV1 {
  return testRunDtoV1Schema.parse({
    run: mapPublicTestRunHeader(record),
    scenarios: record.scenarios.map(mapPublicTestRunScenarioSummary),
  });
}

export function mapPublicTestScenario(input: Readonly<{
  run: IntexAgentTestRunRecordV1;
  projection: TestRunScenarioProjectionV1;
  events: readonly IntexAgentSessionEvent[];
}>): TestScenarioDtoV1 {
  const summary = input.run.scenarios.find(
    (scenario) => scenario.scenarioId === input.projection.scenarioId
  );
  if (
    summary === undefined ||
    input.projection.runId !== input.run.runId ||
    input.projection.userId !== input.run.userId ||
    input.projection.runRevision > input.run.revision ||
    input.projection.scenarioNumber !== summary.scenarioNumber ||
    input.projection.scenarioLabel !== summary.scenarioLabel ||
    input.projection.scenarioRevision !== summary.scenarioRevision ||
    input.projection.eventWatermark !== summary.eventWatermark ||
    input.projection.sessionId !== summary.sessionId ||
    input.projection.sessionBindingDigest !== summary.sessionBindingDigest
  )
    throw new Error('TEST_RUN_PROJECTION_MISMATCH');

  const events = [...input.events].sort(
    (left, right) => (left.eventSequence ?? 0) - (right.eventSequence ?? 0)
  );
  if (
    events.length !== input.projection.eventWatermark ||
    events.some(
      (event, index) =>
        event.eventSequence !== index + 1 ||
        event.sessionId !== input.projection.sessionId ||
        event.userId !== input.run.userId
    )
  )
    throw new Error('TEST_RUN_STALE_PROJECTION');

  const timeline = mapTimeline(events, input.projection);
  const dto = {
    schemaVersion: 1 as const,
    runId: input.run.runId,
    runRevision: input.run.revision,
    agentModel: input.run.agentModel,
    evaluatorModel: input.run.evaluatorModel,
    scenario: mapPublicTestRunScenarioSummary(summary),
    eventWatermark: input.projection.eventWatermark,
    timeline,
  };
  const parsed = testScenarioDtoV1Schema.safeParse(dto);
  if (!parsed.success) throw new Error('TEST_RUN_INVALID_TIMELINE');
  return parsed.data;
}

function mapTimeline(
  events: readonly IntexAgentSessionEvent[],
  projection: TestRunScenarioProjectionV1
): PublicTestTimelineEventV1[] {
  const timeline: PublicTestTimelineEventV1[] = [];
  const confirmations = new Map<string, { toolName: string; turnIndex: number }>();
  let currentTurnIndex: number | null = null;
  let restartPending = false;
  const replyCounts = new Map<number, number>();

  for (const event of events) {
    if (restartPending && event.type !== 'session_started')
      throw new Error('TEST_RUN_INVALID_TIMELINE');
    if (
      !restartPending &&
      currentTurnIndex !== null &&
      event.type === 'session_started'
    )
      throw new Error('TEST_RUN_INVALID_TIMELINE');
    const sequence = event.eventSequence as number;
    const mapped = mapSourceEvent({
      event,
      sequence,
      timelineIndex: timeline.length,
      currentTurnIndex,
      confirmations,
      replyCounts,
    });
    if (mapped.kind === 'invalid') throw new Error('TEST_RUN_INVALID_TIMELINE');
    if (mapped.kind === 'user') {
      currentTurnIndex = mapped.turnIndex;
      timeline.push(mapped.event);
    }
    if (mapped.kind === 'context') {
      currentTurnIndex = mapped.turnIndex;
      timeline.push(mapped.event);
      restartPending = false;
    }
    if (mapped.kind === 'closed') {
      currentTurnIndex = mapped.turnIndex;
      restartPending = true;
      timeline.push(mapped.event);
    }
    if (mapped.kind === 'event') timeline.push(mapped.event);
  }
  if (restartPending) throw new Error('TEST_RUN_INVALID_TIMELINE');

  if (projection.deterministicChecks.length > 0) {
    timeline.push({
      type: 'deterministic_evaluation',
      timelineIndex: timeline.length,
      verdict: aggregateCheckVerdict(projection.deterministicChecks),
      checks: structuredClone(projection.deterministicChecks),
    });
  }
  for (const evaluation of projection.replyEvaluations) {
    timeline.push({
      type: 'minimax_evaluation',
      timelineIndex: timeline.length,
      evaluatorModel: 'or:minimax/minimax-m3',
      evaluation: structuredClone(evaluation),
    });
  }
  if (timeline.some((event) => !publicTestTimelineEventV1Schema.safeParse(event).success))
    throw new Error('TEST_RUN_INVALID_TIMELINE');
  return timeline;
}

type SourceMapResult =
  | Readonly<{ kind: 'ignored' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{
      kind: 'context';
      turnIndex: number;
      event: PublicTestTimelineEventV1;
    }>
  | Readonly<{
      kind: 'closed';
      turnIndex: number;
      event: PublicTestTimelineEventV1;
    }>
  | Readonly<{ kind: 'user'; turnIndex: number; event: PublicTestTimelineEventV1 }>
  | Readonly<{ kind: 'event'; event: PublicTestTimelineEventV1 }>;

function mapSourceEvent(input: Readonly<{
  event: IntexAgentSessionEvent;
  sequence: number;
  timelineIndex: number;
  currentTurnIndex: number | null;
  confirmations: Map<string, { toolName: string; turnIndex: number }>;
  replyCounts: Map<number, number>;
}>): SourceMapResult {
  const { event, sequence, timelineIndex } = input;
  if (event.type === 'session_closed') {
    const nextTurnIndex =
      input.currentTurnIndex === null ? null : readTurnIndex(input.currentTurnIndex + 1);
    if (
      nextTurnIndex === null ||
      Object.keys(event.payload).length !== 2 ||
      event.payload['reason'] !== 'superseded_by_user' ||
      event.payload['status'] !== 'superseded'
    )
      return { kind: 'invalid' };
    const mapped = parseTimelineEvent({
      type: 'session_closed',
      timelineIndex,
      eventSequence: sequence,
      turnIndex: nextTurnIndex,
      endReason: 'superseded_by_user',
      status: 'superseded',
      createdAt: event.createdAt,
    });
    return mapped === null
      ? { kind: 'invalid' }
      : { kind: 'closed', turnIndex: nextTurnIndex, event: mapped };
  }
  if (event.type === 'session_started') {
    const reason = event.payload['reason'];
    const initial = sequence === 1 && input.currentTurnIndex === null;
    const restarted =
      sequence !== 1 &&
      input.currentTurnIndex !== null &&
      reason === 'user_requested_new_session';
    if (
      (!initial && !restarted) ||
      Object.keys(event.payload).length !== 2 ||
      typeof event.payload['explicit'] !== 'boolean' ||
      !SESSION_START_REASONS.has(reason) ||
      event.payload['explicit'] !== (reason === 'user_requested_new_session')
    )
      return { kind: 'invalid' };
    const turnIndex = input.currentTurnIndex ?? 0;
    const mapped = parseTimelineEvent({
      type: 'session_started',
      timelineIndex,
      eventSequence: sequence,
      turnIndex,
      startReason: reason,
      explicit: event.payload['explicit'],
      createdAt: event.createdAt,
    });
    return mapped === null
      ? { kind: 'invalid' }
      : { kind: 'context', turnIndex, event: mapped };
  }
  if (event.type === 'user_message') {
    const turnIndex = readTurnIndex(event.payload['turnIndex']);
    const text = readText(event.payload['text']);
    if (turnIndex === null || text === null) return { kind: 'invalid' };
    const mapped = parseTimelineEvent({
      type: 'user_message',
      timelineIndex,
      eventSequence: sequence,
      turnIndex,
      text,
      createdAt: event.createdAt,
    });
    return mapped === null ? { kind: 'invalid' } : { kind: 'user', turnIndex, event: mapped };
  }
  if (event.type === 'assistant_message') {
    const text = readText(event.payload['text']);
    if (input.currentTurnIndex === null || text === null) return { kind: 'invalid' };
    const replyIndex = (input.replyCounts.get(input.currentTurnIndex) ?? 0) + 1;
    if (replyIndex > INTEX_AGENT_TEST_RUN_MAX_REPLIES_PER_TURN) return { kind: 'invalid' };
    input.replyCounts.set(input.currentTurnIndex, replyIndex);
    return eventResult({
      type: 'assistant_message',
      timelineIndex,
      eventSequence: sequence,
      turnIndex: input.currentTurnIndex,
      replyIndex,
      text: sanitizeIntexAgentReplyText(text),
      createdAt: event.createdAt,
    });
  }
  if (
    event.type === 'tool_call_started' ||
    event.type === 'tool_call_completed' ||
    event.type === 'tool_call_failed'
  ) {
    const toolName = intexAgentToolNameV1Schema.safeParse(event.payload['toolName']);
    const turnIndex = readTurnIndex(event.payload['turnIndex']);
    const ordinal = readPositiveIndex(event.payload['ordinal'], 20);
    const facts = safeToolFactV1Schema
      .array()
      .safeParse(Array.isArray(event.payload['facts']) ? event.payload['facts'] : []);
    const type = toolTimelineType(event);
    if (
      !toolName.success ||
      turnIndex === null ||
      ordinal === null ||
      type === null ||
      !facts.success
    )
      return { kind: 'invalid' };
    return eventResult({
      type,
      timelineIndex,
      eventSequence: sequence,
      turnIndex,
      ordinal,
      toolName: toolName.data,
      facts: facts.data,
      createdAt: event.createdAt,
    });
  }
  if (event.type === 'confirmation_requested') {
    const confirmationId = readPrivateId(event.payload['confirmationId']);
    const toolName = intexAgentToolNameV1Schema.safeParse(event.payload['toolName']);
    const selection = asRecord(event.payload['toolSelection']);
    const turnIndex = readTurnIndex(selection?.['turnIndex']);
    if (confirmationId === null || !toolName.success || turnIndex === null)
      return { kind: 'invalid' };
    input.confirmations.set(confirmationId, { toolName: toolName.data, turnIndex });
    return eventResult({
      type: 'confirmation_requested',
      timelineIndex,
      eventSequence: sequence,
      turnIndex,
      toolName: toolName.data,
      createdAt: event.createdAt,
    });
  }
  if (event.type === 'confirmation_resolved') {
    const confirmationId = readPrivateId(event.payload['confirmationId']);
    const confirmation = confirmationId === null ? undefined : input.confirmations.get(confirmationId);
    const resolution = event.payload['resolution'];
    if (
      confirmation === undefined ||
      (resolution !== 'accepted' && resolution !== 'rejected')
    )
      return { kind: 'invalid' };
    return eventResult({
      type: 'confirmation_resolved',
      timelineIndex,
      eventSequence: sequence,
      turnIndex: confirmation.turnIndex,
      toolName: confirmation.toolName,
      resolution: resolution === 'accepted' ? 'confirmed' : 'rejected',
      createdAt: event.createdAt,
    });
  }
  return IGNORED_SOURCE_EVENT_TYPES.has(event.type)
    ? { kind: 'ignored' }
    : { kind: 'invalid' };
}

function eventResult(value: unknown): SourceMapResult {
  const event = parseTimelineEvent(value);
  return event === null ? { kind: 'invalid' } : { kind: 'event', event };
}

function parseTimelineEvent(value: unknown): PublicTestTimelineEventV1 | null {
  const parsed = publicTestTimelineEventV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toolTimelineType(
  event: IntexAgentSessionEvent
): 'tool_selected' | 'mock_completed' | 'mock_failed' | 'unexpected_known_no_execution' | null {
  if (event.type === 'tool_call_started' && event.payload['status'] === 'started')
    return 'tool_selected';
  if (event.type === 'tool_call_completed' && event.payload['status'] === 'mock_completed')
    return 'mock_completed';
  if (event.type === 'tool_call_failed' && event.payload['status'] === 'mock_failed')
    return 'mock_failed';
  if (
    event.type === 'tool_call_failed' &&
    event.payload['status'] === 'unexpected_known_no_execution'
  )
    return 'unexpected_known_no_execution';
  return null;
}

function aggregateCheckVerdict(
  checks: TestRunScenarioProjectionV1['deterministicChecks']
): TestVerdict {
  if (checks.some((check) => check.status === 'failed')) return 'failed';
  if (checks.some((check) => check.status === 'pending')) return 'pending';
  return 'passed';
}

function readTurnIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 19
    ? value
    : null;
}

const IGNORED_SOURCE_EVENT_TYPES = new Set<IntexAgentSessionEvent['type']>([
  'agent_fallback',
  'clarification_requested',
  'llm_call_usage',
  'llm_usage_summary',
  'matrix_corpus_execution_boundary',
  'turn_processing_completed',
  'turn_processing_failed',
  'unsupported_request',
]);

const SESSION_START_REASONS = new Set<unknown>([
  'no_active_session',
  'previous_completed',
  'previous_expired',
  'previous_superseded',
  'user_requested_new_session',
]);

function readPositiveIndex(value: unknown, maximum: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= maximum
    ? value
    : null;
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= 4096 ? value : null;
}

function readPrivateId(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 ? value : null;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}
