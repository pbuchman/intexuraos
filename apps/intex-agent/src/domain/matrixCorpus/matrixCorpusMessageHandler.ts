import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusStrictToolMockProfileV1,
  matrixCorpusAttestationClaimsV1Schema,
  type MatrixCorpusAttestationClaimsV1,
} from '@intexuraos/http-contracts';

import type {
  MatrixCorpusSessionIdentity,
  MatrixCorpusSessionRepository,
} from '../ports/sessionRepository.js';
import { detectSessionCommand } from '../messages/sessionCommands.js';
import type {
  IntexAgentMatrixCorpusProfileV1,
  IntexAgentSessionEvent,
} from '../sessions/types.js';
import type { MatrixCorpusContextService } from './contextService.js';
import type { MatrixCorpusIngestStableKeys } from './ports/ingestReceiptRepository.js';
import type { TestConfirmationRepository } from './ports/testConfirmationRepository.js';
import {
  MatrixCorpusStrictToolMockError,
  type MatrixCorpusStrictToolSelectionRecord,
} from './strictToolMockExecutor.js';

type IngestClaims = Extract<
  MatrixCorpusAttestationClaimsV1,
  Readonly<{ kind: 'matrix_corpus_ingest' }>
>;

export type MatrixCorpusMessageHandlerFailureCode =
  | 'INVALID_CLAIMS'
  | 'MOCK_PROFILE_DIGEST_MISMATCH'
  | 'CONTEXT_REJECTED'
  | 'SESSION_REJECTED'
  | 'SESSION_PROFILE_MISMATCH'
  | 'CONFIRMATION_REJECTED'
  | 'EVENT_REJECTED';

export type MatrixCorpusMessageHandlingResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      sessionId: string;
      eventSequence: number;
    }>
  | Readonly<{ ok: false; code: MatrixCorpusMessageHandlerFailureCode }>;

export interface MatrixCorpusMessageHandler {
  prepareVerifiedIngest(input: Readonly<{
    claims: unknown;
    stableKeys: MatrixCorpusIngestStableKeys;
  }>): Promise<MatrixCorpusMessageHandlingResult>;
}

export interface MatrixCorpusMessageHandlerDeps {
  contextService: Pick<
    MatrixCorpusContextService,
    'registerScenario' | 'loadScenarioPromptContext' | 'loadSessionProfileSnapshot'
  >;
  sessionRepository: MatrixCorpusSessionRepository;
  confirmationRepository: Pick<TestConfirmationRepository, 'resolveExact'>;
}

export interface CreateMatrixCorpusToolCallStartedRecorderInput {
  sessionRepository: MatrixCorpusSessionRepository;
  identity: MatrixCorpusSessionIdentity;
  ingestReceiptId: string;
  createdAt: string;
}

export function isMatrixCorpusIdleNewSessionStart(claims: IngestClaims): boolean {
  const { context, ordinaryIngest } = claims.payload;
  if (
    context.phase !== 'start' ||
    context.turnIndex !== 0 ||
    !context.startNewSession
  )
    return false;
  const command = detectSessionCommand(ordinaryIngest.text);
  return command.kind === 'start_new' && command.requestText === null;
}

export function isMatrixCorpusExplicitSessionRestart(claims: IngestClaims): boolean {
  const { context, ordinaryIngest } = claims.payload;
  if (context.phase !== 'turn' || context.startNewSession) return false;
  const command = detectSessionCommand(ordinaryIngest.text);
  return command.kind === 'start_new' && command.requestText !== null;
}

export function createMatrixCorpusToolCallStartedRecorder(
  input: CreateMatrixCorpusToolCallStartedRecorderInput
): (selection: MatrixCorpusStrictToolSelectionRecord) => Promise<void> {
  return async (selection): Promise<void> => {
    const eventIdentity = JSON.stringify({
      domain: 'matrix-corpus-tool-call-started-v1',
      ingestReceiptId: input.ingestReceiptId,
      ordinal: selection.ordinal,
      toolName: selection.toolName,
      turnIndex: selection.turnIndex,
    });
    const eventId = `imc_tool_${createHash('sha256')
      .update(eventIdentity, 'utf8')
      .digest('hex')
      .slice(0, 32)}`;
    const appended = await input.sessionRepository.appendMatrixCorpusEvent({
      identity: input.identity,
      event: {
        id: eventId,
        sessionId: input.identity.sessionId,
        userId: input.identity.userId,
        type: 'tool_call_started',
        payload: {
          runId: input.identity.runId,
          scenarioId: input.identity.scenarioId,
          turnIndex: selection.turnIndex,
          toolName: selection.toolName,
          ordinal: selection.ordinal,
          status: 'started',
          facts: selection.facts,
        },
        createdAt: input.createdAt,
      },
      now: input.createdAt,
    });
    if (!appended.ok) {
      throw new MatrixCorpusStrictToolMockError(
        'safety_stop',
        'TOOL_CALL_EVIDENCE_REJECTED'
      );
    }
  };
}

export function createMatrixCorpusMessageHandler(
  deps: MatrixCorpusMessageHandlerDeps
): MatrixCorpusMessageHandler {
  return {
    async prepareVerifiedIngest(input): Promise<MatrixCorpusMessageHandlingResult> {
      const parsed = matrixCorpusAttestationClaimsV1Schema.safeParse(input.claims);
      if (!parsed.success || parsed.data.kind !== 'matrix_corpus_ingest')
        return failure('INVALID_CLAIMS');
      const claims = parsed.data;
      if (!hasValidPayloadDigest(claims)) return failure('INVALID_CLAIMS');

      const { context, ordinaryIngest } = claims.payload;
      const computedMockProfileDigest = sha256(
        canonicalMatrixCorpusStrictToolMockProfileV1(context.mockProfile)
      );
      if (computedMockProfileDigest !== context.mockProfileDigest)
        return failure('MOCK_PROFILE_DIGEST_MISMATCH');
      if (
        context.expectedSessionId !== null &&
        context.expectedSessionId !== input.stableKeys.sessionId
      )
        return failure('SESSION_REJECTED');

      const contextIdentity = {
        runId: context.runId,
        userId: ordinaryIngest.userId,
        leaseFence: context.leaseFence,
      };
      const scenarioIdentity = { ...contextIdentity, scenarioId: context.scenarioId };
      const profileSnapshot = await deps.contextService.loadSessionProfileSnapshot(
        contextIdentity
      );
      if (!profileSnapshot.ok || profileSnapshot.snapshot.userTimeZone !== context.timeZone)
        return failure('CONTEXT_REJECTED');

      let scenarioDisposition: 'applied' | 'already_applied' = 'already_applied';
      if (context.phase === 'start') {
        const registered = await deps.contextService.registerScenario(scenarioIdentity);
        if (
          !registered.ok ||
          registered.snapshot.baselinePromptPreferencesDigest !==
            profileSnapshot.snapshot.promptPreferencesDigest
        )
          return failure('CONTEXT_REJECTED');
        scenarioDisposition = registered.disposition;
      } else {
        const scenario = await deps.contextService.loadScenarioPromptContext(scenarioIdentity);
        if (!scenario.ok) return failure('CONTEXT_REJECTED');
      }

      const profile: IntexAgentMatrixCorpusProfileV1 = {
        version: 1,
        kind: 'matrix_corpus',
        runtimeAudience: 'hetzner-prod',
        leaseFence: context.leaseFence,
        runId: context.runId,
        scenarioId: context.scenarioId,
        scenarioNumber: context.scenarioNumber,
        scenarioLabel: context.scenarioLabel,
        executionMode: 'strict_mock_tools',
        agentModel: profileSnapshot.snapshot.agentModel,
        evaluatorModel: profileSnapshot.snapshot.evaluatorModel,
        promptPreferencesVersion: profileSnapshot.snapshot.promptPreferencesVersion,
        promptPreferencesDigest: profileSnapshot.snapshot.promptPreferencesDigest,
        userTimeZone: profileSnapshot.snapshot.userTimeZone,
        mockProfile: structuredClone(context.mockProfile),
        mockProfileDigest: context.mockProfileDigest,
        expectedToolSchedule: structuredClone(context.expectedToolSchedule),
      };
      const identity: MatrixCorpusSessionIdentity = {
        ...scenarioIdentity,
        sessionId: input.stableKeys.sessionId,
      };
      const idleNewSessionStart = isMatrixCorpusIdleNewSessionStart(claims);
      const explicitSessionRestart = isMatrixCorpusExplicitSessionRestart(claims);
      const startReason = idleNewSessionStart || explicitSessionRestart
        ? ('user_requested_new_session' as const)
        : ('no_active_session' as const);

      let sessionDisposition: 'applied' | 'already_applied';
      if (context.phase === 'start') {
        const created = await deps.sessionRepository.createMatrixCorpusSession({
          identity,
          session: {
            id: input.stableKeys.sessionId,
            userId: ordinaryIngest.userId,
            channel: 'whatsapp',
            status: 'active',
            startedAt: ordinaryIngest.timestamp,
            lastUserMessageAt: ordinaryIngest.timestamp,
            startReason,
            matrixCorpusProfile: profile,
            lastEventSequence: 0,
          },
          now: ordinaryIngest.timestamp,
        });
        if (!created.ok) return failure('SESSION_REJECTED');
        sessionDisposition = created.disposition;
      } else {
        const exact = await deps.sessionRepository.getMatrixCorpusSessionExact(identity);
        if (!exact.ok) return failure('SESSION_REJECTED');
        if (stableJson(exact.session.matrixCorpusProfile) !== stableJson(profile))
          return failure('SESSION_PROFILE_MISMATCH');
        sessionDisposition = 'already_applied';
      }

      let sessionClosedDisposition: 'applied' | 'already_applied' = 'already_applied';
      if (explicitSessionRestart) {
        const sessionClosed = await deps.sessionRepository.appendMatrixCorpusEvent({
          identity,
          event: {
            id: deterministicSessionClosedEventId(input.stableKeys.eventId),
            sessionId: input.stableKeys.sessionId,
            userId: ordinaryIngest.userId,
            type: 'session_closed',
            payload: {
              reason: 'superseded_by_user',
              status: 'superseded',
            },
            createdAt: ordinaryIngest.timestamp,
          },
          now: ordinaryIngest.timestamp,
        });
        if (!sessionClosed.ok) return failure('EVENT_REJECTED');
        sessionClosedDisposition = sessionClosed.disposition;
      }

      let sessionStartedDisposition: 'applied' | 'already_applied' = 'already_applied';
      let sessionStartedSequence = 0;
      if (context.phase === 'start' || explicitSessionRestart) {
        const sessionStarted = await deps.sessionRepository.appendMatrixCorpusEvent({
          identity,
          event: {
            id: idleNewSessionStart
              ? input.stableKeys.eventId
              : explicitSessionRestart
                ? deterministicRestartedEventId(input.stableKeys.eventId)
                : deterministicSessionStartedEventId(input.stableKeys.eventId),
            sessionId: input.stableKeys.sessionId,
            userId: ordinaryIngest.userId,
            type: 'session_started',
            payload: {
              reason: startReason,
              explicit: idleNewSessionStart || explicitSessionRestart,
            },
            createdAt: ordinaryIngest.timestamp,
          },
          ...(explicitSessionRestart
            ? {
                sessionUpdate: {
                  status: 'active' as const,
                  startReason: 'user_requested_new_session' as const,
                  lastUserMessageAt: ordinaryIngest.timestamp,
                  activeTool: null,
                },
              }
            : {}),
          now: ordinaryIngest.timestamp,
        });
        if (!sessionStarted.ok) return failure('EVENT_REJECTED');
        sessionStartedDisposition = sessionStarted.disposition;
        sessionStartedSequence = sessionStarted.sequence;
      }

      if (idleNewSessionStart) {
        return {
          ok: true,
          disposition:
            scenarioDisposition === 'already_applied' &&
            sessionDisposition === 'already_applied' &&
            sessionStartedDisposition === 'already_applied'
              ? 'already_applied'
              : 'applied',
          sessionId: input.stableKeys.sessionId,
          eventSequence: sessionStartedSequence,
        };
      }

      if (context.phase === 'confirmation') {
        const confirmationId = context.pendingConfirmationId;
        const decision = context.expectedDecision;
        /* v8 ignore start -- schema: attested ingest schema validation guarantees both confirmation fields are non-null when phase is confirmation; this guard rejects a bypassed caller @preserve */
        if (confirmationId === null || decision === null)
          return failure('CONFIRMATION_REJECTED');
        /* v8 ignore stop @preserve */
        const confirmation = await deps.confirmationRepository.resolveExact({
          identity: {
            confirmationId,
            runId: context.runId,
            scenarioId: context.scenarioId,
            sessionId: input.stableKeys.sessionId,
            userId: identity.userId,
            leaseFence: context.leaseFence,
          },
          decision,
          resolutionMessageId: ordinaryIngest.messageId,
          now: ordinaryIngest.timestamp,
        });
        if (!confirmation.ok) return failure('CONFIRMATION_REJECTED');
      }

      const eventPayload =
        context.phase === 'confirmation'
          ? {
              confirmationId: context.pendingConfirmationId,
              resolution: context.expectedDecision === 'confirm' ? 'accepted' : 'rejected',
              sourceMessageId: ordinaryIngest.messageId,
              phase: context.phase,
              turnIndex: context.turnIndex,
            }
          : {
              messageId: ordinaryIngest.messageId,
              text: ordinaryIngest.text,
              sourceType: ordinaryIngest.sourceType,
              phase: context.phase,
              turnIndex: context.turnIndex,
            };
      const event: IntexAgentSessionEvent = {
        id: input.stableKeys.eventId,
        sessionId: input.stableKeys.sessionId,
        userId: ordinaryIngest.userId,
        type: context.phase === 'confirmation' ? 'confirmation_resolved' : 'user_message',
        payload: eventPayload,
        createdAt: ordinaryIngest.timestamp,
      };
      const appended = await deps.sessionRepository.appendMatrixCorpusEvent({
        identity,
        event,
        sessionUpdate: {
          status: 'active',
          lastUserMessageAt: ordinaryIngest.timestamp,
        },
        now: ordinaryIngest.timestamp,
      });
      if (!appended.ok) return failure('EVENT_REJECTED');

      return {
        ok: true,
        disposition:
          scenarioDisposition === 'already_applied' &&
          sessionDisposition === 'already_applied' &&
          sessionClosedDisposition === 'already_applied' &&
          sessionStartedDisposition === 'already_applied' &&
          appended.disposition === 'already_applied'
            ? 'already_applied'
            : 'applied',
        sessionId: input.stableKeys.sessionId,
        eventSequence: appended.sequence,
      };
    },
  };
}

function deterministicSessionClosedEventId(eventId: string): string {
  return `imc_session_closed_${createHash('sha256')
    .update(`matrix-corpus-session-closed-v1:${eventId}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;
}

function deterministicRestartedEventId(eventId: string): string {
  return `imc_session_restarted_${createHash('sha256')
    .update(`matrix-corpus-session-restarted-v1:${eventId}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;
}

function deterministicSessionStartedEventId(eventId: string): string {
  return `imc_session_started_${createHash('sha256')
    .update(`matrix-corpus-session-started-v1:${eventId}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;
}

function hasValidPayloadDigest(claims: IngestClaims): boolean {
  try {
    return sha256(canonicalMatrixCorpusIngestPayloadV1(claims.payload)) === claims.payloadDigest;
  } catch {
    return false;
  }
}

function failure(
  code: MatrixCorpusMessageHandlerFailureCode
): Readonly<{ ok: false; code: MatrixCorpusMessageHandlerFailureCode }> {
  return { ok: false, code } as const;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
