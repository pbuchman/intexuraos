/**
 * Service wiring for promptvault-service.
 * Provides backward-compatible service container for routes.
 */
import type { Result } from '@intexuraos/common-core';
import type { NotionLogger } from '@intexuraos/infra-notion';
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
  notionServiceClient: NotionServiceClient;
  promptRepository: PromptRepository;
}

let container: ServiceContainer | null = null;

function createPromptRepository(
  notionServiceClient: NotionServiceClient,
  logger: NotionLogger | undefined
): PromptRepository {
  return {
    createPrompt: async (userId, input): Promise<Result<Prompt, PromptVaultError>> =>
      await createPromptFn(userId, input.title, input.content, notionServiceClient, logger),
    listPrompts: async (userId): Promise<Result<Prompt[], PromptVaultError>> =>
      await listPromptsFn(userId, notionServiceClient, logger),
    getPrompt: async (userId, promptId): Promise<Result<Prompt, PromptVaultError>> =>
      await getPromptFn(userId, promptId, notionServiceClient, logger),
    updatePrompt: async (userId, promptId, input): Promise<Result<Prompt, PromptVaultError>> =>
      await updatePromptFn(userId, promptId, input, notionServiceClient, logger),
  };
}

/**
 * Initialize services with dependencies.
 * Call this early in server startup.
 */
export function getServices(logger?: NotionLogger): ServiceContainer {
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

  container = {
    logger,
    notionServiceClient,
    promptRepository: createPromptRepository(notionServiceClient, logger),
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

  container = {
    logger,
    notionServiceClient,
    promptRepository:
      services.promptRepository ?? createPromptRepository(notionServiceClient, logger),
  };
}

/**
 * Reset services (for testing).
 */
export function resetServices(): void {
  container = null;
}
