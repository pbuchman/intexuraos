/**
 * Service wiring for promptvault-service.
 * Provides backward-compatible service container for routes.
 */
import type { Result } from '@intexuraos/common-core';
import pino from 'pino';
import {
  type NotionLogger,
  type NotionError,
  getPageWithPreview as getPageWithPreviewFn,
} from '@intexuraos/infra-notion';

const defaultNotionLogger: NotionLogger = pino({ level: 'silent' });
import {
  createNotionServiceClient,
  type NotionServiceClient,
} from './infra/notion/notionServiceClient.js';
import {
  createPrompt as createPromptFn,
  getPrompt as getPromptFn,
  listPrompts as listPromptsFn,
  type Prompt,
  type PromptVaultError,
  updatePrompt as updatePromptFn,
} from './infra/notion/index.js';
import type { PromptVaultSettingsPort } from './domain/promptvault/ports/index.js';
import {
  getPromptVaultPageId,
  savePromptVaultPageId,
} from './infra/firestore/promptVaultSettingsRepository.js';

export interface NotionPagePreview {
  id: string;
  title: string;
  url: string;
  blocks: { type: string; content: string }[];
}

export interface NotionPageClient {
  getPageWithPreview(
    token: string,
    pageId: string
  ): Promise<Result<NotionPagePreview, NotionError>>;
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
  logger: NotionLogger;
  notionServiceClient: NotionServiceClient;
  notionPageClient: NotionPageClient;
  promptRepository: PromptRepository;
  promptVaultSettings: PromptVaultSettingsPort;
}

let container: ServiceContainer | null = null;

function createPromptRepository(
  notionServiceClient: NotionServiceClient,
  promptVaultSettings: PromptVaultSettingsPort,
  logger: NotionLogger
): PromptRepository {
  return {
    createPrompt: async (userId, input): Promise<Result<Prompt, PromptVaultError>> =>
      await createPromptFn(
        userId,
        input.title,
        input.content,
        notionServiceClient,
        promptVaultSettings,
        logger
      ),
    listPrompts: async (userId): Promise<Result<Prompt[], PromptVaultError>> =>
      await listPromptsFn(userId, notionServiceClient, promptVaultSettings, logger),
    getPrompt: async (userId, promptId): Promise<Result<Prompt, PromptVaultError>> =>
      await getPromptFn(userId, promptId, notionServiceClient, promptVaultSettings, logger),
    updatePrompt: async (userId, promptId, input): Promise<Result<Prompt, PromptVaultError>> =>
      await updatePromptFn(
        userId,
        promptId,
        input,
        notionServiceClient,
        promptVaultSettings,
        logger
      ),
  };
}

function createPromptVaultSettingsAdapter(): PromptVaultSettingsPort {
  return {
    getPromptVaultPageId: async (userId) => await getPromptVaultPageId(userId),
    savePromptVaultPageId: async (userId, pageId) => await savePromptVaultPageId(userId, pageId),
  };
}

/**
 * Initialize services with dependencies.
 * Call this early in server startup.
 */
export function getServices(logger: NotionLogger = defaultNotionLogger): ServiceContainer {
  if (container !== null) return container;

  const notionServiceUrl = process.env['INTEXURAOS_NOTION_SERVICE_URL'];
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

  if (notionServiceUrl === undefined || notionServiceUrl === '') {
    throw new Error('INTEXURAOS_NOTION_SERVICE_URL is not configured');
  }

  if (internalAuthToken === undefined || internalAuthToken === '') {
    throw new Error('INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured');
  }

  const notionServiceClient = createNotionServiceClient({
    baseUrl: notionServiceUrl,
    internalAuthToken,
  });

  const promptVaultSettings = createPromptVaultSettingsAdapter();

  const notionPageClient: NotionPageClient = {
    getPageWithPreview: async (token, pageId) => await getPageWithPreviewFn(token, pageId, logger),
  };

  container = {
    logger,
    notionServiceClient,
    notionPageClient,
    promptRepository: createPromptRepository(notionServiceClient, promptVaultSettings, logger),
    promptVaultSettings,
  };

  return container;
}

/**
 * Set custom services (for testing).
 */
export function setServices(services: Partial<ServiceContainer>): void {
  const logger = services.logger;

  const notionServiceClient =
    services.notionServiceClient ??
    createNotionServiceClient({
      baseUrl: process.env['INTEXURAOS_NOTION_SERVICE_URL'] ?? '',
      internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
    });

  const promptVaultSettings = services.promptVaultSettings ?? createPromptVaultSettingsAdapter();

  const notionPageClient: NotionPageClient = services.notionPageClient ?? {
    getPageWithPreview: async (token, pageId) => await getPageWithPreviewFn(token, pageId, logger),
  };

  container = {
    logger,
    notionServiceClient,
    notionPageClient,
    promptRepository:
      services.promptRepository ??
      createPromptRepository(notionServiceClient, promptVaultSettings, logger),
    promptVaultSettings,
  };
}

/**
 * Reset services (for testing).
 */
export function resetServices(): void {
  container = null;
}
