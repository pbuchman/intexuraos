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
import { createToolCallingClient } from '@intexuraos/llm-factory';
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { createWhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
import type { ServiceConfig } from './config.js';
import type { IncomingMessageHandler } from './domain/ports/incomingMessageHandler.js';
import type { SessionRepository } from './domain/ports/sessionRepository.js';
import { createIntexAgentRunner } from './domain/agent/intexAgentRunner.js';
import { createIntexAgentToolExecutor } from './domain/agent/toolExecutor.js';
import {
  handleIncomingMessage,
  type IntexAgentRunner,
  type IntexAgentRunnerResult,
} from './domain/messages/handleIncomingMessage.js';
import { FirestoreSessionRepository } from './infra/firestore/sessionRepository.js';
import { createWhatsAppReplyPublisher } from './infra/pubsub/whatsappReplyPublisher.js';

export interface ServiceContainer {
  config: ServiceConfig;
  sessionRepository: SessionRepository;
  incomingMessageHandler: IncomingMessageHandler;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  const logger = createAppLogger({ name: 'intex-agent' });
  const firestore = getFirestore();
  const sessionRepository = new FirestoreSessionRepository({ firestore });

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

  const runner: IntexAgentRunner = {
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

      const toolExecutor = createIntexAgentToolExecutor({
        userId: input.session.userId,
        messageId: input.messageId ?? input.session.id,
        notesClient,
        calendarClient,
        researchClient,
        bookmarksClient,
        codeClient,
      });

      return await createIntexAgentRunner({
        client: toolCallingClient,
        toolExecutor,
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
        },
        sessionTimeoutMs: config.sessionTimeoutMs,
      });
    },
  };

  container = {
    config,
    sessionRepository,
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
