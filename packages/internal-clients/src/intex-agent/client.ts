import {
  intexAgentToolNameV1Schema,
  matrixCorpusAgentModelSchema,
  matrixCorpusEvaluatorModelSchema,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSha256DigestSchema,
  matrixCorpusSignedControlMutationV1Schema,
  matrixCorpusSignedTerminalControlV1Schema,
} from '@intexuraos/http-contracts';
import { z } from 'zod';
import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';
import type { MatrixCorpusClientResult } from '../whatsapp-service/types.js';
import type {
  IntexAgentServiceClient,
  IntexAgentServiceClientConfig,
  MatrixCorpusAdmissionResult,
  MatrixCorpusArtifactDeliveryResult,
  IntexMatrixCorpusCleanupResult,
  MatrixCorpusContextResult,
  MatrixCorpusControlStatusResult,
  MatrixCorpusEvidenceResult,
  MatrixCorpusFinalizeResult,
  MatrixCorpusFinalizationReadinessResult,
  MatrixCorpusRetentionPlanResult,
  MatrixCorpusProjectionResult,
  MatrixCorpusScenarioStatusResult,
  MatrixCorpusTerminalControlResult,
} from './types.js';

const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = matrixCorpusRfc3339TimestampSchema;
const digest = matrixCorpusSha256DigestSchema;
const lifecycle = z.enum(['preflight', 'running', 'finalizing', 'completed', 'stopped']);
const verdict = z.enum(['pending', 'passed', 'failed', 'not_evaluated']);
const identitySchema = z
  .object({
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
  })
  .strict();
const authorizationSchema = matrixCorpusSignedControlMutationV1Schema;
const admissionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('admission_ready'),
      current: z.enum([
        'absent',
        'terminal_artifact_ready',
        'terminal_artifact_failed',
        'terminal_artifact_unknown',
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('admission_blocked'),
      reason: z.enum(['preflight', 'running', 'finalizing', 'artifact_pending', 'artifact_staged']),
    })
    .strict(),
  z.object({ kind: z.literal('not_ready') }).strict(),
]);
const registerContextSchema = z
  .object({
    runtimeAudience: z.literal('hetzner-prod'),
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    catalogDigest: digest,
    agentModel: matrixCorpusAgentModelSchema,
    evaluatorModel: matrixCorpusEvaluatorModelSchema,
    expectedTimeZone: z.literal('Europe/Warsaw'),
  })
  .strict();
const contextResultSchema = z
  .object({
    disposition: z.enum(['applied', 'already_applied']),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    promptPreferencesVersion: safeInteger,
    promptPreferencesDigest: digest,
    agentModel: matrixCorpusAgentModelSchema,
    userTimeZone: z.string().min(1).max(128),
    expiresAt: timestamp,
  })
  .strict();
const finalizeResultSchema = z
  .object({
    disposition: z.enum(['applied', 'already_applied']),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    tombstoneDigest: digest,
    scenarioContextCount: z.number().int().min(0).max(20),
    finalizedAt: timestamp,
  })
  .strict();
const controlStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_ready') }).strict(),
  z
    .object({
      kind: z.literal('status'),
      runId: matrixCorpusSafeIdSchema,
      userId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      lifecycle,
      revision: safeInteger,
      contextReady: z.literal(true),
      manifestReady: z.literal(true),
      preflightProjectionReady: z.boolean(),
      retentionReconciled: z.boolean(),
      contextFinalizationTombstoneDigest: digest.nullable(),
      terminalCandidateDigest: digest.nullable(),
      artifactStageDigest: digest.nullable(),
      terminalControlEventId: matrixCorpusSafeIdSchema.nullable(),
    })
    .strict(),
]);
const scenarioStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_ready') }).strict(),
  z
    .object({
      kind: z.literal('status'),
      runId: matrixCorpusSafeIdSchema,
      userId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      scenarioId: matrixCorpusSafeIdSchema,
      sessionId: matrixCorpusSafeIdSchema,
      eventRevision: safeInteger,
      lifecycle: z.enum(['running', 'completed', 'stopped']),
      pendingConfirmationId: matrixCorpusSafeIdSchema.nullable(),
    })
    .strict(),
]);
const finalizationReadinessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_ready') }).strict(),
  z
    .object({
      kind: z.literal('ready'),
      runId: matrixCorpusSafeIdSchema,
      userId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      revision: safeInteger,
      projectionDigest: digest,
      artifactStageDigest: digest,
    })
    .strict(),
]);
const retentionPlanSchema = identitySchema
  .extend({
    kind: z.literal('retention_plan'),
    records: z
      .array(
        z
          .object({
            runId: matrixCorpusSafeIdSchema,
            leaseFence: matrixCorpusDecimalFenceSchema,
            startedAt: timestamp,
            lifecycle,
            verdict,
            artifactDelivery: z.enum(['pending', 'staged', 'ready', 'failed', 'unknown']),
            completedAt: timestamp.nullable(),
            isCurrent: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(4),
  })
  .strict();
const factValueSchema = z.union([
  safeInteger,
  z.boolean(),
  z.enum(['list', 'count', 'codex', 'codex-xhigh', 'openrouter-free', 'planning', 'execution']),
]);
const factNameSchema = z.enum([
  'contentLength',
  'titleLength',
  'summaryLength',
  'promptLength',
  'queryLength',
  'originalMessageLength',
  'locationLength',
  'descriptionLength',
  'messageLength',
  'textLength',
  'tagsCount',
  'sourceMessageIdsCount',
  'attendeesCount',
  'resultCount',
  'maxResults',
  'expectedVersion',
  'currentVersion',
  'hasUrl',
  'hasSourceUrl',
  'hasCalendarId',
  'hasExpectedEtag',
  'hasEventStart',
  'hasEventEnd',
  'hasItemId',
  'hasLinearIssueId',
  'startMatchesCatalog',
  'endMatchesCatalog',
  'timeZoneMatchesCatalog',
  'mode',
  'workerType',
  'taskMode',
]);
const evidenceSchema = z
  .object({
    version: z.literal(1),
    eventRevision: safeInteger,
    toolEvidence: z
      .array(
        z
          .object({
            event: z.enum([
              'selected',
              'mock_completed',
              'mock_failed',
              'unexpected_known_no_execution',
            ]),
            toolName: intexAgentToolNameV1Schema,
            turnIndex: z.number().int().min(0).max(19),
            ordinal: z.number().int().min(1).max(20),
            facts: z
              .array(z.object({ name: factNameSchema, value: factValueSchema }).strict())
              .max(16),
          })
          .strict()
      )
      .max(100),
    agentUsage: z
      .array(
        z
          .object({
            turnIndex: z.number().int().min(0).max(19),
            stage: z.enum(['intent_classification', 'agent_generation', 'response_schema_repair']),
            callOrdinal: z.number().int().min(1).max(60),
            inputTokens: safeInteger,
            outputTokens: safeInteger,
            totalTokens: safeInteger,
            costNanoUsd: safeInteger,
          })
          .strict()
      )
      .max(60),
    agentUsageTotals: z
      .object({
        inputTokens: safeInteger,
        outputTokens: safeInteger,
        totalTokens: safeInteger,
        costNanoUsd: safeInteger,
      })
      .strict(),
    sessionProof: z
      .object({
        status: z.enum([
          'active',
          'waiting_for_user',
          'completed',
          'unsupported',
          'expired',
          'cancelled',
          'superseded',
        ]),
        startReason: z.enum([
          'no_active_session',
          'previous_completed',
          'previous_expired',
          'previous_superseded',
          'user_requested_new_session',
        ]),
        userMessageCount: z.number().int().min(0).max(20),
        sessionStartedCount: z.number().int().min(0).max(20),
        supersededSessionCount: z.number().int().min(0).max(20),
      })
      .strict(),
    turnTerminals: z
      .array(
        z.discriminatedUnion('status', [
          z
            .object({
              status: z.literal('completed'),
              turnIndex: z.number().int().min(0).max(19),
              replyCount: z.number().int().min(1).max(5),
              replyDigests: z.array(digest).min(1).max(5),
              terminalMarkerDigest: digest,
              recordedAt: timestamp,
            })
            .strict(),
          z
            .object({
              status: z.literal('failed'),
              turnIndex: z.number().int().min(0).max(19),
              failureCode: z.enum([
                'AMBIGUOUS_EXTERNAL_EFFECT',
                'REPLY_PUBLICATION_REJECTED',
                'EXECUTION_REJECTED',
              ]),
              terminalMarkerDigest: digest,
              recordedAt: timestamp,
            })
            .strict(),
        ])
      )
      .max(20),
    strictMockProof: z
      .object({
        version: z.literal(1),
        status: z.literal('passed'),
        executionMode: z.literal('strict_mock_tools'),
        mockProfileDigest: digest,
        productionExecutorResolutions: z.literal(0),
        productionExecutorAdmissions: z.literal(0),
      })
      .strict(),
  })
  .strict();
const projectionResultSchema = z
  .object({
    disposition: z.enum(['applied', 'already_applied']),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    revision: safeInteger,
    lifecycle,
    verdict,
  })
  .strict();
const artifactDeliverySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), failureCode: z.null(), updatedAt: timestamp }).strict(),
  z.object({ status: z.literal('staged'), failureCode: z.null(), updatedAt: timestamp }).strict(),
  z.object({ status: z.literal('ready'), failureCode: z.null(), updatedAt: timestamp }).strict(),
  z
    .object({
      status: z.literal('failed'),
      failureCode: z.enum([
        'REPORT_STAGING_INTERRUPTED',
        'REPORT_STAGING_FAILED',
        'REPORT_VALIDATION_FAILED',
        'REPORT_PUBLICATION_FAILED',
      ]),
      updatedAt: timestamp,
    })
    .strict(),
  z
    .object({
      status: z.literal('unknown'),
      failureCode: z.literal('REPORT_DELIVERY_STATUS_TIMEOUT'),
      updatedAt: timestamp,
    })
    .strict(),
]);
const artifactDeliveryResultSchema = projectionResultSchema
  .extend({ artifactDelivery: artifactDeliverySchema })
  .strict();
const removedSchema = z
  .object({
    runs: safeInteger,
    sessions: safeInteger,
    events: safeInteger,
    confirmations: safeInteger,
    ingestReceipts: safeInteger,
    scenarioProjections: safeInteger,
    scenarioContexts: safeInteger,
    runContexts: safeInteger,
    manifests: safeInteger,
  })
  .strict();
const cleanupResultSchema = z
  .object({
    disposition: z.enum(['applied', 'already_applied']),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    currentRevision: safeInteger,
    retentionReconciled: z.literal(true),
    removed: removedSchema,
  })
  .strict();
const terminalWinnerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('release'),
      eventId: matrixCorpusSafeIdSchema,
      payloadDigest: digest,
      outcome: z.enum(['completed_passed', 'completed_failed', 'stopped_not_evaluated']),
      acknowledgedAt: timestamp,
    })
    .strict(),
  z
    .object({
      kind: z.literal('abandoned'),
      eventId: matrixCorpusSafeIdSchema,
      payloadDigest: digest,
      outcome: z.enum(['stopped_not_evaluated', 'provisioning_noop', 'provisioning_rolled_back']),
      acknowledgedAt: timestamp,
    })
    .strict(),
]);
const terminalControlResultSchema = z
  .object({
    kind: z.literal('acknowledged'),
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    requestEventId: matrixCorpusSafeIdSchema,
    requestPayloadDigest: digest,
    winner: terminalWinnerSchema,
  })
  .strict();
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

export function createIntexAgentServiceClient(
  config: IntexAgentServiceClientConfig
): IntexAgentServiceClient {
  const client = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs: config.defaultTimeoutMs }),
    ...(config.pathPrefix === undefined ? {} : { pathPrefix: config.pathPrefix }),
    ...(config.authorizationHeaderProvider === undefined
      ? {}
      : { authorizationHeaderProvider: config.authorizationHeaderProvider }),
  });

  return {
    async getMatrixCorpusCurrentAcceptance(
      userId
    ): ReturnType<IntexAgentServiceClient['getMatrixCorpusCurrentAcceptance']> {
      if (!matrixCorpusSafeIdSchema.safeParse(userId).success) return invalidInput();
      const result = await request(
        client,
        {
          path: '/internal/matrix-corpus/current-acceptance',
          method: 'POST',
          body: { runtimeAudience: 'hetzner-prod', userId },
        },
        admissionSchema
      );
      return result;
    },

    async registerMatrixCorpusContext(
      input
    ): ReturnType<IntexAgentServiceClient['registerMatrixCorpusContext']> {
      if (
        !matrixCorpusSafeIdSchema.safeParse(input.runId).success ||
        !authorizationSchema.safeParse(input.authorization).success ||
        !registerContextSchema.safeParse(input.request).success
      )
        return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(input.runId)}/context`,
          method: 'POST',
          body: { authorization: input.authorization, request: input.request },
        },
        contextResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== input.runId ||
          result.value.userId !== input.request.userId ||
          result.value.leaseFence !== input.request.leaseFence ||
          result.value.agentModel !== input.request.agentModel)
      )
        return invalidInputResponse();
      return result;
    },

    async finalizeMatrixCorpusContext(
      input
    ): ReturnType<IntexAgentServiceClient['finalizeMatrixCorpusContext']> {
      if (
        !matrixCorpusSafeIdSchema.safeParse(input.runId).success ||
        !authorizationSchema.safeParse(input.authorization).success ||
        !isRecord(input.request)
      )
        return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(input.runId)}/context/finalize`,
          method: 'POST',
          body: { authorization: input.authorization, request: input.request },
        },
        finalizeResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== input.runId ||
          result.value.userId !== input.request.userId ||
          result.value.leaseFence !== input.request.leaseFence)
      )
        return invalidInputResponse();
      return result;
    },

    async getMatrixCorpusControlStatus(
      input
    ): ReturnType<IntexAgentServiceClient['getMatrixCorpusControlStatus']> {
      const parsed = identitySchema.safeParse(input);
      if (!parsed.success) return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(parsed.data.runId)}/control-status`,
          method: 'GET',
          extraHeaders: identityHeaders(parsed.data),
        },
        controlStatusSchema
      );
      if (
        result.ok &&
        result.value.kind === 'status' &&
        (result.value.runId !== parsed.data.runId ||
          result.value.userId !== parsed.data.userId ||
          result.value.leaseFence !== parsed.data.leaseFence)
      )
        return { ok: false, error: { code: 'invalid_response' } };
      return result;
    },

    async getMatrixCorpusEvidence(
      input
    ): ReturnType<IntexAgentServiceClient['getMatrixCorpusEvidence']> {
      const identity = identitySchema.safeParse({
        runId: input.runId,
        userId: input.userId,
        leaseFence: input.leaseFence,
      });
      if (
        !identity.success ||
        !matrixCorpusSafeIdSchema.safeParse(input.scenarioId).success ||
        !matrixCorpusSafeIdSchema.safeParse(input.sessionId).success ||
        !safeInteger.safeParse(input.eventRevision).success
      )
        return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(input.runId)}/scenarios/${encodeURIComponent(input.scenarioId)}/evidence`,
          method: 'GET',
          extraHeaders: {
            ...identityHeaders(input),
            'x-matrix-corpus-session-id': input.sessionId,
            'x-matrix-corpus-event-revision': String(input.eventRevision),
          },
        },
        evidenceSchema
      );
      if (result.ok && result.value.eventRevision !== input.eventRevision) {
        return { ok: false, error: { code: 'invalid_response' } };
      }
      return result;
    },

    async getMatrixCorpusScenarioStatus(
      input
    ): Promise<MatrixCorpusClientResult<MatrixCorpusScenarioStatusResult>> {
      const identity = identitySchema.safeParse({
        runId: input.runId,
        userId: input.userId,
        leaseFence: input.leaseFence,
      });
      if (!identity.success || !matrixCorpusSafeIdSchema.safeParse(input.scenarioId).success)
        return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(input.runId)}/scenarios/${encodeURIComponent(input.scenarioId)}/status`,
          method: 'GET',
          extraHeaders: identityHeaders(input),
        },
        scenarioStatusSchema
      );
      if (
        result.ok &&
        result.value.kind === 'status' &&
        (result.value.runId !== input.runId ||
          result.value.userId !== input.userId ||
          result.value.leaseFence !== input.leaseFence ||
          result.value.scenarioId !== input.scenarioId)
      )
        return invalidInputResponse();
      return result;
    },

    async getMatrixCorpusFinalizationReadiness(
      input
    ): Promise<MatrixCorpusClientResult<MatrixCorpusFinalizationReadinessResult>> {
      const identity = identitySchema.safeParse(input);
      if (!identity.success) return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(input.runId)}/finalization-readiness`,
          method: 'GET',
          extraHeaders: identityHeaders(input),
        },
        finalizationReadinessSchema
      );
      if (
        result.ok &&
        result.value.kind === 'ready' &&
        (result.value.runId !== input.runId ||
          result.value.userId !== input.userId ||
          result.value.leaseFence !== input.leaseFence)
      )
        return invalidInputResponse();
      return result;
    },

    async getMatrixCorpusRetentionPlan(
      input
    ): Promise<MatrixCorpusClientResult<MatrixCorpusRetentionPlanResult>> {
      const identity = identitySchema.safeParse(input);
      if (!identity.success) return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(input.runId)}/retention-plan`,
          method: 'GET',
          extraHeaders: identityHeaders(input),
        },
        retentionPlanSchema
      );
      if (
        result.ok &&
        (result.value.runId !== input.runId ||
          result.value.userId !== input.userId ||
          result.value.leaseFence !== input.leaseFence ||
          result.value.records.filter((record) => record.isCurrent).length !== 1 ||
          !result.value.records.some(
            (record) =>
              record.isCurrent &&
              record.runId === input.runId &&
              record.leaseFence === input.leaseFence
          ))
      )
        return invalidInputResponse();
      return result;
    },

    async mutateMatrixCorpusProjection(
      input
    ): ReturnType<IntexAgentServiceClient['mutateMatrixCorpusProjection']> {
      const expectedIdentity = readProjectionIdentity(input.request);
      if (
        !matrixCorpusSafeIdSchema.safeParse(input.runId).success ||
        !authorizationSchema.safeParse(input.authorization).success ||
        expectedIdentity === null
      )
        return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/test-runs/${encodeURIComponent(input.runId)}/projection`,
          method: 'PUT',
          body: { authorization: input.authorization, request: input.request },
        },
        projectionResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== input.runId ||
          result.value.userId !== expectedIdentity.userId ||
          result.value.leaseFence !== expectedIdentity.leaseFence)
      )
        return invalidInputResponse();
      return result;
    },

    async mutateMatrixCorpusArtifactDelivery(
      input
    ): ReturnType<IntexAgentServiceClient['mutateMatrixCorpusArtifactDelivery']> {
      const parsed = identitySchema.safeParse({
        runId: input.runId,
        userId: input.userId,
        leaseFence: input.leaseFence,
      });
      if (!parsed.success || !isRecord(input.command)) return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/test-runs/${encodeURIComponent(input.runId)}/artifact-delivery`,
          method: 'PUT',
          body: input.command,
          extraHeaders: identityHeaders(input),
        },
        artifactDeliveryResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== parsed.data.runId ||
          result.value.userId !== parsed.data.userId ||
          result.value.leaseFence !== parsed.data.leaseFence)
      )
        return invalidInputResponse();
      return result;
    },

    async applyMatrixCorpusTerminalControl(
      input
    ): ReturnType<IntexAgentServiceClient['applyMatrixCorpusTerminalControl']> {
      if (
        !matrixCorpusSafeIdSchema.safeParse(input.runId).success ||
        !matrixCorpusSignedTerminalControlV1Schema.safeParse(input.envelope).success
      )
        return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(input.runId)}/terminal-control`,
          method: 'POST',
          body: input.envelope,
        },
        terminalControlResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== input.runId ||
          result.value.leaseFence !== input.envelope.leaseFence ||
          result.value.requestEventId !== input.envelope.eventId ||
          result.value.requestPayloadDigest !== input.envelope.payloadDigest)
      )
        return invalidInputResponse();
      return result;
    },

    async cleanupMatrixCorpusRun(
      input
    ): ReturnType<IntexAgentServiceClient['cleanupMatrixCorpusRun']> {
      const parsed = identitySchema.safeParse({
        runId: input.runId,
        userId: input.userId,
        leaseFence: input.leaseFence,
      });
      if (!parsed.success || !isRecord(input.request)) return invalidInput();
      const result = await request(
        client,
        {
          path: `/internal/matrix-corpus/runs/${encodeURIComponent(input.runId)}/cleanup`,
          method: 'POST',
          body: input.request,
          extraHeaders: identityHeaders(input),
        },
        cleanupResultSchema
      );
      if (
        result.ok &&
        (result.value.runId !== parsed.data.runId ||
          result.value.userId !== parsed.data.userId ||
          result.value.leaseFence !== parsed.data.leaseFence)
      )
        return invalidInputResponse();
      return result;
    },
  };
}

async function request<T>(
  client: ReturnType<typeof createInternalHttpClient>,
  input: {
    path: string;
    method: 'GET' | 'POST' | 'PUT';
    body?: unknown;
    extraHeaders?: Record<string, string>;
  },
  schema: z.ZodType<T>
): Promise<MatrixCorpusClientResult<T>> {
  const response = await client.request<unknown>({
    ...input,
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
        return { ok: false, error: { code: 'rejected', httpStatus: response.error.status } };
    }
    throw new Error('Unexpected internal HTTP client error');
  }
  const envelope = successEnvelopeSchema.safeParse(response.value);
  if (!envelope.success) return { ok: false, error: { code: 'invalid_response' } };
  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) return { ok: false, error: { code: 'invalid_response' } };
  return { ok: true, value: parsed.data };
}

function identityHeaders(input: { userId: string; leaseFence: string }): Record<string, string> {
  return {
    'x-matrix-corpus-runtime-audience': 'hetzner-prod',
    'x-matrix-corpus-user-id': input.userId,
    'x-matrix-corpus-lease-fence': input.leaseFence,
  };
}

function invalidInput<T>(): MatrixCorpusClientResult<T> {
  return { ok: false, error: { code: 'invalid_request' } };
}

function invalidInputResponse<T>(): MatrixCorpusClientResult<T> {
  return { ok: false, error: { code: 'invalid_response' } };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readProjectionIdentity(
  request: unknown
): { readonly userId: string; readonly leaseFence: string } | null {
  if (!isRecord(request)) return null;
  let candidate: { readonly userId: unknown; readonly leaseFence: unknown };
  if (request['kind'] === 'create') {
    const record = request['record'];
    if (!isRecord(record)) return null;
    candidate = { userId: record['userId'], leaseFence: record['leaseFence'] };
  } else if (request['kind'] === 'cas') {
    candidate = { userId: request['userId'], leaseFence: request['leaseFence'] };
  } else {
    return null;
  }
  const parsed = identitySchema.pick({ userId: true, leaseFence: true }).safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export type {
  MatrixCorpusAdmissionResult,
  MatrixCorpusArtifactDeliveryResult,
  IntexMatrixCorpusCleanupResult,
  MatrixCorpusContextResult,
  MatrixCorpusControlStatusResult,
  MatrixCorpusEvidenceResult,
  MatrixCorpusFinalizeResult,
  MatrixCorpusProjectionResult,
  MatrixCorpusTerminalControlResult,
};
