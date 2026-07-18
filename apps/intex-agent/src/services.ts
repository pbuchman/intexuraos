import { randomUUID } from 'node:crypto';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { getFirestore } from '@intexuraos/infra-firestore';
import {
  createBookmarksAgentServiceClient,
  createCalendarAgentServiceClient,
  createCodeAgentServiceClient,
  createNotesAgentServiceClient,
  createResearchAgentServiceClient,
  createUserServiceClient,
  type UserServiceClient,
} from '@intexuraos/internal-clients';
import { createLlmClient, createToolCallingClient } from '@intexuraos/llm-factory';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { createWhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
import type { ServiceConfig } from './config.js';
import type { IncomingMessageHandler } from './domain/ports/incomingMessageHandler.js';
import type { PreferencesRepository } from './domain/ports/preferencesRepository.js';
import type { PromptPreferencesRepository } from './domain/ports/promptPreferencesRepository.js';
import type { SessionRepository } from './domain/ports/sessionRepository.js';
import type {
  ExternalSaveConnectionTestPort,
  IntexAgentExternalSavePreferences,
} from './domain/preferences/types.js';
import { renderPromptPreferenceAgentContext } from './domain/preferences/promptPreferences.js';
import { createIntexAgentRunner } from './domain/agent/intexAgentRunner.js';
import { createLlmIntexAgentIntentClassifier } from './domain/agent/intentClassifier.js';
import {
  createIntexAgentToolExecutor,
  type ExternalSaveToolClient,
} from './domain/agent/toolExecutor.js';
import {
  handleIncomingMessage,
  type IdGenerator,
  type IntexAgentRunner,
  type IntexAgentRunnerResult,
} from './domain/messages/handleIncomingMessage.js';
import { runTestConversation, type TestConversationRunner } from './domain/testConversation/runTestConversation.js';
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

const USER_TIME_ZONE_LOOKUP_TIMEOUT_MS = 1_000;

export type AgentRunnerFactory = typeof createIntexAgentRunner;

export interface ServiceContainer {
  config: ServiceConfig;
  sessionRepository: SessionRepository;
  preferencesRepository: PreferencesRepository;
  promptPreferencesRepository: PromptPreferencesRepository;
  externalSaveTester: ExternalSaveConnectionTestPort;
  incomingMessageHandler: IncomingMessageHandler;
  testConversationRunner: TestConversationRunner;
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
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  const logger = createAppLogger({ name: 'intex-agent' });
  const firestore = getFirestore();
  const sessionRepository = new FirestoreSessionRepository({ firestore });
  const preferencesRepository = new FirestorePreferencesRepository({ firestore });
  const promptPreferencesRepository = new FirestorePromptPreferencesRepository({ firestore });

  const notesClient = createNotesAgentServiceClient({
    baseUrl: config.notesAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'intex-agent-notes-client' }),
  });

  const calendarClient = createCalendarAgentServiceClient({
    baseUrl: config.calendarAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'intex-agent-calendar-client' }),
  });

  const researchClient = createResearchAgentServiceClient({
    baseUrl: config.researchAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'intex-agent-research-client' }),
  });

  const bookmarksClient = createBookmarksAgentServiceClient({
    baseUrl: config.bookmarksAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'intex-agent-bookmarks-client' }),
  });

  const codeClient = createCodeAgentServiceClient({
    baseUrl: config.codeAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: createAppLogger({ name: 'intex-agent-code-client' }),
  });

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

  const runner: IntexAgentRunner = {
    async executeConfirmed(
      input: Parameters<ReturnType<typeof createIntexAgentRunner>['executeConfirmed']>[0]
    ): Promise<IntexAgentRunnerResult> {
      const [preferences, promptPreferences] = await Promise.all([
        preferencesRepository.getPreferences(input.session.userId),
        promptPreferencesRepository.getCurrent(input.session.userId),
      ]);
      const toolExecutor = createIntexAgentToolExecutor({
        userId: input.session.userId,
        sessionId: input.session.id,
        messageId: input.messageId ?? input.session.id,
        notesClient,
        calendarClient,
        researchClient,
        bookmarksClient,
        codeClient,
        externalSaveClient: createExternalSaveToolClient(preferences?.externalSave),
        promptPreferencesRepository,
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
        webAppUrl: config.webAppUrl,
        userPreferences: renderPromptPreferenceAgentContext(promptPreferences),
      }).executeConfirmed(input);
    },
    async run(
      input: Parameters<ReturnType<typeof createIntexAgentRunner>['run']>[0]
    ): Promise<IntexAgentRunnerResult> {
      const toolCallingClient = createToolCallingClient({
        apiKey: config.openRouterAppApiKey,
        model: config.model,
        userId: input.session.userId,
        logger,
        usageSink,
        ownerType: 'user',
      });
      const classifierClient = createLlmClient({
        apiKey: config.openRouterAppApiKey,
        model: config.model,
        userId: input.session.userId,
        logger,
        usageSink,
        ownerType: 'user',
      });
      // The intent classifier needs plain generate(); the tool-calling client only exposes run().

      const [preferences, promptPreferences] = await Promise.all([
        preferencesRepository.getPreferences(input.session.userId),
        promptPreferencesRepository.getCurrent(input.session.userId),
      ]);
      const toolExecutor = createIntexAgentToolExecutor({
        userId: input.session.userId,
        sessionId: input.session.id,
        messageId: input.messageId ?? input.session.id,
        notesClient,
        calendarClient,
        researchClient,
        bookmarksClient,
        codeClient,
        externalSaveClient: createExternalSaveToolClient(preferences?.externalSave),
        promptPreferencesRepository,
      });

      return await createIntexAgentRunner({
        client: toolCallingClient,
        responseRepairClient: classifierClient,
        toolExecutor,
        intentClassifier: createLlmIntexAgentIntentClassifier({ client: classifierClient, logger }),
        webAppUrl: config.webAppUrl,
        userPreferences: renderPromptPreferenceAgentContext(promptPreferences),
      }).run(input);
    },
  };

  const incomingMessageHandler: IncomingMessageHandler = {
    async handle(input) {
      return await handleIncomingMessage(input, {
        sessionRepository,
        runner,
        replyPublisher,
        clock: {
          now: () => new Date().toISOString(),
        },
        resolveTimeZone: async (userId) =>
          await resolveUserTimeZone(userId, userServiceClient, logger),
        ids: {
          sessionId: () => `intex_session_${randomUUID()}`,
          eventId: () => `intex_event_${randomUUID()}`,
          confirmationId: () => `intex_confirmation_${randomUUID()}`,
        },
        sessionTimeoutMs: config.sessionTimeoutMs,
      });
    },
  };

  const testConversationRunner = createTestConversationRunnerService({
    config,
    sessionRepository,
    promptPreferencesRepository,
    logger,
    usageSink,
  });

  container = {
    config,
    sessionRepository,
    preferencesRepository,
    promptPreferencesRepository,
    externalSaveTester,
    incomingMessageHandler,
    testConversationRunner,
  };
}

export function createTestConversationRunnerService(
  deps: CreateTestConversationRunnerServiceInput
): TestConversationRunner {
  const createToolCallingClientFn = deps.createToolCallingClientFn ?? createToolCallingClient;
  const createLlmClientFn = deps.createLlmClientFn ?? createLlmClient;
  const createAgentRunnerFn = deps.createAgentRunnerFn ?? createIntexAgentRunner;

  return {
    async run(request): Promise<TestConversationResponse> {
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
            model: deps.config.model,
            userId: runnerInput.session.userId,
            logger: deps.logger,
            usageSink: deps.usageSink,
            ownerType: 'user',
          });
          const classifierClient = createLlmClientFn({
            apiKey: deps.config.openRouterAppApiKey,
            model: deps.config.model,
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

export async function resolveUserTimeZone(
  userId: string,
  userServiceClient: Pick<UserServiceClient, 'getUserTimezone'>,
  logger: { warn(value: Record<string, unknown>, message?: string): void }
): Promise<string> {
  const abortController = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const lookupResult = Promise.resolve()
    .then(
      async () =>
        await userServiceClient.getUserTimezone(userId, {
          signal: abortController.signal,
          throwOnError: true,
        })
    )
    .then(
      (configuredTimeZone) => ({ status: 'resolved' as const, configuredTimeZone }),
      () => ({ status: 'failed' as const })
    );
  const timeoutResult = new Promise<{ status: 'timeout' }>((resolve) => {
    timeoutHandle = setTimeout(
      () => {
        resolve({ status: 'timeout' });
        abortController.abort();
      },
      USER_TIME_ZONE_LOOKUP_TIMEOUT_MS
    );
  });

  let result: Awaited<typeof lookupResult> | Awaited<typeof timeoutResult>;
  try {
    result = await Promise.race([lookupResult, timeoutResult]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }

  if (result.status === 'failed') {
    warnUserTimeZoneFallback(logger, 'time_zone_lookup_failed');
    return 'UTC';
  }
  if (result.status === 'timeout') {
    warnUserTimeZoneFallback(logger, 'time_zone_lookup_timeout');
    return 'UTC';
  }
  const { configuredTimeZone } = result;
  if (configuredTimeZone !== undefined && isIanaTimeZone(configuredTimeZone)) {
    return configuredTimeZone;
  }
  if (configuredTimeZone === undefined) {
    return 'UTC';
  }

  warnUserTimeZoneFallback(logger, 'invalid_time_zone');
  return 'UTC';
}

function warnUserTimeZoneFallback(
  logger: { warn(value: Record<string, unknown>, message?: string): void },
  reason: 'invalid_time_zone' | 'time_zone_lookup_failed' | 'time_zone_lookup_timeout'
): void {
  logger.warn({ reason }, 'Falling back to UTC for Intex Agent user time zone');
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
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
