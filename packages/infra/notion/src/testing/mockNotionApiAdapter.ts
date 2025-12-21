/**
 * Mock test implementation of NotionApiPort.
 * Lives in infra/notion for reuse across tests.
 */
import { ok, err, type Result } from '@praxos/common';
import type {
  NotionApiPort,
  NotionPage,
  NotionBlock,
  CreatedNote,
  NotionError,
  CreatePromptVaultNoteParams,
} from '@praxos/domain-promptvault';

/**
 * Captured PromptVault note creation call for test assertions.
 */
export interface CapturedPromptVaultNote {
  params: CreatePromptVaultNoteParams;
  result: CreatedNote;
}

/**
 * Internal representation of a stored prompt page.
 */
interface StoredPromptPage {
  id: string;
  title: string;
  promptContent: string;
  parentId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mock implementation of NotionApiPort for testing.
 * Returns deterministic data for predictable test behavior.
 */
export class MockNotionApiAdapter implements NotionApiPort {
  private pageCounter = 0;
  private capturedNotes: CapturedPromptVaultNote[] = [];
  private storedPages = new Map<string, StoredPromptPage>();
  private inaccessiblePageIds = new Set<string>();
  private invalidTokens = new Set<string>(['invalid-token']);

  /**
   * Configure a page ID to simulate "not found" / "not shared with integration" error.
   * Use this to test error handling when page validation fails.
   */
  setPageInaccessible(pageId: string): void {
    this.inaccessiblePageIds.add(pageId);
  }

  /**
   * Configure a token to be treated as invalid.
   */
  setTokenInvalid(token: string): void {
    this.invalidTokens.add(token);
  }

  async validateToken(token: string): Promise<Result<boolean, NotionError>> {
    // Simulate invalid token for testing
    if (this.invalidTokens.has(token)) {
      return await Promise.resolve(ok(false));
    }
    return await Promise.resolve(ok(true));
  }

  async getPageWithPreview(
    token: string,
    pageId: string
  ): Promise<Result<{ page: NotionPage; blocks: NotionBlock[] }, NotionError>> {
    // Check for invalid token
    if (this.invalidTokens.has(token)) {
      return await Promise.resolve(
        err({
          code: 'UNAUTHORIZED',
          message: 'Invalid Notion token',
        })
      );
    }

    // Check for inaccessible page
    if (this.inaccessiblePageIds.has(pageId)) {
      return await Promise.resolve(
        err({
          code: 'NOT_FOUND',
          message: `Could not find block with ID: ${pageId}. Make sure the relevant pages and databases are shared with your integration.`,
        })
      );
    }

    const page: NotionPage = {
      id: pageId,
      title: 'Prompt Vault',
      url: `https://notion.so/${pageId}`,
    };

    const blocks: NotionBlock[] = [
      { type: 'heading_1', content: 'Prompt Vault' },
      { type: 'paragraph', content: 'This is a stub preview of your Prompt Vault page.' },
      { type: 'bulleted_list_item', content: 'Item 1: System prompts' },
      { type: 'bulleted_list_item', content: 'Item 2: Templates' },
    ];

    return await Promise.resolve(ok({ page, blocks }));
  }

  async createPromptVaultNote(
    params: CreatePromptVaultNoteParams
  ): Promise<Result<CreatedNote, NotionError>> {
    this.pageCounter++;
    const id = `note_${String(this.pageCounter).padStart(6, '0')}`;
    const now = new Date().toISOString();

    const result: CreatedNote = {
      id,
      url: `https://notion.so/${id.replace(/_/g, '-')}`,
      title: params.title,
    };

    // Store the page for later retrieval
    this.storedPages.set(id, {
      id,
      title: params.title,
      promptContent: params.prompt,
      parentId: params.parentPageId,
      createdAt: now,
      updatedAt: now,
    });

    // Capture the call for test assertions
    this.capturedNotes.push({ params, result });

    return await Promise.resolve(ok(result));
  }

  async listChildPages(
    _token: string,
    parentPageId: string
  ): Promise<Result<NotionPage[], NotionError>> {
    const pages: NotionPage[] = [];

    for (const page of this.storedPages.values()) {
      if (page.parentId === parentPageId) {
        pages.push({
          id: page.id,
          title: page.title,
          url: `https://notion.so/${page.id.replace(/_/g, '-')}`,
        });
      }
    }

    return await Promise.resolve(ok(pages));
  }

  async getPromptPage(
    _token: string,
    pageId: string
  ): Promise<
    Result<
      { page: NotionPage; promptContent: string; createdAt?: string; updatedAt?: string },
      NotionError
    >
  > {
    const stored = this.storedPages.get(pageId);

    if (stored === undefined) {
      return await Promise.resolve(
        err({
          code: 'NOT_FOUND',
          message: `Page not found: ${pageId}`,
        })
      );
    }

    return await Promise.resolve(
      ok({
        page: {
          id: stored.id,
          title: stored.title,
          url: `https://notion.so/${stored.id.replace(/_/g, '-')}`,
        },
        promptContent: stored.promptContent,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      })
    );
  }

  async updatePromptPage(
    _token: string,
    pageId: string,
    update: { title?: string; promptContent?: string }
  ): Promise<Result<{ page: NotionPage; promptContent: string; updatedAt?: string }, NotionError>> {
    const stored = this.storedPages.get(pageId);

    if (stored === undefined) {
      return await Promise.resolve(
        err({
          code: 'NOT_FOUND',
          message: `Page not found: ${pageId}`,
        })
      );
    }

    // Update the stored page
    const now = new Date().toISOString();
    if (update.title !== undefined) {
      stored.title = update.title;
    }
    if (update.promptContent !== undefined) {
      stored.promptContent = update.promptContent;
    }
    stored.updatedAt = now;

    return await Promise.resolve(
      ok({
        page: {
          id: stored.id,
          title: stored.title,
          url: `https://notion.so/${stored.id.replace(/_/g, '-')}`,
        },
        promptContent: stored.promptContent,
        updatedAt: stored.updatedAt,
      })
    );
  }

  /**
   * Get all captured PromptVault note creation calls.
   * Useful for verifying verbatim storage and block structure.
   */
  getCapturedNotes(): CapturedPromptVaultNote[] {
    return [...this.capturedNotes];
  }

  /**
   * Get the last captured PromptVault note.
   */
  getLastCapturedNote(): CapturedPromptVaultNote | undefined {
    return this.capturedNotes[this.capturedNotes.length - 1];
  }

  /**
   * Reset counter and captured notes (for test cleanup).
   */
  reset(): void {
    this.pageCounter = 0;
    this.capturedNotes = [];
    this.storedPages.clear();
    this.inaccessiblePageIds.clear();
    this.invalidTokens.clear();
    this.invalidTokens.add('invalid-token'); // Re-add default invalid token
  }
}
