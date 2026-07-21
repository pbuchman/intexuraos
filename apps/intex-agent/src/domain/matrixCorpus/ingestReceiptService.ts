import { createHash } from 'node:crypto';

import {
  canonicalMatrixCorpusIngestPayloadV1,
  matrixCorpusAttestationClaimsV1Schema,
} from '@intexuraos/http-contracts';

import type {
  IngestReceiptRepository,
  MatrixCorpusIngestReceiptIdentity,
  MatrixCorpusIngestStableKeys,
} from './ports/ingestReceiptRepository.js';
import { MATRIX_CORPUS_IN_FLIGHT_RECOVERY_DEADLINE_MS } from './ports/ingestReceiptRepository.js';
import type { MatrixCorpusMessageHandler } from './matrixCorpusMessageHandler.js';
import type { MatrixCorpusExecutionService } from './matrixCorpusExecutionService.js';
import type { MatrixCorpusTurnTerminalRecorder } from './turnTerminalRecorder.js';

export type MatrixCorpusIngestAcceptanceResult = Readonly<{
  accepted: boolean;
  state: 'completed' | 'not_ready' | 'duplicate' | 'retry' | 'rejected';
  correlationCount: 0 | 1;
}>;

export interface MatrixCorpusIngestReceiptService {
  acceptVerifiedIngest(input: unknown): Promise<MatrixCorpusIngestAcceptanceResult>;
}

export interface MatrixCorpusIngestReceiptServiceDeps {
  repository: IngestReceiptRepository;
  messageHandler?: Pick<MatrixCorpusMessageHandler, 'prepareVerifiedIngest'>;
  executionService?: Pick<
    MatrixCorpusExecutionService,
    'executeVerifiedIngest' | 'recoverVerifiedIngest'
  >;
  terminalRecorder: Pick<MatrixCorpusTurnTerminalRecorder, 'recordTerminal'>;
  generateStableKeys: (
    input: Readonly<{
      ingestReceiptId: string;
      expectedSessionId: string | null;
    }>
  ) => MatrixCorpusIngestStableKeys;
  now: () => string;
}

const rejected = {
  accepted: false,
  state: 'rejected',
  correlationCount: 0,
} as const;

export function createMatrixCorpusIngestReceiptService(
  deps: MatrixCorpusIngestReceiptServiceDeps
): MatrixCorpusIngestReceiptService {
  return {
    async acceptVerifiedIngest(input): Promise<MatrixCorpusIngestAcceptanceResult> {
      const parsed = matrixCorpusAttestationClaimsV1Schema.safeParse(input);
      if (!parsed.success || parsed.data.kind !== 'matrix_corpus_ingest') return rejected;
      const claims = parsed.data;

      let actualPayloadDigest: string;
      try {
        actualPayloadDigest = createHash('sha256')
          .update(canonicalMatrixCorpusIngestPayloadV1(claims.payload), 'utf8')
          .digest('hex');
      } catch {
        return rejected;
      }
      if (actualPayloadDigest !== claims.payloadDigest) return rejected;

      const identity: MatrixCorpusIngestReceiptIdentity = {
        ingestReceiptId: claims.eventId,
        runId: claims.payload.context.runId,
        scenarioId: claims.payload.context.scenarioId,
        turnIndex: claims.payload.context.turnIndex,
        leaseFence: claims.leaseFence,
        payloadDigest: claims.payloadDigest,
      };
      const operationTime = deps.now();
      const reserved = await deps.repository.reserveAndStartProcessing({
        identity,
        stableKeys: deps.generateStableKeys({
          ingestReceiptId: claims.eventId,
          expectedSessionId: claims.payload.context.expectedSessionId,
        }),
        now: operationTime,
      });
      if (!reserved.ok) return rejected;

      if (reserved.receipt.state === 'llm_in_flight') {
        if (isCompletionReady(reserved.receipt))
          return await recoverTerminalReceipt({
            deps,
            identity,
            operationTime,
            userId: claims.payload.ordinaryIngest.userId,
          });
        if (!isPastRecoveryDeadline(reserved.receipt.updatedAt, operationTime))
          return { accepted: false, state: 'retry', correlationCount: 1 };
        if (hasReservedReply(reserved.receipt) && deps.executionService !== undefined) {
          try {
            const recoveredPublication = await deps.executionService.recoverVerifiedIngest({
              claims,
              receipt: reserved.receipt,
              stableKeys: receiptStableKeys(reserved.receipt),
            });
            if (recoveredPublication.ok) {
              const terminal = await deps.repository.complete({ identity, now: operationTime });
              if (!terminal.ok)
                return { accepted: false, state: 'retry', correlationCount: 1 };
              const recorded = await recordTerminal(
                deps,
                terminal.receipt,
                claims.payload.ordinaryIngest.userId
              );
              return recorded
                ? { accepted: true, state: 'duplicate', correlationCount: 1 }
                : { accepted: false, state: 'retry', correlationCount: 1 };
            }
            if (recoveredPublication.code === 'REPLY_PUBLICATION_REJECTED')
              return { accepted: false, state: 'retry', correlationCount: 1 };
          } catch {
            return { accepted: false, state: 'retry', correlationCount: 1 };
          }
        }
        return await recoverTerminalReceipt({
          deps,
          identity,
          operationTime,
          userId: claims.payload.ordinaryIngest.userId,
        });
      }
      if (reserved.receipt.state === 'completed') {
        const recorded = await recordTerminal(
          deps,
          reserved.receipt,
          claims.payload.ordinaryIngest.userId
        );
        return recorded
          ? { accepted: true, state: 'duplicate', correlationCount: 1 }
          : { accepted: false, state: 'retry', correlationCount: 1 };
      }
      if (reserved.receipt.state === 'failed') {
        const recorded = await recordTerminal(
          deps,
          reserved.receipt,
          claims.payload.ordinaryIngest.userId
        );
        return recorded && reserved.receipt.failureCode === 'MATRIX_CORPUS_NOT_READY'
          ? { accepted: true, state: 'duplicate', correlationCount: 1 }
          : recorded
            ? { accepted: false, state: 'rejected', correlationCount: 1 }
            : { accepted: false, state: 'retry', correlationCount: 1 };
      }

      if (deps.messageHandler !== undefined) {
        const prepared = await deps.messageHandler.prepareVerifiedIngest({
          claims,
          stableKeys: {
            sessionId: reserved.receipt.sessionId,
            eventId: reserved.receipt.eventId,
            toolCallId: reserved.receipt.toolCallId,
            replyId: reserved.receipt.replyId,
          },
        });
        if (!prepared.ok) {
          const terminal = await deps.repository.fail({
            identity,
            failureCode: 'MATRIX_CORPUS_PREPARATION_REJECTED',
            now: operationTime,
          });
          if (terminal.ok)
            await recordTerminal(deps, terminal.receipt, claims.payload.ordinaryIngest.userId);
          return {
            accepted: false,
            state: 'rejected',
            correlationCount: terminal.ok ? 1 : 0,
          };
        }
      }

      if (deps.executionService !== undefined) {
        const marked = await deps.repository.markLlmInFlight({
          identity,
          now: operationTime,
        });
        if (!marked.ok) return { accepted: false, state: 'rejected', correlationCount: 1 };
        if (marked.disposition !== 'applied')
          return { accepted: false, state: 'retry', correlationCount: 1 };
        let executed: Awaited<ReturnType<MatrixCorpusExecutionService['executeVerifiedIngest']>>;
        try {
          executed = await deps.executionService.executeVerifiedIngest({
            claims,
            stableKeys: {
              sessionId: reserved.receipt.sessionId,
              eventId: reserved.receipt.eventId,
              toolCallId: reserved.receipt.toolCallId,
              replyId: reserved.receipt.replyId,
            },
          });
        } catch {
          const latest = await deps.repository.reserveAndStartProcessing({
            identity,
            stableKeys: receiptStableKeys(reserved.receipt),
            now: operationTime,
          });
          if (
            latest.ok &&
            latest.receipt.state === 'llm_in_flight' &&
            hasReservedReply(latest.receipt)
          ) {
            try {
              const recoveredPublication = await deps.executionService.recoverVerifiedIngest({
                claims,
                receipt: latest.receipt,
                stableKeys: receiptStableKeys(latest.receipt),
              });
              if (recoveredPublication.ok) {
                const terminal = await deps.repository.complete({ identity, now: operationTime });
                if (!terminal.ok)
                  return { accepted: false, state: 'retry', correlationCount: 1 };
                const recorded =
                  await recordTerminal(
                    deps,
                    terminal.receipt,
                    claims.payload.ordinaryIngest.userId
                  );
                if (recorded)
                  return { accepted: true, state: 'duplicate', correlationCount: 1 };
                return { accepted: false, state: 'retry', correlationCount: 1 };
              } else if (recoveredPublication.code === 'REPLY_PUBLICATION_REJECTED') {
                return { accepted: false, state: 'retry', correlationCount: 1 };
              }
            } catch {
              return { accepted: false, state: 'retry', correlationCount: 1 };
            }
          }
          const recovered = await deps.repository.recoverAfterInterruption({
            identity,
            now: operationTime,
            reason: 'execution_failed',
          });
          if (recovered.ok)
            await recordTerminal(deps, recovered.receipt, claims.payload.ordinaryIngest.userId);
          return {
            accepted: false,
            state: 'rejected',
            correlationCount: recovered.ok ? 1 : 0,
          };
        }
        if (!executed.ok) {
          if (executed.code === 'REPLY_PUBLICATION_REJECTED')
            return { accepted: false, state: 'retry', correlationCount: 1 };
          const terminal = await deps.repository.fail({
            identity,
            failureCode: 'MATRIX_CORPUS_EXECUTION_REJECTED',
            now: operationTime,
          });
          if (terminal.ok)
            await recordTerminal(deps, terminal.receipt, claims.payload.ordinaryIngest.userId);
          return {
            accepted: false,
            state: 'rejected',
            correlationCount: terminal.ok ? 1 : 0,
          };
        }
        const terminal = await deps.repository.complete({ identity, now: operationTime });
        if (!terminal.ok) return { accepted: false, state: 'retry', correlationCount: 1 };
        const recorded = await recordTerminal(
          deps,
          terminal.receipt,
          claims.payload.ordinaryIngest.userId
        );
        return recorded
          ? { accepted: true, state: 'completed', correlationCount: 1 }
          : { accepted: false, state: 'retry', correlationCount: 1 };
      }

      const terminal = await deps.repository.fail({
        identity,
        failureCode: 'MATRIX_CORPUS_NOT_READY',
        now: operationTime,
      });
      if (!terminal.ok) return { accepted: false, state: 'rejected', correlationCount: 1 };
      if (!(await recordTerminal(deps, terminal.receipt, claims.payload.ordinaryIngest.userId)))
        return { accepted: false, state: 'rejected', correlationCount: 1 };
      return { accepted: true, state: 'not_ready', correlationCount: 1 };
    },
  };
}

async function recordTerminal(
  deps: Pick<MatrixCorpusIngestReceiptServiceDeps, 'terminalRecorder'>,
  receipt: import('./ports/ingestReceiptRepository.js').MatrixCorpusIngestReceipt,
  userId: string
): Promise<boolean> {
  try {
    return (await deps.terminalRecorder.recordTerminal({ receipt, userId })).ok;
  } catch {
    return false;
  }
}

async function recoverTerminalReceipt(
  input: Readonly<{
    deps: MatrixCorpusIngestReceiptServiceDeps;
    identity: MatrixCorpusIngestReceiptIdentity;
    operationTime: string;
    userId: string;
  }>
): Promise<MatrixCorpusIngestAcceptanceResult> {
  const recovered = await input.deps.repository.recoverAfterInterruption({
    identity: input.identity,
    now: input.operationTime,
    reason: 'redelivery',
  });
  const recorded =
    recovered.ok && (await recordTerminal(input.deps, recovered.receipt, input.userId));
  if (recovered.ok && recorded && recovered.receipt.state === 'completed')
    return { accepted: true, state: 'duplicate', correlationCount: 1 };
  return {
    accepted: false,
    state: 'rejected',
    correlationCount: recovered.ok ? 1 : 0,
  };
}

function isCompletionReady(
  receipt: import('./ports/ingestReceiptRepository.js').MatrixCorpusIngestReceipt
): boolean {
  const expected = receipt.publication.expectedReplyDigests;
  return (
    receipt.publication.phase === 'completing' &&
    expected !== null &&
    expected.length === receipt.publication.replies.length &&
    receipt.publication.replies.every(
      (reply, index) =>
        reply.replyIndex === index &&
        reply.replyDigest === expected[index] &&
        reply.state === 'accepted' &&
        reply.publicationReceiptDigest !== null
    )
  );
}

function hasReservedReply(
  receipt: import('./ports/ingestReceiptRepository.js').MatrixCorpusIngestReceipt
): boolean {
  return (
    receipt.publication.phase === 'completing' &&
    receipt.publication.replies.some((reply) => reply.state === 'reserved')
  );
}

function receiptStableKeys(
  receipt: import('./ports/ingestReceiptRepository.js').MatrixCorpusIngestReceipt
): MatrixCorpusIngestStableKeys {
  return {
    sessionId: receipt.sessionId,
    eventId: receipt.eventId,
    toolCallId: receipt.toolCallId,
    replyId: receipt.replyId,
  };
}

function isPastRecoveryDeadline(updatedAt: string, now: string): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  const nowMs = Date.parse(now);
  return (
    Number.isFinite(updatedAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs - updatedAtMs >= MATRIX_CORPUS_IN_FLIGHT_RECOVERY_DEADLINE_MS
  );
}
