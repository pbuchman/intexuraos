/**
 * Service wiring for notion-service.
 * Provides backward-compatible service container for routes.
 */
import type { NotionLogger, Result, NotionError } from '@intexuraos/common';
import {
  saveNotionConnection,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  disconnectNotion,
  type NotionConnectionPublic,
  type NotionError as FirestoreError,
} from './infra/firestore/index.js';
import { validateNotionToken, getPageWithPreview } from './infra/notion/index.js';

// Store the logger for use by routes
let notionLogger: NotionLogger | undefined;

/**
 * Connection repository adapter matching old interface.
 */
interface ConnectionRepository {
  isConnected(userId: string): Promise<Result<boolean, FirestoreError>>;
  getToken(userId: string): Promise<Result<string | null, FirestoreError>>;
  getConnection(userId: string): Promise<Result<NotionConnectionPublic | null, FirestoreError>>;
  saveConnection(
    userId: string,
    promptVaultPageId: string,
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
  logger: NotionLogger | undefined;
  connectionRepository: ConnectionRepository;
  notionApi: NotionApiAdapter;
}

let container: ServiceContainer | null = null;

function createConnectionRepository(): ConnectionRepository {
  return {
    isConnected: async (userId) => await isNotionConnected(userId),
    getToken: async (userId) => await getNotionToken(userId),
    getConnection: async (userId) => await getNotionConnection(userId),
    saveConnection: async (userId, promptVaultPageId, notionToken) =>
      await saveNotionConnection(userId, promptVaultPageId, notionToken),
    disconnect: async (userId) => await disconnectNotion(userId),
    disconnectConnection: async (userId) => await disconnectNotion(userId),
  };
}

function createNotionApiAdapter(): NotionApiAdapter {
  return {
    validateToken: async (token): Promise<Result<boolean, NotionError>> =>
      await validateNotionToken(token, notionLogger),
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
      const result = await getPageWithPreview(token, pageId, notionLogger);
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
export function getServices(logger?: NotionLogger): ServiceContainer {
  if (logger !== undefined) {
    notionLogger = logger;
  }

  container ??= {
    logger: notionLogger,
    connectionRepository: createConnectionRepository(),
    notionApi: createNotionApiAdapter(),
  };

  return container;
}

/**
 * Get the configured Notion logger.
 */
export function getNotionLogger(): NotionLogger | undefined {
  return notionLogger;
}

/**
 * Set custom services (for testing).
 */
export function setServices(services: Partial<ServiceContainer>): void {
  container = {
    logger: services.logger ?? notionLogger,
    connectionRepository: services.connectionRepository ?? createConnectionRepository(),
    notionApi: services.notionApi ?? createNotionApiAdapter(),
  };
}

/**
 * Reset services (for testing).
 */
export function resetServices(): void {
  notionLogger = undefined;
  container = null;
}

// Re-export infra functions for direct use
export * from './infra/firestore/index.js';
export * from './infra/notion/index.js';
