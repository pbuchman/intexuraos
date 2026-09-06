import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { GenerateChatResult } from '@intexuraos/llm-factory';
import type {
  ConversationAssistantOperationalTelemetry,
  ConversationAssistantTelemetryInput,
  ConversationAssistantTelemetryOperation,
  ConversationAssistantTelemetryOutcome,
} from './operationalTelemetry.js';
import type {
  ClaimConversationAssistantTurnRequestRecoveryResult,
  ClaimConversationAssistantTurnRequestRetryResult,
  ConversationAssistantTurnRequest,
  ConversationAssistantTurnRequestPromptSnapshot,
  ConversationAssistantTurnRequestRepository,
  ConversationAssistantTurnRequestRunner,
  StartConversationAssistantTurnRequestRepositoryResult,
  TurnRequestConversationTurn,
} from './turnRequestPorts.js';
import { isLatestRetryableConversationAssistantAnswer } from './answerRetryCapability.js';

const TURN_REQUEST_LEASE_MS = 5 * 60 * 1000;
const TURN_REQUEST_HEARTBEAT_MS = TURN_REQUEST_LEASE_MS / 3;
const PUBLIC_MODEL_FAILURE_MESSAGE = 'The answer could not be generated';
const PERSISTED_MODEL_FAILURE_TEXT = 'I could not generate the answer. Try answer again.';

export interface ConversationAssistantTurnRequestClock {
  now(): string;
}

export interface ConversationAssistantTurnRequestIds {
  claimId(): string;
}

export interface ConversationAssistantTurnRequestHeartbeat {
  every(intervalMs: number, task: () => Promise<void>): () => void;
}

export const conversationAssistantTurnRequestSystemHeartbeat: ConversationAssistantTurnRequestHeartbeat = {
  every(intervalMs, task): () => void {
    const timer = setInterval(() => void task(), intervalMs);
    return () => {
      clearInterval(timer);
    };
  },
};

export interface ConversationAssistantTurnRequestDeps {
  repository: ConversationAssistantTurnRequestRepository;
  runner: ConversationAssistantTurnRequestRunner;
  telemetry: ConversationAssistantOperationalTelemetry;
  clock: ConversationAssistantTurnRequestClock;
  ids: ConversationAssistantTurnRequestIds;
  heartbeat: ConversationAssistantTurnRequestHeartbeat;
}

export interface StartConversationAssistantTurnRequestInput {
  userId: string;
  sessionId: string;
  requestId: string;
  question: string;
  contextAttachmentId?: string;
  confirmationToken?: string;
}

export interface RetryConversationAssistantTurnRequestAnswerInput {
  userId: string;
  sessionId: string;
  requestId: string;
}

export interface GetConversationAssistantTurnRequestInput {
  userId: string;
  sessionId: string;
  requestId: string;
}

export type ResumeConversationAssistantTurnRequestInput =
  GetConversationAssistantTurnRequestInput;

export interface GetConversationAssistantTurnRequestResult {
  request: PublicConversationAssistantTurnRequest;
  turns: TurnRequestConversationTurn[];
  canRetryAnswer: boolean;
}

export type ConversationAssistantTurnRequestErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'REQUEST_BODY_CONFLICT'
  | 'TURN_IN_PROGRESS'
  | 'CONTEXT_STALE'
  | 'ATTACHMENT_NOT_READY'
  | 'CONFIRMATION_REQUIRED'
  | 'CONTEXT_WINDOW_EXCEEDED'
  | 'ANSWER_RETRY_UNAVAILABLE'
  | 'REQUEST_STALE'
  | 'INTERNAL_ERROR';

export interface ConversationAssistantTurnRequestError {
  code: ConversationAssistantTurnRequestErrorCode;
  message: string;
}

export interface PublicConversationAssistantTurnRequest {
  id: string;
  sessionId: string;
  status: ConversationAssistantTurnRequest['status'];
  attempt: number;
  stateVersion: number;
  conversationRevision: number;
  contextAttachmentId?: string;
  completedAt?: string;
  error?: { code: string; message: string };
}

interface StreamEventBase {
  requestId: string;
  streamSequence: number;
}

export type ConversationAssistantTurnRequestStreamEvent =
  | (StreamEventBase & {
      type: 'request_state';
      request: PublicConversationAssistantTurnRequest;
    })
  | (StreamEventBase & { type: 'context_attached'; attachmentId: string })
  | (StreamEventBase & { type: 'user_turn'; turn: TurnRequestConversationTurn })
  | (StreamEventBase & { type: 'assistant_delta'; text: string })
  | (StreamEventBase & { type: 'usage'; usage: GenerateChatResult['usage'] })
  | (StreamEventBase & {
      type: 'assistant_turn';
      turn: TurnRequestConversationTurn;
      canRetryAnswer: boolean;
    })
  | (StreamEventBase & { type: 'done' });

export interface ConversationAssistantTurnRequestExecutionResult {
  request: PublicConversationAssistantTurnRequest;
  userTurn: TurnRequestConversationTurn;
  assistantTurn?: TurnRequestConversationTurn;
  canRetryAnswer: boolean;
}

type TurnRequestResult = Result<
  ConversationAssistantTurnRequestExecutionResult,
  ConversationAssistantTurnRequestError
>;

export async function startConversationAssistantTurnRequest(
  input: StartConversationAssistantTurnRequestInput,
  deps: ConversationAssistantTurnRequestDeps,
  onEvent: (event: ConversationAssistantTurnRequestStreamEvent) => void
): Promise<TurnRequestResult> {
  const normalized = normalizeStartInput(input);
  if (!normalized.ok) {
    await recordTelemetry(deps.telemetry, 'turn_request', 'rejected');
    return normalized;
  }

  const now = deps.clock.now();
  let started: StartConversationAssistantTurnRequestRepositoryResult;
  try {
    started = await deps.repository.startTurnRequest({
      ...normalized.value,
      requestFingerprint: createTurnRequestFingerprint(normalized.value),
      claimId: deps.ids.claimId(),
      now,
      leaseExpiresAt: leaseExpiry(now),
    });
  } catch {
    await recordTelemetry(deps.telemetry, 'turn_request', 'failed');
    return err(internalTurnRequestError());
  }
  if (started.status === 'replay') {
    await recordTelemetry(deps.telemetry, 'turn_request', 'replay');
    return replayTurnRequest(started, onEvent, deps.telemetry, deps.clock.now());
  }
  if (started.status !== 'claimed') {
    await recordTelemetry(
      deps.telemetry,
      'turn_request',
      startRepositoryOutcome(started.status),
      startRepositoryMeasurements(started.status)
    );
    return err(mapStartError(started.status));
  }
  let result: TurnRequestResult;
  try {
    result = await executeClaimedTurnRequest(
      started.request,
      started.userTurn,
      deps,
      onEvent,
      true
    );
  } catch {
    result = err(internalTurnRequestError());
  }
  await recordTelemetry(
    deps.telemetry,
    'turn_request',
    executionOutcome(result),
    promptBudgetMeasurements(result)
  );
  return result;
}

export async function retryConversationAssistantTurnRequestAnswer(
  input: RetryConversationAssistantTurnRequestAnswerInput,
  deps: ConversationAssistantTurnRequestDeps,
  onEvent: (event: ConversationAssistantTurnRequestStreamEvent) => void
): Promise<TurnRequestResult> {
  const userId = input.userId.trim();
  const sessionId = input.sessionId.trim();
  const requestId = input.requestId.trim();
  if (userId === '' || sessionId === '' || requestId === '') {
    await recordTelemetry(deps.telemetry, 'answer_retry', 'rejected');
    return err({ code: 'INVALID_REQUEST', message: 'Request id is required' });
  }
  const now = deps.clock.now();
  let claimed: ClaimConversationAssistantTurnRequestRetryResult;
  try {
    claimed = await deps.repository.claimAnswerRetry({
      userId,
      sessionId,
      requestId,
      claimId: deps.ids.claimId(),
      now,
      leaseExpiresAt: leaseExpiry(now),
    });
  } catch {
    await recordTelemetry(deps.telemetry, 'answer_retry', 'failed');
    return err(internalTurnRequestError());
  }
  if (claimed.status === 'replay') {
    await recordTelemetry(deps.telemetry, 'answer_retry', 'replay');
    return replayTurnRequest(claimed, onEvent, deps.telemetry, deps.clock.now());
  }
  if (claimed.status !== 'claimed') {
    await recordTelemetry(
      deps.telemetry,
      'answer_retry',
      claimed.status === 'busy' ? 'conflict' : 'rejected'
    );
    return err(mapRetryError(claimed.status));
  }
  let result: TurnRequestResult;
  try {
    result = await executeClaimedTurnRequest(
      claimed.request,
      claimed.userTurn,
      deps,
      onEvent,
      false
    );
  } catch {
    result = err(internalTurnRequestError());
  }
  await recordTelemetry(
    deps.telemetry,
    'answer_retry',
    executionOutcome(result),
    promptBudgetMeasurements(result)
  );
  return result;
}

export async function resumeConversationAssistantTurnRequest(
  input: ResumeConversationAssistantTurnRequestInput,
  deps: ConversationAssistantTurnRequestDeps,
  onEvent: (event: ConversationAssistantTurnRequestStreamEvent) => void
): Promise<TurnRequestResult> {
  const userId = input.userId.trim();
  const sessionId = input.sessionId.trim();
  const requestId = input.requestId.trim();
  if (userId === '' || sessionId === '' || requestId === '') {
    return err({ code: 'INVALID_REQUEST', message: 'Request id is required' });
  }
  const now = deps.clock.now();
  let claimed: ClaimConversationAssistantTurnRequestRecoveryResult;
  try {
    claimed = await deps.repository.claimTurnRequestRecovery({
      userId,
      sessionId,
      requestId,
      claimId: deps.ids.claimId(),
      now,
      leaseExpiresAt: leaseExpiry(now),
    });
  } catch {
    await recordTelemetry(deps.telemetry, 'turn_request', 'failed');
    return err(internalTurnRequestError());
  }
  if (claimed.status === 'replay') {
    await recordTelemetry(deps.telemetry, 'turn_request', 'replay');
    return replayTurnRequest(claimed, onEvent, deps.telemetry, deps.clock.now());
  }
  if (claimed.status !== 'claimed') {
    await recordTelemetry(
      deps.telemetry,
      'turn_request',
      claimed.status === 'busy' ? 'conflict' : 'rejected'
    );
    return err(
      claimed.status === 'busy'
        ? { code: 'TURN_IN_PROGRESS', message: 'Another answer request is still in progress' }
        : { code: 'NOT_FOUND', message: 'Conversation Assistant answer request not found' }
    );
  }
  const result = await executeClaimedTurnRequest(
    claimed.request,
    claimed.userTurn,
    deps,
    onEvent,
    false
  ).catch(() => err(internalTurnRequestError()));
  await recordTelemetry(
    deps.telemetry,
    'turn_request',
    result.ok ? 'lease_recovered' : executionOutcome(result),
    promptBudgetMeasurements(result)
  );
  return result;
}

export async function getConversationAssistantTurnRequest(
  input: GetConversationAssistantTurnRequestInput,
  deps: ConversationAssistantTurnRequestDeps
): Promise<
  Result<GetConversationAssistantTurnRequestResult, ConversationAssistantTurnRequestError>
> {
  const userId = input.userId.trim();
  const sessionId = input.sessionId.trim();
  const requestId = input.requestId.trim();
  if (userId === '' || sessionId === '' || requestId === '') {
    return err({ code: 'INVALID_REQUEST', message: 'Request id is required' });
  }
  const stored = await deps.repository.getTurnRequest({ userId, sessionId, requestId });
  if (stored.status === 'not_found') {
    return err({ code: 'NOT_FOUND', message: 'Conversation Assistant answer request not found' });
  }
  return ok({
    request: toPublicTurnRequest(stored.request),
    turns: [
      stored.userTurn,
      ...(stored.assistantTurn === undefined ? [] : [stored.assistantTurn]),
    ],
    canRetryAnswer: isLatestRetryableConversationAssistantAnswer({
      failed: stored.request.status === 'failed',
      errorCode: stored.request.error?.code,
      conversationRevision: stored.request.conversationRevision,
      completedConversationRevision: stored.completedConversationRevision,
      activeTurnRequestId: stored.activeTurnRequestId,
      activeTurnLeaseExpiresAt: stored.activeTurnLeaseExpiresAt,
      now: deps.clock.now(),
    }),
  });
}

async function executeClaimedTurnRequest(
  request: ConversationAssistantTurnRequest,
  userTurn: TurnRequestConversationTurn,
  deps: ConversationAssistantTurnRequestDeps,
  onEvent: (event: ConversationAssistantTurnRequestStreamEvent) => void,
  emitCommittedBoundary: boolean
): Promise<TurnRequestResult> {
  const answerExecutionStartedAt = performance.now();
  let recordedFirstModelDelta = false;
  const emitter = createSafeEmitter(request.id, onEvent, deps.telemetry);
  emitter.emit({ type: 'request_state', request: toPublicTurnRequest(request) });
  if (emitCommittedBoundary) {
    if (request.contextAttachmentId !== undefined) {
      emitter.emit({ type: 'context_attached', attachmentId: request.contextAttachmentId });
    }
    emitter.emit({ type: 'user_turn', turn: userTurn });
  }
  const lease = createTurnRequestLeaseGuard(request, deps);
  if (!(await lease.start())) {
    return err(staleTurnRequestError());
  }

  try {
    if (request.acknowledgment !== '') {
      emitter.emit({ type: 'assistant_delta', text: `${request.acknowledgment}\n\n` });
    }
    const prompt = await deps.repository.loadPromptSnapshot({
      userId: request.userId,
      sessionId: request.sessionId,
      requestId: request.id,
      expectedSessionGenerationId: request.sessionGenerationId,
      attempt: request.attempt,
      claimId: request.claimId,
      now: deps.clock.now(),
    });
    if (prompt.status !== 'found') {
      return err(
        prompt.status === 'stale'
          ? staleTurnRequestError()
          : { code: 'NOT_FOUND', message: 'Conversation Assistant answer request not found' }
      );
    }

    const generated = await generateSafely(deps.runner, prompt.snapshot, (text) => {
      if (text !== '' && lease.canEmit()) {
        if (!recordedFirstModelDelta) {
          recordedFirstModelDelta = true;
          recordTelemetryDetached(deps.telemetry, 'model_first_delta', 'completed', {
            timeToFirstDeltaMs: performance.now() - answerExecutionStartedAt,
          });
        }
        emitter.emit({ type: 'assistant_delta', text });
      }
    });
    if (!(await lease.verifyBeforeFinalize())) {
      return err(staleTurnRequestError());
    }
    if (!generated.ok) {
      const contextWindowExceeded = generated.error.code === 'CONTEXT_WINDOW_EXCEEDED';
      const failed = await deps.repository.failTurnRequest({
        userId: request.userId,
        sessionId: request.sessionId,
        requestId: request.id,
        expectedSessionGenerationId: request.sessionGenerationId,
        attempt: request.attempt,
        claimId: request.claimId,
        errorBodyText: contextWindowExceeded
          ? generated.error.message
          : PERSISTED_MODEL_FAILURE_TEXT,
        error: { code: contextWindowExceeded ? 'CONTEXT_WINDOW_EXCEEDED' : 'LLM_ERROR' },
        publicErrorMessage: contextWindowExceeded
          ? generated.error.message
          : PUBLIC_MODEL_FAILURE_MESSAGE,
        completedAt: deps.clock.now(),
      });
      if (contextWindowExceeded) {
        if (!('request' in failed)) return finalizeAndEmit(failed, userTurn, emitter);
        return err({
          code: 'CONTEXT_WINDOW_EXCEEDED',
          message: generated.error.message,
        });
      }
      return finalizeAndEmit(failed, userTurn, emitter);
    }

    const completedInput = {
      userId: request.userId,
      sessionId: request.sessionId,
      requestId: request.id,
      expectedSessionGenerationId: request.sessionGenerationId,
      attempt: request.attempt,
      claimId: request.claimId,
      answerText: generated.value.text,
      completedAt: deps.clock.now(),
      ...(generated.value.usage === undefined ? {} : { usage: generated.value.usage }),
    };
    const completed = await deps.repository.completeTurnRequest(completedInput);
    if ('request' in completed && generated.value.usage !== undefined) {
      emitter.emit({ type: 'usage', usage: generated.value.usage });
    }
    return finalizeAndEmit(completed, userTurn, emitter);
  } finally {
    await lease.stop();
  }
}

interface TurnRequestLeaseGuard {
  start(): Promise<boolean>;
  canEmit(): boolean;
  verifyBeforeFinalize(): Promise<boolean>;
  stop(): Promise<void>;
}

function createTurnRequestLeaseGuard(
  request: ConversationAssistantTurnRequest,
  deps: ConversationAssistantTurnRequestDeps
): TurnRequestLeaseGuard {
  let owned = true;
  let leaseExpiresAt = request.leaseExpiresAt;
  let cancelHeartbeat: (() => void) | undefined;
  let renewal: Promise<void> | undefined;

  const renew = async (): Promise<boolean> => {
    if (!owned) return false;
    const now = deps.clock.now();
    if (leaseExpiresAt <= now) {
      owned = false;
      return false;
    }
    if (renewal !== undefined) {
      await renewal;
      return owned;
    }
    renewal = (async (): Promise<void> => {
      try {
        const result = await deps.repository.renewTurnRequestLease({
          userId: request.userId,
          sessionId: request.sessionId,
          requestId: request.id,
          expectedSessionGenerationId: request.sessionGenerationId,
          attempt: request.attempt,
          claimId: request.claimId,
          now,
          leaseExpiresAt: leaseExpiry(now),
        });
        if (result.status === 'renewed') {
          leaseExpiresAt = result.request.leaseExpiresAt;
        } else {
          owned = false;
        }
      } catch {
        owned = false;
      } finally {
        renewal = undefined;
      }
    })();
    await renewal;
    return owned;
  };

  const cancel = (): void => {
    cancelHeartbeat?.();
    cancelHeartbeat = undefined;
  };

  return {
    async start(): Promise<boolean> {
      if (!(await renew())) return false;
      cancelHeartbeat = deps.heartbeat.every(TURN_REQUEST_HEARTBEAT_MS, async () => {
        await renew();
      });
      return true;
    },
    canEmit(): boolean {
      if (leaseExpiresAt <= deps.clock.now()) owned = false;
      return owned;
    },
    async verifyBeforeFinalize(): Promise<boolean> {
      cancel();
      if (renewal !== undefined) await renewal;
      return await renew();
    },
    async stop(): Promise<void> {
      cancel();
      await renewal;
    },
  };
}

async function generateSafely(
  runner: ConversationAssistantTurnRequestRunner,
  snapshot: ConversationAssistantTurnRequestPromptSnapshot,
  onDelta: (text: string) => void
): ReturnType<ConversationAssistantTurnRequestRunner['generateAnswer']> {
  try {
    return await runner.generateAnswer(snapshot, onDelta);
  } catch {
    return err({ code: 'LLM_ERROR', message: PUBLIC_MODEL_FAILURE_MESSAGE });
  }
}

function finalizeAndEmit(
  finalized: Awaited<
    ReturnType<
      | ConversationAssistantTurnRequestRepository['completeTurnRequest']
      | ConversationAssistantTurnRequestRepository['failTurnRequest']
    >
  >,
  userTurn: TurnRequestConversationTurn,
  emitter: SafeEventEmitter
): TurnRequestResult {
  if (!('request' in finalized)) {
    return finalized.status === 'stale'
      ? err({ code: 'REQUEST_STALE', message: 'The answer request lease is no longer owned' })
      : err({ code: 'NOT_FOUND', message: 'Conversation Assistant answer request not found' });
  }
  const canRetryAnswer = isLatestRetryableConversationAssistantAnswer({
    failed: finalized.request.status === 'failed',
    errorCode: finalized.request.error?.code,
    conversationRevision: finalized.request.conversationRevision,
    completedConversationRevision: finalized.request.conversationRevision,
    activeTurnRequestId: undefined,
    activeTurnLeaseExpiresAt: undefined,
    now: finalized.request.completedAt ?? finalized.request.updatedAt,
  });
  emitter.emit({ type: 'request_state', request: toPublicTurnRequest(finalized.request) });
  emitter.emit({ type: 'assistant_turn', turn: finalized.assistantTurn, canRetryAnswer });
  emitter.emit({ type: 'done' });
  return ok({
    request: toPublicTurnRequest(finalized.request),
    userTurn,
    assistantTurn: finalized.assistantTurn,
    canRetryAnswer,
  });
}

function replayTurnRequest(
  replay: Extract<
    | StartConversationAssistantTurnRequestRepositoryResult
    | ClaimConversationAssistantTurnRequestRecoveryResult
    | ClaimConversationAssistantTurnRequestRetryResult,
    { status: 'replay' }
  >,
  onEvent: (event: ConversationAssistantTurnRequestStreamEvent) => void,
  telemetry: ConversationAssistantOperationalTelemetry,
  now: string
): TurnRequestResult {
  const emitter = createSafeEmitter(replay.request.id, onEvent, telemetry);
  const canRetryAnswer = isLatestRetryableConversationAssistantAnswer({
    failed: replay.request.status === 'failed',
    errorCode: replay.request.error?.code,
    conversationRevision: replay.request.conversationRevision,
    completedConversationRevision: replay.completedConversationRevision,
    activeTurnRequestId: replay.activeTurnRequestId,
    activeTurnLeaseExpiresAt: replay.activeTurnLeaseExpiresAt,
    now,
  });
  emitter.emit({ type: 'request_state', request: toPublicTurnRequest(replay.request) });
  if (replay.request.contextAttachmentId !== undefined) {
    emitter.emit({
      type: 'context_attached',
      attachmentId: replay.request.contextAttachmentId,
    });
  }
  emitter.emit({ type: 'user_turn', turn: replay.userTurn });
  if (replay.assistantTurn !== undefined) {
    emitter.emit({ type: 'assistant_turn', turn: replay.assistantTurn, canRetryAnswer });
  }
  if (replay.request.status !== 'in_progress') {
    emitter.emit({ type: 'done' });
  }
  return ok({
    request: toPublicTurnRequest(replay.request),
    userTurn: replay.userTurn,
    ...(replay.assistantTurn === undefined ? {} : { assistantTurn: replay.assistantTurn }),
    canRetryAnswer,
  });
}

function createTurnRequestFingerprint(input: {
  userId: string;
  sessionId: string;
  requestId: string;
  question: string;
  contextAttachmentId?: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        userId: input.userId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        question: input.question,
        contextAttachmentId: input.contextAttachmentId ?? null,
      })
    )
    .digest('hex');
}

function normalizeStartInput(
  input: StartConversationAssistantTurnRequestInput
): Result<
  {
    userId: string;
    sessionId: string;
    requestId: string;
    question: string;
    contextAttachmentId?: string;
    confirmationToken?: string;
  },
  ConversationAssistantTurnRequestError
> {
  const userId = input.userId.trim();
  const sessionId = input.sessionId.trim();
  const requestId = input.requestId.trim();
  const question = input.question.trim();
  const contextAttachmentId = input.contextAttachmentId?.trim();
  const confirmationToken = input.confirmationToken?.trim();
  if (userId === '' || sessionId === '' || requestId === '' || question === '') {
    return err({ code: 'INVALID_REQUEST', message: 'Request id and question are required' });
  }
  if (requestId.length > 128 || contextAttachmentId === '' || confirmationToken === '') {
    return err({ code: 'INVALID_REQUEST', message: 'Invalid answer request' });
  }
  return ok({
    userId,
    sessionId,
    requestId,
    question,
    ...(contextAttachmentId === undefined ? {} : { contextAttachmentId }),
    ...(confirmationToken === undefined ? {} : { confirmationToken }),
  });
}

function mapStartError(
  status: Exclude<
    StartConversationAssistantTurnRequestRepositoryResult['status'],
    'claimed' | 'replay'
  >
): ConversationAssistantTurnRequestError {
  switch (status) {
    case 'conflict':
      return { code: 'REQUEST_BODY_CONFLICT', message: 'Request id was already used' };
    case 'active_request':
      return { code: 'TURN_IN_PROGRESS', message: 'Another answer is still in progress' };
    case 'attachment_stale':
      return { code: 'CONTEXT_STALE', message: 'The context attachment is stale' };
    case 'attachment_not_ready':
      return { code: 'ATTACHMENT_NOT_READY', message: 'The context attachment is not ready' };
    case 'confirmation_required':
      return { code: 'CONFIRMATION_REQUIRED', message: 'Confirm the large context first' };
    case 'context_window_exceeded':
      return {
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'This update is too large to include in one question.',
      };
    case 'not_found':
      return { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' };
  }
}

function mapRetryError(
  status: Exclude<ClaimConversationAssistantTurnRequestRetryResult['status'], 'claimed' | 'replay'>
): ConversationAssistantTurnRequestError {
  if (status === 'not_found') {
    return { code: 'NOT_FOUND', message: 'Conversation Assistant answer request not found' };
  }
  if (status === 'busy') {
    return { code: 'TURN_IN_PROGRESS', message: 'The answer retry is already in progress' };
  }
  return {
    code: 'ANSWER_RETRY_UNAVAILABLE',
    message: 'Only a failed answer can be retried',
  };
}

function leaseExpiry(now: string): string {
  return new Date(Date.parse(now) + TURN_REQUEST_LEASE_MS).toISOString();
}

function internalTurnRequestError(): ConversationAssistantTurnRequestError {
  return {
    code: 'INTERNAL_ERROR',
    message: 'Conversation Assistant answer request failed',
  };
}

function staleTurnRequestError(): ConversationAssistantTurnRequestError {
  return {
    code: 'REQUEST_STALE',
    message: 'The answer request lease is no longer owned',
  };
}

function toPublicTurnRequest(
  request: ConversationAssistantTurnRequest
): PublicConversationAssistantTurnRequest {
  return {
    id: request.id,
    sessionId: request.sessionId,
    status: request.status,
    attempt: request.attempt,
    stateVersion: request.stateVersion,
    conversationRevision: request.conversationRevision,
    ...(request.contextAttachmentId === undefined
      ? {}
      : { contextAttachmentId: request.contextAttachmentId }),
    ...(request.completedAt === undefined ? {} : { completedAt: request.completedAt }),
    ...(request.error === undefined ? {} : { error: { ...request.error } }),
  };
}

interface SafeEventEmitter {
  emit(event: StreamEventPayload): void;
}

type StreamEventPayload = ConversationAssistantTurnRequestStreamEvent extends infer Event
  ? Event extends ConversationAssistantTurnRequestStreamEvent
    ? Omit<Event, 'requestId' | 'streamSequence'>
    : never
  : never;

function createSafeEmitter(
  requestId: string,
  sink: (event: ConversationAssistantTurnRequestStreamEvent) => void,
  telemetry: ConversationAssistantOperationalTelemetry
): SafeEventEmitter {
  let sequence = 0;
  let connected = true;
  return {
    emit(event): void {
      if (!connected) return;
      sequence += 1;
      try {
        sink({ ...event, requestId, streamSequence: sequence } as ConversationAssistantTurnRequestStreamEvent);
      } catch {
        connected = false;
        recordTelemetryDetached(telemetry, 'sse_disconnect', 'disconnected');
      }
    },
  };
}

function startRepositoryOutcome(
  status: Exclude<
    StartConversationAssistantTurnRequestRepositoryResult['status'],
    'claimed' | 'replay'
  >
): ConversationAssistantTelemetryOutcome {
  if (status === 'conflict' || status === 'active_request') return 'conflict';
  if (status === 'attachment_stale') return 'stale';
  return 'rejected';
}

function executionOutcome(result: TurnRequestResult): ConversationAssistantTelemetryOutcome {
  if (result.ok) {
    return result.value.request.status === 'failed' ? 'failed' : 'completed';
  }
  if (result.error.code === 'REQUEST_STALE' || result.error.code === 'CONTEXT_STALE') {
    return 'stale';
  }
  return result.error.code === 'INTERNAL_ERROR' ? 'failed' : 'rejected';
}

type TurnTelemetryMeasurements = Pick<
  ConversationAssistantTelemetryInput,
  'promptBudgetRejectionCount' | 'timeToFirstDeltaMs' | 'twoTabConflictCount'
>;

function startRepositoryMeasurements(
  status: Exclude<
    StartConversationAssistantTurnRequestRepositoryResult['status'],
    'claimed' | 'replay'
  >
): TurnTelemetryMeasurements {
  if (status === 'context_window_exceeded') return { promptBudgetRejectionCount: 1 };
  if (status === 'active_request' || status === 'attachment_stale') {
    return { twoTabConflictCount: 1 };
  }
  return {};
}

function promptBudgetMeasurements(result: TurnRequestResult): TurnTelemetryMeasurements {
  return !result.ok && result.error.code === 'CONTEXT_WINDOW_EXCEEDED'
    ? { promptBudgetRejectionCount: 1 }
    : {};
}

async function recordTelemetry(
  telemetry: ConversationAssistantOperationalTelemetry,
  operation: ConversationAssistantTelemetryOperation,
  outcome: ConversationAssistantTelemetryOutcome,
  measurements: TurnTelemetryMeasurements = {}
): Promise<void> {
  try {
    await telemetry.record({ operation, outcome, ...measurements });
  } catch {
    // Metrics must never affect durable request execution.
  }
}

function recordTelemetryDetached(
  telemetry: ConversationAssistantOperationalTelemetry,
  operation: ConversationAssistantTelemetryOperation,
  outcome: ConversationAssistantTelemetryOutcome,
  measurements: TurnTelemetryMeasurements = {}
): void {
  void recordTelemetry(telemetry, operation, outcome, measurements);
}
