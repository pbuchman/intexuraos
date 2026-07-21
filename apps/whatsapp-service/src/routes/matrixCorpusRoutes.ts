import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import {
  matrixCorpusCapabilityIssueRequestV1Schema,
  matrixCorpusControlMutationOperationV1Schema,
  matrixCorpusKeyedDigestSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSignedControlMutationV1Schema,
} from '@intexuraos/http-contracts';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  abandonPendingResultSchema,
  activationResultSchema,
  capabilityIssueResultSchema,
  matrixSendProofResultSchema,
  cleanupResultSchema,
  leaseRenewResultSchema,
  provisioningLeaseResultSchema,
  quiesceResultSchema,
  releaseResultSchema,
  transportStatusResultSchema,
} from '../domain/matrixCorpus/types.js';
import type { MatrixCorpusRouteControlPlane } from '../domain/matrixCorpus/ports/matrixCorpusRouteControlPlane.js';

const noStore = 'no-store';
const MATRIX_CORPUS_REQUEST_LOG_OPTIONS = {
  message: 'Received protected Matrix corpus control request',
  bodyPreviewLength: 0,
  includeHeaders: false,
  includeParams: false,
} as const;
const safeId = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$' } as const;
const fence = { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } as const;
const sensitiveFence = { ...fence, writeOnly: true } as const;
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
const sensitiveDigest = { ...digest, writeOnly: true } as const;
const timestampSchema = { type: 'string', format: 'date-time', maxLength: 29 } as const;
const idempotencyKey = {
  type: 'string',
  minLength: 16,
  maxLength: 128,
  pattern: '^[A-Za-z0-9._:-]+$',
} as const;
const runParamsSchema = closedObject(['runId'], ['runId'], { runId: safeId });
const readinessResponseSchema = closedObject(
  ['status'],
  ['status'],
  {
    status: { type: 'string', enum: ['ready'] },
  }
);

const provisionBodySchema = closedObject(
  ['runId', 'idempotencyKey'],
  ['runId', 'idempotencyKey'],
  { runId: safeId, idempotencyKey }
);
const operationBodySchema = closedObject(
  ['leaseFence', 'idempotencyKey'],
  ['leaseFence', 'idempotencyKey'],
  { leaseFence: sensitiveFence, idempotencyKey }
);
const capabilityBodySchema = closedObject(
  [
    'leaseFence',
    'idempotencyKey',
    'capability',
    'scenarioId',
    'scenarioNumber',
    'scenarioLabel',
    'promptNormalizationVersion',
    'promptDigest',
    'phase',
    'turnIndex',
    'expectedSessionId',
    'pendingConfirmationId',
    'expectedDecision',
    'mockProfile',
    'mockProfileDigest',
    'expectedToolSchedule',
    'currentDateTime',
    'timeZone',
  ],
  [
    'leaseFence',
    'idempotencyKey',
    'capability',
    'scenarioId',
    'scenarioNumber',
    'scenarioLabel',
    'promptNormalizationVersion',
    'promptDigest',
    'phase',
    'turnIndex',
    'expectedSessionId',
    'pendingConfirmationId',
    'expectedDecision',
    'mockProfile',
    'mockProfileDigest',
    'expectedToolSchedule',
    'currentDateTime',
    'timeZone',
  ],
  {
    leaseFence: sensitiveFence,
    idempotencyKey,
    capability: {
      type: 'string',
      pattern: '^imc1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$',
      writeOnly: true,
    },
    scenarioId: safeId,
    scenarioNumber: { type: 'integer', minimum: 1, maximum: 20 },
    scenarioLabel: { type: 'string', minLength: 1, maxLength: 128 },
    promptNormalizationVersion: { type: 'integer', minimum: 1, maximum: 1 },
    promptDigest: digest,
    phase: { type: 'string', enum: ['start', 'turn', 'confirmation'] },
    turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
    expectedSessionId: { anyOf: [safeId, { type: 'null' }] },
    pendingConfirmationId: { anyOf: [safeId, { type: 'null' }] },
    expectedDecision: { anyOf: [{ type: 'string', enum: ['confirm', 'reject'] }, { type: 'null' }] },
    mockProfile: { type: 'object' },
    mockProfileDigest: digest,
    expectedToolSchedule: {
      type: 'array',
      maxItems: 200,
      items: closedObject(
        ['turnIndex', 'toolName', 'ordinal'],
        ['turnIndex', 'toolName', 'ordinal'],
        {
          turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
          toolName: { type: 'string' },
          ordinal: { type: 'integer', minimum: 1, maximum: 20 },
        }
      ),
    },
    currentDateTime: { type: 'string', minLength: 20, maxLength: 29 },
    timeZone: { type: 'string', minLength: 1, maxLength: 128 },
  }
);
const matrixSendProofBodySchema = closedObject(
  [
    'leaseFence',
    'idempotencyKey',
    'capability',
    'scenarioId',
    'scenarioNumber',
    'phase',
    'turnIndex',
    'matrixEventId',
    'matrixRoomId',
    'messageText',
  ],
  [
    'leaseFence',
    'idempotencyKey',
    'capability',
    'scenarioId',
    'scenarioNumber',
    'phase',
    'turnIndex',
    'matrixEventId',
    'matrixRoomId',
    'messageText',
  ],
  {
    leaseFence: sensitiveFence,
    idempotencyKey,
    capability: {
      type: 'string',
      pattern: '^imc1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$',
      writeOnly: true,
    },
    scenarioId: safeId,
    scenarioNumber: { type: 'integer', minimum: 1, maximum: 20 },
    phase: { type: 'string', enum: ['start', 'turn', 'confirmation'] },
    turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
    matrixEventId: { type: 'string', minLength: 2, maxLength: 4_096, writeOnly: true },
    matrixRoomId: { type: 'string', minLength: 4, maxLength: 255, writeOnly: true },
    messageText: { type: 'string', minLength: 1, maxLength: 8_192, writeOnly: true },
  }
);
const statusQuerySchema = closedObject(
  ['scenarioId', 'turnIndex'],
  [],
  {
    scenarioId: safeId,
    turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
  }
);
const cleanupBodySchema = closedObject(
  [
    'leaseFence',
    'targetRunId',
    'targetLeaseFence',
    'targetRunFenceDigest',
    'expectedRevision',
    'idempotencyKey',
  ],
  [
    'leaseFence',
    'targetRunId',
    'targetLeaseFence',
    'targetRunFenceDigest',
    'expectedRevision',
    'idempotencyKey',
  ],
  {
    leaseFence: sensitiveFence,
    targetRunId: safeId,
    targetLeaseFence: sensitiveFence,
    targetRunFenceDigest: sensitiveDigest,
    expectedRevision: { type: 'integer', minimum: 0, maximum: 63 },
    idempotencyKey,
  }
);
const controlAuthorizationBodySchema = closedObject(
  ['leaseFence', 'operation', 'request'],
  ['leaseFence', 'operation', 'request'],
  {
    leaseFence: sensitiveFence,
    operation: {
      type: 'string',
      enum: [
        'register_context',
        'finalize_run',
        'create_projection',
        'advance_projection',
      ],
    },
    request: { type: 'object' },
  }
);
const provisionResponseSchema = closedObject(
  ['code', 'runId', 'phase', 'leaseFence', 'acquiredAt', 'expiresAt'],
  ['code', 'runId', 'phase', 'leaseFence', 'acquiredAt', 'expiresAt'],
  {
    code: { type: 'string', enum: ['ACQUIRED', 'ALREADY_APPLIED'] },
    runId: safeId,
    phase: { type: 'string', enum: ['provisioning'] },
    leaseFence: fence,
    acquiredAt: timestampSchema,
    expiresAt: timestampSchema,
  }
);
const activationResponseSchema = closedObject(
  ['code', 'runId', 'leaseFence', 'phase', 'activatedAt'],
  ['code', 'runId', 'leaseFence', 'phase', 'activatedAt'],
  {
    code: { type: 'string', enum: ['ACTIVATED', 'ALREADY_APPLIED'] },
    runId: safeId,
    leaseFence: fence,
    phase: { type: 'string', enum: ['active'] },
    activatedAt: timestampSchema,
  }
);
const renewResponseSchema = closedObject(
  ['code', 'runId', 'leaseFence', 'phase', 'renewedAt', 'expiresAt'],
  ['code', 'runId', 'leaseFence', 'phase', 'renewedAt', 'expiresAt'],
  {
    code: { type: 'string', enum: ['LEASE_RENEWED', 'ALREADY_APPLIED'] },
    runId: safeId,
    leaseFence: fence,
    phase: { type: 'string', enum: ['active'] },
    renewedAt: timestampSchema,
    expiresAt: timestampSchema,
  }
);
const capabilityResponseSchema = closedObject(
  ['code', 'runId', 'leaseFence', 'scenarioId', 'phase', 'turnIndex', 'issuedAt', 'expiresAt'],
  ['code', 'runId', 'leaseFence', 'scenarioId', 'phase', 'turnIndex', 'issuedAt', 'expiresAt'],
  {
    code: { type: 'string', enum: ['CAPABILITY_ISSUED', 'ALREADY_APPLIED'] },
    runId: safeId,
    leaseFence: fence,
    scenarioId: safeId,
    phase: { type: 'string', enum: ['start', 'turn', 'confirmation'] },
    turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
  }
);
const matrixSendProofResponseSchema = closedObject(
  ['code', 'runId', 'leaseFence', 'scenarioId', 'phase', 'turnIndex', 'recordedAt'],
  ['code', 'runId', 'leaseFence', 'scenarioId', 'phase', 'turnIndex', 'recordedAt'],
  {
    code: { type: 'string', enum: ['MATRIX_SEND_PROOF_RECORDED', 'ALREADY_APPLIED'] },
    runId: safeId,
    leaseFence: fence,
    scenarioId: safeId,
    phase: { type: 'string', enum: ['start', 'turn', 'confirmation'] },
    turnIndex: { type: 'integer', minimum: 0, maximum: 19 },
    recordedAt: timestampSchema,
  }
);
const transportStatusResponseSchema = closedObject(
  [
    'code',
    'runId',
    'leaseFence',
    'phase',
    'consumedCapabilityCount',
    'terminalIntexMarkerCount',
    'terminalOutboxCount',
    'replyOrDeliveryWorkInFlight',
    'nonterminalIngestOutboxCount',
    'drained',
  ],
  [
    'code',
    'runId',
    'leaseFence',
    'phase',
    'consumedCapabilityCount',
    'terminalIntexMarkerCount',
    'terminalOutboxCount',
    'replyOrDeliveryWorkInFlight',
    'nonterminalIngestOutboxCount',
    'drained',
  ],
  {
    code: { type: 'string', enum: ['TRANSPORT_STATUS'] },
    runId: safeId,
    leaseFence: fence,
    phase: {
      type: 'string',
      enum: [
        'provisioning',
        'active',
        'quiescing',
        'release_pending',
        'abandon_pending',
        'released',
        'abandoned',
      ],
    },
    consumedCapabilityCount: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    terminalIntexMarkerCount: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    terminalOutboxCount: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    replyOrDeliveryWorkInFlight: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    nonterminalIngestOutboxCount: { type: 'integer', minimum: 0, maximum: 1 },
    drained: { type: 'boolean' },
  }
);
const quiesceResponseSchema = closedObject(
  ['code', 'runId', 'leaseFence', 'phase', 'quiescedAt', 'drained'],
  ['code', 'runId', 'leaseFence', 'phase', 'quiescedAt', 'drained'],
  {
    code: { type: 'string', enum: ['QUIESCED', 'ALREADY_APPLIED'] },
    runId: safeId,
    leaseFence: fence,
    phase: { type: 'string', enum: ['quiescing'] },
    quiescedAt: timestampSchema,
    drained: { type: 'boolean' },
  }
);
const releaseResponseSchema = closedObject(
  ['code', 'runId', 'leaseFence', 'phase', 'createdAt'],
  ['code', 'runId', 'leaseFence', 'phase', 'createdAt'],
  {
    code: { type: 'string', enum: ['RELEASE_PENDING', 'ALREADY_APPLIED'] },
    runId: safeId,
    leaseFence: fence,
    phase: { type: 'string', enum: ['release_pending'] },
    createdAt: timestampSchema,
  }
);
const abortResponseSchema = closedObject(
  ['code', 'runId', 'leaseFence', 'phase', 'reconciledAt'],
  ['code', 'runId', 'leaseFence', 'phase', 'reconciledAt'],
  {
    code: { type: 'string', enum: ['ABANDON_PENDING', 'ALREADY_APPLIED'] },
    runId: safeId,
    leaseFence: fence,
    phase: { type: 'string', enum: ['abandon_pending'] },
    reconciledAt: timestampSchema,
  }
);
const cleanupResponseSchema = {
  oneOf: [
    closedObject(
      ['code', 'targetRunId', 'targetLeaseFence', 'targetRunFenceDigest', 'state', 'committedRevision', 'remainingChildCount', 'chunkCommittedAt'],
      ['code', 'targetRunId', 'targetLeaseFence', 'targetRunFenceDigest', 'state', 'committedRevision', 'remainingChildCount', 'chunkCommittedAt'],
      {
        code: {
          type: 'string',
          enum: ['RUN_CLEANUP_PROGRESS', 'ALREADY_APPLIED'],
        },
        targetRunId: safeId,
        targetLeaseFence: fence,
        targetRunFenceDigest: digest,
        state: { type: 'string', enum: ['progress'] },
        committedRevision: { type: 'integer', minimum: 1, maximum: 63 },
        remainingChildCount: { type: 'integer', minimum: 1, maximum: 6_144 },
        chunkCommittedAt: timestampSchema,
      }
    ),
    closedObject(
      ['code', 'targetRunId', 'targetLeaseFence', 'targetRunFenceDigest', 'state', 'finalRevision', 'cleanedAt'],
      ['code', 'targetRunId', 'targetLeaseFence', 'targetRunFenceDigest', 'state', 'finalRevision', 'cleanedAt'],
      {
        code: { type: 'string', enum: ['RUN_CLEANED', 'ALREADY_APPLIED'] },
        targetRunId: safeId,
        targetLeaseFence: fence,
        targetRunFenceDigest: digest,
        state: { type: 'string', enum: ['cleaned'] },
        finalRevision: { type: 'integer', minimum: 1, maximum: 64 },
        cleanedAt: timestampSchema,
      }
    ),
  ],
} as const;
const controlAuthorizationResponseSchema = closedObject(
  ['code', 'authorization'],
  ['code', 'authorization'],
  {
    code: { type: 'string', enum: ['AUTHORIZED'] },
    authorization: closedObject(
      ['version', 'kind', 'eventId', 'leaseFence', 'payloadDigest', 'attestation'],
      ['version', 'kind', 'eventId', 'leaseFence', 'payloadDigest', 'attestation'],
      {
        version: { type: 'integer', enum: [1] },
        kind: { type: 'string', enum: ['matrix_corpus_control_mutation'] },
        eventId: safeId,
        leaseFence: fence,
        payloadDigest: digest,
        attestation: { type: 'string', minLength: 16, maxLength: 32_768 },
      }
    ),
  }
);

type OperationBody = Readonly<{ leaseFence: string; idempotencyKey: string }>;
type MatrixCorpusControlMutationOperationV1 = z.infer<
  typeof matrixCorpusControlMutationOperationV1Schema
>;
type ControlAuthorizationBody = Readonly<{
  leaseFence: string;
  operation: MatrixCorpusControlMutationOperationV1;
  request: Record<string, unknown>;
}>;
type RunParams = Readonly<{ runId: string }>;
type CapabilityBody = Readonly<{
  leaseFence: string;
  idempotencyKey: string;
  capability: string;
  scenarioId: string;
  scenarioNumber: number;
  scenarioLabel: string;
  promptNormalizationVersion: number;
  promptDigest: string;
  phase: 'start' | 'turn' | 'confirmation';
  turnIndex: number;
  expectedSessionId: string | null;
  pendingConfirmationId: string | null;
  expectedDecision: 'confirm' | 'reject' | null;
  mockProfile: unknown;
  mockProfileDigest: string;
  expectedToolSchedule: unknown;
  currentDateTime: string;
  timeZone: string;
}>;
type MatrixSendProofBody = Readonly<{
  leaseFence: string;
  idempotencyKey: string;
  capability: string;
  scenarioId: string;
  scenarioNumber: number;
  phase: 'start' | 'turn' | 'confirmation';
  turnIndex: number;
  matrixEventId: string;
  matrixRoomId: string;
  messageText: string;
}>;

export interface MatrixCorpusRoutesDependencies {
  gate: Readonly<{
    enabled: boolean;
    runtimeAudience: string;
    evaluator: Readonly<{
      userId: string;
      matrixRoomBindingDigest: string;
      whatsappAccountBindingDigest: string;
      whatsappSenderBindingDigest: string;
    }>;
  }>;
  digestMatrixIdempotencyKey(idempotencyKey: string): string;
  issueControlAuthorization(input: Readonly<{
    runtimeAudience: 'home-dev';
    runId: string;
    userId: string;
    leaseFence: string;
    matrixRoomBindingDigest: string;
    whatsappAccountBindingDigest: string;
    whatsappSenderBindingDigest: string;
    operation: MatrixCorpusControlMutationOperationV1;
    request: Record<string, unknown>;
  }>): Promise<unknown>;
  controlPlane: MatrixCorpusRouteControlPlane;
}

export function createMatrixCorpusRoutes(
  dependencies: MatrixCorpusRoutesDependencies
): FastifyPluginCallback {
  return (fastify, _options, done) => {
    if (!hasEnabledHomeDevGate(dependencies.gate)) {
      done();
      return;
    }

    fastify.get(
      '/internal/matrix-corpus/readiness',
      routeSchema(
        'getMatrixCorpusReadiness',
        'Verify the enabled Home Dev Matrix corpus boundary',
        {},
        readinessResponseSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        return await reply.ok({ status: 'ready' });
      }
    );

    fastify.post<{ Body: Readonly<{ runId: string; idempotencyKey: string }> }>(
      '/internal/matrix-corpus/runs',
      routeSchema('createMatrixCorpusRun', 'Create a Home Dev Matrix corpus run lease', {
        body: provisionBodySchema,
      }, provisionResponseSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        const evaluator = dependencies.gate.evaluator;
        return await execute(
          reply,
          () =>
            dependencies.controlPlane.acquireProvisioningLease({
              runtimeAudience: 'home-dev',
              runId: request.body.runId,
              userId: evaluator.userId,
              matrixRoomBindingDigest: evaluator.matrixRoomBindingDigest,
              whatsappAccountBindingDigest: evaluator.whatsappAccountBindingDigest,
              whatsappSenderBindingDigest: evaluator.whatsappSenderBindingDigest,
              idempotencyKey: request.body.idempotencyKey,
            }),
          provisioningLeaseResultSchema,
          ['ACQUIRED', 'ALREADY_APPLIED'],
          (result) => {
            const success = result as Extract<
              typeof result,
              Readonly<{ code: 'ACQUIRED' | 'ALREADY_APPLIED' }>
            >;
            return {
              code: success.code,
              runId: success.runId,
              phase: success.phase,
              leaseFence: success.leaseFence,
              acquiredAt: success.acquiredAt,
              expiresAt: success.expiresAt,
            };
          }
        );
      }
    );

    fastify.post<{ Params: RunParams; Body: OperationBody }>(
      '/internal/matrix-corpus/runs/:runId/activate',
      routeSchema('activateMatrixCorpusRun', 'Activate a Home Dev Matrix corpus run', {
        params: runParamsSchema,
        body: operationBodySchema,
      }, activationResponseSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        return await execute(
          reply,
          () => dependencies.controlPlane.activateRun(operationInput(dependencies, request)),
          activationResultSchema,
          ['ACTIVATED', 'ALREADY_APPLIED'],
          (result) => {
            const success = result as Extract<
              typeof result,
              Readonly<{ code: 'ACTIVATED' | 'ALREADY_APPLIED' }>
            >;
            return {
              code: success.code,
              runId: success.runId,
              leaseFence: success.leaseFence,
              phase: success.phase,
              activatedAt: success.activatedAt,
            };
          }
        );
      }
    );

    fastify.post<{ Params: RunParams; Body: OperationBody }>(
      '/internal/matrix-corpus/runs/:runId/lease/renew',
      routeSchema('renewMatrixCorpusRunLease', 'Renew a Home Dev Matrix corpus run lease', {
        params: runParamsSchema,
        body: operationBodySchema,
      }, renewResponseSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        return await execute(
          reply,
          () => dependencies.controlPlane.renewLease(operationInput(dependencies, request)),
          leaseRenewResultSchema,
          ['LEASE_RENEWED', 'ALREADY_APPLIED'],
          (result) => {
            const success = result as Extract<
              typeof result,
              Readonly<{ code: 'LEASE_RENEWED' | 'ALREADY_APPLIED' }>
            >;
            return {
              code: success.code,
              runId: success.runId,
              leaseFence: success.leaseFence,
              phase: success.phase,
              renewedAt: success.renewedAt,
              expiresAt: success.expiresAt,
            };
          }
        );
      }
    );

    fastify.post<{ Params: RunParams; Body: CapabilityBody }>(
      '/internal/matrix-corpus/runs/:runId/capabilities',
      routeSchema('issueMatrixCorpusCapability', 'Issue a write-only Matrix corpus capability', {
        params: runParamsSchema,
        body: capabilityBodySchema,
      }, capabilityResponseSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        const evaluator = dependencies.gate.evaluator;
        let matrixIdempotencyKeyDigest: string;
        try {
          matrixIdempotencyKeyDigest = dependencies.digestMatrixIdempotencyKey(
            request.body.idempotencyKey
          );
        } catch {
          return await safeControlFailure(reply, 'CORRUPT_STATE');
        }
        if (!matrixCorpusKeyedDigestSchema.safeParse(matrixIdempotencyKeyDigest).success)
          return await safeControlFailure(reply, 'CORRUPT_STATE');
        const parsed = matrixCorpusCapabilityIssueRequestV1Schema.safeParse({
          version: 1,
          runtimeAudience: 'home-dev',
          rawCapability: request.body.capability,
          runId: request.params.runId,
          leaseFence: request.body.leaseFence,
          userId: evaluator.userId,
          scenarioId: request.body.scenarioId,
          scenarioNumber: request.body.scenarioNumber,
          scenarioLabel: request.body.scenarioLabel,
          matrixRoomBindingDigest: evaluator.matrixRoomBindingDigest,
          whatsappAccountBindingDigest: evaluator.whatsappAccountBindingDigest,
          whatsappSenderBindingDigest: evaluator.whatsappSenderBindingDigest,
          matrixIdempotencyKeyDigest,
          promptNormalizationVersion: request.body.promptNormalizationVersion,
          promptDigest: request.body.promptDigest,
          phase: request.body.phase,
          turnIndex: request.body.turnIndex,
          expectedSessionId: request.body.expectedSessionId,
          pendingConfirmationId: request.body.pendingConfirmationId,
          expectedDecision: request.body.expectedDecision,
          mockProfile: request.body.mockProfile,
          mockProfileDigest: request.body.mockProfileDigest,
          expectedToolSchedule: request.body.expectedToolSchedule,
          currentDateTime: request.body.currentDateTime,
          timeZone: request.body.timeZone,
        });
        if (!parsed.success) return await invalidRequest(reply);
        return await execute(
          reply,
          () => dependencies.controlPlane.issueCapability(parsed.data),
          capabilityIssueResultSchema,
          ['CAPABILITY_ISSUED', 'ALREADY_APPLIED'],
          (result) => {
            const success = result as Extract<
              typeof result,
              Readonly<{ code: 'CAPABILITY_ISSUED' | 'ALREADY_APPLIED' }>
            >;
            return {
              code: success.code,
              runId: success.runId,
              leaseFence: request.body.leaseFence,
              scenarioId: success.scenarioId,
              phase: success.phase,
              turnIndex: success.turnIndex,
              issuedAt: success.issuedAt,
              expiresAt: success.expiresAt,
            };
          }
        );
      }
    );

    fastify.post<{ Params: RunParams; Body: MatrixSendProofBody }>(
      '/internal/matrix-corpus/runs/:runId/matrix-send-proofs',
      routeSchema(
        'recordMatrixCorpusSendProof',
        'Record one independently observed Matrix corpus outbound event',
        { params: runParamsSchema, body: matrixSendProofBodySchema },
        matrixSendProofResponseSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        const evaluator = dependencies.gate.evaluator;
        return await execute(
          reply,
          () =>
            dependencies.controlPlane.recordMatrixSendProof({
              runtimeAudience: 'home-dev',
              runId: request.params.runId,
              userId: evaluator.userId,
              leaseFence: request.body.leaseFence,
              matrixRoomBindingDigest: evaluator.matrixRoomBindingDigest,
              whatsappAccountBindingDigest: evaluator.whatsappAccountBindingDigest,
              whatsappSenderBindingDigest: evaluator.whatsappSenderBindingDigest,
              idempotencyKey: request.body.idempotencyKey,
              rawCapability: request.body.capability,
              scenarioId: request.body.scenarioId,
              scenarioNumber: request.body.scenarioNumber,
              phase: request.body.phase,
              turnIndex: request.body.turnIndex,
              matrixEventId: request.body.matrixEventId,
              matrixRoomId: request.body.matrixRoomId,
              messageText: request.body.messageText,
            }),
          matrixSendProofResultSchema,
          ['MATRIX_SEND_PROOF_RECORDED', 'ALREADY_APPLIED'],
          (result) => {
            const success = result as Extract<
              typeof result,
              Readonly<{ code: 'MATRIX_SEND_PROOF_RECORDED' | 'ALREADY_APPLIED' }>
            >;
            return {
              code: success.code,
              runId: success.runId,
              leaseFence: success.leaseFence,
              scenarioId: success.scenarioId,
              phase: success.phase,
              turnIndex: success.turnIndex,
              recordedAt: success.recordedAt,
            };
          }
        );
      }
    );

    fastify.post<{ Params: RunParams; Body: ControlAuthorizationBody }>(
      '/internal/matrix-corpus/runs/:runId/control-authorizations',
      routeSchema(
        'issueMatrixCorpusControlAuthorization',
        'Authorize one exact Intex Agent Matrix corpus mutation',
        {
          params: runParamsSchema,
          body: controlAuthorizationBodySchema,
        },
        controlAuthorizationResponseSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        let result: unknown;
        try {
          result = await dependencies.issueControlAuthorization({
            runtimeAudience: 'home-dev',
            runId: request.params.runId,
            userId: dependencies.gate.evaluator.userId,
            leaseFence: request.body.leaseFence,
            matrixRoomBindingDigest:
              dependencies.gate.evaluator.matrixRoomBindingDigest,
            whatsappAccountBindingDigest:
              dependencies.gate.evaluator.whatsappAccountBindingDigest,
            whatsappSenderBindingDigest:
              dependencies.gate.evaluator.whatsappSenderBindingDigest,
            operation: request.body.operation,
            request: request.body.request,
          });
        } catch {
          return await safeControlFailure(reply, 'CORRUPT_STATE');
        }
        const parsed = z
          .object({
            code: z.literal('AUTHORIZED'),
            authorization: matrixCorpusSignedControlMutationV1Schema,
          })
          .strict()
          .safeParse(result);
        if (!parsed.success) {
          const code =
            typeof result === 'object' &&
            result !== null &&
            'code' in result &&
            typeof result.code === 'string'
              ? result.code
              : 'CORRUPT_STATE';
          return await safeControlFailure(reply, code);
        }
        void reply.header('cache-control', noStore);
        return await reply.ok({
          code: 'AUTHORIZED',
          authorization: parsed.data.authorization,
        });
      }
    );

    fastify.get<{
      Params: RunParams;
      Querystring: Readonly<{ scenarioId?: string; turnIndex?: number }>;
      Headers: Readonly<{ 'x-matrix-corpus-lease-fence': string }>;
    }>(
      '/internal/matrix-corpus/runs/:runId/transport-status',
      routeSchema('getMatrixCorpusTransportStatus', 'Read safe Matrix corpus transport status', {
        params: runParamsSchema,
        querystring: statusQuerySchema,
        headers: {
          type: 'object',
          required: ['x-internal-auth', 'x-matrix-corpus-lease-fence'],
          properties: {
            'x-internal-auth': { type: 'string', minLength: 1, maxLength: 512 },
            'x-matrix-corpus-lease-fence': sensitiveFence,
          },
        },
      }, transportStatusResponseSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        return await execute(
          reply,
          () =>
            dependencies.controlPlane.getTransportStatus({
              runtimeAudience: 'home-dev',
              runId: request.params.runId,
              userId: dependencies.gate.evaluator.userId,
              leaseFence: request.headers['x-matrix-corpus-lease-fence'],
              matrixRoomBindingDigest:
                dependencies.gate.evaluator.matrixRoomBindingDigest,
              whatsappAccountBindingDigest:
                dependencies.gate.evaluator.whatsappAccountBindingDigest,
              whatsappSenderBindingDigest:
                dependencies.gate.evaluator.whatsappSenderBindingDigest,
            }),
          transportStatusResultSchema,
          ['TRANSPORT_STATUS'],
          (result) => {
            const success = result as Extract<
              typeof result,
              Readonly<{ code: 'TRANSPORT_STATUS' }>
            >;
            return {
              code: success.code,
              runId: success.runId,
              leaseFence: success.leaseFence,
              phase: success.phase,
              consumedCapabilityCount: success.consumedCapabilityCount,
              terminalIntexMarkerCount: success.terminalIntexMarkerCount,
              terminalOutboxCount: success.terminalOutboxCount,
              replyOrDeliveryWorkInFlight: success.replyOrDeliveryWorkInFlight,
              nonterminalIngestOutboxCount: success.nonterminalIngestOutboxCount,
              drained: success.drained,
            };
          }
        );
      }
    );

    fastify.post<{ Params: RunParams; Body: OperationBody }>(
      '/internal/matrix-corpus/runs/:runId/quiesce',
      routeSchema('quiesceMatrixCorpusRun', 'Quiesce a Home Dev Matrix corpus run', {
        params: runParamsSchema,
        body: operationBodySchema,
      }, quiesceResponseSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        return await execute(
          reply,
          () => dependencies.controlPlane.quiesceRun(operationInput(dependencies, request)),
          quiesceResultSchema,
          ['QUIESCED', 'ALREADY_APPLIED'],
          (result) => {
            const success = result as Extract<
              typeof result,
              Readonly<{ code: 'QUIESCED' | 'ALREADY_APPLIED' }>
            >;
            return {
              code: success.code,
              runId: success.runId,
              leaseFence: success.leaseFence,
              phase: success.phase,
              quiescedAt: success.quiescedAt,
              drained: success.drained,
            };
          }
        );
      }
    );

    fastify.post<{ Params: RunParams; Body: OperationBody }>(
      '/internal/matrix-corpus/runs/:runId/release',
      routeSchema('releaseMatrixCorpusRun', 'Release a drained Home Dev Matrix corpus run', {
        params: runParamsSchema,
        body: operationBodySchema,
      }, releaseResponseSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        return await execute(
          reply,
          () => dependencies.controlPlane.releaseRun(operationInput(dependencies, request)),
          releaseResultSchema,
          ['RELEASE_PENDING', 'ALREADY_APPLIED'],
          (result) => {
            const success = result as Extract<
              typeof result,
              Readonly<{ code: 'RELEASE_PENDING' | 'ALREADY_APPLIED' }>
            >;
            return {
              code: success.code,
              runId: success.runId,
              leaseFence: success.leaseFence,
              phase: 'release_pending',
              createdAt: success.createdAt,
            };
          }
        );
      }
    );

    fastify.post<{ Params: RunParams; Body: OperationBody }>(
      '/internal/matrix-corpus/runs/:runId/abort-provisioning',
      routeSchema(
        'abortProvisioningMatrixCorpusRun',
        'Abort a Home Dev Matrix corpus run before activation',
        { params: runParamsSchema, body: operationBodySchema },
        abortResponseSchema
      ),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        return await execute(
          reply,
          () => dependencies.controlPlane.abortProvisioningRun(operationInput(dependencies, request)),
          abandonPendingResultSchema,
          ['ABANDON_PENDING', 'ALREADY_APPLIED'],
          (result) => {
            const success = result as Extract<
              typeof result,
              Readonly<{ code: 'ABANDON_PENDING' | 'ALREADY_APPLIED' }>
            >;
            return {
              code: success.code,
              runId: success.runId,
              leaseFence: success.leaseFence,
              phase: 'abandon_pending',
              reconciledAt: success.reconciledAt,
            };
          }
        );
      }
    );

    fastify.post<{
      Params: RunParams;
      Body: Readonly<{
        leaseFence: string;
        targetRunId: string;
        targetLeaseFence: string;
        targetRunFenceDigest: string;
        expectedRevision: number;
        idempotencyKey: string;
      }>;
    }>(
      '/internal/matrix-corpus/runs/:runId/cleanup',
      routeSchema('cleanupMatrixCorpusRun', 'Clean one exact retained Matrix corpus run', {
        params: runParamsSchema,
        body: cleanupBodySchema,
      }, cleanupResponseSchema),
      async (request, reply) => {
        logIncomingRequest(request, MATRIX_CORPUS_REQUEST_LOG_OPTIONS);
        if (!(await authorizeAndValidate(request, reply))) return;
        return await execute(
          reply,
          () =>
            dependencies.controlPlane.cleanupExactRun({
              runtimeAudience: 'home-dev',
              runId: request.params.runId,
              userId: dependencies.gate.evaluator.userId,
              leaseFence: request.body.leaseFence,
              matrixRoomBindingDigest:
                dependencies.gate.evaluator.matrixRoomBindingDigest,
              whatsappAccountBindingDigest:
                dependencies.gate.evaluator.whatsappAccountBindingDigest,
              whatsappSenderBindingDigest:
                dependencies.gate.evaluator.whatsappSenderBindingDigest,
              targetRunId: request.body.targetRunId,
              targetLeaseFence: request.body.targetLeaseFence,
              targetRunFenceDigest: request.body.targetRunFenceDigest,
              expectedRevision: request.body.expectedRevision,
              idempotencyKey: request.body.idempotencyKey,
            }),
          cleanupResultSchema,
          ['RUN_CLEANUP_PROGRESS', 'RUN_CLEANED', 'ALREADY_APPLIED'],
          (result) => {
            if ('committedRevision' in result)
              return {
                code: result.code,
                targetRunId: result.targetRunId,
                targetLeaseFence: result.targetLeaseFence,
                targetRunFenceDigest: result.targetRunFenceDigest,
                state: 'progress',
                committedRevision: result.committedRevision,
                remainingChildCount: result.remainingChildCount,
                chunkCommittedAt: result.chunkCommittedAt,
              };
            const cleaned = result as Extract<typeof result, Readonly<{ finalRevision: number }>>;
            return {
              code: cleaned.code,
              targetRunId: cleaned.targetRunId,
              targetLeaseFence: cleaned.targetLeaseFence,
              targetRunFenceDigest: cleaned.targetRunFenceDigest,
              state: 'cleaned',
              finalRevision: cleaned.finalRevision,
              cleanedAt: cleaned.cleanedAt,
            };
          }
        );
      }
    );

    done();
  };
}

function closedObject(
  propertyNames: readonly string[],
  required: readonly string[],
  properties: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    propertyNames: { enum: propertyNames },
    required,
    properties,
  } as const;
}

function routeSchema(
  operationId: string,
  summary: string,
  schemas: Readonly<Record<string, unknown>>,
  successDataSchema: Readonly<Record<string, unknown>>
): Readonly<{
  attachValidation: true;
  schema: Readonly<Record<string, unknown>>;
}> {
  const withHeaders =
    schemas['headers'] === undefined
      ? {
          ...schemas,
          headers: {
            type: 'object',
            required: ['x-internal-auth'],
            properties: {
              'x-internal-auth': { type: 'string', minLength: 1, maxLength: 512 },
            },
          },
        }
      : schemas;
  return {
    attachValidation: true,
    schema: {
      operationId,
      summary,
      tags: ['internal'],
      ...withHeaders,
      response: {
        200: successEnvelope(successDataSchema),
        400: errorEnvelope(['INVALID_REQUEST']),
        401: errorEnvelope(['UNAUTHORIZED']),
        404: successEnvelope(domainFailureDataSchema),
        409: successEnvelope(domainFailureDataSchema),
        410: successEnvelope(domainFailureDataSchema),
        500: successEnvelope(domainFailureDataSchema),
      },
    },
  } as const;
}

const diagnosticsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId'],
  properties: {
    requestId: { type: 'string' },
    durationMs: { type: 'number' },
    downstreamStatus: { type: 'number' },
    downstreamRequestId: { type: 'string' },
    endpointCalled: { type: 'string' },
  },
} as const;
const domainFailureDataSchema = closedObject(['code'], ['code'], {
  code: { type: 'string', pattern: '^[A-Z][A-Z_]{1,63}$' },
});

function successEnvelope(
  dataSchema: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: dataSchema,
      diagnostics: diagnosticsSchema,
    },
  } as const;
}

function errorEnvelope(codes: readonly string[]): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: closedObject(['code', 'message'], ['code', 'message'], {
        code: { type: 'string', enum: codes },
        message: { type: 'string' },
      }),
      diagnostics: diagnosticsSchema,
    },
  } as const;
}

function operationInput(
  dependencies: MatrixCorpusRoutesDependencies,
  request: FastifyRequest<{ Params: RunParams; Body: OperationBody }>
): Parameters<MatrixCorpusRouteControlPlane['activateRun']>[0] {
  return {
    runtimeAudience: 'home-dev' as const,
    runId: request.params.runId,
    userId: dependencies.gate.evaluator.userId,
    leaseFence: request.body.leaseFence,
    matrixRoomBindingDigest: dependencies.gate.evaluator.matrixRoomBindingDigest,
    whatsappAccountBindingDigest:
      dependencies.gate.evaluator.whatsappAccountBindingDigest,
    whatsappSenderBindingDigest:
      dependencies.gate.evaluator.whatsappSenderBindingDigest,
    idempotencyKey: request.body.idempotencyKey,
  };
}

function hasEnabledHomeDevGate(gate: MatrixCorpusRoutesDependencies['gate']): boolean {
  return (
    gate.enabled &&
    gate.runtimeAudience === 'home-dev' &&
    matrixCorpusSafeIdSchema.safeParse(gate.evaluator.userId).success &&
    matrixCorpusKeyedDigestSchema.safeParse(gate.evaluator.matrixRoomBindingDigest).success &&
    matrixCorpusKeyedDigestSchema.safeParse(gate.evaluator.whatsappAccountBindingDigest).success &&
    matrixCorpusKeyedDigestSchema.safeParse(gate.evaluator.whatsappSenderBindingDigest).success
  );
}

async function authorize(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (validateInternalAuth(request).valid) return true;
  await reply.fail('UNAUTHORIZED', 'Matrix corpus control authorization failed');
  return false;
}

async function authorizeAndValidate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  if (!(await authorize(request, reply))) return false;
  if (
    (request as FastifyRequest & { validationError?: Error }).validationError !== undefined
  ) {
    await invalidRequest(reply);
    return false;
  }
  return true;
}

async function execute<T extends { code: string }>(
  reply: FastifyReply,
  call: () => Promise<unknown>,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  successCodes: readonly string[],
  project: (result: T) => Readonly<Record<string, unknown>>
): Promise<unknown> {
  let result: unknown;
  try {
    result = await call();
  } catch {
    return await safeControlFailure(reply, 'CORRUPT_STATE');
  }
  const parsed = schema.safeParse(result);
  if (!parsed.success) return await safeControlFailure(reply, 'CORRUPT_STATE');
  if (!successCodes.includes(parsed.data.code))
    return await safeControlFailure(reply, parsed.data.code);
  void reply.header('cache-control', noStore);
  return await reply.ok(project(parsed.data));
}

async function invalidRequest(reply: FastifyReply): Promise<unknown> {
  void reply.status(400);
  return await reply.fail('INVALID_REQUEST', 'Invalid Matrix corpus request');
}

async function safeControlFailure(reply: FastifyReply, code: string): Promise<unknown> {
  const status =
    code === 'NOT_FOUND'
      ? 404
      : code === 'LEASE_EXPIRED' || code === 'CAPABILITY_EXPIRED'
        ? 410
        : code === 'CORRUPT_STATE'
          ? 500
          : 409;
  void reply.header('cache-control', noStore);
  void reply.status(status);
  return await reply.ok({ code });
}
