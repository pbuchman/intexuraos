import {
  createWhatsAppServiceClient,
  type InternalHttpClientLogger,
  type SendPrivateOutboundMatrixMessageRequest,
  type WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { JudgeMatrixSmokeReply, MiniMaxJudgeVerdict } from '../minimaxJudge.js';
import {
  WHATSAPP_SERVICE_BASE_URL,
  createProductionSetupPorts,
  withValidatedAccountContext,
  type ValidatedAccountContext,
  type ValidatedAccountContextResult,
} from '../preflight.js';
import type { JudgeInfrastructureCode, JudgeUsageSummary } from '../runEndpointScenario.js';
import {
  isWhatsAppPuppetSender,
  type MatrixClient,
  type MatrixTimelineEvent,
} from './matrixClient.js';

export const MATRIX_SMOKE_REPLY_TIMEOUT_MS = 120_000;
export const MATRIX_SYNC_POLL_TIMEOUT_MS = 30_000;

export const MATRIX_SMOKE_FAILURE_CODES = [
  'MATRIX_ACCOUNT_CONTEXT_FAILED',
  'MATRIX_CURSOR_CAPTURE_FAILED',
  'MATRIX_OUTBOUND_NOT_READY',
  'MATRIX_OUTBOUND_SEND_FAILED',
  'MATRIX_SYNC_FAILED',
  'MATRIX_SYNC_INVALID',
  'MATRIX_TIMELINE_LIMITED',
  'MATRIX_REPLY_TIMEOUT',
  'MINIMAX_JUDGE_KEY_MISSING',
  'MINIMAX_JUDGE_TIMEOUT',
  'MINIMAX_JUDGE_PROVIDER_FAILED',
  'MINIMAX_JUDGE_INVALID_OUTPUT',
  'MINIMAX_JUDGE_USAGE_INVALID',
  'MATRIX_UNEXPECTED_FAILURE',
] as const;

export type MatrixSmokeFailureCode = (typeof MATRIX_SMOKE_FAILURE_CODES)[number];

export type MatrixSmokeJudgeResult =
  | { status: 'not_run' }
  | {
      status: 'completed';
      verdict: Omit<MiniMaxJudgeVerdict, 'rationale'>;
      usage: JudgeUsageSummary;
    }
  | {
      status: 'infrastructure_failure';
      code: JudgeInfrastructureCode;
      usage: JudgeUsageSummary;
    };

export interface MatrixSmokeResult {
  effectiveKind: 'passed' | 'behavioral_failure' | 'infrastructure_failure';
  exitCode: 0 | 1 | 2;
  failureCodes: readonly MatrixSmokeFailureCode[];
  transportFacts: {
    cursorCaptured: boolean;
    outboundSent: boolean;
    eligiblePuppetTextObserved: boolean;
    hiddenToolAudit: 'not_available';
  };
  judge: MatrixSmokeJudgeResult;
  durationMs: number;
}

export interface RunMatrixSmokeDependencies {
  withAccountContext(
    callback: (context: ValidatedAccountContext) => Promise<void>
  ): Promise<ValidatedAccountContextResult>;
  matrix: MatrixClient;
  whatsapp: Pick<WhatsAppServiceClient, 'sendPrivateOutboundMatrixMessage'>;
  judgeMatrixSmokeReply: JudgeMatrixSmokeReply;
  createUuid(): string;
  nowMs(): number;
  timer: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
}

interface MutableTransportFacts {
  cursorCaptured: boolean;
  outboundSent: boolean;
  eligiblePuppetTextObserved: boolean;
}

type MatrixSmokeCoreResult = Omit<MatrixSmokeResult, 'durationMs'>;

const LOWERCASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const OutboundSendValueSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('sent'),
      matrixEventId: z
        .string()
        .min(1)
        .max(4_096)
        .refine((value) => value.trim() !== ''),
    })
    .strict(),
  z
    .object({
      status: z.literal('setup_required'),
      reason: z.string().min(1).max(8_192),
    })
    .strict(),
  z
    .object({
      status: z.literal('error'),
      message: z.string().min(1).max(8_192),
    })
    .strict(),
]);

const MATRIX_SMOKE_SEMANTIC_CRITERIA = [
  'understands that note content is missing',
  'asks the user for that content',
  'does not claim any save or other action completed',
  'is concise, clear, professional, and not passive-aggressive',
] as const;

const NO_OP_LOGGER: InternalHttpClientLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

export function buildSafeMatrixSmokePrompt(nonce: string): string {
  if (!LOWERCASE_UUID_PATTERN.test(nonce)) {
    throw new Error('Invalid Matrix smoke nonce');
  }
  return (
    `To jest automatyczny test ${nonce}. Rozważam utworzenie notatki, ale celowo nie ` +
    'podaję jej treści i nie zlecam jeszcze zapisu. Odpowiedz wyłącznie prośbą o ' +
    'brakującą treść. Nie zapisuj notatki, nie twórz ani nie zmieniaj kalendarza lub ' +
    'preferencji, nie uruchamiaj researchu ani kodu, nie zapisuj linku ani danych ' +
    'zewnętrznych i nie wykonuj żadnego narzędzia.'
  );
}

function snapshotTransportFacts(facts: MutableTransportFacts): MatrixSmokeResult['transportFacts'] {
  return {
    cursorCaptured: facts.cursorCaptured,
    outboundSent: facts.outboundSent,
    eligiblePuppetTextObserved: facts.eligiblePuppetTextObserved,
    hiddenToolAudit: 'not_available',
  };
}

function infrastructureFailure(
  code: MatrixSmokeFailureCode,
  facts: MutableTransportFacts,
  judge: MatrixSmokeJudgeResult = { status: 'not_run' }
): MatrixSmokeCoreResult {
  return {
    effectiveKind: 'infrastructure_failure',
    exitCode: 2,
    failureCodes: [code],
    transportFacts: snapshotTransportFacts(facts),
    judge,
  };
}

function privacySafeVerdict(verdict: MiniMaxJudgeVerdict): Omit<MiniMaxJudgeVerdict, 'rationale'> {
  return {
    pass: verdict.pass,
    score: verdict.score,
    criteria: {
      understoodIntent: verdict.criteria.understoodIntent,
      helpful: verdict.criteria.helpful,
      conciseAndClear: verdict.criteria.conciseAndClear,
      professionalTone: verdict.criteria.professionalTone,
      noPassiveAggression: verdict.criteria.noPassiveAggression,
    },
    failures: [...verdict.failures],
  };
}

function privacySafeUsage(usage: JudgeUsageSummary): JudgeUsageSummary | undefined {
  const projected: JudgeUsageSummary = {
    logicalCalls: usage.logicalCalls,
    repairCount: usage.repairCount,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    providerReportedUsd: usage.providerReportedUsd,
    providerReportedUsdComplete: usage.providerReportedUsdComplete,
  };
  if (
    !Number.isSafeInteger(projected.logicalCalls) ||
    projected.logicalCalls < 0 ||
    !Number.isSafeInteger(projected.repairCount) ||
    projected.repairCount < 0 ||
    projected.repairCount > projected.logicalCalls ||
    !Number.isSafeInteger(projected.inputTokens) ||
    projected.inputTokens < 0 ||
    !Number.isSafeInteger(projected.outputTokens) ||
    projected.outputTokens < 0 ||
    !Number.isSafeInteger(projected.totalTokens) ||
    projected.totalTokens < 0 ||
    !Number.isFinite(projected.providerReportedUsd) ||
    projected.providerReportedUsd < 0 ||
    typeof projected.providerReportedUsdComplete !== 'boolean'
  ) {
    return undefined;
  }
  return projected;
}

type ClosedOutboundResult = 'sent' | 'not_ready' | 'failed';

async function sendSafeOutbound(
  whatsapp: Pick<WhatsAppServiceClient, 'sendPrivateOutboundMatrixMessage'>,
  request: SendPrivateOutboundMatrixMessageRequest
): Promise<ClosedOutboundResult> {
  const sendResult = await whatsapp.sendPrivateOutboundMatrixMessage(request);
  if (!sendResult.ok) {
    return 'failed';
  }
  const outbound = OutboundSendValueSchema.safeParse(sendResult.value);
  if (!outbound.success) {
    return 'failed';
  }
  switch (outbound.data.status) {
    case 'sent':
      return 'sent';
    case 'setup_required':
      return 'not_ready';
    case 'error':
      return 'failed';
  }
}

type ClosedCaptureResult =
  | { ok: true; cursor: string }
  | {
      ok: false;
      code: 'MATRIX_CURSOR_CAPTURE_FAILED' | 'MATRIX_TIMELINE_LIMITED';
    };

async function captureMatrixCursor(
  context: ValidatedAccountContext,
  matrix: MatrixClient,
  timer: RunMatrixSmokeDependencies['timer']
): Promise<ClosedCaptureResult> {
  const controller = new AbortController();
  const timeout = timer.set(() => {
    controller.abort();
  }, MATRIX_SYNC_POLL_TIMEOUT_MS);
  let capture: Awaited<ReturnType<MatrixClient['syncTargetRoom']>>;
  try {
    capture = await matrix.syncTargetRoom({
      homeserverUrl: context.homeserverUrl,
      accessToken: context.accessToken,
      targetRoomId: context.targetRoomId,
      timeoutMs: 0,
      signal: controller.signal,
    });
  } finally {
    timer.clear(timeout);
  }
  if (controller.signal.aborted || !capture.ok) {
    return { ok: false, code: 'MATRIX_CURSOR_CAPTURE_FAILED' };
  }
  if (capture.limited) {
    return { ok: false, code: 'MATRIX_TIMELINE_LIMITED' };
  }
  return { ok: true, cursor: capture.nextBatch };
}

function selectedAssistantText(
  events: readonly MatrixTimelineEvent[],
  matrixUserId: string
): string | undefined {
  for (const event of events) {
    if (
      event.type !== 'm.room.message' ||
      event.sender === matrixUserId ||
      !isWhatsAppPuppetSender(event.sender) ||
      event.content?.msgtype !== 'm.text' ||
      event.content['m.relates_to']?.rel_type === 'm.replace' ||
      (event.unsigned !== undefined && Object.hasOwn(event.unsigned, 'redacted_because'))
    ) {
      continue;
    }
    const body = event.content.body?.trim();
    if (body !== undefined && body !== '') {
      return body;
    }
  }
  return undefined;
}

function isSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function executeRoundTrip(
  context: ValidatedAccountContext,
  prompt: string,
  uuid: string,
  dependencies: RunMatrixSmokeDependencies
): Promise<MatrixSmokeCoreResult> {
  const facts: MutableTransportFacts = {
    cursorCaptured: false,
    outboundSent: false,
    eligiblePuppetTextObserved: false,
  };
  try {
    const capture = await captureMatrixCursor(context, dependencies.matrix, dependencies.timer);
    if (!capture.ok) {
      return infrastructureFailure(capture.code, facts);
    }

    facts.cursorCaptured = true;
    let cursor = capture.cursor;
    const outbound = await sendSafeOutbound(dependencies.whatsapp, {
      userId: context.userId,
      text: prompt,
      startNewSession: true,
      idempotencyKey: `intex-agent-eval-matrix-${uuid}`,
    });
    if (outbound === 'not_ready') {
      return infrastructureFailure('MATRIX_OUTBOUND_NOT_READY', facts);
    }
    if (outbound === 'failed') {
      return infrastructureFailure('MATRIX_OUTBOUND_SEND_FAILED', facts);
    }
    facts.outboundSent = true;

    const replyController = new AbortController();
    const replyTimer = dependencies.timer.set(() => {
      replyController.abort();
    }, MATRIX_SMOKE_REPLY_TIMEOUT_MS);
    let assistantText: string | undefined;
    try {
      for (;;) {
        if (isSignalAborted(replyController.signal)) {
          return infrastructureFailure('MATRIX_REPLY_TIMEOUT', facts);
        }
        const sync = await dependencies.matrix.syncTargetRoom({
          homeserverUrl: context.homeserverUrl,
          accessToken: context.accessToken,
          targetRoomId: context.targetRoomId,
          since: cursor,
          timeoutMs: MATRIX_SYNC_POLL_TIMEOUT_MS,
          signal: replyController.signal,
        });
        if (isSignalAborted(replyController.signal)) {
          return infrastructureFailure('MATRIX_REPLY_TIMEOUT', facts);
        }
        if (!sync.ok) {
          return infrastructureFailure(
            sync.reason === 'invalid_response' ? 'MATRIX_SYNC_INVALID' : 'MATRIX_SYNC_FAILED',
            facts
          );
        }
        if (sync.limited) {
          return infrastructureFailure('MATRIX_TIMELINE_LIMITED', facts);
        }

        cursor = sync.nextBatch;
        assistantText = selectedAssistantText(sync.events, context.matrixUserId);
        if (assistantText !== undefined) {
          facts.eligiblePuppetTextObserved = true;
          break;
        }
      }
    } finally {
      dependencies.timer.clear(replyTimer);
    }

    const judge = await dependencies.judgeMatrixSmokeReply({
      assistantText,
      semanticCriteria: MATRIX_SMOKE_SEMANTIC_CRITERIA,
      transportFacts: {
        cursorCaptured: true,
        outboundSent: true,
        eligiblePuppetTextObserved: true,
        hiddenToolAudit: 'not_available',
      },
    });
    const usage = privacySafeUsage(judge.usage);
    if (usage === undefined) {
      return infrastructureFailure('MATRIX_UNEXPECTED_FAILURE', facts);
    }
    if (!judge.ok) {
      return infrastructureFailure(judge.code, facts, {
        status: 'infrastructure_failure',
        code: judge.code,
        usage,
      });
    }

    return {
      effectiveKind: judge.verdict.pass ? 'passed' : 'behavioral_failure',
      exitCode: judge.verdict.pass ? 0 : 1,
      failureCodes: [],
      transportFacts: snapshotTransportFacts(facts),
      judge: {
        status: 'completed',
        verdict: privacySafeVerdict(judge.verdict),
        usage,
      },
    };
  } catch {
    return infrastructureFailure('MATRIX_UNEXPECTED_FAILURE', facts);
  }
}

function unexpectedCoreResult(
  facts: MutableTransportFacts = {
    cursorCaptured: false,
    outboundSent: false,
    eligiblePuppetTextObserved: false,
  }
): MatrixSmokeCoreResult {
  return infrastructureFailure('MATRIX_UNEXPECTED_FAILURE', facts);
}

function unexpectedFromCore(core: MatrixSmokeCoreResult): MatrixSmokeCoreResult {
  return {
    ...core,
    effectiveKind: 'infrastructure_failure',
    exitCode: 2,
    failureCodes: core.failureCodes.includes('MATRIX_UNEXPECTED_FAILURE')
      ? core.failureCodes
      : [...core.failureCodes, 'MATRIX_UNEXPECTED_FAILURE'],
  };
}

export async function runMatrixSmoke(
  dependencies: RunMatrixSmokeDependencies
): Promise<MatrixSmokeResult> {
  let uuid: string;
  let prompt: string;
  try {
    uuid = dependencies.createUuid();
    prompt = buildSafeMatrixSmokePrompt(uuid);
  } catch {
    return { ...unexpectedCoreResult(), durationMs: 0 };
  }

  let startedAt: number;
  try {
    startedAt = dependencies.nowMs();
    if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
      return { ...unexpectedCoreResult(), durationMs: 0 };
    }
  } catch {
    return { ...unexpectedCoreResult(), durationMs: 0 };
  }

  function finish(core: MatrixSmokeCoreResult): MatrixSmokeResult {
    try {
      const completedAt = dependencies.nowMs();
      const durationMs = completedAt - startedAt;
      if (
        !Number.isSafeInteger(completedAt) ||
        completedAt < startedAt ||
        !Number.isSafeInteger(durationMs) ||
        durationMs < 0
      ) {
        return { ...unexpectedFromCore(core), durationMs: 0 };
      }
      return { ...core, durationMs };
    } catch {
      return { ...unexpectedFromCore(core), durationMs: 0 };
    }
  }

  let callbackResult: MatrixSmokeCoreResult | undefined;
  try {
    let callbackStarted = false;
    const account = await dependencies.withAccountContext(async (context) => {
      if (callbackStarted) {
        return;
      }
      callbackStarted = true;
      callbackResult = await executeRoundTrip(context, prompt, uuid, dependencies);
    });
    if (!account.ok) {
      return finish(
        infrastructureFailure(
          account.code === 'UNEXPECTED_FAILURE'
            ? 'MATRIX_UNEXPECTED_FAILURE'
            : 'MATRIX_ACCOUNT_CONTEXT_FAILED',
          {
            cursorCaptured: false,
            outboundSent: false,
            eligiblePuppetTextObserved: false,
          }
        )
      );
    }
    return finish(callbackResult ?? unexpectedCoreResult());
  } catch {
    return finish(
      callbackResult === undefined ? unexpectedCoreResult() : unexpectedFromCore(callbackResult)
    );
  }
}

export function createProductionMatrixSmokeRunner(options: {
  matrix: MatrixClient;
  judgeMatrixSmokeReply: JudgeMatrixSmokeReply;
}): () => Promise<MatrixSmokeResult> {
  const setupPorts = createProductionSetupPorts({ matrix: options.matrix });
  const whatsapp = createWhatsAppServiceClient({
    baseUrl: WHATSAPP_SERVICE_BASE_URL,
    internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    defaultTimeoutMs: 10_000,
    logger: NO_OP_LOGGER,
  });
  const timerCancellations = new Map<unknown, () => void>();
  const timer: RunMatrixSmokeDependencies['timer'] = {
    set(callback, ms): unknown {
      const handle = setTimeout(callback, ms);
      const key = Symbol('matrix-smoke-timer');
      timerCancellations.set(key, () => {
        clearTimeout(handle);
      });
      return key;
    },
    clear(handle): void {
      timerCancellations.get(handle)?.();
      timerCancellations.delete(handle);
    },
  };

  return async () =>
    await runMatrixSmoke({
      withAccountContext: async (callback) =>
        await withValidatedAccountContext(setupPorts, callback),
      matrix: options.matrix,
      whatsapp,
      judgeMatrixSmokeReply: options.judgeMatrixSmokeReply,
      createUuid: randomUUID,
      nowMs: Date.now,
      timer,
    });
}
