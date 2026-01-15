/**
 * Service wiring for notion-service.
 * Provides backward-compatible service container for routes.
 */
import type { Result } from '@intexuraos/common-core';
import type { NotionError, NotionLogger } from '@intexuraos/infra-notion';
import pino from 'pino';

const defaultNotionLogger: NotionLogger = pino({ level: 'silent' });
import {
  disconnectNotion,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  type NotionConnectionPublic,
  type NotionError as FirestoreError,
  saveNotionConnection,
} from './infra/firestore/index.js';
import { getPageWithPreview, validateNotionToken } from './infra/notion/index.js';

/**
 * Connection repository adapter matching domain port interface.
 */
interface ConnectionRepository {
  isConnected(userId: string): Promise<Result<boolean, FirestoreError>>;
  getToken(userId: string): Promise<Result<string | null, FirestoreError>>;
  getConnection(userId: string): Promise<Result<NotionConnectionPublic | null, FirestoreError>>;
  saveConnection(
    userId: string,
    notionToken: string
  ): Promise<Result<NotionConnectionPublic, FirestoreError>>;
  disconnect(userId: string): Promise<Result<NotionConnectionPublic, FirestoreError>>;
  disconnectConnection(userId: string): Promise<Result<NotionConnectionPublic, FirestoreError>>;
}

/**
 * Notion API adapter matching old interface.
 */
interface NotionApiAdapter {
  validateToken(token: string): Promise<Result<boolean, NotionError>>;
  getPageWithPreview(
    token: string,
    pageId: string
  ): Promise<
    Result<
      {
        page: { id: string; title: string; url: string };
        blocks: { type: string; content: string }[];
      },
      NotionError
    >
  >;
}

/**
 * Service container for routes.
 */
export interface ServiceContainer {
  logger: NotionLogger;
  connectionRepository: ConnectionRepository;
  notionApi: NotionApiAdapter;
}

let container: ServiceContainer | null = null;

function createConnectionRepository(): ConnectionRepository {
  return {
    isConnected: async (userId) => await isNotionConnected(userId),
    getToken: async (userId) => await getNotionToken(userId),
    getConnection: async (userId) => await getNotionConnection(userId),
    saveConnection: async (userId, notionToken) => await saveNotionConnection(userId, notionToken),
    disconnect: async (userId) => await disconnectNotion(userId),
    disconnectConnection: async (userId) => await disconnectNotion(userId),
  };
}

function createNotionApiAdapter(logger: NotionLogger): NotionApiAdapter {
  return {
    validateToken: async (token): Promise<Result<boolean, NotionError>> =>
      await validateNotionToken(token, logger),
    getPageWithPreview: async (
      token,
      pageId
    ): Promise<
      Result<
        {
          page: { id: string; title: string; url: string };
          blocks: { type: string; content: string }[];
        },
        NotionError
      >
    > => {
      const result = await getPageWithPreview(token, pageId, logger);
      if (!result.ok) return result;
      const { id, title, url, blocks } = result.value;
      return { ok: true as const, value: { page: { id, title, url }, blocks } };
    },
  };
}

/**
 * Initialize services with dependencies.
 * Call this early in server startup.
 */
export function getServices(logger: NotionLogger = defaultNotionLogger): ServiceContainer {
  container ??= {
    logger,
    connectionRepository: createConnectionRepository(),
    notionApi: createNotionApiAdapter(logger),
  };

  return container;
}

/**
 * Set custom services (for testing).
 */
export function setServices(services: Partial<ServiceContainer>): void {
  const logger = services.logger ?? defaultNotionLogger;
  container = {
    logger,
    connectionRepository: services.connectionRepository ?? createConnectionRepository(),
    notionApi: services.notionApi ?? createNotionApiAdapter(logger),
  };
}

/**
 * Reset services (for testing).
 */
export function resetServices(): void {
  container = null;
}
