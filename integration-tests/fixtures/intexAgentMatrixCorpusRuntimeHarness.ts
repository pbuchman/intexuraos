/* eslint-disable @typescript-eslint/array-type, @typescript-eslint/explicit-function-return-type -- integration fixture methods intentionally preserve inferred runtime client literals */
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { ok } from '@intexuraos/common-core';
import { intexuraFastifyPlugin } from '@intexuraos/common-http';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import {
  createIntexAgentServiceClient,
  createWhatsAppServiceClient,
  type IntexAgentServiceClient,
  type WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import {
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  IntexAgentModels,
  type ToolCallingClient,
  type ToolDefinition,
} from '@intexuraos/llm-contract';
import Fastify, { type FastifyInstance } from 'fastify';

import type { IntexAgentIntentClassifier } from '../../apps/intex-agent/src/domain/agent/intentClassifier.js';
import type { PromptPreferencesRepository } from '../../apps/intex-agent/src/domain/ports/promptPreferencesRepository.js';
import { emptyPromptPreferences } from '../../apps/intex-agent/src/domain/preferences/promptPreferences.js';
import { FirestoreSessionRepository } from '../../apps/intex-agent/src/infra/firestore/sessionRepository.js';
import { applyTestRunProjectionCas } from '../../apps/intex-agent/src/domain/testRuns/stateMachine.js';
import { testRunProjectionCasCommandV1Schema } from '../../apps/intex-agent/src/domain/testRuns/types.js';
import { createInternalRoutes as createIntexInternalRoutes } from '../../apps/intex-agent/src/routes/internalRoutes.js';
import { createMatrixCorpusRoutes as createIntexMatrixCorpusRoutes } from '../../apps/intex-agent/src/routes/matrixCorpusRoutes.js';
import {
  createIntexMatrixCorpusRuntime,
  createMatrixCorpusRunner,
} from '../../apps/intex-agent/src/services.js';
import type { EventPublisherPort } from '../../apps/whatsapp-service/src/domain/whatsapp/ports/eventPublisher.js';
import { parseMatrixCorpusVisibleMessage } from '../../apps/whatsapp-service/src/domain/matrixCorpus/visibleHeader.js';
import { createIntexAgentMatrixCorpusClient } from '../../apps/whatsapp-service/src/infra/http/intexAgentMatrixCorpusClient.js';
import { createMatrixCorpusRoutes as createWhatsAppMatrixCorpusRoutes } from '../../apps/whatsapp-service/src/routes/matrixCorpusRoutes.js';
import { createWhatsAppMatrixCorpusRuntime } from '../../apps/whatsapp-service/src/services.js';
import type {
  MatrixClient,
  MatrixTimelineEvent,
} from '../../tools/intex-agent-evals/src/live/matrixClient.js';
import type { MiniMaxEvaluator } from '../../tools/intex-agent-evals/src/minimaxJudge.js';
import { loadCanonicalMatrixCorpus } from '../../tools/intex-agent-evals/src/matrixCorpus/catalog.js';
import { MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX } from '../../tools/intex-agent-evals/src/matrixCorpus/correlation.js';
import { createProductionMatrixCorpusExecutor } from '../../tools/intex-agent-evals/src/matrixCorpus/liveExecution.js';
import { createNodeMatrixCorpusRetentionSagaPort } from '../../tools/intex-agent-evals/src/matrixCorpus/retentionExecution.js';
import type { MatrixCorpusPreparedContext } from '../../tools/intex-agent-evals/src/matrixCorpus/liveRuntime.js';
import {
  MATRIX_CORPUS_PREFLIGHT_CHECKS,
  type MatrixCorpusPreflightResult,
} from '../../tools/intex-agent-evals/src/matrixCorpus/preflight.js';
import type {
  CanonicalMatrixCorpus,
  CanonicalMatrixCorpusScenario,
} from '../../tools/intex-agent-evals/src/matrixCorpus/types.js';

const NOW = '2026-07-21T10:00:00.000Z';
const RUN_ID = 'eval-123e4567-e89b-42d3-a456-426614174000';
const USER_ID = 'auth0|private-user-sentinel';
const INTERNAL_AUTH_TOKEN = 'matrix-corpus-composition-internal-auth';
const MATRIX_USER_ID = '@private_user_sentinel:example.test';
const MATRIX_ROOM_ID = '!private-room-sentinel:example.test';
const MATRIX_PUPPET_ID = '@whatsapp_lid-private-puppet-sentinel:example.test';
const WHATSAPP_ACCOUNT_BINDING = 'private-whatsapp-account-sentinel';
const WHATSAPP_SENDER_BINDING = 'private-whatsapp-sender-sentinel';
const REVISION = 'a'.repeat(40);
const AGENT_MODEL = IntexAgentModels.DeepSeekV4Flash;

export interface IntexAgentMatrixCorpusRuntimeMetrics {
  readonly matrixMessages: string[];
  readonly deepSeekCalls: Array<{
    readonly modelId: typeof AGENT_MODEL;
    readonly scenarioId: string;
    readonly turnIndex: number;
    readonly callOrdinal: number;
  }>;
  miniMaxJudgeCalls: number;
  ingestPublications: number;
  terminalPublications: number;
  replyPublications: number;
  maxConcurrentTurns: number;
  readonly projectionMutations: Array<{
    readonly kind: 'create' | 'cas';
    readonly outcome: 'ok' | 'failed';
    readonly code?: string;
    readonly httpStatus?: number;
  }>;
  readonly repositoryProjectionFailures: string[];
  readonly stateMachineProjectionFailures: string[];
  readonly projectionCommandValidationFailures: string[];
  readonly retentionPlans: Array<{
    readonly outcome: 'ok' | 'failed';
    readonly recordCount?: number;
    readonly records?: ReadonlyArray<{
      readonly lifecycle: string;
      readonly artifactDelivery: string;
      readonly isCurrent: boolean;
    }>;
    readonly code?: string;
    readonly httpStatus?: number;
  }>;
  retentionSagaProbe: 'ok' | 'failed' | 'not_run';
  readonly retentionSagaLoads: Array<{
    readonly outcome: 'ok' | 'failed';
    readonly sagaCount?: number;
  }>;
  readonly controlAuthorizations: Array<{
    readonly operation: string;
    readonly outcome: 'ok' | 'failed';
    readonly code?: string;
    readonly httpStatus?: number;
  }>;
  readonly leaseRenewals: Array<{
    readonly outcome: 'ok' | 'failed';
    readonly code?: string;
    readonly httpStatus?: number;
  }>;
  readonly capabilityIssues: Array<{
    readonly scenarioId: string;
    readonly turnIndex: number;
    readonly outcome: 'ok' | 'failed';
    readonly code?: string;
    readonly httpStatus?: number;
    readonly transportBefore?: Readonly<{
      readonly phase: string;
      readonly nonterminalIngestOutboxCount: number;
      readonly replyOrDeliveryWorkInFlight: number;
      readonly drained: boolean;
    }>;
  }>;
}

export interface IntexAgentMatrixCorpusRuntimeHarness {
  readonly runtimeCompositionProven: true;
  readonly runId: string;
  readonly repositoryRoot: string;
  readonly result: Awaited<ReturnType<ReturnType<typeof createProductionMatrixCorpusExecutor>>>;
  readonly metrics: IntexAgentMatrixCorpusRuntimeMetrics;
  readonly cleanup: () => Promise<void>;
}

interface MatrixBoundaryState {
  readonly events: MatrixTimelineEvent[];
  cursor: number;
  eventOrdinal: number;
  activeTurns: number;
}

export async function createIntexAgentMatrixCorpusRuntimeHarness(): Promise<IntexAgentMatrixCorpusRuntimeHarness> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'intex-matrix-runtime-composition-'));
  const scenariosDirectory = fileURLToPath(
    new URL('../../tools/intex-agent-evals/scenarios/', import.meta.url)
  );
  const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
  const now = createMonotonicNow(NOW);
  const previousInternalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

  const metrics: IntexAgentMatrixCorpusRuntimeMetrics = {
    matrixMessages: [],
    deepSeekCalls: [],
    miniMaxJudgeCalls: 0,
    ingestPublications: 0,
    terminalPublications: 0,
    replyPublications: 0,
    maxConcurrentTurns: 0,
    projectionMutations: [],
    repositoryProjectionFailures: [],
    stateMachineProjectionFailures: [],
    projectionCommandValidationFailures: [],
    retentionPlans: [],
    retentionSagaProbe: 'not_run',
    retentionSagaLoads: [],
    controlAuthorizations: [],
    leaseRenewals: [],
    capabilityIssues: [],
  };
  const matrixState: MatrixBoundaryState = {
    events: [],
    cursor: 0,
    eventOrdinal: 0,
    activeTurns: 0,
  };
  const firestore = createFakeFirestore();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const logger = privacySafeLogger();
  const promptPreferences = promptPreferencesRepository();
  const deepSeek = createDeepSeekBoundary(catalog, metrics);
  const classifier = createCatalogIntentClassifier(catalog);
  const sessionRepository = new FirestoreSessionRepository({ firestore: firestore as never });
  const intexRuntime = createIntexMatrixCorpusRuntime(
    {
      enabled: true,
      runtimeAudience: 'home-dev',
      signingKeyVersion: 'matrix-composition-v1',
      signingKeyMaterial: 'injected-public-key',
      evaluatorUserId: USER_ID,
      contextEncryptionKeyVersion: 'context-composition-v1',
      contextEncryptionKeyMaterial: Buffer.alloc(32, 7).toString('base64url'),
    },
    {
      firestore: firestore as never,
      verificationKey: publicKey,
      promptPreferencesRepository: promptPreferences,
      runtimeSettingsClient: {
        async resolveIntexAgentRuntimeSettings() {
          return ok({
            status: 'available' as const,
            effectiveModel: AGENT_MODEL,
            explicitModel: AGENT_MODEL,
            source: 'explicit' as const,
            revision: 1,
            timeZone: 'Europe/Warsaw',
          });
        },
      },
      sessionRepository,
      createRunner: ({ execution, userPreferences }) =>
        createMatrixCorpusRunner({
          execution,
          client: deepSeek,
          intentClassifier: classifier,
          userPreferences,
        }),
      replyPublisher: {
        async publishReplyWithReceipt(input) {
          metrics.replyPublications += 1;
          matrixState.eventOrdinal += 1;
          const matrixBody =
            input.buttons !== undefined && input.buttons.length > 0
              ? `${input.message}${MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX}`
              : input.message;
          matrixState.events.push({
            eventId: `$matrix_reply_${String(matrixState.eventOrdinal)}`,
            originServerTs: Date.parse(NOW) + matrixState.eventOrdinal,
            type: 'm.room.message',
            sender: MATRIX_PUPPET_ID,
            content: { msgtype: 'm.text', body: matrixBody },
          });
          return { publicationReceiptId: `reply_publication_${String(metrics.replyPublications)}` };
        },
      },
      now,
    }
  );
  const applyProjection = intexRuntime.testRunRepository.applyProjection.bind(
    intexRuntime.testRunRepository
  );
  intexRuntime.testRunRepository.applyProjection = async (input) => {
    const current = await intexRuntime.testRunRepository.getExact(input.identity);
    if (current.ok) {
      const transition = applyTestRunProjectionCas(current.record, input.command);
      if (!transition.ok) metrics.stateMachineProjectionFailures.push(transition.code);
    }
    const result = await applyProjection(input);
    if (!result.ok) metrics.repositoryProjectionFailures.push(result.code);
    return result;
  };

  const intexApp = await startIntexApp(intexRuntime);
  const intexUrl = localUrl(intexApp);
  const intexControlClient = createIntexAgentMatrixCorpusClient({
    baseUrl: intexUrl,
    internalAuthToken: INTERNAL_AUTH_TOKEN,
    logger,
  });
  const eventPublisher = createEventPublisher(intexApp, metrics);
  const whatsappConfig = {
    enabled: true as const,
    runtimeAudience: 'home-dev' as const,
    evaluatorBindingHmacKey: 'composition-binding-key-with-at-least-thirty-two-bytes',
    configuredEvaluatorUserId: USER_ID,
    matrixRoomBinding: MATRIX_ROOM_ID,
    whatsappAccountBinding: WHATSAPP_ACCOUNT_BINDING,
    whatsappSenderBinding: WHATSAPP_SENDER_BINDING,
    signingKeyVersion: 'matrix-composition-v1',
    signingKeyMaterial: 'injected-private-key',
  };
  const whatsappRuntime = createWhatsAppMatrixCorpusRuntime({
    config: whatsappConfig,
    serviceConfig: {
      mediaBucket: 'composition-bucket',
      gcpProjectId: 'composition-project',
      mediaCleanupTopic: 'composition-media-cleanup',
      audioStoredTopic: 'composition-audio',
      intexMessageIngestTopic: 'composition-intex-ingest',
      whatsappAccessToken: 'private-whatsapp-token-sentinel',
      whatsappPhoneNumberId: 'private-phone-id-sentinel',
      webAgentUrl: 'https://web-agent.example.test',
      internalAuthToken: INTERNAL_AUTH_TOKEN,
      llmUsageServiceUrl: 'https://usage.example.test',
      userServiceUrl: 'https://users.example.test',
      messageDigestServiceUrl: 'https://message-digest-service.example.test',
      conversationAssistantModel: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
      matrixOutboundAdapterBaseUrl: 'https://matrix-adapter.example.test',
      matrixOutboundAdapterAuthToken: 'private-matrix-adapter-token-sentinel',
      intexAgentBaseUrl: intexUrl,
      matrixCorpus: whatsappConfig,
    },
    eventPublisher,
    dependencies: {
      firestore: firestore as never,
      intexAgent: intexControlClient,
      privateKey,
      logger: logger as never,
      scheduler: {
        setInterval: () => Symbol('composition-timer'),
        clearInterval: () => undefined,
      },
      now,
      workerNonce: 'composition-worker',
    },
  });
  const whatsappApp = await startWhatsAppApp(whatsappRuntime.routes);
  const whatsappControl = createWhatsAppServiceClient({
    baseUrl: localUrl(whatsappApp),
    internalAuthToken: INTERNAL_AUTH_TOKEN,
    defaultTimeoutMs: 15_000,
    logger,
  });
  const matrix = createMatrixBoundary(matrixState);
  const whatsapp = createWhatsAppBoundary({
    control: whatsappControl,
    runtime: whatsappRuntime,
    matrixState,
    metrics,
  });
  const rawIntex = createIntexAgentServiceClient({
    baseUrl: intexUrl,
    internalAuthToken: INTERNAL_AUTH_TOKEN,
    defaultTimeoutMs: 15_000,
    logger,
  });
  const intex: IntexAgentServiceClient = {
    ...rawIntex,
    async getMatrixCorpusRetentionPlan(input) {
      const result = await rawIntex.getMatrixCorpusRetentionPlan(input);
      metrics.retentionPlans.push(
        result.ok
          ? {
              outcome: 'ok',
              recordCount: result.value.records.length,
              records: result.value.records.map(({ lifecycle, artifactDelivery, isCurrent }) => ({
                lifecycle,
                artifactDelivery,
                isCurrent,
              })),
            }
          : {
              outcome: 'failed',
              code: result.error.code,
              ...(result.error.httpStatus === undefined
                ? {}
                : { httpStatus: result.error.httpStatus }),
            }
      );
      return result;
    },
    async mutateMatrixCorpusProjection(input) {
      if (input.request.kind === 'cas') {
        const parsed = testRunProjectionCasCommandV1Schema.safeParse(input.request.command);
        if (!parsed.success) {
          metrics.projectionCommandValidationFailures.push(
            ...parsed.error.issues.map(
              ({ path, message }) => `${path.map(String).join('.')}:${message}`
            )
          );
        }
      }
      const result = await rawIntex.mutateMatrixCorpusProjection(input);
      metrics.projectionMutations.push(
        result.ok
          ? { kind: input.request.kind, outcome: 'ok' }
          : {
              kind: input.request.kind,
              outcome: 'failed',
              code: result.error.code,
              ...(result.error.httpStatus === undefined
                ? {}
                : { httpStatus: result.error.httpStatus }),
            }
      );
      return result;
    },
  };
  const evaluator = createMiniMaxBoundary(metrics);
  const nodeRetentionSagas = createNodeMatrixCorpusRetentionSagaPort(
    join(repositoryRoot, '.artifacts', 'intex-agent-evals')
  );
  const retentionSagas = {
    ...nodeRetentionSagas,
    async load() {
      const result = await nodeRetentionSagas.load();
      metrics.retentionSagaLoads.push(
        result.ok ? { outcome: 'ok', sagaCount: result.sagas.length } : { outcome: 'failed' }
      );
      return result;
    },
  };
  const cleanup = async (): Promise<void> => {
    await whatsappRuntime.recoveryController.stop();
    await Promise.all([whatsappApp.close(), intexApp.close()]);
    await rm(repositoryRoot, { recursive: true, force: true });
    if (previousInternalAuthToken === undefined) {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    } else {
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = previousInternalAuthToken;
    }
  };

  try {
    const sagaProbe = await retentionSagas.load();
    metrics.retentionSagaProbe = sagaProbe.ok ? 'ok' : 'failed';
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot,
      matrix,
      whatsapp,
      intex,
      evaluator,
      retentionSagas,
      correlationTimeoutMs: 1_000,
      pollIntervalMs: 5,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY: whatsappConfig.evaluatorBindingHmacKey,
      },
      now: () => new Date(now()),
    });
    const result = await execute({
      runId: RUN_ID,
      preflight: passingPreflight(catalog),
      prepared: preparedContext(),
    });
    return {
      runtimeCompositionProven: true,
      runId: RUN_ID,
      repositoryRoot,
      result,
      metrics,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function startIntexApp(
  runtime: ReturnType<typeof createIntexMatrixCorpusRuntime>
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(intexuraFastifyPlugin);
  await app.register(createIntexMatrixCorpusRoutes(runtime));
  await app.register(
    createIntexInternalRoutes({
      handleOrdinary: () => Promise.reject(new Error('ordinary ingest crossed test boundary')),
      matrixCorpus: runtime,
    })
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  return app;
}

async function startWhatsAppApp(
  routes: Parameters<typeof createWhatsAppMatrixCorpusRoutes>[0]
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(intexuraFastifyPlugin);
  await app.register(createWhatsAppMatrixCorpusRoutes(routes));
  await app.listen({ host: '127.0.0.1', port: 0 });
  return app;
}

function localUrl(app: FastifyInstance): string {
  const address = app.server.address() as AddressInfo | null;
  if (address === null) throw new Error('composition server has no bound address');
  return `http://127.0.0.1:${String(address.port)}`;
}

function createEventPublisher(
  intexApp: FastifyInstance,
  metrics: IntexAgentMatrixCorpusRuntimeMetrics
): EventPublisherPort {
  return {
    async publishMediaCleanup() {
      return ok(undefined);
    },
    async publishAudioStored() {
      return ok(undefined);
    },
    async publishMediaTranscriptionRequested() {
      return ok(undefined);
    },
    async publishIntexMessageIngest() {
      return ok(undefined);
    },
    async publishMatrixCorpusIngest(event) {
      metrics.ingestPublications += 1;
      const response = await intexApp.inject({
        method: 'POST',
        url: '/internal/intex-agent/messages',
        headers: {
          from: 'noreply@google.com',
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify(event), 'utf8').toString('base64'),
            messageId: `composition_pubsub_${String(metrics.ingestPublications)}`,
          },
        },
      });
      const body = response.json() as Readonly<{
        success?: boolean;
        data?: Readonly<{ accepted?: boolean; state?: string }>;
      }>;
      if (response.statusCode !== 202 || body.success !== true || body.data?.accepted !== true) {
        throw new Error('real Intex ingest route rejected the signed composition event');
      }
      return ok({ publisherReceiptDigest: sha256(JSON.stringify(event)) });
    },
    async publishWebhookProcess() {
      return ok(undefined);
    },
    async publishExtractLinkPreviews() {
      return ok(undefined);
    },
    async publishConversationAssistantPreparation() {
      return ok(undefined);
    },
    async publishConversationAssistantContextAttachmentPreparation() {
      return ok(undefined);
    },
  };
}

function createWhatsAppBoundary(input: {
  readonly control: WhatsAppServiceClient;
  readonly runtime: ReturnType<typeof createWhatsAppMatrixCorpusRuntime>;
  readonly matrixState: MatrixBoundaryState;
  readonly metrics: IntexAgentMatrixCorpusRuntimeMetrics;
}): WhatsAppServiceClient {
  return {
    ...input.control,
    async authorizeMatrixCorpusControl(request) {
      const result = await input.control.authorizeMatrixCorpusControl(request);
      input.metrics.controlAuthorizations.push(
        result.ok
          ? { operation: request.operation, outcome: 'ok' }
          : {
              operation: request.operation,
              outcome: 'failed',
              code: result.error.code,
              ...(result.error.httpStatus === undefined
                ? {}
                : { httpStatus: result.error.httpStatus }),
            }
      );
      return result;
    },
    async renewMatrixCorpusLease(request) {
      const result = await input.control.renewMatrixCorpusLease(request);
      input.metrics.leaseRenewals.push(
        result.ok
          ? { outcome: 'ok' }
          : {
              outcome: 'failed',
              code: result.error.code,
              ...(result.error.httpStatus === undefined
                ? {}
                : { httpStatus: result.error.httpStatus }),
            }
      );
      return result;
    },
    async issueMatrixCorpusCapability(request) {
      const status = await input.control.getMatrixCorpusTransportStatus({
        runId: request.runId,
        leaseFence: request.leaseFence,
      });
      const transportBefore = status.ok
        ? {
            phase: status.value.phase,
            nonterminalIngestOutboxCount: status.value.nonterminalIngestOutboxCount,
            replyOrDeliveryWorkInFlight: status.value.replyOrDeliveryWorkInFlight,
            drained: status.value.drained,
          }
        : undefined;
      const result = await input.control.issueMatrixCorpusCapability(request);
      input.metrics.capabilityIssues.push(
        result.ok
          ? {
              scenarioId: request.scenarioId,
              turnIndex: request.turnIndex,
              outcome: 'ok',
              ...(transportBefore === undefined ? {} : { transportBefore }),
            }
          : {
              scenarioId: request.scenarioId,
              turnIndex: request.turnIndex,
              outcome: 'failed',
              ...(transportBefore === undefined ? {} : { transportBefore }),
              code: result.error.code,
              ...(result.error.httpStatus === undefined
                ? {}
                : { httpStatus: result.error.httpStatus }),
            }
      );
      return result;
    },
    async sendPrivateOutboundMatrixMessage(request) {
      input.matrixState.activeTurns += 1;
      input.metrics.maxConcurrentTurns = Math.max(
        input.metrics.maxConcurrentTurns,
        input.matrixState.activeTurns
      );
      input.metrics.matrixMessages.push(request.text);
      input.matrixState.eventOrdinal += 1;
      const matrixEventId = `$matrix_outbound_${String(input.matrixState.eventOrdinal)}`;
      input.matrixState.events.push({
        eventId: matrixEventId,
        originServerTs: Date.parse(NOW) + input.matrixState.eventOrdinal,
        type: 'm.room.message',
        sender: MATRIX_USER_ID,
        content: { msgtype: 'm.text', body: request.text },
      });
      const parsed = parseMatrixCorpusVisibleMessage(request.text);
      if (parsed.kind !== 'matrix_corpus') {
        throw new Error('real WhatsApp visible-header parser rejected the evaluator message');
      }
      const transportOrdinal = input.metrics.matrixMessages.length;
      const consumed = await input.runtime.ingress.consumeReservedMessage({
        message: parsed,
        userId: USER_ID,
        transportMessageId: `composition_transport_${String(transportOrdinal)}`,
        webhookEventId: `composition_webhook_${String(transportOrdinal)}`,
        senderPhoneNumber: WHATSAPP_SENDER_BINDING,
        recipientPhoneNumber: 'composition-recipient',
        whatsappAccountId: WHATSAPP_ACCOUNT_BINDING,
        timestamp: NOW,
      });
      if (consumed.code !== 'INGEST_ENQUEUED' && consumed.code !== 'ALREADY_APPLIED') {
        throw new Error(`real WhatsApp ingress rejected the message: ${consumed.code}`);
      }
      await input.runtime.recoveryController.tickDrain();
      await input.runtime.recoveryController.tickDrain();
      input.matrixState.activeTurns -= 1;
      return ok({ status: 'sent' as const, matrixEventId });
    },
    async releaseMatrixCorpusRun(operation) {
      const result = await input.control.releaseMatrixCorpusRun(operation);
      await input.runtime.recoveryController.tickDrain();
      input.metrics.terminalPublications += result.ok ? 1 : 0;
      return result;
    },
    async abortProvisioningMatrixCorpusRun(operation) {
      const result = await input.control.abortProvisioningMatrixCorpusRun(operation);
      await input.runtime.recoveryController.tickDrain();
      return result;
    },
  };
}

function createMatrixBoundary(state: MatrixBoundaryState): MatrixClient {
  return {
    async whoAmI() {
      return { ok: true, userId: MATRIX_USER_ID };
    },
    async syncTargetRoom(input) {
      state.cursor += 1;
      if (input.timeoutMs === 0) {
        return {
          ok: true,
          nextBatch: `composition_batch_${String(state.cursor)}`,
          limited: false,
          events: [],
        };
      }
      const event = state.events.shift();
      return {
        ok: true,
        nextBatch: `composition_batch_${String(state.cursor)}`,
        limited: false,
        events: event === undefined ? [] : [event],
      };
    },
  };
}

function createDeepSeekBoundary(
  catalog: CanonicalMatrixCorpus,
  metrics: IntexAgentMatrixCorpusRuntimeMetrics
): ToolCallingClient {
  return {
    async run(params) {
      const context = params.matrixCorpusContext;
      if (context === undefined) throw new Error('DeepSeek boundary requires Matrix context');
      const entry = requiredEntry(catalog, context.scenarioId);
      const selectedTools = expectedToolsForNormalTurn(entry, context.turnIndex);
      const expectsClarification =
        entry.scenario.expected.turns[context.turnIndex]?.timeline.requiredEventTypes.includes(
          'clarification_requested'
        ) === true;
      let toolCallsMade = 0;
      let content: string;
      if (selectedTools.length === 0 && expectsClarification) {
        const isAttendeeUpdate = entry.scenario.id === 'intex-eval-008';
        content = JSON.stringify({
          outcome: 'needs_clarification',
          reply: isAttendeeUpdate
            ? 'What is the attendee email address?'
            : 'Which date should I use?',
          blockerReason: 'missing_required_details',
          missingFields: [isAttendeeUpdate ? 'attendee_email' : 'date'],
          candidateIntents: [isAttendeeUpdate ? 'update_calendar_event' : 'create_calendar_event'],
          suggestedNextStep: isAttendeeUpdate
            ? 'Provide the attendee email address.'
            : 'Provide the missing calendar date.',
          clarification: isAttendeeUpdate
            ? 'What is the attendee email address?'
            : 'Which date should I use?',
        });
      } else if (selectedTools.length === 0) {
        content = JSON.stringify({
          outcome: 'completed',
          reply: `Scenario ${String(entry.scenarioNumber).padStart(3, '0')} turn ${String(context.turnIndex + 1)} acknowledged.`,
        });
      } else {
        let terminalSelection: (typeof selectedTools)[number] | undefined;
        let terminalArgs: Record<string, unknown> | undefined;
        for (const selectedTool of selectedTools) {
          const tool = requiredTool(params.tools, selectedTool.toolName);
          const args = toolArgs(
            entry,
            selectedTool.toolName,
            params.messages.map(({ content }) => content)
          );
          await tool.run(args);
          terminalSelection = selectedTool;
          terminalArgs = args;
        }
        if (terminalSelection === undefined || terminalArgs === undefined) {
          throw new Error('DeepSeek boundary did not select a terminal tool');
        }
        toolCallsMade = selectedTools.length;
        content = JSON.stringify({
          outcome: terminalSelection.confirmationPreview ? 'needs_confirmation' : 'completed',
          reply: terminalSelection.confirmationPreview
            ? 'Please confirm the synthetic action.'
            : 'The synthetic action completed.',
          toolName: terminalSelection.toolName,
          ...(terminalSelection.confirmationPreview ? { toolArgs: terminalArgs } : {}),
        });
      }
      const iterationCount = toolCallsMade + 1;
      const providerCalls = Array.from({ length: iterationCount }, (_, index) => {
        const callOrdinal = context.callOrdinal + index;
        metrics.deepSeekCalls.push({
          modelId: AGENT_MODEL,
          scenarioId: context.scenarioId,
          turnIndex: context.turnIndex,
          callOrdinal,
        });
        return {
          context: { ...context, callOrdinal },
          modelId: AGENT_MODEL,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          providerReportedUsd: 0.000001,
        };
      });
      return ok({
        content,
        toolCallsMade,
        iterationCount,
        usage: {
          inputTokens: iterationCount,
          outputTokens: iterationCount,
          totalTokens: iterationCount * 2,
          costUsd: iterationCount * 0.000001,
        },
        providerCalls,
      });
    },
  };
}

function createCatalogIntentClassifier(catalog: CanonicalMatrixCorpus): IntexAgentIntentClassifier {
  return {
    async classify(input) {
      const located = locateMessage(catalog, input.message);
      const expected = expectedToolsForNormalTurn(located.entry, located.turnIndex);
      return expected.length === 0
        ? { kind: 'no_action' as const, reason: 'conversation' as const }
        : {
            kind: 'tool' as const,
            allowedToolNames: expected.map(({ toolName }) => toolName),
          };
    },
  };
}

function expectedToolsForNormalTurn(
  entry: CanonicalMatrixCorpusScenario,
  turnIndex: number
): readonly Readonly<{
  toolName: CanonicalMatrixCorpusScenario['expectedToolSchedule'][number]['toolName'];
  confirmationPreview: boolean;
}>[] {
  const current =
    entry.scenario.expected.turns[turnIndex]?.requiredToolCalls.map(({ toolName }) => ({
      toolName,
      confirmationPreview: false,
    })) ?? [];
  const nextTurn = entry.scenario.turns[turnIndex + 1];
  const next = entry.scenario.expected.turns[turnIndex + 1]?.requiredToolCalls[0];
  return nextTurn?.kind === 'confirmation_button' && next !== undefined
    ? [...current, { toolName: next.toolName, confirmationPreview: true }]
    : current;
}

function locateMessage(
  catalog: CanonicalMatrixCorpus,
  message: string
): Readonly<{ entry: CanonicalMatrixCorpusScenario; turnIndex: number }> {
  for (const entry of catalog.scenarios) {
    for (let turnIndex = 0; turnIndex < entry.scenario.turns.length; turnIndex += 1) {
      const turn = entry.scenario.turns[turnIndex];
      if (turn?.kind === 'message' && message.endsWith(turn.text)) return { entry, turnIndex };
    }
  }
  throw new Error('classifier could not bind the message to the canonical catalog');
}

function requiredEntry(
  catalog: CanonicalMatrixCorpus,
  scenarioId: string
): CanonicalMatrixCorpusScenario {
  const entry = catalog.scenarios.find(({ scenario }) => scenario.id === scenarioId);
  if (entry === undefined) throw new Error('DeepSeek boundary received an unknown scenario');
  return entry;
}

function requiredTool(tools: readonly ToolDefinition[], toolName: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (tool === undefined) throw new Error(`DeepSeek boundary did not receive ${toolName}`);
  return tool;
}

function toolArgs(
  entry: CanonicalMatrixCorpusScenario,
  toolName: CanonicalMatrixCorpusScenario['expectedToolSchedule'][number]['toolName'],
  messageHistory: readonly string[]
): Record<string, unknown> {
  const message = messageHistory.at(-1) ?? 'Synthetic Matrix corpus message.';
  const history = messageHistory.join('\n');
  const configuredCall = entry.mockProfile.calls.find((call) => call.toolName === toolName);
  const configuredResult =
    configuredCall?.outcome.kind === 'success' ? configuredCall.outcome.result : undefined;
  switch (toolName) {
    case 'create_note':
      return { content: history, title: `Synthetic ${entry.scenario.id}` };
    case 'create_calendar_event':
      return {
        summary: `Synthetic ${entry.scenario.id}`,
        start: calendarStart(entry.scenario.id),
        end: calendarEnd(entry.scenario.id),
        timeZone: 'Europe/Warsaw',
        location: 'Synthetic location',
      };
    case 'update_calendar_event':
      return {
        eventId: mockCalendarEventField(configuredResult, 'eventId'),
        eventSummary: mockCalendarEventField(configuredResult, 'summary'),
        attendeesToAdd: ['synthetic-attendee@example.com'],
      };
    case 'query_calendar_events':
      if (entry.scenario.id === 'intex-eval-008') {
        return {
          mode: 'list',
          timeMin: '2026-07-16T10:00:00+02:00',
          timeMax: '2026-08-16T10:00:00+02:00',
          query: 'INTEX-EVAL-008 project review INTEX-EVAL-008-F01',
        };
      }
      return {
        mode: 'list',
        timeMin: '2026-07-17T00:00:00.000+02:00',
        timeMax: '2026-07-18T00:00:00.000+02:00',
      };
    case 'create_research':
      return { title: `Synthetic ${entry.scenario.id}`, prompt: message };
    case 'create_link':
      return {
        url: /https?:\/\/\S+/u.exec(message)?.[0] ?? 'https://example.invalid/synthetic',
        title: `Synthetic ${entry.scenario.id}`,
      };
    case 'create_code_task':
      return { prompt: message, workerType: 'minimax', taskMode: 'planning' };
    case 'save_external':
      return { message };
    case 'get_user_preferences':
      return {};
    case 'add_user_preference':
      return {
        text: message,
        expectedVersion: preferencePreviousVersion(configuredResult),
      };
    case 'update_user_preference':
      return {
        itemId: preferenceChangedItemId(configuredResult),
        text: message,
        expectedVersion: preferencePreviousVersion(configuredResult),
      };
    case 'delete_user_preference':
      return {
        itemId: preferenceChangedItemId(configuredResult),
        expectedVersion: preferencePreviousVersion(configuredResult),
      };
  }
}

function mockCalendarEventField(value: unknown, field: 'eventId' | 'summary'): string {
  if (value === null || typeof value !== 'object') {
    throw new Error(`calendar update mock result has no ${field}`);
  }
  const record = value as Record<string, unknown>;
  const fieldValue = record[field];
  if (typeof fieldValue !== 'string') {
    throw new Error(`calendar update mock result has no ${field}`);
  }
  return fieldValue;
}

function preferencePreviousVersion(value: unknown): number {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('currentVersion' in value) ||
    typeof value.currentVersion !== 'number'
  ) {
    throw new Error('preference mock result has no version');
  }
  return value.currentVersion - 1;
}

function preferenceChangedItemId(value: unknown): string {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('changedItemId' in value) ||
    typeof value.changedItemId !== 'string'
  ) {
    throw new Error('preference mock result has no changed item');
  }
  return value.changedItemId;
}

function calendarStart(scenarioId: string): string {
  if (scenarioId === 'intex-eval-002') return '2026-08-18T14:30:00+02:00';
  if (scenarioId === 'intex-eval-008') return '2026-07-23T15:00:00+02:00';
  return '2026-07-21T12:00:00+02:00';
}

function calendarEnd(scenarioId: string): string {
  if (scenarioId === 'intex-eval-002') return '2026-08-18T15:15:00+02:00';
  if (scenarioId === 'intex-eval-008') return '2026-07-23T16:00:00+02:00';
  return '2026-07-21T13:00:00+02:00';
}

function createMiniMaxBoundary(metrics: IntexAgentMatrixCorpusRuntimeMetrics): MiniMaxEvaluator {
  return {
    async probe() {
      return { ok: true };
    },
    async judgeReplies(inputs) {
      metrics.miniMaxJudgeCalls += inputs.length;
      return {
        ok: true,
        verdicts: inputs.map((input) => ({
          scenarioId: input.scenarioId,
          turnIndex: input.turnIndex,
          replyIndex: input.replyIndex,
          pass: true,
          score: 5 as const,
          criteria: {
            understoodIntent: true,
            helpful: true,
            conciseAndClear: true,
            professionalTone: true,
            noPassiveAggression: true,
          },
          failures: [],
          rationale: 'Sanitized reply satisfies the scenario criteria.',
        })),
        usage: {
          logicalCalls: inputs.length,
          repairCount: 0,
          inputTokens: inputs.length * 10,
          outputTokens: inputs.length * 5,
          totalTokens: inputs.length * 15,
          providerReportedUsd: inputs.length * 0.000001,
          providerReportedUsdComplete: true,
        },
      };
    },
    async judgeMatrixSmokeReply() {
      throw new Error('Matrix smoke judge crossed corpus composition');
    },
  };
}

function promptPreferencesRepository(): PromptPreferencesRepository {
  return {
    async getCurrent(userId) {
      return emptyPromptPreferences(userId);
    },
    async listVersions() {
      return [];
    },
    async getVersion() {
      return null;
    },
    async addItem() {
      throw new Error('production prompt preference write crossed test boundary');
    },
    async updateItem() {
      throw new Error('production prompt preference write crossed test boundary');
    },
    async deleteItem() {
      throw new Error('production prompt preference write crossed test boundary');
    },
  };
}

function passingPreflight(
  catalog: CanonicalMatrixCorpus
): Extract<MatrixCorpusPreflightResult, { ok: true }> {
  return {
    ok: true,
    exitCode: 0,
    checks: MATRIX_CORPUS_PREFLIGHT_CHECKS,
    catalog,
    snapshot: {
      requestedRevision: REVISION,
      deployedRevision: REVISION,
      localCriticalPathsClean: true,
      remoteCriticalPathsClean: true,
      runtimeAudience: 'home-dev',
      environmentAlias: 'dev',
      protectedConfigReady: true,
      servicesReady: true,
      clocksReady: true,
      userReady: true,
      accountTupleCount: 1,
      matrixReady: true,
      whatsappReady: true,
      capabilityBoundaryReady: true,
      strictMockToolCount: 11,
      catalogDigest: catalog.catalogDigest,
      scenarioCount: 20,
      turnCount: 59,
      catalogMatchesTracked: true,
      agentModel: AGENT_MODEL,
      evaluatorModel: 'or:minimax/minimax-m3',
      modelBoundaryReady: true,
      runAdmission: 'absent',
      artifactRootReady: true,
      artifactCapacityReady: true,
      accountAlias: 'Primary test account',
    },
  };
}

function preparedContext(): MatrixCorpusPreparedContext {
  return {
    account: {
      userId: USER_ID,
      matrixUserId: MATRIX_USER_ID,
      homeserverUrl: 'https://matrix.example.test',
      accessToken: 'private-token-sentinel',
      targetRoomId: MATRIX_ROOM_ID,
    },
    accountAlias: 'Primary test account',
    expectedPuppetSender: MATRIX_PUPPET_ID,
  };
}

function privacySafeLogger(): {
  info(value: object, message?: string): void;
  warn(value: object, message?: string): void;
  error(value: object, message?: string): void;
  debug(value: object, message?: string): void;
} {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function createMonotonicNow(origin: string): () => string {
  const originMs = Date.parse(origin);
  let offsetMs = 0;
  return () => {
    const value = new Date(originMs + offsetMs).toISOString();
    offsetMs += 1;
    return value;
  };
}
