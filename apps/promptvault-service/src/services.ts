/**
 * Service wiring for promptvault-service.
 * Provides backward-compatible service container for routes.
 */
import type { NotionLogger, Result } from '@praxos/common';
import {
  saveNotionConnection,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  disconnectNotion,
  type NotionConnectionPublic,
  type NotionError,
} from './infra/firestore/index.js';
import {
  createPrompt as createPromptFn,
  listPrompts as listPromptsFn,
  getPrompt as getPromptFn,
  updatePrompt as updatePromptFn,
  validateNotionToken,
  getPageWithPreview,
  type Prompt,
  type PromptVaultError,
} from './infra/notion/index.js';

// Store the logger for use by routes
let notionLogger: NotionLogger | undefined;

/**
 * Connection repository adapter matching old interface.
 */
interface ConnectionRepository {
  isConnected(userId: string): Promise<Result<boolean, NotionError>>;
  getToken(userId: string): Promise<Result<string | null, NotionError>>;
  getConnection(userId: string): Promise<Result<NotionConnectionPublic | null, NotionError>>;
  saveConnection(
    userId: string,
    promptVaultPageId: string,
    notionToken: string
  ): Promise<Result<NotionConnectionPublic, NotionError>>;
  disconnect(userId: string): Promise<Result<NotionConnectionPublic, NotionError>>;
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
 * Prompt repository adapter matching old interface.
 */
interface PromptRepository {
  createPrompt(
    userId: string,
    input: { title: string; content: string }
  ): Promise<Result<Prompt, PromptVaultError>>;
  listPrompts(userId: string): Promise<Result<Prompt[], PromptVaultError>>;
  getPrompt(userId: string, promptId: string): Promise<Result<Prompt, PromptVaultError>>;
  updatePrompt(
    userId: string,
    promptId: string,
    input: { title?: string; content?: string }
  ): Promise<Result<Prompt, PromptVaultError>>;
}

/**
 * Service container for routes.
 */
export interface ServiceContainer {
  logger: NotionLogger | undefined;
  connectionRepository: ConnectionRepository;
  notionApi: NotionApiAdapter;
  promptRepository: PromptRepository;
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

function createPromptRepository(): PromptRepository {
  return {
    createPrompt: async (userId, input): Promise<Result<Prompt, PromptVaultError>> =>
      await createPromptFn(userId, input.title, input.content, notionLogger),
    listPrompts: async (userId): Promise<Result<Prompt[], PromptVaultError>> =>
      await listPromptsFn(userId, notionLogger),
    getPrompt: async (userId, promptId): Promise<Result<Prompt, PromptVaultError>> =>
      await getPromptFn(userId, promptId, notionLogger),
    updatePrompt: async (userId, promptId, input): Promise<Result<Prompt, PromptVaultError>> =>
      await updatePromptFn(userId, promptId, input, notionLogger),
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
    promptRepository: createPromptRepository(),
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
 * Reset services (for testing).
 */
export function resetServices(): void {
  notionLogger = undefined;
  container = null;
}

// Re-export infra functions for direct use
export * from './infra/firestore/index.js';
export * from './infra/notion/index.js';
