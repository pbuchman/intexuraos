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
import {
  createInternalHttpClient,
  type InternalHttpClientError,
} from '../shared/createInternalHttpClient.js';
import type {
  AuthorizeOutboundDeliveryRetryInput,
  AuthorizeOutboundDeliveryRetryResult,
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
  GetOutboundDeliveryStateInput,
  OutboundDeliveryState,
  PrivateMatrixDeliveryStatus,
  QueryPrivateDigestMessagesInput,
  QueryPrivateDigestMessagesResult,
  SendPrivateOutboundMatrixMessageRequest,
  SendPrivateOutboundMatrixMessageResult,
  ValidatePrivateDigestSourceInput,
  ValidatedPrivateDigestSource,
  WhatsAppDigestClientResult,
  WhatsAppDeliveryReadiness,
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

const validatedPrivateDigestSourceSchema = z
  .object({
    sourceAccountId: z.string().min(1).max(512),
    generationId: z.string().min(1).max(512),
    chatId: z.string().min(1).max(4_096),
    chatType: z.enum(['group', 'direct']),
    displayName: z.string().min(1).max(512),
    messageCount: boundedIntegerSchema,
    participantCount: boundedIntegerSchema.optional(),
    lastActivityAt: timestampSchema.optional(),
    sourceRevision: z.string().min(1).max(8_192),
  })
  .strict();

const privateDigestMessageSchema = z
  .object({
    messageRef: z.string().min(1).max(8_192),
    eventTimestamp: timestampSchema,
    direction: z.enum(['inbound', 'outbound', 'system']),
    authorLabel: z.string().min(1).max(512),
    text: z.string().max(262_144),
    contentKind: z.enum(['text', 'media_caption', 'transcription', 'reaction', 'system']),
  })
  .strict();

const queryPrivateDigestMessagesResultSchema = z
  .object({
    messages: z.array(privateDigestMessageSchema).max(500),
    sourceRevision: z.string().min(1).max(8_192),
    highWatermark: z.string().min(1).max(8_192).nullable(),
    nextCursor: z.string().min(1).max(8_192).nullable(),
  })
  .strict();

const deliveryReadinessCommonSchema = {
  observationVersion: z.string().min(1).max(8_192),
  observedAt: timestampSchema,
};
const whatsAppDeliveryReadinessSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      maskedPrimaryNumber: z.string().min(1).max(64),
      ...deliveryReadinessCommonSchema,
    })
    .strict(),
  z
    .object({
      status: z.enum(['mapping_missing', 'disconnected', 'delivery_disabled']),
      ...deliveryReadinessCommonSchema,
    })
    .strict(),
]);

const outboundDeliveryStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['pending', 'missing']) }).strict(),
  z.object({ status: z.literal('sent'), acceptedAt: timestampSchema }).strict(),
  z.object({ status: z.literal('ambiguous'), acceptedAt: timestampSchema.optional() }).strict(),
  z
    .object({
      status: z.literal('failed'),
      failedAt: timestampSchema,
      failureCode: z.string().min(1).max(128),
    })
    .strict(),
]);

const authorizeOutboundDeliveryRetryResultSchema = z
  .object({ authorized: z.literal(true) })
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
    const error = response.error as Extract<
      InternalHttpClientError,
      { code: 'TIMEOUT' | 'NETWORK_ERROR' | 'API_ERROR' }
    >;
    if (error.code === 'TIMEOUT') {
      return { ok: false, error: { code: 'timeout' } };
    }
    if (error.code === 'NETWORK_ERROR') {
      return { ok: false, error: { code: 'unavailable' } };
    }
    return { ok: false, error: { code: 'rejected', httpStatus: error.status } };
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

async function requestPrivateDigest<T>(
  client: ReturnType<typeof createInternalHttpClient>,
  path: string,
  body: unknown,
  schema: z.ZodType<T>
): Promise<WhatsAppDigestClientResult<T>> {
  const response = await client.request<unknown>({
    path,
    method: 'POST',
    body,
    responseMode: 'raw',
    skipSentry: true,
    privateRequest: true,
  });
  if (!response.ok) {
    const error = response.error as Extract<
      InternalHttpClientError,
      { code: 'TIMEOUT' | 'NETWORK_ERROR' | 'API_ERROR' }
    >;
    if (error.code === 'TIMEOUT') {
      return { ok: false, error: { code: 'timeout' } };
    }
    if (error.code === 'NETWORK_ERROR') {
      return { ok: false, error: { code: 'unavailable' } };
    }
    if (error.status === 404) {
      return { ok: false, error: { code: 'not_found', httpStatus: 404 } };
    }
    if (error.status === 409) {
      const body = error.body;
      const envelope =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
      const envelopeError =
        envelope !== null && typeof envelope['error'] === 'object' && envelope['error'] !== null
          ? (envelope['error'] as Record<string, unknown>)
          : null;
      if (envelopeError?.['code'] === 'SOURCE_CHANGED') {
        return { ok: false, error: { code: 'source_changed', httpStatus: 409 } };
      }
    }
    return { ok: false, error: { code: 'rejected', httpStatus: error.status } };
  }
  const envelope = successEnvelopeSchema.safeParse(response.value);
  if (!envelope.success) return { ok: false, error: { code: 'invalid_response' } };
  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) return { ok: false, error: { code: 'invalid_response' } };
  return { ok: true, value: parsed.data };
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
    async validatePrivateDigestSource(
      input: ValidatePrivateDigestSourceInput
    ): Promise<WhatsAppDigestClientResult<ValidatedPrivateDigestSource>> {
      return await requestPrivateDigest(
        client,
        '/internal/whatsapp/private/digest-source/validate',
        input,
        validatedPrivateDigestSourceSchema
      );
    },

    async queryPrivateDigestMessages(
      input: QueryPrivateDigestMessagesInput
    ): Promise<WhatsAppDigestClientResult<QueryPrivateDigestMessagesResult>> {
      return await requestPrivateDigest(
        client,
        '/internal/whatsapp/private/digest-source/messages/query',
        input,
        queryPrivateDigestMessagesResultSchema
      );
    },

    async getWhatsAppDeliveryReadiness(
      userId: string
    ): Promise<WhatsAppDigestClientResult<WhatsAppDeliveryReadiness>> {
      return await requestPrivateDigest(
        client,
        '/internal/whatsapp/delivery-readiness/get',
        { userId },
        whatsAppDeliveryReadinessSchema
      );
    },

    async getOutboundDeliveryState(
      input: GetOutboundDeliveryStateInput
    ): Promise<WhatsAppDigestClientResult<OutboundDeliveryState>> {
      return await requestPrivateDigest(
        client,
        '/internal/whatsapp/outbound-deliveries/get',
        input,
        outboundDeliveryStateSchema
      );
    },

    async authorizeOutboundDeliveryRetry(
      input: AuthorizeOutboundDeliveryRetryInput
    ): Promise<WhatsAppDigestClientResult<AuthorizeOutboundDeliveryRetryResult>> {
      return await requestPrivateDigest(
        client,
        '/internal/whatsapp/outbound-deliveries/retry',
        input,
        authorizeOutboundDeliveryRetryResultSchema
      );
    },

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
