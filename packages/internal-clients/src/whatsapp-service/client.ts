import { err, ok, type Result } from '@intexuraos/common-core';
import {
  matrixCorpusCapabilityTokenSchema,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusExpectedToolScheduleV1Schema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSha256DigestSchema,
  matrixCorpusSignedControlMutationV1Schema,
  strictToolMockProfileV1Schema,
} from '@intexuraos/http-contracts';
import { z } from 'zod';
import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';
import type {
  MatrixCorpusActivateResult,
  MatrixCorpusAbortResult,
  MatrixCorpusCapabilityInput,
  MatrixCorpusCapabilityResult,
  MatrixCorpusCleanupInput,
  MatrixCorpusCleanupResult,
  MatrixCorpusClientResult,
  MatrixCorpusControlAuthorizationInput,
  MatrixCorpusControlAuthorizationResult,
  MatrixCorpusLeaseOperationInput,
  MatrixCorpusProvisionInput,
  MatrixCorpusProvisionResult,
  MatrixCorpusQuiesceResult,
  MatrixCorpusReleaseResult,
  MatrixCorpusRenewResult,
  MatrixCorpusSendProofInput,
  MatrixCorpusSendProofResult,
  MatrixCorpusTransportStatusInput,
  MatrixCorpusTransportStatusResult,
  PrivateMatrixDeliveryStatus,
  SendPrivateOutboundMatrixMessageRequest,
  SendPrivateOutboundMatrixMessageResult,
  WhatsAppServiceClient,
  WhatsAppServiceClientConfig,
} from './types.js';

const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const timestampSchema = matrixCorpusRfc3339TimestampSchema;
const boundedIntegerSchema = z.number().int().min(0).max(1_000_000);
const readinessSchema = z.object({ status: z.literal('ready') }).strict();
const leaseOperationSchema = z
  .object({
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const provisionInputSchema = z
  .object({ runId: matrixCorpusSafeIdSchema, idempotencyKey: idempotencyKeySchema })
  .strict();
const provisionResultSchema = z
  .object({
    code: z.enum(['ACQUIRED', 'ALREADY_APPLIED']),
    runId: matrixCorpusSafeIdSchema,
    phase: z.literal('provisioning'),
    leaseFence: matrixCorpusDecimalFenceSchema,
    acquiredAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();
const activateResultSchema = z
  .object({
    code: z.enum(['ACTIVATED', 'ALREADY_APPLIED']),
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    phase: z.literal('active'),
    activatedAt: timestampSchema,
  })
  .strict();
const renewResultSchema = z
  .object({
    code: z.enum(['LEASE_RENEWED', 'ALREADY_APPLIED']),
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    phase: z.literal('active'),
    renewedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();
const capabilityInputSchema = leaseOperationSchema
  .extend({
    capability: matrixCorpusCapabilityTokenSchema,
    scenarioId: matrixCorpusSafeIdSchema,
    scenarioNumber: z.number().int().min(1).max(20),
    scenarioLabel: z.string().min(1).max(128),
    promptNormalizationVersion: z.literal(1),
    promptDigest: matrixCorpusSha256DigestSchema,
    phase: z.enum(['start', 'turn', 'confirmation']),
    turnIndex: z.number().int().min(0).max(19),
    expectedSessionId: matrixCorpusSafeIdSchema.nullable(),
    pendingConfirmationId: matrixCorpusSafeIdSchema.nullable(),
    expectedDecision: z.enum(['confirm', 'reject']).nullable(),
    mockProfile: strictToolMockProfileV1Schema,
    mockProfileDigest: matrixCorpusSha256DigestSchema,
    expectedToolSchedule: matrixCorpusExpectedToolScheduleV1Schema,
    currentDateTime: timestampSchema,
    timeZone: z.string().min(1).max(128),
  })
  .strict();
const capabilityResultSchema = z
  .object({
    code: z.enum(['CAPABILITY_ISSUED', 'ALREADY_APPLIED']),
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    scenarioId: matrixCorpusSafeIdSchema,
    phase: z.enum(['start', 'turn', 'confirmation']),
    turnIndex: z.number().int().min(0).max(19),
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();
const matrixSendProofInputSchema = leaseOperationSchema
  .extend({
    capability: matrixCorpusCapabilityTokenSchema,
    scenarioId: matrixCorpusSafeIdSchema,
    scenarioNumber: z.number().int().min(1).max(20),
    phase: z.enum(['start', 'turn', 'confirmation']),
    turnIndex: z.number().int().min(0).max(19),
    matrixEventId: z
      .string()
      .min(2)
      .max(4_096)
      .regex(/^\$[^\s]+$/u),
    matrixRoomId: z
      .string()
      .min(4)
      .max(255)
      .regex(/^![^\s:]+:[^\s]+$/u),
    messageText: z.string().min(1).max(8_192),
  })
  .strict();
const matrixSendProofResultSchema = z
  .object({
    code: z.enum(['MATRIX_SEND_PROOF_RECORDED', 'ALREADY_APPLIED']),
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    scenarioId: matrixCorpusSafeIdSchema,
    phase: z.enum(['start', 'turn', 'confirmation']),
    turnIndex: z.number().int().min(0).max(19),
    recordedAt: timestampSchema,
  })
  .strict();
const controlAuthorizationInputSchema = z
  .object({
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    operation: z.enum([
      'register_context',
      'finalize_run',
      'create_projection',
      'advance_projection',
    ]),
    request: z.record(z.string(), z.unknown()),
  })
  .strict();
const controlAuthorizationResultSchema = z
  .object({
    code: z.literal('AUTHORIZED'),
    authorization: matrixCorpusSignedControlMutationV1Schema,
  })
  .strict();
const transportStatusInputSchema = z
  .object({
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    scenarioId: matrixCorpusSafeIdSchema.optional(),
    turnIndex: z.number().int().min(0).max(19).optional(),
  })
  .strict();
const transportStatusResultSchema = z
  .object({
    code: z.literal('TRANSPORT_STATUS'),
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    phase: z.enum([
      'provisioning',
      'active',
      'quiescing',
      'release_pending',
      'abandon_pending',
      'released',
      'abandoned',
    ]),
    consumedCapabilityCount: boundedIntegerSchema,
    terminalIntexMarkerCount: boundedIntegerSchema,
    terminalOutboxCount: boundedIntegerSchema,
    replyOrDeliveryWorkInFlight: boundedIntegerSchema,
    nonterminalIngestOutboxCount: z.number().int().min(0).max(1),
    drained: z.boolean(),
  })
  .strict();
const quiesceResultSchema = z
  .object({
    code: z.enum(['QUIESCED', 'ALREADY_APPLIED']),
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    phase: z.literal('quiescing'),
    quiescedAt: timestampSchema,
    drained: z.boolean(),
  })
  .strict();
const releaseResultSchema = z
  .object({
    code: z.enum(['RELEASE_PENDING', 'ALREADY_APPLIED']),
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    phase: z.literal('release_pending'),
    createdAt: timestampSchema,
  })
  .strict();
const abortResultSchema = z
  .object({
    code: z.enum(['ABANDON_PENDING', 'ALREADY_APPLIED']),
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    phase: z.literal('abandon_pending'),
    reconciledAt: timestampSchema,
  })
  .strict();
const cleanupInputSchema = leaseOperationSchema
  .extend({
    targetRunId: matrixCorpusSafeIdSchema,
    targetLeaseFence: matrixCorpusDecimalFenceSchema,
    targetRunFenceDigest: matrixCorpusSha256DigestSchema,
    expectedRevision: z.number().int().min(0).max(63),
  })
  .strict();
const cleanupResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      code: z.enum(['RUN_CLEANUP_PROGRESS', 'ALREADY_APPLIED']),
      targetRunId: matrixCorpusSafeIdSchema,
      targetLeaseFence: matrixCorpusDecimalFenceSchema,
      targetRunFenceDigest: matrixCorpusSha256DigestSchema,
      state: z.literal('progress'),
      committedRevision: z.number().int().min(1).max(63),
      remainingChildCount: z.number().int().min(1).max(6_144),
      chunkCommittedAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      code: z.enum(['RUN_CLEANED', 'ALREADY_APPLIED']),
      targetRunId: matrixCorpusSafeIdSchema,
      targetLeaseFence: matrixCorpusDecimalFenceSchema,
      targetRunFenceDigest: matrixCorpusSha256DigestSchema,
      state: z.literal('cleaned'),
      finalRevision: z.number().int().min(1).max(64),
      cleanedAt: timestampSchema,
    })
    .strict(),
]);

const diagnosticsSchema = z
  .object({
    requestId: z.string().min(1).max(512),
    durationMs: z.number().finite().nonnegative().optional(),
    downstreamStatus: z.number().int().min(100).max(599).optional(),
    downstreamRequestId: z.string().min(1).max(512).optional(),
    endpointCalled: z.string().min(1).max(4096).optional(),
  })
  .strict();

const successEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: z.unknown(),
    diagnostics: diagnosticsSchema.optional(),
  })
  .strict();

type WhatsAppClientResult<T> = Result<T>;

function invalidResponseError(): Error {
  return new Error('Invalid response from whatsapp-service');
}

async function parseResponse<T>(
  client: ReturnType<typeof createInternalHttpClient>,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<WhatsAppClientResult<T>> {
  const result = await client.request<T>({
    path,
    method,
    ...(body !== undefined ? { body } : {}),
    privateRequest: true,
    skipSentry: true,
  });

  if (result.ok) {
    return ok(result.value);
  }

  if (result.error.code === 'ENVELOPE_ERROR' || result.error.code === 'MALFORMED_ENVELOPE') {
    return err(invalidResponseError());
  }

  if (result.error.code === 'API_ERROR') {
    return err(new Error(`HTTP ${String(result.error.status)}: ${result.error.statusText}`));
  }

  return err(new Error(result.error.message));
}

async function requestMatrix<T>(
  client: ReturnType<typeof createInternalHttpClient>,
  input: {
    path: string;
    method: 'GET' | 'POST';
    body?: unknown;
    extraHeaders?: Record<string, string>;
  },
  schema: z.ZodType<T>
): Promise<MatrixCorpusClientResult<T>> {
  const response = await client.request<unknown>({
    path: input.path,
    method: input.method,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.extraHeaders === undefined ? {} : { extraHeaders: input.extraHeaders }),
    responseMode: 'raw',
    skipSentry: true,
    privateRequest: true,
  });
  if (!response.ok) {
    switch (response.error.code) {
      case 'TIMEOUT':
        return { ok: false, error: { code: 'timeout' } };
      case 'NETWORK_ERROR':
        return { ok: false, error: { code: 'unavailable' } };
      case 'API_ERROR':
        return {
          ok: false,
          error: { code: 'rejected', httpStatus: response.error.status },
        };
    }
    throw new Error('Unexpected internal HTTP client error');
  }
  const envelope = successEnvelopeSchema.safeParse(response.value);
  if (!envelope.success) return { ok: false, error: { code: 'invalid_response' } };
  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) return { ok: false, error: { code: 'invalid_response' } };
  return { ok: true, value: parsed.data };
}

function invalidMatrixInput<T>(): MatrixCorpusClientResult<T> {
  return { ok: false, error: { code: 'invalid_request' } };
}

function invalidMatrixResponse<T>(): MatrixCorpusClientResult<T> {
  return { ok: false, error: { code: 'invalid_response' } };
}

export function createWhatsAppServiceClient(
  config: WhatsAppServiceClientConfig
): WhatsAppServiceClient {
  const client = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
    ...(config.pathPrefix !== undefined ? { pathPrefix: config.pathPrefix } : {}),
    ...(config.authorizationHeaderProvider !== undefined
      ? { authorizationHeaderProvider: config.authorizationHeaderProvider }
      : {}),
  });

  return {
    async getMatrixCorpusReadiness(): ReturnType<
      WhatsAppServiceClient['getMatrixCorpusReadiness']
    > {
      return await requestMatrix(
        client,
        { path: '/internal/matrix-corpus/readiness', method: 'GET' },
        readinessSchema
      );
    },

    async getPrivateMatrixDeliveryStatus(
      userId: string
    ): Promise<WhatsAppClientResult<PrivateMatrixDeliveryStatus>> {
      return await parseResponse<PrivateMatrixDeliveryStatus>(
        client,
        `/internal/whatsapp/private/matrix-delivery-status/${encodeURIComponent(userId)}`,
        'GET'
      );
    },

    async sendPrivateOutboundMatrixMessage(
      request: SendPrivateOutboundMatrixMessageRequest
    ): Promise<WhatsAppClientResult<SendPrivateOutboundMatrixMessageResult>> {
      return await parseResponse<SendPrivateOutboundMatrixMessageResult>(
        client,
        '/internal/whatsapp/private/outbound-matrix-messages',
        'POST',
        request
      );
    },

    async provisionMatrixCorpusRun(
      input: MatrixCorpusProvisionInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusProvisionResult>> {
      const parsed = provisionInputSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const result = await requestMatrix(
        client,
        { path: '/internal/matrix-corpus/runs', method: 'POST', body: parsed.data },
        provisionResultSchema
      );
      if (result.ok && result.value.runId !== parsed.data.runId) return invalidMatrixResponse();
      return result;
    },

    async activateMatrixCorpusRun(
      input: MatrixCorpusLeaseOperationInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusActivateResult>> {
      const parsed = leaseOperationSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const { runId, ...body } = parsed.data;
      const result = await requestMatrix(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(runId)}/activate`,
          method: 'POST',
          body,
        },
        activateResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== runId || result.value.leaseFence !== parsed.data.leaseFence)
      )
        return invalidMatrixResponse();
      return result;
    },

    async renewMatrixCorpusLease(
      input: MatrixCorpusLeaseOperationInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusRenewResult>> {
      const parsed = leaseOperationSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const { runId, ...body } = parsed.data;
      const result = await requestMatrix(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(runId)}/lease/renew`,
          method: 'POST',
          body,
        },
        renewResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== runId || result.value.leaseFence !== parsed.data.leaseFence)
      )
        return invalidMatrixResponse();
      return result;
    },

    async issueMatrixCorpusCapability(
      input: MatrixCorpusCapabilityInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusCapabilityResult>> {
      const parsed = capabilityInputSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const { runId, ...body } = parsed.data;
      const result = await requestMatrix(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(runId)}/capabilities`,
          method: 'POST',
          body,
        },
        capabilityResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== runId ||
          result.value.leaseFence !== parsed.data.leaseFence ||
          result.value.scenarioId !== parsed.data.scenarioId ||
          result.value.phase !== parsed.data.phase ||
          result.value.turnIndex !== parsed.data.turnIndex)
      ) {
        return { ok: false, error: { code: 'invalid_response' } };
      }
      return result;
    },

    async recordMatrixCorpusSendProof(
      input: MatrixCorpusSendProofInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusSendProofResult>> {
      const parsed = matrixSendProofInputSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const { runId, ...body } = parsed.data;
      const result = await requestMatrix(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(runId)}/matrix-send-proofs`,
          method: 'POST',
          body,
        },
        matrixSendProofResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== runId ||
          result.value.leaseFence !== parsed.data.leaseFence ||
          result.value.scenarioId !== parsed.data.scenarioId ||
          result.value.phase !== parsed.data.phase ||
          result.value.turnIndex !== parsed.data.turnIndex)
      )
        return invalidMatrixResponse();
      return result;
    },

    async authorizeMatrixCorpusControl(
      input: MatrixCorpusControlAuthorizationInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusControlAuthorizationResult>> {
      const parsed = controlAuthorizationInputSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const { runId, ...body } = parsed.data;
      const result = await requestMatrix(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(runId)}/control-authorizations`,
          method: 'POST',
          body,
        },
        controlAuthorizationResultSchema
      );
      if (result.ok && result.value.authorization.leaseFence !== parsed.data.leaseFence) {
        return { ok: false, error: { code: 'invalid_response' } };
      }
      return result;
    },

    async getMatrixCorpusTransportStatus(
      input: MatrixCorpusTransportStatusInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusTransportStatusResult>> {
      const parsed = transportStatusInputSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const url = new URL(
        `/internal/matrix-corpus/runs/${encodeURIComponent(parsed.data.runId)}/transport-status`,
        'http://internal.invalid'
      );
      if (parsed.data.scenarioId !== undefined)
        url.searchParams.set('scenarioId', parsed.data.scenarioId);
      if (parsed.data.turnIndex !== undefined)
        url.searchParams.set('turnIndex', String(parsed.data.turnIndex));
      const result = await requestMatrix(
        client,
        {
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          extraHeaders: { 'x-matrix-corpus-lease-fence': parsed.data.leaseFence },
        },
        transportStatusResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== parsed.data.runId ||
          result.value.leaseFence !== parsed.data.leaseFence)
      )
        return invalidMatrixResponse();
      return result;
    },

    async quiesceMatrixCorpusRun(
      input: MatrixCorpusLeaseOperationInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusQuiesceResult>> {
      const parsed = leaseOperationSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const { runId, ...body } = parsed.data;
      const result = await requestMatrix(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(runId)}/quiesce`,
          method: 'POST',
          body,
        },
        quiesceResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== runId || result.value.leaseFence !== parsed.data.leaseFence)
      )
        return invalidMatrixResponse();
      return result;
    },

    async releaseMatrixCorpusRun(
      input: MatrixCorpusLeaseOperationInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusReleaseResult>> {
      const parsed = leaseOperationSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const { runId, ...body } = parsed.data;
      const result = await requestMatrix(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(runId)}/release`,
          method: 'POST',
          body,
        },
        releaseResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== runId || result.value.leaseFence !== parsed.data.leaseFence)
      )
        return invalidMatrixResponse();
      return result;
    },

    async abortProvisioningMatrixCorpusRun(
      input: MatrixCorpusLeaseOperationInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusAbortResult>> {
      const parsed = leaseOperationSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const { runId, ...body } = parsed.data;
      const result = await requestMatrix(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(runId)}/abort-provisioning`,
          method: 'POST',
          body,
        },
        abortResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== runId || result.value.leaseFence !== parsed.data.leaseFence)
      )
        return invalidMatrixResponse();
      return result;
    },

    async cleanupMatrixCorpusRun(
      input: MatrixCorpusCleanupInput
    ): Promise<MatrixCorpusClientResult<MatrixCorpusCleanupResult>> {
      const parsed = cleanupInputSchema.safeParse(input);
      if (!parsed.success) return invalidMatrixInput();
      const { runId, ...body } = parsed.data;
      const result = await requestMatrix(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(runId)}/cleanup`,
          method: 'POST',
          body,
        },
        cleanupResultSchema
      );
      if (
        result.ok &&
        (result.value.targetRunId !== parsed.data.targetRunId ||
          result.value.targetLeaseFence !== parsed.data.targetLeaseFence ||
          result.value.targetRunFenceDigest !== parsed.data.targetRunFenceDigest)
      )
        return invalidMatrixResponse();
      return result;
    },
  };
}
