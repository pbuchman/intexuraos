/**
 * PromptRepository adapter using Notion API.
 * Implements the domain PromptRepository port using Notion as storage.
 */
import { ok, err, type Result } from '@praxos/common';
import type {
  Prompt,
  PromptId,
  CreatePromptInput,
  UpdatePromptInput,
  PromptRepository,
  PromptVaultError,
  NotionApiPort,
  NotionConnectionRepository,
} from '@praxos/domain-promptvault';

/**
 * Map Notion errors to PromptVault domain errors.
 */
function mapNotionErrorToPromptVaultError(notionError: {
  code: string;
  message: string;
}): PromptVaultError {
  switch (notionError.code) {
    case 'NOT_FOUND':
      return { code: 'NOT_FOUND', message: notionError.message };
    case 'UNAUTHORIZED':
      return { code: 'UNAUTHORIZED', message: notionError.message };
    default:
      return { code: 'DOWNSTREAM_ERROR', message: notionError.message };
  }
}

/**
 * Factory to create a PromptRepository backed by Notion.
 */
export function createNotionPromptRepository(
  connectionRepository: NotionConnectionRepository,
  notionApi: NotionApiPort
): PromptRepository {
  /**
   * Get the user's Notion token and prompt vault page ID.
   */
  async function getUserContext(
    userId: string
  ): Promise<Result<{ token: string; promptVaultPageId: string }, PromptVaultError>> {
    // Check if connected
    const connectedResult = await connectionRepository.isConnected(userId);
    if (!connectedResult.ok) {
      return err(mapNotionErrorToPromptVaultError(connectedResult.error));
    }
    if (!connectedResult.value) {
      return err({
        code: 'NOT_CONNECTED',
        message: 'Notion integration is not configured',
      });
    }

    // Get token
    const tokenResult = await connectionRepository.getToken(userId);
    if (!tokenResult.ok) {
      return err(mapNotionErrorToPromptVaultError(tokenResult.error));
    }
    const token = tokenResult.value;
    if (token === null) {
      return err({
        code: 'NOT_CONNECTED',
        message: 'Notion token not found',
      });
    }

    // Get config
    const configResult = await connectionRepository.getConnection(userId);
    if (!configResult.ok) {
      return err(mapNotionErrorToPromptVaultError(configResult.error));
    }
    const config = configResult.value;
    if (config === null) {
      return err({
        code: 'NOT_CONNECTED',
        message: 'Notion configuration not found',
      });
    }

    return ok({ token, promptVaultPageId: config.promptVaultPageId });
  }

  return {
    async createPrompt(
      userId: string,
      input: CreatePromptInput
    ): Promise<Result<Prompt, PromptVaultError>> {
      const contextResult = await getUserContext(userId);
      if (!contextResult.ok) {
        return err(contextResult.error);
      }

      const { token, promptVaultPageId } = contextResult.value;

      const createResult = await notionApi.createPromptVaultNote({
        token,
        parentPageId: promptVaultPageId,
        title: input.title,
        prompt: input.content,
        userId,
      });

      if (!createResult.ok) {
        return err(mapNotionErrorToPromptVaultError(createResult.error));
      }

      const createdNote = createResult.value;
      const now = new Date().toISOString();

      return ok({
        id: createdNote.id,
        title: createdNote.title,
        content: input.content,
        createdAt: now,
        updatedAt: now,
      });
    },

    async listPrompts(userId: string): Promise<Result<Prompt[], PromptVaultError>> {
      const contextResult = await getUserContext(userId);
      if (!contextResult.ok) {
        return err(contextResult.error);
      }

      const { token, promptVaultPageId } = contextResult.value;

      const listResult = await notionApi.listChildPages(token, promptVaultPageId);
      if (!listResult.ok) {
        return err(mapNotionErrorToPromptVaultError(listResult.error));
      }

      const pages = listResult.value;
      const prompts: Prompt[] = [];

      // Fetch full content for each page
      for (const page of pages) {
        const pageResult = await notionApi.getPromptPage(token, page.id);
        if (pageResult.ok) {
          prompts.push({
            id: pageResult.value.page.id,
            title: pageResult.value.page.title,
            content: pageResult.value.promptContent,
            createdAt: pageResult.value.createdAt,
            updatedAt: pageResult.value.updatedAt,
          });
        }
        // Skip pages that fail to load (may not be prompt pages)
      }

      return ok(prompts);
    },

    async getPrompt(userId: string, promptId: PromptId): Promise<Result<Prompt, PromptVaultError>> {
      const contextResult = await getUserContext(userId);
      if (!contextResult.ok) {
        return err(contextResult.error);
      }

      const { token } = contextResult.value;

      const pageResult = await notionApi.getPromptPage(token, promptId);
      if (!pageResult.ok) {
        return err(mapNotionErrorToPromptVaultError(pageResult.error));
      }

      return ok({
        id: pageResult.value.page.id,
        title: pageResult.value.page.title,
        content: pageResult.value.promptContent,
        createdAt: pageResult.value.createdAt,
        updatedAt: pageResult.value.updatedAt,
      });
    },

    async updatePrompt(
      userId: string,
      promptId: PromptId,
      input: UpdatePromptInput
    ): Promise<Result<Prompt, PromptVaultError>> {
      const contextResult = await getUserContext(userId);
      if (!contextResult.ok) {
        return err(contextResult.error);
      }

      const { token } = contextResult.value;

      // Build update object only with defined properties
      const update: { title?: string; promptContent?: string } = {};
      if (input.title !== undefined) {
        update.title = input.title;
      }
      if (input.content !== undefined) {
        update.promptContent = input.content;
      }

      const updateResult = await notionApi.updatePromptPage(token, promptId, update);

      if (!updateResult.ok) {
        return err(mapNotionErrorToPromptVaultError(updateResult.error));
      }

      // Get the original page for createdAt
      const pageResult = await notionApi.getPromptPage(token, promptId);
      const createdAt = pageResult.ok ? pageResult.value.createdAt : undefined;

      return ok({
        id: updateResult.value.page.id,
        title: updateResult.value.page.title,
        content: updateResult.value.promptContent,
        createdAt,
        updatedAt: updateResult.value.updatedAt,
      });
    },
  };
}
