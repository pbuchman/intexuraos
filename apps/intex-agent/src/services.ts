import { randomUUID } from 'node:crypto';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { getFirestore } from '@intexuraos/infra-firestore';
import {
  createBookmarksAgentServiceClient,
  createCalendarAgentServiceClient,
  createCodeAgentServiceClient,
  createNotesAgentServiceClient,
  createResearchAgentServiceClient,
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
import { createIntexAgentRunner } from './domain/agent/intexAgentRunner.js';
import { createLlmIntexAgentIntentClassifier } from './domain/agent/intentClassifier.js';
import {
  createIntexAgentToolExecutor,
  type ExternalSaveToolClient,
} from './domain/agent/toolExecutor.js';
import {
  handleIncomingMessage,
  type IntexAgentRunner,
  type IntexAgentRunnerResult,
} from './domain/messages/handleIncomingMessage.js';
import { FirestorePreferencesRepository } from './infra/firestore/preferencesRepository.js';
import { FirestorePromptPreferencesRepository } from './infra/firestore/promptPreferencesRepository.js';
import { FirestoreSessionRepository } from './infra/firestore/sessionRepository.js';
import { createExternalSaveClient } from './infra/http/externalSaveClient.js';
import { createWhatsAppReplyPublisher } from './infra/pubsub/whatsappReplyPublisher.js';

export interface ServiceContainer {
  config: ServiceConfig;
  sessionRepository: SessionRepository;
  preferencesRepository: PreferencesRepository;
  promptPreferencesRepository: PromptPreferencesRepository;
  externalSaveTester: ExternalSaveConnectionTestPort;
  incomingMessageHandler: IncomingMessageHandler;
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

  const sendPublisher = createWhatsAppSendPublisher({
    projectId: config.gcpProjectId,
    topicName: config.whatsappSendTopic,
    logger: createAppLogger({ name: 'intex-agent-whatsapp-send-publisher' }),
  });
  const replyPublisher = createWhatsAppReplyPublisher({ sendPublisher });
  const externalSaveTester: ExternalSaveConnectionTestPort = {
    async testConnection(externalSave) {
      const result = await createExternalSaveClient(toExternalSaveClientConfig(externalSave)).save({
        message: 'INTEX Agent external save connection test.',
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
              new Error('Confirmed INTEX Agent execution must not invoke the LLM')
            );
          },
        },
        toolExecutor,
        webAppUrl: config.webAppUrl,
        userPreferences: promptPreferences.renderedPromptBlock,
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
        toolExecutor,
        intentClassifier: createLlmIntexAgentIntentClassifier({ client: classifierClient, logger }),
        webAppUrl: config.webAppUrl,
        userPreferences: promptPreferences.renderedPromptBlock,
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
        ids: {
          sessionId: () => `intex_session_${randomUUID()}`,
          eventId: () => `intex_event_${randomUUID()}`,
          confirmationId: () => `intex_confirmation_${randomUUID()}`,
        },
        sessionTimeoutMs: config.sessionTimeoutMs,
      });
    },
  };

  container = {
    config,
    sessionRepository,
    preferencesRepository,
    promptPreferencesRepository,
    externalSaveTester,
    incomingMessageHandler,
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
