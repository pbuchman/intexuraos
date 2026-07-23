import { createHash } from 'node:crypto';

import type {
  MatrixCorpusAttestationClaimsV1,
  MatrixCorpusExpectedToolScheduleV1,
} from '@intexuraos/http-contracts';
import type { WhatsAppInteractiveButton } from '@intexuraos/whatsapp-pubsub-client';

import { buildNewSessionReadyText } from '../agent/capabilities.js';
import type {
  IntexAgentRunner,
  IntexAgentRunnerResult,
  MatrixCorpusWhatsAppReplyPublisher,
} from '../messages/handleIncomingMessage.js';
import type {
  MatrixCorpusSession,
  MatrixCorpusSessionIdentity,
  MatrixCorpusSessionRepository,
} from '../ports/sessionRepository.js';
import type { IntexAgentSessionEvent, IntexAgentToolName } from '../sessions/types.js';
import type { MatrixCorpusContextService } from './contextService.js';
import type {
  MatrixCorpusExecutionBoundaryResolution,
  MatrixCorpusExecutorExecutionContext,
} from './executorResolver.js';
import {
  createMatrixCorpusToolCallStartedRecorder,
  isMatrixCorpusIdleNewSessionStart,
} from './matrixCorpusMessageHandler.js';
import type {
  IngestReceiptRepository,
  MatrixCorpusIngestReceipt,
  MatrixCorpusIngestReceiptIdentity,
  MatrixCorpusIngestStableKeys,
} from './ports/ingestReceiptRepository.js';
import type { TestConfirmationRepository } from './ports/testConfirmationRepository.js';
import { mapSafeToolFacts } from './safeEvidence.js';
import { projectMatrixCorpusUsage, usdDecimalToNanoUsd } from './usageProjection.js';
import type {
  MatrixCorpusLlmCallContextV1,
  MatrixCorpusProviderCallUsageV1,
} from '@intexuraos/llm-contract';

type IngestClaims = Extract<
  MatrixCorpusAttestationClaimsV1,
  Readonly<{ kind: 'matrix_corpus_ingest' }>
>;

export type MatrixCorpusExecutionFailureCode =
  | 'CONTEXT_REJECTED'
  | 'SESSION_REJECTED'
  | 'PROFILE_REJECTED'
  | 'CONFIRMATION_REJECTED'
  | 'CORRELATION_REJECTED'
  | 'REPLY_PUBLICATION_REJECTED';

export type MatrixCorpusExecutionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: MatrixCorpusExecutionFailureCode }>;

export interface MatrixCorpusExecutionService {
  executeVerifiedIngest(
    input: Readonly<{
      claims: IngestClaims;
      stableKeys: MatrixCorpusIngestStableKeys;
    }>
  ): Promise<MatrixCorpusExecutionResult>;
  recoverVerifiedIngest(
    input: Readonly<{
      claims: IngestClaims;
      stableKeys: MatrixCorpusIngestStableKeys;
      receipt: MatrixCorpusIngestReceipt;
    }>
  ): Promise<MatrixCorpusExecutionResult>;
}

export interface MatrixCorpusExecutionServiceDeps {
  contextService: Pick<
    MatrixCorpusContextService,
    'loadScenarioPromptContext' | 'createPreferenceOverlay'
  >;
  sessionRepository: MatrixCorpusSessionRepository;
  confirmationRepository: Pick<TestConfirmationRepository, 'createOrGet' | 'getExact'>;
  receiptRepository: Pick<
    IngestReceiptRepository,
    'beginReplyCompletion' | 'reserveReplyPublication' | 'acceptReplyPublication'
  >;
  createRunner(
    input: Readonly<{
      execution: MatrixCorpusExecutorExecutionContext;
      userId: string;
      userPreferences: string | null;
    }>
  ): IntexAgentRunner;
  replyPublisher: Pick<MatrixCorpusWhatsAppReplyPublisher, 'publishReplyWithReceipt'>;
}

export function createMatrixCorpusExecutionService(
  deps: MatrixCorpusExecutionServiceDeps
): MatrixCorpusExecutionService {
  return {
    async executeVerifiedIngest(input): Promise<MatrixCorpusExecutionResult> {
      const { context, ordinaryIngest } = input.claims.payload;
      const identity: MatrixCorpusSessionIdentity = {
        runId: context.runId,
        scenarioId: context.scenarioId,
        sessionId: input.stableKeys.sessionId,
        userId: ordinaryIngest.userId,
        leaseFence: context.leaseFence,
      };
      const scenarioIdentity = {
        runId: context.runId,
        scenarioId: context.scenarioId,
        userId: ordinaryIngest.userId,
        leaseFence: context.leaseFence,
      };
      const [sessionResult, eventsResult, promptResult] = await Promise.all([
        deps.sessionRepository.getMatrixCorpusSessionExact(identity),
        deps.sessionRepository.listMatrixCorpusEventsExact(identity),
        deps.contextService.loadScenarioPromptContext(scenarioIdentity),
      ]);
      if (!sessionResult.ok || !eventsResult.ok) return failure('SESSION_REJECTED');
      if (!promptResult.ok) return failure('CONTEXT_REJECTED');
      const session = sessionResult.session;
      if (
        stableJson(session.matrixCorpusProfile.expectedToolSchedule) !==
          stableJson(context.expectedToolSchedule) ||
        stableJson(session.matrixCorpusProfile.mockProfile) !== stableJson(context.mockProfile) ||
        session.matrixCorpusProfile.mockProfileDigest !== context.mockProfileDigest
      )
        return failure('PROFILE_REJECTED');

      const currentLogicalSessionEvents = eventsAfterLatestSessionStart(
        eventsResult.events
      );
      const previousEvents = currentLogicalSessionEvents.filter(
        (event) => event.id !== input.stableKeys.eventId
      );
      const preferenceOverlay = deps.contextService.createPreferenceOverlay(scenarioIdentity);

      if (context.phase === 'confirmation') {
        return await executeConfirmation({
          deps,
          input,
          identity,
          session,
          previousEvents: currentLogicalSessionEvents,
          userPreferences: promptResult.promptContext,
          preferenceOverlay,
        });
      }

      const usageRecorder = createMatrixCorpusProviderUsageRecorder({
        sessionRepository: deps.sessionRepository,
        identity,
        ingestReceiptId: context.ingestReceiptId,
        expectedModelId: session.matrixCorpusProfile.agentModel,
        turnIndex: context.turnIndex,
        createdAt: ordinaryIngest.timestamp,
      });
      const recordExecutionBoundary = createMatrixCorpusExecutionBoundaryRecorder({
        sessionRepository: deps.sessionRepository,
        identity,
        ingestReceiptId: context.ingestReceiptId,
        turnIndex: context.turnIndex,
        mockProfileDigest: context.mockProfileDigest,
        createdAt: ordinaryIngest.timestamp,
      });
      if (isMatrixCorpusIdleNewSessionStart(input.claims)) {
        await recordExecutionBoundary('no_executor_required');
        await usageRecorder.finalize('natural', 'complete');
        return await persistAndPublishResult({
          deps,
          input,
          identity,
          result: {
            outcome: 'no_action',
            reply: buildNewSessionReadyText('en'),
          },
        });
      }
      const execution = createExecutionContext({
        flow: 'normal',
        turnIndex: context.turnIndex,
        ingestReceiptId: context.ingestReceiptId,
        expectedSchedule: context.expectedToolSchedule,
        preferenceOverlay,
        recordExecutionBoundary,
        recordToolCallStarted: createMatrixCorpusToolCallStartedRecorder({
          sessionRepository: deps.sessionRepository,
          identity,
          ingestReceiptId: context.ingestReceiptId,
          createdAt: ordinaryIngest.timestamp,
        }),
        registerExpectedProviderCall: (providerContext) => {
          usageRecorder.registerExpectedProviderCall(providerContext);
        },
        recordProviderCall: async (providerCall) => {
          await usageRecorder.recordProviderCall(providerCall);
        },
      });
      const runner = deps.createRunner({
        execution,
        userId: ordinaryIngest.userId,
        userPreferences: promptResult.promptContext,
      });
      let result: IntexAgentRunnerResult;
      try {
        result = await runner.run({
          session,
          events: previousEvents,
          message: ordinaryIngest.text,
          sourceType: ordinaryIngest.sourceType,
          currentDateTime: context.currentDateTime,
          timeZone: context.timeZone,
          messageId: ordinaryIngest.messageId,
        });
      } catch (error) {
        await usageRecorder.finalize('natural', 'failed');
        throw error;
      }
      await usageRecorder.finalize('natural', 'complete');
      return await persistAndPublishResult({ deps, input, identity, result });
    },
    async recoverVerifiedIngest(input): Promise<MatrixCorpusExecutionResult> {
      return await recoverReservedReply({ deps, ...input });
    },
  };
}

function eventsAfterLatestSessionStart(
  events: readonly IntexAgentSessionEvent[]
): readonly IntexAgentSessionEvent[] {
  let latestStartIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.type === 'session_started') latestStartIndex = index;
  }
  return latestStartIndex === -1 ? events : events.slice(latestStartIndex + 1);
}

async function recoverReservedReply(
  input: Readonly<{
    deps: MatrixCorpusExecutionServiceDeps;
    claims: IngestClaims;
    stableKeys: MatrixCorpusIngestStableKeys;
    receipt: MatrixCorpusIngestReceipt;
  }>
): Promise<MatrixCorpusExecutionResult> {
  const { context, ordinaryIngest } = input.claims.payload;
  const receipt = input.receipt;
  if (
    receipt.state !== 'llm_in_flight' ||
    receipt.ingestReceiptId !== input.claims.eventId ||
    receipt.runId !== context.runId ||
    receipt.scenarioId !== context.scenarioId ||
    receipt.turnIndex !== context.turnIndex ||
    receipt.leaseFence !== context.leaseFence ||
    receipt.payloadDigest !== input.claims.payloadDigest ||
    stableJson({
      sessionId: receipt.sessionId,
      eventId: receipt.eventId,
      toolCallId: receipt.toolCallId,
      replyId: receipt.replyId,
    }) !== stableJson(input.stableKeys) ||
    receipt.publication.phase !== 'completing' ||
    receipt.publication.expectedReplyDigests?.length !== 1 ||
    receipt.publication.replies.length !== 1
  )
    return failure('CORRELATION_REJECTED');
  const publication = receipt.publication.replies[0];
  if (publication?.replyIndex !== 0) return failure('CORRELATION_REJECTED');
  if (publication.state === 'accepted') return { ok: true };
  const identity: MatrixCorpusSessionIdentity = {
    runId: context.runId,
    scenarioId: context.scenarioId,
    sessionId: receipt.sessionId,
    userId: ordinaryIngest.userId,
    leaseFence: context.leaseFence,
  };
  const [sessionResult, eventsResult] = await Promise.all([
    input.deps.sessionRepository.getMatrixCorpusSessionExact(identity),
    input.deps.sessionRepository.listMatrixCorpusEventsExact(identity),
  ]);
  if (!sessionResult.ok || !eventsResult.ok) return failure('SESSION_REJECTED');
  const assistantEvents = eventsResult.events.filter((event) => event.id === receipt.replyId);
  if (assistantEvents.length !== 1) return failure('CORRELATION_REJECTED');
  const assistantEvent = assistantEvents[0];
  if (
    assistantEvent?.type !== 'assistant_message' ||
    Object.keys(assistantEvent.payload).length !== 1 ||
    typeof assistantEvent.payload['text'] !== 'string'
  )
    return failure('CORRELATION_REJECTED');
  const reply = assistantEvent.payload['text'];
  const replyDigest = sha256(
    stableJson({ version: 1, kind: 'matrix_corpus_reply', replyIndex: 0, text: reply })
  );
  const idempotencyKey = deterministicId('imc_reply_publish', context.ingestReceiptId, '0');
  if (
    publication.replyDigest !== replyDigest ||
    receipt.publication.expectedReplyDigests[0] !== replyDigest ||
    publication.idempotencyKeyDigest !== sha256(idempotencyKey)
  )
    return failure('CORRELATION_REJECTED');
  const confirmationEvents = eventsResult.events.filter(
    (event) =>
      event.type === 'confirmation_requested' &&
      event.payload['sourceMessageId'] === ordinaryIngest.messageId &&
      event.payload['message'] === reply
  );
  if (confirmationEvents.length > 1) return failure('CORRELATION_REJECTED');
  const confirmationId = confirmationEvents[0]?.payload['confirmationId'];
  if (confirmationId !== undefined && typeof confirmationId !== 'string')
    return failure('CORRELATION_REJECTED');
  let publicationReceiptId: string;
  try {
    ({ publicationReceiptId } = await input.deps.replyPublisher.publishReplyWithReceipt({
      userId: ordinaryIngest.userId,
      message: reply,
      replyToMessageId: ordinaryIngest.messageId,
      idempotencyKey,
      ...(confirmationId === undefined ? {} : { buttons: confirmationButtons(confirmationId) }),
    }));
  } catch {
    return failure('REPLY_PUBLICATION_REJECTED');
  }
  if (publicationReceiptId.length === 0 || publicationReceiptId.length > 512)
    return failure('REPLY_PUBLICATION_REJECTED');
  const accepted = await input.deps.receiptRepository.acceptReplyPublication({
    identity: toReceiptIdentity(input.claims),
    replyIndex: 0,
    replyDigest,
    idempotencyKeyDigest: sha256(idempotencyKey),
    publicationReceiptDigest: sha256(publicationReceiptId),
    now: ordinaryIngest.timestamp,
  });
  return accepted.ok ? { ok: true } : failure('REPLY_PUBLICATION_REJECTED');
}

async function executeConfirmation(
  input: Readonly<{
    deps: MatrixCorpusExecutionServiceDeps;
    input: Readonly<{ claims: IngestClaims; stableKeys: MatrixCorpusIngestStableKeys }>;
    identity: MatrixCorpusSessionIdentity;
    session: MatrixCorpusSession;
    previousEvents: readonly IntexAgentSessionEvent[];
    userPreferences: string;
    preferenceOverlay: ReturnType<MatrixCorpusContextService['createPreferenceOverlay']>;
  }>
): Promise<MatrixCorpusExecutionResult> {
  const { context, ordinaryIngest } = input.input.claims.payload;
  const confirmationId = context.pendingConfirmationId;
  const decision = context.expectedDecision;
  if (confirmationId === null || decision === null) return failure('CONFIRMATION_REJECTED');
  const exact = await input.deps.confirmationRepository.getExact({
    confirmationId,
    runId: context.runId,
    scenarioId: context.scenarioId,
    sessionId: input.input.stableKeys.sessionId,
    userId: input.identity.userId,
    leaseFence: context.leaseFence,
    now: ordinaryIngest.timestamp,
  });
  if (
    !exact.ok ||
    exact.confirmation.state !== 'resolved' ||
    exact.confirmation.decision !== decision ||
    exact.confirmation.resolutionMessageId !== ordinaryIngest.messageId ||
    exact.confirmation.resolvedAt !== ordinaryIngest.timestamp
  )
    return failure('CONFIRMATION_REJECTED');

  const usageRecorder = createMatrixCorpusProviderUsageRecorder({
    sessionRepository: input.deps.sessionRepository,
    identity: input.identity,
    ingestReceiptId: context.ingestReceiptId,
    expectedModelId: input.session.matrixCorpusProfile.agentModel,
    turnIndex: context.turnIndex,
    createdAt: ordinaryIngest.timestamp,
  });

  if (decision === 'reject') {
    await createMatrixCorpusExecutionBoundaryRecorder({
      sessionRepository: input.deps.sessionRepository,
      identity: input.identity,
      ingestReceiptId: context.ingestReceiptId,
      turnIndex: context.turnIndex,
      mockProfileDigest: context.mockProfileDigest,
      createdAt: ordinaryIngest.timestamp,
    })('no_executor_required');
    await usageRecorder.finalize('confirmation', 'complete');
    return await persistAssistantAndPublish({
      deps: input.deps,
      input: input.input,
      identity: input.identity,
      reply: 'Okay, I will not run this action.',
      activeTool: null,
    });
  }

  const selection = {
    toolName: exact.confirmation.toolName,
    turnIndex: exact.confirmation.selectionTurnIndex,
    ordinal: exact.confirmation.selectionOrdinal,
  } as const;
  if (!isExpectedSelection(context.expectedToolSchedule, selection))
    return failure('CONFIRMATION_REJECTED');
  const execution = createExecutionContext({
    flow: 'confirmation',
    turnIndex: selection.turnIndex,
    ingestReceiptId: context.ingestReceiptId,
    expectedSchedule: context.expectedToolSchedule,
    preferenceOverlay: input.preferenceOverlay,
    recordExecutionBoundary: createMatrixCorpusExecutionBoundaryRecorder({
      sessionRepository: input.deps.sessionRepository,
      identity: input.identity,
      ingestReceiptId: context.ingestReceiptId,
      turnIndex: context.turnIndex,
      mockProfileDigest: context.mockProfileDigest,
      createdAt: ordinaryIngest.timestamp,
    }),
    recordToolCallStarted: createMatrixCorpusToolCallStartedRecorder({
      sessionRepository: input.deps.sessionRepository,
      identity: input.identity,
      ingestReceiptId: context.ingestReceiptId,
      createdAt: ordinaryIngest.timestamp,
    }),
    registerExpectedProviderCall: (providerContext) => {
      usageRecorder.registerExpectedProviderCall(providerContext);
    },
    recordProviderCall: async (providerCall) => {
      await usageRecorder.recordProviderCall(providerCall);
    },
    preauthorizedSelection: selection,
  });
  const runner = input.deps.createRunner({
    execution,
    userId: ordinaryIngest.userId,
    userPreferences: input.userPreferences,
  });
  let result: IntexAgentRunnerResult;
  try {
    result = await runner.executeConfirmed({
      session: input.session,
      events: [...input.previousEvents],
      toolName: exact.confirmation.toolName,
      toolArgs: structuredClone(exact.confirmation.toolArgs),
      currentDateTime: context.currentDateTime,
      messageId: ordinaryIngest.messageId,
    });
  } catch (error) {
    await usageRecorder.finalize('confirmation', 'failed');
    throw error;
  }
  await usageRecorder.finalize('confirmation', 'complete');
  const correlatedResult =
    'toolName' in result && result.toolName === selection.toolName
      ? { ...result, toolSelection: selection }
      : result;
  return await persistAndPublishResult({
    deps: input.deps,
    input: input.input,
    identity: input.identity,
    result: correlatedResult,
  });
}

function createExecutionContext(
  input: MatrixCorpusExecutorExecutionContext
): MatrixCorpusExecutorExecutionContext {
  const expectedKeys = new Set(input.expectedSchedule.map(scheduleKey));
  return {
    ...input,
    expectedByCatalog: (selection) => expectedKeys.has(scheduleKey(selection)),
  };
}

function createMatrixCorpusExecutionBoundaryRecorder(
  input: Readonly<{
    sessionRepository: MatrixCorpusSessionRepository;
    identity: MatrixCorpusSessionIdentity;
    ingestReceiptId: string;
    turnIndex: number;
    mockProfileDigest: string;
    createdAt: string;
  }>
): (resolution: MatrixCorpusExecutionBoundaryResolution) => Promise<void> {
  return async (resolution): Promise<void> => {
    const appended = await input.sessionRepository.appendMatrixCorpusEvent({
      identity: input.identity,
      event: {
        id: deterministicId('imc_execution_boundary', input.ingestReceiptId, 'turn'),
        sessionId: input.identity.sessionId,
        userId: input.identity.userId,
        type: 'matrix_corpus_execution_boundary',
        payload: {
          version: 1,
          turnIndex: input.turnIndex,
          resolution,
          executionMode: 'strict_mock_tools',
          mockProfileDigest: input.mockProfileDigest,
          productionExecutorResolutions: 0,
          productionExecutorAdmissions: 0,
        },
        createdAt: input.createdAt,
      },
      now: input.createdAt,
    });
    if (!appended.ok) throw new Error('Matrix corpus execution boundary persistence failed');
  };
}

async function persistAndPublishResult(
  input: Readonly<{
    deps: MatrixCorpusExecutionServiceDeps;
    input: Readonly<{ claims: IngestClaims; stableKeys: MatrixCorpusIngestStableKeys }>;
    identity: MatrixCorpusSessionIdentity;
    result: IntexAgentRunnerResult;
  }>
): Promise<MatrixCorpusExecutionResult> {
  const { result } = input;
  if (result.outcome === 'needs_confirmation') {
    if (result.toolSelection === undefined)
      throw new Error('Matrix corpus confirmation is missing strict selection metadata');
    const confirmationId = deterministicId(
      'imc_confirmation',
      input.input.claims.payload.context.ingestReceiptId,
      'confirmation'
    );
    const createdAt = input.input.claims.payload.ordinaryIngest.timestamp;
    const expiresAt = new Date(Date.parse(createdAt) + 5 * 60 * 1000).toISOString();
    const confirmation = await input.deps.confirmationRepository.createOrGet({
      identity: {
        confirmationId,
        runId: input.identity.runId,
        scenarioId: input.identity.scenarioId,
        sessionId: input.identity.sessionId,
        userId: input.identity.userId,
        leaseFence: input.identity.leaseFence,
      },
      toolName: result.toolName,
      toolArgs: structuredClone(result.toolArgs),
      selectionTurnIndex: result.toolSelection.turnIndex,
      selectionOrdinal: result.toolSelection.ordinal,
      createdAt,
      expiresAt,
    });
    if (!confirmation.ok) throw new Error('Matrix corpus confirmation persistence failed');
    await appendEvent({
      deps: input.deps,
      identity: input.identity,
      event: {
        id: deterministicId(
          'imc_event',
          input.input.claims.payload.context.ingestReceiptId,
          'confirmation_requested'
        ),
        sessionId: input.identity.sessionId,
        userId: input.identity.userId,
        type: 'confirmation_requested',
        payload: {
          confirmationId,
          toolName: result.toolName,
          message: result.reply,
          sourceMessageId: input.input.claims.payload.ordinaryIngest.messageId,
          toolSelection: result.toolSelection,
          ...(result.summary === undefined ? {} : { summary: result.summary }),
        },
        createdAt,
      },
    });
    return await persistAssistantAndPublish({
      deps: input.deps,
      input: input.input,
      identity: input.identity,
      reply: result.reply,
      activeTool: result.toolName,
      buttons: confirmationButtons(confirmationId),
    });
  }

  const event = resultEvent(
    input.input.claims.payload.context.ingestReceiptId,
    input.input.claims.payload.ordinaryIngest.timestamp,
    input.identity,
    result
  );
  if (event !== null) await appendEvent({ deps: input.deps, identity: input.identity, event });
  return await persistAssistantAndPublish({
    deps: input.deps,
    input: input.input,
    identity: input.identity,
    reply: result.reply,
    activeTool:
      result.outcome === 'completed' ? null : 'toolName' in result ? result.toolName : undefined,
  });
}

function resultEvent(
  ingestReceiptId: string,
  createdAt: string,
  identity: MatrixCorpusSessionIdentity,
  result: Exclude<IntexAgentRunnerResult, Readonly<{ outcome: 'needs_confirmation' }>>
): IntexAgentSessionEvent | null {
  const base = {
    id: deterministicId('imc_event', ingestReceiptId, result.outcome),
    sessionId: identity.sessionId,
    userId: identity.userId,
    createdAt,
  };
  if (result.outcome === 'completed' && result.toolName !== undefined)
    return {
      ...base,
      type: 'tool_call_completed',
      payload: {
        toolName: result.toolName,
        ...(result.toolSelection === undefined
          ? {}
          : {
              turnIndex: result.toolSelection.turnIndex,
              ordinal: result.toolSelection.ordinal,
            }),
        status: 'mock_completed',
        facts:
          result.toolResult === undefined
            ? []
            : mapSafeToolFacts({
                toolName: result.toolName,
                source: 'result',
                value: result.toolResult,
              }),
      },
    };
  if (result.outcome === 'tool_failed' || result.outcome === 'tool_selection_rejected')
    return {
      ...base,
      type: 'tool_call_failed',
      payload: {
        toolName: result.toolName,
        turnIndex: result.toolSelection?.turnIndex ?? 0,
        ordinal: result.toolSelection?.ordinal ?? 1,
        status:
          result.outcome === 'tool_selection_rejected'
            ? 'unexpected_known_no_execution'
            : 'mock_failed',
        failureCode:
          result.outcome === 'tool_selection_rejected' ? result.code : 'MOCK_TOOL_FAILURE',
        facts: [],
      },
    };
  if (result.outcome === 'needs_clarification')
    return {
      ...base,
      type: 'clarification_requested',
      payload: {
        message: result.reply,
        ...(result.blockerReason === undefined ? {} : { blockerReason: result.blockerReason }),
        ...(result.missingFields === undefined ? {} : { missingFields: result.missingFields }),
        ...(result.candidateIntents === undefined
          ? {}
          : { candidateIntents: result.candidateIntents }),
        ...(result.suggestedNextStep === undefined
          ? {}
          : { suggestedNextStep: result.suggestedNextStep }),
        ...(result.fallbackReason === undefined ? {} : { fallbackReason: result.fallbackReason }),
        ...(result.clarification === undefined ? {} : { clarification: result.clarification }),
      },
    };
  if (result.outcome === 'unsupported')
    return { ...base, type: 'unsupported_request', payload: { message: result.reply } };
  return null;
}

async function persistAssistantAndPublish(
  input: Readonly<{
    deps: MatrixCorpusExecutionServiceDeps;
    input: Readonly<{ claims: IngestClaims; stableKeys: MatrixCorpusIngestStableKeys }>;
    identity: MatrixCorpusSessionIdentity;
    reply: string;
    activeTool: MatrixCorpusSessionUpdateActiveTool;
    buttons?: WhatsAppInteractiveButton[];
  }>
): Promise<MatrixCorpusExecutionResult> {
  const createdAt = input.input.claims.payload.ordinaryIngest.timestamp;
  const receiptIdentity = toReceiptIdentity(input.input.claims);
  const replyIndex = 0;
  const replyDigest = sha256(
    stableJson({ version: 1, kind: 'matrix_corpus_reply', replyIndex, text: input.reply })
  );
  const idempotencyKey = deterministicId(
    'imc_reply_publish',
    input.input.claims.payload.context.ingestReceiptId,
    String(replyIndex)
  );
  const idempotencyKeyDigest = sha256(idempotencyKey);
  const begun = await input.deps.receiptRepository.beginReplyCompletion({
    identity: receiptIdentity,
    expectedReplyDigests: [replyDigest],
    now: createdAt,
  });
  if (!begun.ok) return failure('CORRELATION_REJECTED');
  const reserved = await input.deps.receiptRepository.reserveReplyPublication({
    identity: receiptIdentity,
    replyIndex,
    replyDigest,
    idempotencyKeyDigest,
    now: createdAt,
  });
  if (!reserved.ok) return failure('CORRELATION_REJECTED');
  await appendEvent({
    deps: input.deps,
    identity: input.identity,
    event: {
      id: input.input.stableKeys.replyId,
      sessionId: input.identity.sessionId,
      userId: input.identity.userId,
      type: 'assistant_message',
      payload: { text: input.reply },
      createdAt,
    },
    sessionUpdate: {
      status: 'waiting_for_user',
      lastAssistantMessageAt: createdAt,
      ...(input.activeTool === undefined ? {} : { activeTool: input.activeTool }),
    },
  });
  let publicationReceiptId: string;
  try {
    ({ publicationReceiptId } = await input.deps.replyPublisher.publishReplyWithReceipt({
      userId: input.identity.userId,
      message: input.reply,
      replyToMessageId: input.input.claims.payload.ordinaryIngest.messageId,
      idempotencyKey,
      ...(input.buttons === undefined ? {} : { buttons: input.buttons }),
    }));
  } catch {
    return failure('REPLY_PUBLICATION_REJECTED');
  }
  if (publicationReceiptId.length === 0 || publicationReceiptId.length > 512)
    return failure('REPLY_PUBLICATION_REJECTED');
  const accepted = await input.deps.receiptRepository.acceptReplyPublication({
    identity: receiptIdentity,
    replyIndex,
    replyDigest,
    idempotencyKeyDigest,
    publicationReceiptDigest: sha256(publicationReceiptId),
    now: createdAt,
  });
  return accepted.ok ? { ok: true } : failure('REPLY_PUBLICATION_REJECTED');
}

type MatrixCorpusSessionUpdateActiveTool = IntexAgentToolName | null | undefined;

async function appendEvent(
  input: Readonly<{
    deps: MatrixCorpusExecutionServiceDeps;
    identity: MatrixCorpusSessionIdentity;
    event: IntexAgentSessionEvent;
    sessionUpdate?: Parameters<
      MatrixCorpusSessionRepository['appendMatrixCorpusEvent']
    >[0]['sessionUpdate'];
  }>
): Promise<void> {
  const appended = await input.deps.sessionRepository.appendMatrixCorpusEvent({
    identity: input.identity,
    event: input.event,
    ...(input.sessionUpdate === undefined ? {} : { sessionUpdate: input.sessionUpdate }),
    now: input.event.createdAt,
  });
  if (!appended.ok) throw new Error('Matrix corpus event persistence failed');
}

function confirmationButtons(confirmationId: string): WhatsAppInteractiveButton[] {
  return [
    {
      type: 'reply',
      reply: { id: `intex_confirm:${confirmationId}:yes`, title: 'Yes' },
    },
    {
      type: 'reply',
      reply: { id: `intex_confirm:${confirmationId}:no`, title: 'No' },
    },
  ];
}

function deterministicId(prefix: string, ingestReceiptId: string, purpose: string): string {
  const digest = createHash('sha256')
    .update(`${ingestReceiptId}:${purpose}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function isExpectedSelection(
  schedule: MatrixCorpusExpectedToolScheduleV1,
  selection: Readonly<{ turnIndex: number; toolName: string; ordinal: number }>
): boolean {
  return schedule.some(
    (expected) =>
      expected.turnIndex === selection.turnIndex &&
      expected.toolName === selection.toolName &&
      expected.ordinal === selection.ordinal
  );
}

function scheduleKey(
  input: Readonly<{
    turnIndex: number;
    toolName: string;
    ordinal: number;
  }>
): string {
  return `${String(input.turnIndex)}:${input.toolName}:${String(input.ordinal)}`;
}

function failure(code: MatrixCorpusExecutionFailureCode): MatrixCorpusExecutionResult {
  return { ok: false, code };
}

function toReceiptIdentity(claims: IngestClaims): MatrixCorpusIngestReceiptIdentity {
  return {
    ingestReceiptId: claims.eventId,
    runId: claims.payload.context.runId,
    scenarioId: claims.payload.context.scenarioId,
    turnIndex: claims.payload.context.turnIndex,
    leaseFence: claims.leaseFence,
    payloadDigest: claims.payloadDigest,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

interface MatrixCorpusProviderUsageRecorder {
  registerExpectedProviderCall(context: MatrixCorpusLlmCallContextV1): void;
  recordProviderCall(call: MatrixCorpusProviderCallUsageV1): Promise<void>;
  finalize(phase: 'natural' | 'confirmation', status: 'complete' | 'failed'): Promise<void>;
}

function createMatrixCorpusProviderUsageRecorder(
  input: Readonly<{
    sessionRepository: MatrixCorpusSessionRepository;
    identity: MatrixCorpusSessionIdentity;
    ingestReceiptId: string;
    expectedModelId: string;
    turnIndex: number;
    createdAt: string;
  }>
): MatrixCorpusProviderUsageRecorder {
  const expectedCalls = new Map<string, MatrixCorpusLlmCallContextV1>();
  const actualCalls = new Map<string, MatrixCorpusProviderCallUsageV1>();
  const registerExpected = (context: MatrixCorpusLlmCallContextV1): void => {
    assertProviderContext(input, context);
    const key = providerCallKey(context);
    const existing = expectedCalls.get(key);
    /* v8 ignore start -- ts-type: a changed value cannot share this key because validated fixed execution identity plus stage/ordinal exhaust every MatrixCorpusLlmCallContextV1 field @preserve */
    if (existing !== undefined && stableJson(existing) !== stableJson(context))
      throw new Error('Matrix corpus expected provider usage replay conflict');
    /* v8 ignore stop @preserve */
    if (existing === undefined && expectedCalls.size >= 60)
      throw new Error('Matrix corpus expected provider usage limit exceeded');
    expectedCalls.set(key, structuredClone(context));
  };
  return {
    registerExpectedProviderCall(context): void {
      registerExpected(context);
    },
    async recordProviderCall(call): Promise<void> {
      registerExpected(call.context);
      assertProviderContext(input, call.context);
      if (
        call.modelId !== input.expectedModelId ||
        !isSafeTokenCount(call.inputTokens) ||
        !isSafeTokenCount(call.outputTokens) ||
        !isSafeTokenCount(call.totalTokens) ||
        call.totalTokens !== call.inputTokens + call.outputTokens ||
        call.providerReportedUsd === undefined
      ) {
        throw new Error('Matrix corpus provider usage correlation rejected');
      }
      const cost = usdDecimalToNanoUsd(call.providerReportedUsd);
      if (!cost.ok) throw new Error('Matrix corpus provider cost rejected');
      const key = providerCallKey(call.context);
      const existing = actualCalls.get(key);
      if (existing !== undefined) {
        if (stableJson(existing) !== stableJson(call))
          throw new Error('Matrix corpus provider usage replay conflict');
        return;
      }
      /* v8 ignore start -- schema: a sixty-first actual call cannot be admitted because registerExpected caps the identical provider-call keyspace first @preserve */
      if (actualCalls.size >= 60) throw new Error('Matrix corpus provider usage limit exceeded');
      /* v8 ignore stop @preserve */
      const eventId = deterministicId(
        'imc_usage',
        input.ingestReceiptId,
        `${call.context.stage}:${String(call.context.callOrdinal)}`
      );
      const appended = await input.sessionRepository.appendMatrixCorpusEvent({
        identity: input.identity,
        event: {
          id: eventId,
          sessionId: input.identity.sessionId,
          userId: input.identity.userId,
          type: 'llm_call_usage',
          payload: {
            turnIndex: call.context.turnIndex,
            stage: call.context.stage,
            callOrdinal: call.context.callOrdinal,
            inputTokens: call.inputTokens,
            outputTokens: call.outputTokens,
            totalTokens: call.totalTokens,
            costNanoUsd: cost.value,
          },
          createdAt: input.createdAt,
        },
        now: input.createdAt,
      });
      if (!appended.ok) throw new Error('Matrix corpus provider usage persistence failed');
      actualCalls.set(key, structuredClone(call));
    },
    async finalize(phase, status): Promise<void> {
      const projectedExpectedCalls =
        status === 'complete'
          ? [...expectedCalls.values()]
          : [...actualCalls.values()].map((call) => call.context);
      const projection = projectMatrixCorpusUsage({
        identity: {
          runId: input.identity.runId,
          scenarioId: input.identity.scenarioId,
          sessionId: input.identity.sessionId,
          turnIndex: input.turnIndex,
          modelId: input.expectedModelId,
        },
        phase: status === 'failed' ? 'natural' : phase,
        expectedCalls: projectedExpectedCalls.map((context) => ({
          stage: context.stage,
          callOrdinal: context.callOrdinal,
        })),
        calls: [...actualCalls.values()].map((call) => ({
          ...call,
          providerReportedUsd: call.providerReportedUsd,
        })),
      });
      if (!projection.ok) throw new Error('Matrix corpus provider usage projection rejected');
      const appended = await input.sessionRepository.appendMatrixCorpusEvent({
        identity: input.identity,
        event: {
          id: deterministicId('imc_usage_summary', input.ingestReceiptId, 'turn'),
          sessionId: input.identity.sessionId,
          userId: input.identity.userId,
          type: 'llm_usage_summary',
          payload: {
            turnIndex: input.turnIndex,
            status,
            expectedCallCount: expectedCalls.size,
            reportedCallCount: actualCalls.size,
            ...projection.totals,
          },
          createdAt: input.createdAt,
        },
        now: input.createdAt,
      });
      if (!appended.ok) throw new Error('Matrix corpus provider usage summary persistence failed');
    },
  };
}

function assertProviderContext(
  input: Readonly<{
    identity: MatrixCorpusSessionIdentity;
    turnIndex: number;
  }>,
  context: MatrixCorpusLlmCallContextV1
): void {
  if (
    context.runId !== input.identity.runId ||
    context.scenarioId !== input.identity.scenarioId ||
    context.sessionId !== input.identity.sessionId ||
    context.turnIndex !== input.turnIndex ||
    !Number.isSafeInteger(context.callOrdinal) ||
    context.callOrdinal < 1 ||
    context.callOrdinal > 60
  )
    throw new Error('Matrix corpus provider usage context rejected');
}

function providerCallKey(context: MatrixCorpusLlmCallContextV1): string {
  return `${context.stage}:${String(context.callOrdinal)}`;
}

function isSafeTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}
