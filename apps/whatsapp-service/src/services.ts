/**
 * Service wiring for whatsapp-service.
 * Provides class-based adapters for domain use cases.
 */
import { createPrivateKey, randomUUID } from 'node:crypto';

import { createAppLogger } from '@intexuraos/infra-sentry';
import { createMetricsClient } from '@intexuraos/common-metrics';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { ConversationAssistantModel } from '@intexuraos/llm-contract';
import {
  MessageRepositoryAdapter,
  NotificationPreferencesRepositoryAdapter,
  PhoneVerificationRepositoryAdapter,
  UserMappingRepositoryAdapter,
  WebhookEventRepositoryAdapter,
} from './adapters.js';
import { GcsMediaStorageAdapter } from './infra/gcs/index.js';
import { GcpPubSubPublisher, type GcpPubSubPublisherConfig } from './infra/pubsub/index.js';
import { WhatsAppCloudApiAdapter, WhatsAppCloudApiSender } from './infra/whatsapp/index.js';
import { ThumbnailGeneratorAdapter } from './infra/media/index.js';
import { createWebAgentLinkPreviewClient } from './infra/linkpreview/webAgentLinkPreviewClient.js';
import { createLlmClient } from '@intexuraos/llm-factory';
import { createUserServiceClient } from '@intexuraos/internal-clients';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { createPdfConversationExporter } from '@intexuraos/infra-pdf-export';
import { err, ok } from '@intexuraos/common-core';
import type {
  EventPublisherPort,
  LinkPreviewFetcherPort,
  MediaStoragePort,
  PrivateWhatsAppRepository,
  PrivateWhatsAppErasurePublisher,
  PrivateWhatsAppErasureRepository,
  NotificationPreferencesRepository,
  OutboundMessageRepository,
  PhoneVerificationRepository,
  ThumbnailGeneratorPort,
  WhatsAppCloudApiPort,
  WhatsAppMessageRepository,
  WhatsAppMessageSender,
  WhatsAppUserMappingRepository,
  WhatsAppWebhookEventRepository,
} from './domain/whatsapp/index.js';
import type { MatrixOutboundGateway } from './domain/whatsapp/ports/matrixOutboundGateway.js';
import type {
  ConversationAssistantLlmClientFactory,
  ConversationAssistantPdfExporter,
  ConversationAssistantRepository,
} from './domain/conversation-assistant/ports.js';
import type {
  ConversationAssistantContextAttachmentAccessRepository,
  ConversationAssistantContextAttachmentDeltaBuilder,
  ConversationAssistantContextAttachmentPreparationRepository,
  ConversationAssistantContextAttachmentRepository,
} from './domain/conversation-assistant/contextAttachmentPorts.js';
import type { ConversationAssistantOperationalTelemetry } from './domain/conversation-assistant/operationalTelemetry.js';
import type {
  ConversationAssistantTurnRequestRepository,
  ConversationAssistantTurnRequestRunner,
} from './domain/conversation-assistant/turnRequestPorts.js';
import { createConversationAssistantContextAttachmentDeltaBuilder } from './domain/conversation-assistant/contextAttachmentDeltaBuilder.js';
import { createOutboundMessageRepository } from './infra/firestore/outboundMessageRepository.js';
import { createPrivateWhatsAppRepository } from './infra/firestore/privateWhatsAppRepository.js';
import { createPrivateWhatsAppErasureRepository } from './infra/firestore/privateWhatsAppErasureRepository.js';
import { createConversationAssistantRepository } from './infra/firestore/conversationAssistantRepository.js';
import { createConversationAssistantContextAttachmentRepository } from './infra/firestore/conversationAssistantContextAttachmentRepository.js';
import { createConversationAssistantTurnRequestRepository } from './infra/firestore/conversationAssistantTurnRequestRepository.js';
import { createConversationAssistantTurnRunner } from './infra/llm/conversationAssistantTurnRunner.js';
import { createConversationAssistantOperationalTelemetry } from './infra/metrics/conversationAssistantOperationalTelemetry.js';
import { createMatrixOutboundAdapterClient } from './infra/http/matrixOutboundAdapterClient.js';
import type { WhatsAppMatrixCorpusConfig } from './config.js';
import { MatrixCorpusControlPlane } from './domain/matrixCorpus/controlPlane.js';
import { MatrixCorpusRouteControlPlaneAdapter } from './domain/matrixCorpus/routeControlPlane.js';
import type { MatrixCorpusRoutesDependencies } from './routes/matrixCorpusRoutes.js';
import {
  createMatrixCorpusKeyedDigests,
  createMatrixCorpusReplayProjectionDigest,
  createMatrixCorpusSha256,
} from './domain/matrixCorpus/crypto.js';
import {
  FirestoreMatrixCorpusLeaseBindingAuthorization,
  FirestoreMatrixCorpusRepository,
  FirestoreMatrixCorpusSignedEnvelopeStore,
} from './infra/firestore/matrixCorpusRepository.js';
import { FirestoreMatrixCorpusRecoveryScanner } from './infra/firestore/matrixCorpusRecoveryScanner.js';
import { createIntexAgentMatrixCorpusClient } from './infra/http/intexAgentMatrixCorpusClient.js';
import { createMatrixCorpusOutboxDrainer } from './infra/pubsub/matrixCorpusOutboxDrainer.js';
import { signMatrixCorpusAttestation } from './domain/matrixCorpus/attestation.js';
import { createMatrixCorpusControlAuthorizationIssuer } from './domain/matrixCorpus/controlAuthorization.js';
import type { CleanupResult, MatrixCorpusClock } from './domain/matrixCorpus/types.js';
import {
  MatrixCorpusRecoveryController,
  createMatrixCorpusRecoveryWork,
  createRuntimeMatrixCorpusTimerScheduler,
} from './jobs/matrixCorpusLeaseSweeper.js';
import type { Firestore } from '@intexuraos/infra-firestore';
import type { IntexAgentMatrixCorpusClient } from './domain/matrixCorpus/ports/intexAgentMatrixCorpusClient.js';
import type { MatrixCorpusTimerScheduler } from './jobs/matrixCorpusLeaseSweeper.js';
import type { MatrixCorpusIngressPort } from './domain/matrixCorpus/ports/matrixCorpusIngress.js';
import { FirestoreMatrixCorpusIngress } from './infra/firestore/matrixCorpusIngress.js';

export function composeWhatsAppMatrixCorpusFeature<T>(
  config: WhatsAppMatrixCorpusConfig,
  createEnabled: (config: Extract<WhatsAppMatrixCorpusConfig, { enabled: true }>) => T
): T | null {
  return config.enabled ? createEnabled(config) : null;
}

/**
 * Configuration for service initialization.
 */
export interface ServiceConfig {
  mediaBucket: string;
  gcpProjectId: string;
  mediaCleanupTopic: string;
  audioStoredTopic: string;
  intexMessageIngestTopic: string;
  webhookProcessTopic?: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  webAgentUrl: string;
  internalAuthToken: string;
  llmUsageServiceUrl: string;
  userServiceUrl: string;
  conversationAssistantModel: ConversationAssistantModel;
  matrixOutboundAdapterBaseUrl: string;
  matrixOutboundAdapterAuthToken: string;
  intexAgentBaseUrl: string;
  matrixCorpus: WhatsAppMatrixCorpusConfig;
}

export interface WhatsAppMatrixCorpusRuntime {
  routes: MatrixCorpusRoutesDependencies;
  ingress: MatrixCorpusIngressPort;
  recoveryController: MatrixCorpusRecoveryController;
}

function buildPubSubConfig(config: ServiceConfig): GcpPubSubPublisherConfig {
  const pubsubConfig: GcpPubSubPublisherConfig = {
    projectId: config.gcpProjectId,
    mediaCleanupTopic: config.mediaCleanupTopic,
    audioStoredTopic: config.audioStoredTopic,
    intexMessageIngestTopic: config.intexMessageIngestTopic,
    logger: createAppLogger({ name: 'whatsapp-pubsub-publisher' }),
  };
  if (config.webhookProcessTopic !== undefined) {
    pubsubConfig.webhookProcessTopic = config.webhookProcessTopic;
  }
  return pubsubConfig;
}

/**
 * Service container holding all adapter instances.
 * Uses domain interface types for proper type inference.
 */
export interface ServiceContainer {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  userMappingRepository: WhatsAppUserMappingRepository;
  messageRepository: WhatsAppMessageRepository;
  outboundMessageRepository: OutboundMessageRepository;
  phoneVerificationRepository: PhoneVerificationRepository;
  notificationPreferencesRepository: NotificationPreferencesRepository;
  privateWhatsAppRepository: PrivateWhatsAppRepository;
  privateWhatsAppErasureRepository?: PrivateWhatsAppErasureRepository;
  privateWhatsAppErasurePublisher?: PrivateWhatsAppErasurePublisher;
  matrixOutboundGateway: MatrixOutboundGateway;
  mediaStorage: MediaStoragePort;
  eventPublisher: EventPublisherPort;
  messageSender: WhatsAppMessageSender;
  whatsappCloudApi: WhatsAppCloudApiPort;
  thumbnailGenerator: ThumbnailGeneratorPort;
  linkPreviewFetcher: LinkPreviewFetcherPort;
  conversationAssistantRepository?: ConversationAssistantRepository;
  conversationAssistantContextAttachmentRepository?: ConversationAssistantContextAttachmentRepository &
    ConversationAssistantContextAttachmentPreparationRepository &
    ConversationAssistantContextAttachmentAccessRepository;
  conversationAssistantContextAttachmentDeltaBuilder?: ConversationAssistantContextAttachmentDeltaBuilder;
  conversationAssistantTurnRequestRepository?: ConversationAssistantTurnRequestRepository;
  conversationAssistantTurnRequestRunner?: ConversationAssistantTurnRequestRunner;
  conversationAssistantOperationalTelemetry?: ConversationAssistantOperationalTelemetry;
  llmClientFactory?: ConversationAssistantLlmClientFactory;
  pdfConversationExporter?: ConversationAssistantPdfExporter;
  conversationAssistantModel?: ConversationAssistantModel;
  matrixCorpus?: WhatsAppMatrixCorpusRuntime;
}

let container: ServiceContainer | null = null;
let serviceConfig: ServiceConfig | null = null;

/**
 * Initialize the service container with configuration.
 * Must be called before getServices().
 */
export function initServices(config: ServiceConfig): void {
  serviceConfig = config;
}

/**
 * Get the service container.
 * Throws if initServices() was not called first.
 */
export function getServices(): ServiceContainer {
  if (container !== null) {
    return container;
  }

  if (serviceConfig === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  const initializedConfig = serviceConfig;

  const privateWhatsAppRepository = createPrivateWhatsAppRepository();
  const llmClientFactory = createConversationAssistantLlmClientFactory(serviceConfig);
  const telemetryLogger = createAppLogger({
    name: 'whatsapp-conversation-assistant-operational-telemetry',
  });
  const conversationAssistantOperationalTelemetry =
    createConversationAssistantOperationalTelemetry({
      metrics: createMetricsClient({
        projectId: serviceConfig.gcpProjectId,
        serviceName: 'whatsapp-service',
        logger: telemetryLogger,
      }),
      logger: telemetryLogger,
    });
  const conversationAssistantContextAttachmentRepository =
    createConversationAssistantContextAttachmentRepository({
      telemetry: conversationAssistantOperationalTelemetry,
    });
  const eventPublisher = new GcpPubSubPublisher(buildPubSubConfig(serviceConfig));
  const ordinaryContainer: ServiceContainer = {
    webhookEventRepository: new WebhookEventRepositoryAdapter(),
    userMappingRepository: new UserMappingRepositoryAdapter(),
    messageRepository: new MessageRepositoryAdapter(),
    outboundMessageRepository: createOutboundMessageRepository(),
    phoneVerificationRepository: new PhoneVerificationRepositoryAdapter(),
    notificationPreferencesRepository: new NotificationPreferencesRepositoryAdapter(),
    privateWhatsAppRepository,
    privateWhatsAppErasureRepository: createPrivateWhatsAppErasureRepository(),
    privateWhatsAppErasurePublisher: eventPublisher,
    matrixOutboundGateway: createMatrixOutboundAdapterClient({
      baseUrl: serviceConfig.matrixOutboundAdapterBaseUrl,
      authToken: serviceConfig.matrixOutboundAdapterAuthToken,
    }),
    mediaStorage: new GcsMediaStorageAdapter(serviceConfig.mediaBucket),
    eventPublisher,
    messageSender: new WhatsAppCloudApiSender(
      serviceConfig.whatsappAccessToken,
      serviceConfig.whatsappPhoneNumberId
    ),
    whatsappCloudApi: new WhatsAppCloudApiAdapter(serviceConfig.whatsappAccessToken),
    thumbnailGenerator: new ThumbnailGeneratorAdapter(),
    linkPreviewFetcher: createWebAgentLinkPreviewClient({
      baseUrl: serviceConfig.webAgentUrl,
      internalAuthToken: serviceConfig.internalAuthToken,
      logger: createAppLogger({ name: 'webAgentLinkPreviewClient' }),
    }),
    conversationAssistantRepository: createConversationAssistantRepository(),
    conversationAssistantContextAttachmentRepository,
    conversationAssistantContextAttachmentDeltaBuilder:
      createConversationAssistantContextAttachmentDeltaBuilder({
        privateWhatsAppRepository,
        confirmationSecret: serviceConfig.internalAuthToken,
        warningMessageThreshold: 5_000,
        warningTokenThreshold: 50_000,
      }),
    conversationAssistantTurnRequestRepository:
      createConversationAssistantTurnRequestRepository({
        telemetry: conversationAssistantOperationalTelemetry,
      }),
    conversationAssistantTurnRequestRunner: createConversationAssistantTurnRunner({
      llmClientFactory,
    }),
    conversationAssistantOperationalTelemetry,
    llmClientFactory,
    pdfConversationExporter: createConversationAssistantPdfExporter(),
    conversationAssistantModel: serviceConfig.conversationAssistantModel,
  };
  const matrixCorpus = composeWhatsAppMatrixCorpusFeature(
    serviceConfig.matrixCorpus,
    (enabledConfig) =>
      createWhatsAppMatrixCorpusRuntime({
        config: enabledConfig,
        serviceConfig: initializedConfig,
        eventPublisher,
      })
  );
  container =
    matrixCorpus === null
      ? ordinaryContainer
      : { ...ordinaryContainer, matrixCorpus };
  return container;
}

interface CreateWhatsAppMatrixCorpusRuntimeInput {
  config: Extract<WhatsAppMatrixCorpusConfig, { enabled: true }>;
  serviceConfig: ServiceConfig;
  eventPublisher: EventPublisherPort;
  dependencies?: Readonly<{
    firestore: Firestore;
    intexAgent: IntexAgentMatrixCorpusClient;
    privateKey: ReturnType<typeof createPrivateKey>;
    logger: ReturnType<typeof createAppLogger>;
    scheduler: MatrixCorpusTimerScheduler;
    now(): string;
    workerNonce: string;
  }>;
}

export function createWhatsAppMatrixCorpusRuntime(
  input: CreateWhatsAppMatrixCorpusRuntimeInput
): WhatsAppMatrixCorpusRuntime {
  if (input.serviceConfig.intexAgentBaseUrl.trim() === '') {
    throw new Error('INTEXURAOS_INTEX_AGENT_URL is invalid');
  }

  const logger =
    input.dependencies?.logger ?? createAppLogger({ name: 'whatsapp-matrix-corpus' });
  const firestore = input.dependencies?.firestore ?? getFirestore();
  const digests = createMatrixCorpusKeyedDigests(input.config.evaluatorBindingHmacKey);
  const sha256 = createMatrixCorpusSha256();
  const repository = new FirestoreMatrixCorpusRepository({
    firestore,
    replayProjectionDigest: createMatrixCorpusReplayProjectionDigest(),
  });
  const intexAgent =
    input.dependencies?.intexAgent ??
    createIntexAgentMatrixCorpusClient({
      baseUrl: input.serviceConfig.intexAgentBaseUrl,
      internalAuthToken: input.serviceConfig.internalAuthToken,
      logger,
    });
  const clock: MatrixCorpusClock = {
    now: input.dependencies?.now ?? ((): string => new Date().toISOString()),
  };
  const controlPlane = new MatrixCorpusControlPlane({
    repository,
    clock,
    digests,
    sha256,
    ids: {
      ingestReceiptId: (): string => `imc_receipt_${randomUUID()}`,
      ingestOutboxId: (): string => `imc_outbox_${randomUUID()}`,
    },
    intexAgent,
    logger,
    leaseTtlMs: 300_000,
    capabilityTtlMs: 300_000,
  });
  const leaseBindingAuthorization = new FirestoreMatrixCorpusLeaseBindingAuthorization({
    firestore,
    digests,
  });
  const routeControlPlane = new MatrixCorpusRouteControlPlaneAdapter({
    controlPlane,
    leaseBindingAuthorization,
    cleanup: {
      async cleanupExactRun(cleanupInput): Promise<CleanupResult> {
        const now = clock.now();
        const leaseSlotDigest = digests.digest('imc-lease-slot-v1', [
          cleanupInput.runtimeAudience,
          cleanupInput.userId,
        ]);
        const currentRunFenceDigest = digests.digest('imc-run-fence-v1', [
          cleanupInput.runtimeAudience,
          cleanupInput.userId,
          cleanupInput.runId,
        ]);
        const idempotencyKeyDigest = digests.digest('imc-operation-idempotency-v1', [
          'cleanup',
          cleanupInput.idempotencyKey,
        ]);
        const canonicalRequestDigest = digests.digest('imc-operation-request-v1', [
          'cleanup',
          JSON.stringify({
            runtimeAudience: cleanupInput.runtimeAudience,
            currentRunId: cleanupInput.runId,
            userId: cleanupInput.userId,
            currentLeaseFence: cleanupInput.leaseFence,
            targetRunId: cleanupInput.targetRunId,
            targetLeaseFence: cleanupInput.targetLeaseFence,
            targetRunFenceDigest: cleanupInput.targetRunFenceDigest,
            expectedRevision: cleanupInput.expectedRevision,
          }),
        ]);
        return await repository.cleanupExactRun({
          runtimeAudience: cleanupInput.runtimeAudience,
          currentRunId: cleanupInput.runId,
          userId: cleanupInput.userId,
          currentLeaseFence: cleanupInput.leaseFence,
          leaseSlotDigest,
          currentRunFenceDigest,
          targetRunId: cleanupInput.targetRunId,
          targetLeaseFence: cleanupInput.targetLeaseFence,
          targetRunFenceDigest: cleanupInput.targetRunFenceDigest,
          expectedRevision: cleanupInput.expectedRevision,
          idempotencyKeyDigest,
          canonicalRequestDigest,
          now,
        });
      },
    },
    intexAgent,
  });

  const privateKey =
    input.dependencies?.privateKey ??
    createPrivateKey({
      key: JSON.parse(input.config.signingKeyMaterial) as never,
      format: 'jwk',
    });
  const signedEnvelopeStore = new FirestoreMatrixCorpusSignedEnvelopeStore({ firestore });
  const signAttestation = async (
    signInput: Parameters<typeof signMatrixCorpusAttestation>[0]
  ): Promise<Awaited<ReturnType<typeof signMatrixCorpusAttestation>>> =>
    await signMatrixCorpusAttestation(signInput, {
      keyVersion: input.config.signingKeyVersion,
      privateKey,
    });
  const issueControlAuthorization = createMatrixCorpusControlAuthorizationIssuer({
    getTransportStatus: async (authority) =>
      await routeControlPlane.getTransportStatus(authority),
    sign: signAttestation,
    now: (): string => clock.now(),
    eventId: (): string => `imc_control_${randomUUID()}`,
  });
  const drainer = createMatrixCorpusOutboxDrainer({
    repository,
    publisher: input.eventPublisher,
    intexAgentClient: intexAgent,
    signedEnvelopeStore,
    sign: signAttestation,
    now: (): string => clock.now(),
  });
  const scanner = new FirestoreMatrixCorpusRecoveryScanner({ firestore, digests });
  const recovery = createMatrixCorpusRecoveryWork({
    scanner,
    drainer,
    controlPlane,
    now: (): string => clock.now(),
    ownerDigest: digests.digest('imc-claim-owner-v1', [
      'whatsapp-service',
      input.dependencies?.workerNonce ?? randomUUID(),
    ]),
  });
  const recoveryController = new MatrixCorpusRecoveryController({
    scheduler: input.dependencies?.scheduler ?? createRuntimeMatrixCorpusTimerScheduler(),
    drainBatch: async (): Promise<void> => {
      await recovery.drainBatch();
    },
    sweepExpiredLeases: async (): Promise<void> => {
      await recovery.sweepExpiredLeases();
    },
    logger,
  });

  const evaluator = {
    userId: input.config.configuredEvaluatorUserId,
    matrixRoomBindingDigest: digests.digest('imc-lease-slot-v1', [
      'matrix-room-binding',
      input.config.matrixRoomBinding,
    ]),
    whatsappAccountBindingDigest: digests.digest('imc-lease-slot-v1', [
      'whatsapp-account-binding',
      input.config.whatsappAccountBinding,
    ]),
    whatsappSenderBindingDigest: digests.digest('imc-lease-slot-v1', [
      'whatsapp-sender-binding',
      input.config.whatsappSenderBinding,
    ]),
  };

  const ingress = new FirestoreMatrixCorpusIngress({
    firestore,
    controlPlane,
    digests,
    sha256,
    expectedMatrixRoomBindingDigest: evaluator.matrixRoomBindingDigest,
    expectedWhatsAppAccountBindingDigest: evaluator.whatsappAccountBindingDigest,
    expectedWhatsAppSenderBindingDigest: evaluator.whatsappSenderBindingDigest,
  });

  return {
    routes: {
      gate: {
        enabled: true,
        runtimeAudience: 'home-dev',
        evaluator,
      },
      digestMatrixIdempotencyKey: (idempotencyKey) =>
        digests.digest('imc-matrix-idempotency-v1', [idempotencyKey]),
      issueControlAuthorization,
      controlPlane: routeControlPlane,
    },
    ingress,
    recoveryController,
  };
}

export function createConversationAssistantLlmClientFactory(
  config: ServiceConfig
): ConversationAssistantLlmClientFactory {
  const usageSink = new HttpInternalAuthUsageSink({
    usageServiceUrl: config.llmUsageServiceUrl,
    internalAuthToken: config.internalAuthToken,
    service: 'whatsapp-service',
    component: 'conversation-assistant',
    logger: createAppLogger({ name: 'whatsapp-conversation-assistant-usage-sink' }),
  });
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'whatsapp-conversation-assistant-user-service' }),
    usageSink,
  });
  return {
    async createLlmClientForUser(
      userId: string,
      model: string
    ): ReturnType<ConversationAssistantLlmClientFactory['createLlmClientForUser']> {
      const keysResult = await userServiceClient.getApiKeys(userId);
      if (!keysResult.ok) {
        return err({ code: 'LLM_ERROR', message: keysResult.error.message });
      }
      const openRouterKey = keysResult.value.openrouter;
      if (openRouterKey === undefined) {
        return err({
          code: 'LLM_ERROR',
          message: 'No OpenRouter API key configured. Please add your OpenRouter API key in settings.',
        });
      }
      return ok(createLlmClient({
        apiKey: openRouterKey,
        model: model as never,
        userId,
        logger: createAppLogger({ name: 'whatsapp-conversation-assistant-llm' }),
        usageSink,
        ownerType: 'user',
      }));
    },
  };
}

export function createConversationAssistantPdfExporter(): ConversationAssistantPdfExporter {
  const exporter = createPdfConversationExporter();
  return {
    async exportConversation(
      input
    ): ReturnType<ConversationAssistantPdfExporter['exportConversation']> {
      const result = await exporter.exportConversation(input);
      if (!result.ok) {
        return err({ message: result.error.message });
      }
      return ok(result.value);
    },
  };
}

/**
 * Set a custom service container (for testing).
 */
export function setServices(services: ServiceContainer): void {
  container = services;
}

/**
 * Reset the service container (for testing).
 */
export function resetServices(): void {
  container = null;
}
