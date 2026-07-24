import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { err, type Result } from '@intexuraos/common-core';
import { createAppLogger, SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import {
  createOpenRouterCatalogClient,
  type OpenRouterCatalogClient,
} from '@intexuraos/infra-openrouter';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { MatrixCorpusAgentModel } from '@intexuraos/http-contracts';
import {
  createBookmarksAgentServiceClient,
  createCalendarAgentServiceClient,
  createCodeAgentServiceClient,
  createNotesAgentServiceClient,
  createResearchAgentServiceClient,
  createUserServiceClient,
  type IntexAgentRuntimeSettingsClient,
  type IntexAgentRuntimeSettingsClientError,
  type IntexAgentRuntimeSettingsV1,
} from '@intexuraos/internal-clients';
import { createLlmClient, createToolCallingClient } from '@intexuraos/llm-factory';
import {
  IntexAgentModels,
  type IntexAgentModel,
  type MatrixCorpusLlmCallContextV1,
  type MatrixCorpusLlmStageV1,
  type ToolCallingClient,
} from '@intexuraos/llm-contract';
import type { StructuredClient } from '@intexuraos/llm-utils';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { createWhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
import type { ServiceConfig } from './config.js';
import type { IncomingMessageHandler } from './domain/ports/incomingMessageHandler.js';
import type { PreferencesRepository } from './domain/ports/preferencesRepository.js';
import type { PromptPreferencesRepository } from './domain/ports/promptPreferencesRepository.js';
import type {
  MatrixCorpusSessionRepository,
  SessionRepository,
} from './domain/ports/sessionRepository.js';
import type {
  ExternalSaveConnectionTestPort,
  IntexAgentExternalSavePreferences,
} from './domain/preferences/types.js';
import { renderPromptPreferenceAgentContext } from './domain/preferences/promptPreferences.js';
import { createIntexAgentRunner } from './domain/agent/intexAgentRunner.js';
import {
  createLlmIntexAgentIntentClassifier,
  type IntexAgentIntentClassifier,
} from './domain/agent/intentClassifier.js';
import {
  createIntexAgentToolExecutor,
  type ExternalSaveToolClient,
} from './domain/agent/toolExecutor.js';
import {
  handleIncomingMessage,
  type HandleIncomingMessageDeps,
  type IdGenerator,
  type IntexAgentRuntimeSnapshot,
  type IntexAgentRunner,
  type IntexAgentRunnerResult,
} from './domain/messages/handleIncomingMessage.js';
import { runTestConversation, type TestConversationRunner } from './domain/testConversation/runTestConversation.js';
import { TEST_CONVERSATION_AGENT_MODEL } from './domain/testConversation/testConversationTypes.js';
import { createTestToolExecutor } from './domain/testConversation/testToolMocks.js';
import type {
  CapturedToolCall,
  TestConversationResponse,
} from './domain/testConversation/testConversationTypes.js';
import { FirestorePreferencesRepository } from './infra/firestore/preferencesRepository.js';
import { FirestorePromptPreferencesRepository } from './infra/firestore/promptPreferencesRepository.js';
import { FirestoreSessionRepository } from './infra/firestore/sessionRepository.js';
import { createExternalSaveClient } from './infra/http/externalSaveClient.js';
import { createWhatsAppReplyPublisher } from './infra/pubsub/whatsappReplyPublisher.js';
import type { IntexMatrixCorpusConfig } from './config.js';
import { verifyMatrixCorpusAttestation } from './domain/matrixCorpus/attestation.js';
import {
  createMatrixCorpusIngestReceiptService,
  type MatrixCorpusIngestReceiptService,
} from './domain/matrixCorpus/ingestReceiptService.js';
import { FirestoreIngestReceiptRepository } from './infra/firestore/ingestReceiptRepository.js';
import { createMatrixCorpusContextCrypto } from './domain/matrixCorpus/contextCrypto.js';
import { createMatrixCorpusContextService } from './domain/matrixCorpus/contextService.js';
import { createMatrixCorpusMessageHandler } from './domain/matrixCorpus/matrixCorpusMessageHandler.js';
import {
  createMatrixCorpusExecutionService,
  type MatrixCorpusExecutionServiceDeps,
} from './domain/matrixCorpus/matrixCorpusExecutionService.js';
import {
  createStrictToolMockBoundary,
  createStrictToolMockExecutor,
} from './domain/matrixCorpus/strictToolMockExecutor.js';
import {
  createIntexAgentExecutorResolver,
  MatrixCorpusExecutorResolutionError,
  type MatrixCorpusExecutorExecutionContext,
} from './domain/matrixCorpus/executorResolver.js';
import { FirestoreMatrixCorpusContextRepository } from './infra/firestore/matrixCorpusContextRepository.js';
import { FirestoreMatrixCorpusManifestRepository } from './infra/firestore/matrixCorpusManifestRepository.js';
import { FirestoreTestConfirmationRepository } from './infra/firestore/testConfirmationRepository.js';
import { FirestoreTestRunRepository } from './infra/firestore/testRunRepository.js';
import type { MatrixCorpusRoutesDependencies } from './routes/matrixCorpusRoutes.js';
import type { TestRunRoutesDependencies } from './routes/testRunRoutes.js';
import { createMatrixCorpusEvidenceService } from './domain/matrixCorpus/evidenceService.js';
import { createMatrixCorpusTurnTerminalRecorder } from './domain/matrixCorpus/turnTerminalRecorder.js';
import {
  createTestRunArtifactSweepScheduler,
  createTestRunArtifactSweeper,
  type TestRunArtifactSweepScheduler,
} from './jobs/testRunArtifactSweeper.js';

export function composeIntexMatrixCorpusFeature<T>(
  config: IntexMatrixCorpusConfig,
  createEnabled: (config: Extract<IntexMatrixCorpusConfig, { enabled: true }>) => T
): T | null {
  return config.enabled ? createEnabled(config) : null;
}

const RUNTIME_SETTINGS_LOOKUP_TIMEOUT_MS = 2_000;
export const MATRIX_CORPUS_MODEL_REQUEST_TIMEOUT_MS = 45_000;
export const MATRIX_CORPUS_MODEL_TURN_BUDGET_MS = 180_000;
export const MATRIX_CORPUS_MODEL_MAX_ATTEMPTS = 3;

const MATRIX_CORPUS_RUNTIME_MODELS = {
  'or:deepseek/deepseek-v4-flash': IntexAgentModels.DeepSeekV4Flash,
  'or:minimax/minimax-m3': IntexAgentModels.MiniMaxM3,
} as const satisfies Readonly<Record<MatrixCorpusAgentModel, IntexAgentModel>>;

export function resolveMatrixCorpusRuntimeModel(
  agentModel: MatrixCorpusAgentModel
): IntexAgentModel {
  return MATRIX_CORPUS_RUNTIME_MODELS[agentModel];
}

export interface RuntimeSettingsDeadlineScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const runtimeSettingsDeadlineScheduler: RuntimeSettingsDeadlineScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

export type AgentRunnerFactory = typeof createIntexAgentRunner;

export interface CreateRuntimeBoundModelClientsInput {
  runtimeSettings: IntexAgentRuntimeSnapshot;
  apiKey: string;
  userId: string;
  logger: CreateTestConversationRunnerServiceInput['logger'];
  usageSink: HttpInternalAuthUsageSink;
  timeoutMs?: number;
  maxAttempts?: number;
  deadlineAtMs?: number;
  createToolCallingClientFn?: typeof createToolCallingClient;
  createLlmClientFn?: typeof createLlmClient;
}

export function createRuntimeBoundModelClients(input: CreateRuntimeBoundModelClientsInput): {
  toolCallingClient: ReturnType<typeof createToolCallingClient>;
  structuredClient: ReturnType<typeof createLlmClient>;
} {
  const sharedConfig = {
    apiKey: input.apiKey,
    model: input.runtimeSettings.effectiveModel,
    userId: input.userId,
    logger: input.logger,
    usageSink: input.usageSink,
    ownerType: 'user' as const,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    ...(input.deadlineAtMs === undefined ? {} : { deadlineAtMs: input.deadlineAtMs }),
  };
  return {
    toolCallingClient: (input.createToolCallingClientFn ?? createToolCallingClient)(sharedConfig),
    structuredClient: (input.createLlmClientFn ?? createLlmClient)(sharedConfig),
  };
}

export interface ServiceContainer {
  config: ServiceConfig;
  sessionRepository: SessionRepository;
  preferencesRepository: PreferencesRepository;
  promptPreferencesRepository: PromptPreferencesRepository;
  externalSaveTester: ExternalSaveConnectionTestPort;
  incomingMessageHandler: IncomingMessageHandler;
  testConversationRunner: TestConversationRunner;
  matrixCorpus?: IntexMatrixCorpusRuntime;
  testRuns?: IntexAgentTestRunsRuntime;
}

export interface IntexAgentTestRunsRuntime extends TestRunRoutesDependencies {
  sweepScheduler: TestRunArtifactSweepScheduler;
}

export interface IntexMatrixCorpusRuntime extends MatrixCorpusRoutesDependencies {
  enabled: true;
  acceptVerifiedIngest: MatrixCorpusIngestReceiptService['acceptVerifiedIngest'];
}

export interface CreateIntexMatrixCorpusRuntimeDependencies {
  firestore: ReturnType<typeof getFirestore>;
  verificationKey: ReturnType<typeof createPublicKey>;
  promptPreferencesRepository: PromptPreferencesRepository;
  runtimeSettingsClient: Pick<
    IntexAgentRuntimeSettingsClient,
    'resolveIntexAgentRuntimeSettings'
  >;
  sessionRepository: MatrixCorpusSessionRepository;
  createRunner: MatrixCorpusExecutionServiceDeps['createRunner'];
  replyPublisher: MatrixCorpusExecutionServiceDeps['replyPublisher'];
  now(): string;
}

export function createIntexMatrixCorpusRuntime(
  config: Extract<IntexMatrixCorpusConfig, { enabled: true }>,
  dependencies: CreateIntexMatrixCorpusRuntimeDependencies
): IntexMatrixCorpusRuntime {
  const keyring = new Map([[config.signingKeyVersion, dependencies.verificationKey]]);
  const contextRepository = new FirestoreMatrixCorpusContextRepository({
    firestore: dependencies.firestore,
  });
  const manifestRepository = new FirestoreMatrixCorpusManifestRepository({
    firestore: dependencies.firestore,
  });
  const contextCrypto = createMatrixCorpusContextCrypto({
    key: Buffer.from(config.contextEncryptionKeyMaterial, 'base64url'),
    keyVersion: config.contextEncryptionKeyVersion,
  });
  const contextService = createMatrixCorpusContextService({
    contextRepository,
    manifestRepository,
    promptPreferencesRepository: dependencies.promptPreferencesRepository,
    runtimeSettingsClient: dependencies.runtimeSettingsClient,
    crypto: contextCrypto,
    now: () => dependencies.now(),
  });
  const testConfirmationRepository = new FirestoreTestConfirmationRepository({
    firestore: dependencies.firestore,
    crypto: contextCrypto,
  });
  const receiptRepository = new FirestoreIngestReceiptRepository({
    firestore: dependencies.firestore,
  });
  const messageHandler = createMatrixCorpusMessageHandler({
    contextService,
    sessionRepository: dependencies.sessionRepository,
    confirmationRepository: testConfirmationRepository,
  });
  const executionService = createMatrixCorpusExecutionService({
    contextService,
    sessionRepository: dependencies.sessionRepository,
    confirmationRepository: testConfirmationRepository,
    receiptRepository,
    createRunner: dependencies.createRunner,
    replyPublisher: dependencies.replyPublisher,
  });
  const terminalRecorder = createMatrixCorpusTurnTerminalRecorder({
    sessionRepository: dependencies.sessionRepository,
  });
  const receiptService = createMatrixCorpusIngestReceiptService({
    repository: receiptRepository,
    terminalRecorder,
    generateStableKeys: ({ ingestReceiptId, expectedSessionId }) => {
      const identityDigest = createHash('sha256')
        .update(ingestReceiptId, 'utf8')
        .digest('hex')
        .slice(0, 32);
      return {
        sessionId: expectedSessionId ?? `imc_session_${identityDigest}`,
        eventId: `imc_event_${identityDigest}`,
        toolCallId: `imc_tool_${identityDigest}`,
        replyId: `imc_reply_${identityDigest}`,
      };
    },
    messageHandler,
    executionService,
    now: () => dependencies.now(),
  });
  const evidenceService = createMatrixCorpusEvidenceService({
    sessionRepository: dependencies.sessionRepository,
  });
  const verifyAttestation = async (
    input: unknown
  ): ReturnType<typeof verifyMatrixCorpusAttestation> =>
    await verifyMatrixCorpusAttestationForRuntime(input, keyring, () => dependencies.now());
  return {
    enabled: true,
    configuredUserId: config.evaluatorUserId,
    contextService,
    contextRepository,
    manifestRepository,
    testRunRepository: new FirestoreTestRunRepository({
      firestore: dependencies.firestore,
      crypto: contextCrypto,
    }),
    sessionRepository: dependencies.sessionRepository,
    evidenceService,
    verifyAttestation,
    now: () => dependencies.now(),
    acceptVerifiedIngest: async (input) => await receiptService.acceptVerifiedIngest(input),
  };
}

type IntexAgentCatalogAdmissionClient = Pick<
  OpenRouterCatalogClient,
  'getIntexAgentCatalogEvidence'
>;

export interface ComposeIntexAgentExecutionServicesInput {
  catalogClient: IntexAgentCatalogAdmissionClient;
  logger: HandleIncomingMessageDeps['logger'];
  createOrdinaryIncomingMessageHandler(
    logger: HandleIncomingMessageDeps['logger']
  ): IncomingMessageHandler;
  createTestConversationRunner(
    catalogClient: IntexAgentCatalogAdmissionClient
  ): TestConversationRunner;
}

export function composeIntexAgentExecutionServices(
  input: ComposeIntexAgentExecutionServicesInput
): Pick<ServiceContainer, 'incomingMessageHandler' | 'testConversationRunner'> {
  return {
    incomingMessageHandler: input.createOrdinaryIncomingMessageHandler(
      createRuntimeResolutionFailureLogger(input.logger)
    ),
    testConversationRunner: input.createTestConversationRunner(input.catalogClient),
  };
}

export interface CreateMatrixCorpusRunnerInput {
  execution: MatrixCorpusExecutorExecutionContext;
  client?: ToolCallingClient;
  responseRepairClient?: StructuredClient;
  intentClassifier?: IntexAgentIntentClassifier;
  webAppUrl?: string;
  userPreferences: string | null;
}

export function createMatrixCorpusRunner(
  input: CreateMatrixCorpusRunnerInput
): IntexAgentRunner {
  return {
    async run(runnerInput): Promise<IntexAgentRunnerResult> {
      if (input.execution.flow !== 'normal' || input.client === undefined) {
        throw new MatrixCorpusExecutorResolutionError('MISSING_MATRIX_EXECUTION_CONTEXT');
      }
      let boundary: ReturnType<typeof createStrictToolMockBoundary> | undefined;
      const resolver = createIntexAgentExecutorResolver({
        createOrdinaryExecutor() {
          throw new MatrixCorpusExecutorResolutionError('CROSS_LANE_EXECUTION_CONTEXT');
        },
        createMatrixCorpusExecutor(factoryInput) {
          if (
            factoryInput.flow !== 'normal' ||
            factoryInput.preauthorizedSelection !== undefined
          )
            throw new MatrixCorpusExecutorResolutionError('INVALID_PREAUTHORIZED_SELECTION');
          const {
            flow: _flow,
            preauthorizedSelection: _preauthorizedSelection,
            ...strictInput
          } = factoryInput;
          boundary = createStrictToolMockBoundary(strictInput);
          return boundary.executor;
        },
      });
      const executor = resolver.resolve({
        session: runnerInput.session,
        matrixCorpus: input.execution,
      });
      if (boundary === undefined) {
        throw new MatrixCorpusExecutorResolutionError('INVALID_MATRIX_MOCK_PROFILE');
      }
      await input.execution.recordExecutionBoundary('strict_mock_executor_resolved');
      const matrixProfile = runnerInput.session.matrixCorpusProfile;
      if (matrixProfile === undefined) {
        throw new MatrixCorpusExecutorResolutionError('MISSING_MATRIX_EXECUTION_CONTEXT');
      }
      const llmOrdinals = new Map<string, number>();
      const matrixCorpusLlm = {
        nextContext(stage: MatrixCorpusLlmStageV1): MatrixCorpusLlmCallContextV1 {
          const callOrdinal = (llmOrdinals.get(stage) ?? 0) + 1;
          llmOrdinals.set(stage, callOrdinal);
          const context = {
            version: 1 as const,
            runId: matrixProfile.runId,
            scenarioId: matrixProfile.scenarioId,
            sessionId: runnerInput.session.id,
            turnIndex: input.execution.turnIndex,
            stage,
            callOrdinal,
          };
          input.execution.registerExpectedProviderCall(context);
          return context;
        },
        recordProviderCall: input.execution.recordProviderCall,
      };
      return await createIntexAgentRunner({
        client: input.client,
        ...(input.responseRepairClient !== undefined
          ? { responseRepairClient: input.responseRepairClient }
          : {}),
        toolExecutor: executor,
        toolSelectionGate: boundary.selectionGate,
        ...(input.intentClassifier !== undefined
          ? { intentClassifier: input.intentClassifier }
          : {}),
        ...(input.webAppUrl !== undefined ? { webAppUrl: input.webAppUrl } : {}),
        userPreferences: input.userPreferences,
        matrixCorpusLlm,
      }).run(runnerInput);
    },

    async executeConfirmed(confirmedInput): Promise<IntexAgentRunnerResult> {
      if (
        input.execution.flow !== 'confirmation' ||
        input.execution.preauthorizedSelection === undefined
      )
        throw new MatrixCorpusExecutorResolutionError('INVALID_PREAUTHORIZED_SELECTION');
      const resolver = createIntexAgentExecutorResolver({
        createOrdinaryExecutor() {
          throw new MatrixCorpusExecutorResolutionError('CROSS_LANE_EXECUTION_CONTEXT');
        },
        createMatrixCorpusExecutor(factoryInput) {
          const selection = factoryInput.preauthorizedSelection;
          if (factoryInput.flow !== 'confirmation' || selection === undefined)
            throw new MatrixCorpusExecutorResolutionError('INVALID_PREAUTHORIZED_SELECTION');
          const call = factoryInput.profile.findCall(selection);
          if (
            call === undefined ||
            factoryInput.turnIndex !== selection.turnIndex ||
            call.toolName !== selection.toolName
          )
            throw new MatrixCorpusExecutorResolutionError('INVALID_PREAUTHORIZED_SELECTION');
          let consumed = false;
          const {
            flow: _flow,
            preauthorizedSelection: _preauthorizedSelection,
            ...strictInput
          } = factoryInput;
          return createStrictToolMockExecutor({
            ...strictInput,
            recordPreauthorizedCallStarted: true,
            takePreauthorizedCall(toolName) {
              if (consumed || toolName !== selection.toolName) return undefined;
              consumed = true;
              return call;
            },
          });
        },
      });
      const executor = resolver.resolve({
        session: confirmedInput.session,
        matrixCorpus: input.execution,
      });
      await input.execution.recordExecutionBoundary('strict_mock_executor_resolved');
      return await createIntexAgentRunner({
        client: {
          run() {
            return Promise.reject(
              new Error('Matrix corpus confirmation must not invoke an LLM')
            );
          },
        },
        toolExecutor: executor,
        ...(input.webAppUrl !== undefined ? { webAppUrl: input.webAppUrl } : {}),
        userPreferences: input.userPreferences,
      }).executeConfirmed(confirmedInput);
    },
  };
}

export interface CreateOrdinaryRunnerInput {
  preferencesRepository: Pick<PreferencesRepository, 'getPreferences'>;
  promptPreferencesRepository: Pick<PromptPreferencesRepository, 'getCurrent'>;
  createToolExecutor(input: Readonly<{
    userId: string;
    sessionId: string;
    messageId: string;
    externalSave: IntexAgentExternalSavePreferences | undefined;
  }>): ReturnType<typeof createIntexAgentToolExecutor>;
  createModelClients(input: Readonly<{
    runtimeSettings: IntexAgentRuntimeSnapshot;
    userId: string;
  }>): Readonly<{
    toolCallingClient: ToolCallingClient;
    structuredClient: StructuredClient;
  }>;
  createIntentClassifier(client: StructuredClient): IntexAgentIntentClassifier;
  webAppUrl: string;
}

export function createOrdinaryRunner(input: CreateOrdinaryRunnerInput): IntexAgentRunner {
  return {
    async executeConfirmed(confirmedInput): Promise<IntexAgentRunnerResult> {
      const [preferences, promptPreferences] = await Promise.all([
        input.preferencesRepository.getPreferences(confirmedInput.session.userId),
        input.promptPreferencesRepository.getCurrent(confirmedInput.session.userId),
      ]);
      const toolExecutor = input.createToolExecutor({
        userId: confirmedInput.session.userId,
        sessionId: confirmedInput.session.id,
        messageId: confirmedInput.messageId ?? confirmedInput.session.id,
        externalSave: preferences?.externalSave,
      });
      return await createIntexAgentRunner({
        client: {
          run() {
            return Promise.reject(
              new Error('Confirmed Intex Agent execution must not invoke the LLM')
            );
          },
        },
        toolExecutor,
        webAppUrl: input.webAppUrl,
        userPreferences: renderPromptPreferenceAgentContext(promptPreferences),
      }).executeConfirmed(confirmedInput);
    },

    async run(runnerInput): Promise<IntexAgentRunnerResult> {
      const [preferences, promptPreferences] = await Promise.all([
        input.preferencesRepository.getPreferences(runnerInput.session.userId),
        input.promptPreferencesRepository.getCurrent(runnerInput.session.userId),
      ]);
      const toolExecutor = input.createToolExecutor({
        userId: runnerInput.session.userId,
        sessionId: runnerInput.session.id,
        messageId: runnerInput.messageId ?? runnerInput.session.id,
        externalSave: preferences?.externalSave,
      });
      if (runnerInput.runtimeSettings === undefined) {
        return await createIntexAgentRunner({
          client: {
            run() {
              return Promise.reject(new Error('Image shortcut must not invoke the LLM'));
            },
          },
          toolExecutor,
          webAppUrl: input.webAppUrl,
          userPreferences: renderPromptPreferenceAgentContext(promptPreferences),
        }).run(runnerInput);
      }
      const { toolCallingClient, structuredClient } = input.createModelClients({
        runtimeSettings: runnerInput.runtimeSettings,
        userId: runnerInput.session.userId,
      });
      return await createIntexAgentRunner({
        client: toolCallingClient,
        responseRepairClient: structuredClient,
        toolExecutor,
        intentClassifier: input.createIntentClassifier(structuredClient),
        webAppUrl: input.webAppUrl,
        userPreferences: renderPromptPreferenceAgentContext(promptPreferences),
      }).run(runnerInput);
    },
  };
}

function createRuntimeResolutionFailureLogger(
  logger: HandleIncomingMessageDeps['logger']
): HandleIncomingMessageDeps['logger'] {
  return {
    warn(value, message): void {
      logger.warn({ ...value, [SKIP_SENTRY_KEY]: true }, message);
    },
  };
}

export interface CreateTestConversationRunnerServiceInput {
  config: ServiceConfig;
  sessionRepository: SessionRepository;
  promptPreferencesRepository: PromptPreferencesRepository;
  logger: {
    debug(value: Record<string, unknown>, message?: string): void;
    info(value: Record<string, unknown>, message?: string): void;
    warn(value: Record<string, unknown>, message?: string): void;
    error(value: Record<string, unknown>, message?: string): void;
  };
  usageSink: HttpInternalAuthUsageSink;
  createToolCallingClientFn?: typeof createToolCallingClient;
  createLlmClientFn?: typeof createLlmClient;
  createAgentRunnerFn?: AgentRunnerFactory;
  ids?: IdGenerator;
  catalogClient: IntexAgentCatalogAdmissionClient;
}

let container: ServiceContainer | null = null;

export async function initServices(config: ServiceConfig): Promise<void> {
  const logger = createAppLogger({ name: 'intex-agent' });
  const firestore = getFirestore();
  const sessionRepository = new FirestoreSessionRepository({ firestore });
  const preferencesRepository = new FirestorePreferencesRepository({ firestore });
  const promptPreferencesRepository = new FirestorePromptPreferencesRepository({ firestore });
  let productionToolClients:
    | Readonly<{
        notesClient: ReturnType<typeof createNotesAgentServiceClient>;
        calendarClient: ReturnType<typeof createCalendarAgentServiceClient>;
        researchClient: ReturnType<typeof createResearchAgentServiceClient>;
        bookmarksClient: ReturnType<typeof createBookmarksAgentServiceClient>;
        codeClient: ReturnType<typeof createCodeAgentServiceClient>;
      }>
    | undefined;
  const getProductionToolClients = (): NonNullable<typeof productionToolClients> => {
    productionToolClients ??= {
      notesClient: createNotesAgentServiceClient({
        baseUrl: config.notesAgentUrl,
        internalAuthToken: config.internalAuthToken,
        logger: createAppLogger({ name: 'intex-agent-notes-client' }),
      }),
      calendarClient: createCalendarAgentServiceClient({
        baseUrl: config.calendarAgentUrl,
        internalAuthToken: config.internalAuthToken,
        logger: createAppLogger({ name: 'intex-agent-calendar-client' }),
      }),
      researchClient: createResearchAgentServiceClient({
        baseUrl: config.researchAgentUrl,
        internalAuthToken: config.internalAuthToken,
        logger: createAppLogger({ name: 'intex-agent-research-client' }),
      }),
      bookmarksClient: createBookmarksAgentServiceClient({
        baseUrl: config.bookmarksAgentUrl,
        internalAuthToken: config.internalAuthToken,
        logger: createAppLogger({ name: 'intex-agent-bookmarks-client' }),
      }),
      codeClient: createCodeAgentServiceClient({
        baseUrl: config.codeAgentUrl,
        internalAuthToken: config.internalAuthToken,
        logger: createAppLogger({ name: 'intex-agent-code-client' }),
      }),
    };
    return productionToolClients;
  };

  const usageSink = new HttpInternalAuthUsageSink({
    usageServiceUrl: config.llmUsageServiceUrl,
    internalAuthToken: config.internalAuthToken,
    service: 'intex-agent',
    component: 'agent-runner',
    logger: createAppLogger({ name: 'intex-agent-usage-sink' }),
  });
  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'intex-agent-user-service-client' }),
    usageSink,
  });
  const sendPublisher = createWhatsAppSendPublisher({
    projectId: config.gcpProjectId,
    topicName: config.whatsappSendTopic,
    logger: createAppLogger({ name: 'intex-agent-whatsapp-send-publisher' }),
  });
  const replyPublisher = createWhatsAppReplyPublisher({ sendPublisher });
  const matrixCorpus = composeIntexMatrixCorpusFeature(config.matrixCorpus, (enabledConfig) => {
    const verificationKey = createPublicKey({
      key: JSON.parse(enabledConfig.signingKeyMaterial) as never,
      format: 'jwk',
    });
    return createIntexMatrixCorpusRuntime(enabledConfig, {
      firestore,
      verificationKey,
      promptPreferencesRepository,
      runtimeSettingsClient: userServiceClient,
      sessionRepository,
      createRunner(input) {
        if (input.execution.flow === 'confirmation') {
          return createMatrixCorpusRunner({
            execution: input.execution,
            userPreferences: input.userPreferences,
            webAppUrl: config.webAppUrl,
          });
        }
        const agentModel = resolveMatrixCorpusRuntimeModel(input.agentModel);
        const runtimeSettings: IntexAgentRuntimeSnapshot = {
          status: 'available',
          effectiveModel: agentModel,
          explicitModel: agentModel,
          source: 'explicit',
          revision: 0,
          timeZone: 'Europe/Warsaw',
        };
        const clients = createRuntimeBoundModelClients({
          runtimeSettings,
          apiKey: config.openRouterAppApiKey,
          userId: input.userId,
          logger,
          usageSink,
          timeoutMs: MATRIX_CORPUS_MODEL_REQUEST_TIMEOUT_MS,
          maxAttempts: MATRIX_CORPUS_MODEL_MAX_ATTEMPTS,
          deadlineAtMs: Date.now() + MATRIX_CORPUS_MODEL_TURN_BUDGET_MS,
        });
        return createMatrixCorpusRunner({
          execution: input.execution,
          client: clients.toolCallingClient,
          responseRepairClient: clients.structuredClient,
          intentClassifier: createLlmIntexAgentIntentClassifier({
            client: clients.structuredClient,
            logger,
          }),
          userPreferences: input.userPreferences,
          webAppUrl: config.webAppUrl,
        });
      },
      replyPublisher,
      now: () => new Date().toISOString(),
    });
  });
  const testRuns: IntexAgentTestRunsRuntime | null =
    config.testRunsRead.enabled && matrixCorpus !== null
      ? {
          enabled: true,
          runtimeAudience: config.testRunsRead.runtimeAudience,
          configuredUserId: config.testRunsRead.evaluatorUserId,
          repository: matrixCorpus.testRunRepository,
          sweepScheduler: createTestRunArtifactSweepScheduler(
            createTestRunArtifactSweeper({ repository: matrixCorpus.testRunRepository }),
            () => {
              logger.warn(
                { reason: 'test_run_artifact_sweep_failed', [SKIP_SENTRY_KEY]: true },
                'Test Run artifact sweep failed'
              );
            }
          ),
        }
      : null;
  const catalogClient = createOpenRouterCatalogClient({
    apiKey: config.openRouterAppApiKey,
    logger: createAppLogger({ name: 'intex-agent-openrouter-catalog' }),
  });
  await startCatalogNonBlocking(catalogClient, logger);

  const externalSaveTester: ExternalSaveConnectionTestPort = {
    async testConnection(externalSave) {
      const result = await createExternalSaveClient(toExternalSaveClientConfig(externalSave)).save({
        message: 'Intex Agent external save connection test.',
      });
      return result.ok
        ? { ok: true, status: 'success', message: 'Connection successful' }
        : { ok: false, status: 'failure', message: result.error.message };
    },
  };

  const runner = createOrdinaryRunner({
    preferencesRepository,
    promptPreferencesRepository,
    createToolExecutor(input) {
      const clients = getProductionToolClients();
      return createIntexAgentToolExecutor({
        userId: input.userId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        notesClient: clients.notesClient,
        calendarClient: clients.calendarClient,
        researchClient: clients.researchClient,
        bookmarksClient: clients.bookmarksClient,
        codeClient: clients.codeClient,
        externalSaveClient: createExternalSaveToolClient(input.externalSave),
        promptPreferencesRepository,
      });
    },
    createModelClients(input) {
      return createRuntimeBoundModelClients({
        runtimeSettings: input.runtimeSettings,
        apiKey: config.openRouterAppApiKey,
        userId: input.userId,
        logger,
        usageSink,
      });
    },
    createIntentClassifier(client) {
      return createLlmIntexAgentIntentClassifier({ client, logger });
    },
    webAppUrl: config.webAppUrl,
  });

  const { incomingMessageHandler, testConversationRunner } = composeIntexAgentExecutionServices({
    catalogClient,
    logger,
    createOrdinaryIncomingMessageHandler: (handlerLogger) => ({
      async handle(input): ReturnType<IncomingMessageHandler['handle']> {
        return await handleIncomingMessage(input, {
          sessionRepository,
          runner,
          replyPublisher,
          clock: {
            now: () => new Date().toISOString(),
          },
          resolveRuntimeSettings: async (userId) =>
            await resolveRuntimeSettingsWithDeadline(userId, userServiceClient),
          logger: handlerLogger,
          ids: {
            sessionId: () => `intex_session_${randomUUID()}`,
            eventId: () => `intex_event_${randomUUID()}`,
            confirmationId: () => `intex_confirmation_${randomUUID()}`,
          },
          sessionTimeoutMs: config.sessionTimeoutMs,
        });
      },
    }),
    createTestConversationRunner: (evaluatorCatalogClient) =>
      createTestConversationRunnerService({
        config,
        sessionRepository,
        promptPreferencesRepository,
        logger,
        usageSink,
        catalogClient: evaluatorCatalogClient,
      }),
  });

  const ordinaryContainer: ServiceContainer = {
    config,
    sessionRepository,
    preferencesRepository,
    promptPreferencesRepository,
    externalSaveTester,
    incomingMessageHandler,
    testConversationRunner,
  };
  container =
    matrixCorpus === null
      ? ordinaryContainer
      : {
          ...ordinaryContainer,
          matrixCorpus,
          ...(testRuns === null ? {} : { testRuns }),
        };
}

async function verifyMatrixCorpusAttestationForRuntime(
  input: unknown,
  keyring: ReadonlyMap<string, ReturnType<typeof createPublicKey>>,
  now: () => string
): ReturnType<typeof verifyMatrixCorpusAttestation> {
  return await verifyMatrixCorpusAttestation(input, {
    keyring,
    now,
  });
}

export function createTestConversationRunnerService(
  deps: CreateTestConversationRunnerServiceInput
): TestConversationRunner {
  const createToolCallingClientFn = deps.createToolCallingClientFn ?? createToolCallingClient;
  const createLlmClientFn = deps.createLlmClientFn ?? createLlmClient;
  const createAgentRunnerFn = deps.createAgentRunnerFn ?? createIntexAgentRunner;

  return {
    async run(request): Promise<TestConversationResponse> {
      if (request.agentModel !== TEST_CONVERSATION_AGENT_MODEL) {
        throw new Error('Intex Agent test conversation model mismatch');
      }
      const requestModel = IntexAgentModels.DeepSeekV4Flash;
      if ((await deps.catalogClient.getIntexAgentCatalogEvidence()) === null) {
        throw new Error('Intex Agent evaluator catalog admission unavailable');
      }
      const toolCalls: CapturedToolCall[] = [];
      const testRunner: IntexAgentRunner = {
        async executeConfirmed(
          confirmedInput: Parameters<ReturnType<typeof createIntexAgentRunner>['executeConfirmed']>[0]
        ): Promise<IntexAgentRunnerResult> {
          const promptPreferences = await deps.promptPreferencesRepository.getCurrent(
            confirmedInput.session.userId
          );
          return await createAgentRunnerFn({
            client: {
              run() {
                return Promise.reject(
                  new Error('Confirmed Intex Agent test execution must not invoke the LLM')
                );
              },
            },
            toolExecutor: createTestToolExecutor({ mocks: request.toolMocks, calls: toolCalls }),
            webAppUrl: deps.config.webAppUrl,
            userPreferences: renderPromptPreferenceAgentContext(promptPreferences),
          }).executeConfirmed(confirmedInput);
        },
        async run(
          runnerInput: Parameters<ReturnType<typeof createIntexAgentRunner>['run']>[0]
        ): Promise<IntexAgentRunnerResult> {
          const toolCallingClient = createToolCallingClientFn({
            apiKey: deps.config.openRouterAppApiKey,
            model: requestModel,
            userId: runnerInput.session.userId,
            logger: deps.logger,
            usageSink: deps.usageSink,
            ownerType: 'user',
          });
          const classifierClient = createLlmClientFn({
            apiKey: deps.config.openRouterAppApiKey,
            model: requestModel,
            userId: runnerInput.session.userId,
            logger: deps.logger,
            usageSink: deps.usageSink,
            ownerType: 'user',
          });
          const promptPreferences = await deps.promptPreferencesRepository.getCurrent(
            runnerInput.session.userId
          );
          return await createAgentRunnerFn({
            client: toolCallingClient,
            responseRepairClient: classifierClient,
            toolExecutor: createTestToolExecutor({ mocks: request.toolMocks, calls: toolCalls }),
            intentClassifier: createLlmIntexAgentIntentClassifier({
              client: classifierClient,
              logger: deps.logger,
            }),
            webAppUrl: deps.config.webAppUrl,
            userPreferences: renderPromptPreferenceAgentContext(promptPreferences),
          }).run(runnerInput);
        },
      };

      return await runTestConversation(request, {
        sessionRepository: deps.sessionRepository,
        runner: testRunner,
        sessionTimeoutMs: deps.config.sessionTimeoutMs,
        ids: deps.ids ?? {
          sessionId: () => `intex_session_${randomUUID()}`,
          eventId: () => `intex_event_${randomUUID()}`,
          confirmationId: () => `intex_confirmation_${randomUUID()}`,
        },
        toolCalls,
        logger: deps.logger,
      });
    },
  };
}

export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(services: ServiceContainer): void {
  container = services;
}

export function resetServices(): void {
  container = null;
}

export async function startCatalogNonBlocking(
  catalogClient: Pick<OpenRouterCatalogClient, 'start'>,
  logger: { warn(value: Record<string, unknown>, message?: string): void }
): Promise<void> {
  try {
    await catalogClient.start();
  } catch {
    logger.warn(
      { reason: 'catalog_start_failed' },
      'Intex Agent OpenRouter catalog startup failed'
    );
  }
}

export async function resolveRuntimeSettingsWithDeadline(
  userId: string,
  userServiceClient: Pick<IntexAgentRuntimeSettingsClient, 'resolveIntexAgentRuntimeSettings'>,
  scheduler: RuntimeSettingsDeadlineScheduler = runtimeSettingsDeadlineScheduler
): ReturnType<IntexAgentRuntimeSettingsClient['resolveIntexAgentRuntimeSettings']> {
  let timeoutHandle: unknown;
  const lookupResult = Promise.resolve().then(
    async () => await userServiceClient.resolveIntexAgentRuntimeSettings(userId)
  );
  void lookupResult.catch(() => undefined);
  const timeoutResult = new Promise<Result<IntexAgentRuntimeSettingsV1, IntexAgentRuntimeSettingsClientError>>((resolve) => {
    timeoutHandle = scheduler.setTimeout(
      () => {
        resolve(
          err<IntexAgentRuntimeSettingsClientError>({
            code: 'TIMEOUT' as const,
            message: 'User Service runtime settings request timed out',
          })
        );
      },
      RUNTIME_SETTINGS_LOOKUP_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([lookupResult, timeoutResult]);
  } finally {
    if (timeoutHandle !== undefined) {
      scheduler.clearTimeout(timeoutHandle);
    }
  }

}

function createExternalSaveToolClient(
  externalSave: IntexAgentExternalSavePreferences | undefined
): ExternalSaveToolClient | null {
  if (externalSave?.enabled !== true) {
    return null;
  }
  if (
    externalSave.endpointUrl.trim() === '' ||
    externalSave.cfAccessClientId.trim() === '' ||
    externalSave.cfAccessClientSecret.trim() === '' ||
    externalSave.source.trim() === ''
  ) {
    return null;
  }
  return createExternalSaveClient(toExternalSaveClientConfig(externalSave));
}

function toExternalSaveClientConfig(externalSave: IntexAgentExternalSavePreferences): {
  endpointUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  source: string;
} {
  return {
    endpointUrl: externalSave.endpointUrl,
    cfAccessClientId: externalSave.cfAccessClientId,
    cfAccessClientSecret: externalSave.cfAccessClientSecret,
    source: externalSave.source,
  };
}
