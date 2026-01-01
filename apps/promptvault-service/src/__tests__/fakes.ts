/**
 * Fake repositories for testing promptvault-service.
 *
 * These fakes implement the same interfaces as the real Firestore/Notion adapters
 * but use in-memory storage. They are designed to be exercised by route tests.
 *
 * Coverage note: Some methods may show low coverage until all Tier 1 test issues
 * are completed (see docs/continuity/1-3-promptvault-usecases.md).
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  NotionServiceClient,
  NotionServiceError,
  NotionTokenContext,
} from '../infra/notion/notionServiceClient.js';
import type {
  PromptVaultSettingsPort,
  PromptVaultSettings,
  PromptVaultSettingsError,
} from '../domain/promptvault/ports/index.js';

export interface NotionConnectionPublic {
  promptVaultPageId: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotionError {
  code: string;
  message: string;
}

/**
 * Fake Notion service client for testing.
 * Simulates HTTP calls to notion-service.
 */
export class FakeNotionServiceClient implements NotionServiceClient {
  private tokenContexts = new Map<string, NotionTokenContext>();
  private getNotionTokenError: NotionServiceError | null = null;

  async getNotionToken(userId: string): Promise<Result<NotionTokenContext, NotionServiceError>> {
    if (this.getNotionTokenError !== null) {
      const error = this.getNotionTokenError;
      this.getNotionTokenError = null; // Reset after use
      return err(error);
    }

    const context = this.tokenContexts.get(userId);
    if (context === undefined) {
      return ok({ connected: false, token: null });
    }

    return ok(context);
  }

  // Test helpers
  setTokenContext(userId: string, context: NotionTokenContext): void {
    this.tokenContexts.set(userId, context);
  }

  setGetNotionTokenError(error: NotionServiceError | null): void {
    this.getNotionTokenError = error;
  }

  clear(): void {
    this.tokenContexts.clear();
    this.getNotionTokenError = null;
  }
}

/**
 * Fake PromptVault settings repository for testing.
 * Stores promptVaultPageId in memory.
 * Implements PromptVaultSettingsPort for proper DI testing.
 */
export class FakePromptVaultSettingsRepository implements PromptVaultSettingsPort {
  private pageIds = new Map<string, { pageId: string; createdAt: string; updatedAt: string }>();
  private getPageIdError: PromptVaultSettingsError | null = null;
  private savePageIdError: PromptVaultSettingsError | null = null;

  async getPromptVaultPageId(
    userId: string
  ): Promise<Result<string | null, PromptVaultSettingsError>> {
    if (this.getPageIdError !== null) {
      const error = this.getPageIdError;
      this.getPageIdError = null;
      return err(error);
    }
    const data = this.pageIds.get(userId);
    return ok(data?.pageId ?? null);
  }

  async savePromptVaultPageId(
    userId: string,
    pageId: string
  ): Promise<Result<PromptVaultSettings, PromptVaultSettingsError>> {
    if (this.savePageIdError !== null) {
      const error = this.savePageIdError;
      this.savePageIdError = null;
      return err(error);
    }
    const now = new Date().toISOString();
    const existing = this.pageIds.get(userId);
    const createdAt = existing?.createdAt ?? now;
    this.pageIds.set(userId, { pageId, createdAt, updatedAt: now });
    return ok({ promptVaultPageId: pageId, createdAt, updatedAt: now });
  }

  setPageId(userId: string, pageId: string): void {
    const now = new Date().toISOString();
    this.pageIds.set(userId, { pageId, createdAt: now, updatedAt: now });
  }

  setGetPageIdError(error: PromptVaultSettingsError | null): void {
    this.getPageIdError = error;
  }

  setSavePageIdError(error: PromptVaultSettingsError | null): void {
    this.savePageIdError = error;
  }

  clear(): void {
    this.pageIds.clear();
    this.getPageIdError = null;
    this.savePageIdError = null;
  }
}

/**
 * Fake Notion connection repository for testing.
 * @deprecated Use FakeNotionServiceClient instead.
 */
export class FakeNotionConnectionRepository {
  private connections = new Map<
    string,
    {
      token: string | null;
      promptVaultPageId: string;
      connected: boolean;
      createdAt: string;
      updatedAt: string;
    }
  >();

  // Error injection for testing error paths
  private getTokenError: NotionError | null = null;
  private getConnectionError: NotionError | null = null;
  private isConnectedError: NotionError | null = null;
  // Force getConnection to return null for testing config-not-found scenario
  private forceGetConnectionNull = false;

  saveConnection(
    userId: string,
    promptVaultPageId: string,
    notionToken: string
  ): Promise<Result<NotionConnectionPublic, NotionError>> {
    const now = new Date().toISOString();
    const existing = this.connections.get(userId);
    this.connections.set(userId, {
      token: notionToken,
      promptVaultPageId,
      connected: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return Promise.resolve(
      ok({
        promptVaultPageId,
        connected: true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    );
  }

  getConnection(userId: string): Promise<Result<NotionConnectionPublic | null, NotionError>> {
    if (this.getConnectionError !== null) {
      return Promise.resolve(err(this.getConnectionError));
    }
    if (this.forceGetConnectionNull) {
      return Promise.resolve(ok(null));
    }
    const conn = this.connections.get(userId);
    if (conn === undefined) return Promise.resolve(ok(null));
    return Promise.resolve(
      ok({
        promptVaultPageId: conn.promptVaultPageId,
        connected: conn.connected,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      })
    );
  }

  getToken(userId: string): Promise<Result<string | null, NotionError>> {
    if (this.getTokenError !== null) {
      return Promise.resolve(err(this.getTokenError));
    }
    const conn = this.connections.get(userId);
    if (conn?.connected !== true) return Promise.resolve(ok(null));
    return Promise.resolve(ok(conn.token));
  }

  isConnected(userId: string): Promise<Result<boolean, NotionError>> {
    if (this.isConnectedError !== null) {
      return Promise.resolve(err(this.isConnectedError));
    }
    const conn = this.connections.get(userId);
    return Promise.resolve(ok(conn?.connected ?? false));
  }

  disconnect(userId: string): Promise<Result<NotionConnectionPublic, NotionError>> {
    const conn = this.connections.get(userId);
    if (conn === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Not found' }));
    }
    conn.connected = false;
    conn.updatedAt = new Date().toISOString();
    return Promise.resolve(
      ok({
        promptVaultPageId: conn.promptVaultPageId,
        connected: false,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      })
    );
  }

  disconnectConnection(userId: string): Promise<Result<NotionConnectionPublic, NotionError>> {
    return this.disconnect(userId);
  }

  // Test helpers
  setConnection(
    userId: string,
    token: string | null,
    promptVaultPageId: string,
    connected = true
  ): void {
    const now = new Date().toISOString();
    this.connections.set(userId, {
      token,
      promptVaultPageId,
      connected,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Set error to return from getToken for testing error paths.
   */
  setGetTokenError(error: NotionError | null): void {
    this.getTokenError = error;
  }

  /**
   * Set error to return from getConnection for testing error paths.
   */
  setGetConnectionError(error: NotionError | null): void {
    this.getConnectionError = error;
  }

  /**
   * Set error to return from isConnected for testing error paths.
   */
  setIsConnectedError(error: NotionError | null): void {
    this.isConnectedError = error;
  }

  /**
   * Force getConnection to return null even when user is connected.
   * This simulates a data inconsistency scenario for testing.
   */
  setForceGetConnectionNull(force: boolean): void {
    this.forceGetConnectionNull = force;
  }

  clear(): void {
    this.connections.clear();
    this.getTokenError = null;
    this.getConnectionError = null;
    this.isConnectedError = null;
    this.forceGetConnectionNull = false;
  }
}

/**
 * Mock Notion API adapter for testing.
 */
export class MockNotionApiAdapter {
  private pages = new Map<string, { title: string; content: string; url: string }>();
  private childPages = new Map<string, string[]>();

  // Error injection for testing error paths
  private getPageWithPreviewError: NotionError | null = null;

  validateToken(_token: string): Promise<Result<boolean, NotionError>> {
    return Promise.resolve(ok(true));
  }

  getPageWithPreview(
    _token: string,
    pageId: string
  ): Promise<
    Result<
      {
        page: { id: string; title: string; url: string };
        blocks: { type: string; content: string }[];
      },
      NotionError
    >
  > {
    if (this.getPageWithPreviewError !== null) {
      return Promise.resolve(err(this.getPageWithPreviewError));
    }
    const page = this.pages.get(pageId);
    if (page === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Page not found' }));
    }
    // Split content by double newlines to create multiple blocks
    const blocks = page.content
      .split('\n\n')
      .filter((c) => c.trim().length > 0)
      .map((content) => ({ type: 'paragraph', content }));
    return Promise.resolve(
      ok({
        page: { id: pageId, title: page.title, url: page.url },
        blocks,
      })
    );
  }

  createPromptVaultNote(params: {
    token: string;
    parentPageId: string;
    title: string;
    prompt: string;
    userId: string;
  }): Promise<Result<{ id: string; url: string; title: string }, NotionError>> {
    const id = `page-${String(Date.now())}`;
    this.pages.set(id, {
      title: params.title,
      content: params.prompt,
      url: `https://notion.so/${id}`,
    });
    const children = this.childPages.get(params.parentPageId) ?? [];
    children.push(id);
    this.childPages.set(params.parentPageId, children);
    return Promise.resolve(ok({ id, url: `https://notion.so/${id}`, title: params.title }));
  }

  listChildPages(
    _token: string,
    parentPageId: string
  ): Promise<Result<{ id: string; title: string; url: string }[], NotionError>> {
    const children = this.childPages.get(parentPageId) ?? [];
    const pages = children
      .map((id) => {
        const page = this.pages.get(id);
        return page !== undefined ? { id, title: page.title, url: page.url } : null;
      })
      .filter((p): p is { id: string; title: string; url: string } => p !== null);
    return Promise.resolve(ok(pages));
  }

  getPromptPage(
    _token: string,
    pageId: string
  ): Promise<
    Result<
      {
        page: { id: string; title: string; url: string };
        promptContent: string;
        createdAt?: string;
        updatedAt?: string;
      },
      NotionError
    >
  > {
    const page = this.pages.get(pageId);
    if (page === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Page not found' }));
    }
    return Promise.resolve(
      ok({
        page: { id: pageId, title: page.title, url: page.url },
        promptContent: page.content,
      })
    );
  }

  updatePromptPage(
    _token: string,
    pageId: string,
    update: { title?: string; promptContent?: string }
  ): Promise<
    Result<
      {
        page: { id: string; title: string; url: string };
        promptContent: string;
        updatedAt?: string;
      },
      NotionError
    >
  > {
    const page = this.pages.get(pageId);
    if (page === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Page not found' }));
    }
    if (update.title !== undefined) page.title = update.title;
    if (update.promptContent !== undefined) page.content = update.promptContent;
    return Promise.resolve(
      ok({
        page: { id: pageId, title: page.title, url: page.url },
        promptContent: page.content,
      })
    );
  }

  // Test helpers
  setPage(id: string, title: string, content: string): void {
    this.pages.set(id, { title, content, url: `https://notion.so/${id}` });
  }

  addChildPage(parentId: string, childId: string): void {
    const children = this.childPages.get(parentId) ?? [];
    children.push(childId);
    this.childPages.set(parentId, children);
  }

  /**
   * Set error to return from getPageWithPreview for testing error paths.
   */
  setGetPageWithPreviewError(error: NotionError | null): void {
    this.getPageWithPreviewError = error;
  }

  clear(): void {
    this.pages.clear();
    this.childPages.clear();
    this.getPageWithPreviewError = null;
  }
}

interface PromptResult {
  id: string;
  title: string;
  content: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface PromptListItem {
  id: string;
  title: string;
  content: string;
  url?: string;
}

interface PromptError {
  code: string;
  message: string;
}

/**
 * Factory to create a fake prompt repository for testing.
 * @deprecated Use the real promptRepository with FakeNotionServiceClient instead.
 */
export function createFakePromptRepository(
  connectionRepo: FakeNotionConnectionRepository,
  notionApi: MockNotionApiAdapter
): {
  createPrompt: (
    userId: string,
    input: { title: string; content: string }
  ) => Promise<Result<PromptResult, PromptError>>;
  listPrompts: (userId: string) => Promise<Result<PromptListItem[], PromptError>>;
  getPrompt: (userId: string, promptId: string) => Promise<Result<PromptListItem, PromptError>>;
  updatePrompt: (
    userId: string,
    promptId: string,
    input: { title?: string; content?: string }
  ) => Promise<Result<PromptListItem, PromptError>>;
} {
  return {
    createPrompt: async (
      userId: string,
      input: { title: string; content: string }
    ): Promise<Result<PromptResult, PromptError>> => {
      const connectedResult = await connectionRepo.isConnected(userId);
      if (!connectedResult.ok || !connectedResult.value) {
        return err({ code: 'NOT_CONNECTED', message: 'Not connected' });
      }
      const tokenResult = await connectionRepo.getToken(userId);
      if (!tokenResult.ok || tokenResult.value === null) {
        return err({ code: 'NOT_CONNECTED', message: 'No token' });
      }
      const configResult = await connectionRepo.getConnection(userId);
      if (!configResult.ok || configResult.value === null) {
        return err({ code: 'NOT_CONNECTED', message: 'No config' });
      }
      const result = await notionApi.createPromptVaultNote({
        token: tokenResult.value,
        parentPageId: configResult.value.promptVaultPageId,
        title: input.title,
        prompt: input.content,
        userId,
      });
      if (!result.ok) return err({ code: 'DOWNSTREAM_ERROR', message: result.error.message });
      const now = new Date().toISOString();
      return ok({
        id: result.value.id,
        title: input.title,
        content: input.content,
        url: result.value.url,
        createdAt: now,
        updatedAt: now,
      });
    },
    listPrompts: async (userId: string): Promise<Result<PromptListItem[], PromptError>> => {
      const connectedResult = await connectionRepo.isConnected(userId);
      if (!connectedResult.ok || !connectedResult.value) {
        return err({ code: 'NOT_CONNECTED', message: 'Not connected' });
      }
      const tokenResult = await connectionRepo.getToken(userId);
      if (!tokenResult.ok || tokenResult.value === null) {
        return err({ code: 'NOT_CONNECTED', message: 'No token' });
      }
      const configResult = await connectionRepo.getConnection(userId);
      if (!configResult.ok || configResult.value === null) {
        return err({ code: 'NOT_CONNECTED', message: 'No config' });
      }
      const listResult = await notionApi.listChildPages(
        tokenResult.value,
        configResult.value.promptVaultPageId
      );
      if (!listResult.ok)
        return err({ code: 'DOWNSTREAM_ERROR', message: listResult.error.message });

      const prompts: PromptListItem[] = [];
      for (const page of listResult.value) {
        const pageResult = await notionApi.getPromptPage(tokenResult.value, page.id);
        if (pageResult.ok) {
          prompts.push({
            id: page.id,
            title: page.title,
            content: pageResult.value.promptContent,
            url: page.url,
          });
        }
      }
      return ok(prompts);
    },
    getPrompt: async (
      userId: string,
      promptId: string
    ): Promise<Result<PromptListItem, PromptError>> => {
      const tokenResult = await connectionRepo.getToken(userId);
      if (!tokenResult.ok || tokenResult.value === null) {
        return err({ code: 'NOT_CONNECTED', message: 'No token' });
      }
      const result = await notionApi.getPromptPage(tokenResult.value, promptId);
      if (!result.ok)
        return err({
          code: result.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'DOWNSTREAM_ERROR',
          message: result.error.message,
        });
      return ok({
        id: result.value.page.id,
        title: result.value.page.title,
        content: result.value.promptContent,
        url: result.value.page.url,
      });
    },
    updatePrompt: async (
      userId: string,
      promptId: string,
      input: { title?: string; content?: string }
    ): Promise<Result<PromptListItem, PromptError>> => {
      const tokenResult = await connectionRepo.getToken(userId);
      if (!tokenResult.ok || tokenResult.value === null) {
        return err({ code: 'NOT_CONNECTED', message: 'No token' });
      }
      const updatePayload: { title?: string; promptContent?: string } = {};
      if (input.title !== undefined) {
        updatePayload.title = input.title;
      }
      if (input.content !== undefined) {
        updatePayload.promptContent = input.content;
      }
      const result = await notionApi.updatePromptPage(tokenResult.value, promptId, updatePayload);
      if (!result.ok)
        return err({
          code: result.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'DOWNSTREAM_ERROR',
          message: result.error.message,
        });
      return ok({
        id: result.value.page.id,
        title: result.value.page.title,
        content: result.value.promptContent,
        url: result.value.page.url,
      });
    },
  };
}
