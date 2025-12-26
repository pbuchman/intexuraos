/**
 * Fake repositories for testing notion-service.
 *
 * These fakes implement the same interfaces as the real Firestore/Notion adapters
 * but use in-memory storage. They are designed to be exercised by route tests.
 *
 * Coverage note: Some methods may show low coverage until all Tier 1 test issues
 * are completed (see docs/continuity/1-7-notion-service-coverage.md).
 */
import type { Result } from '@intexuraos/common';
import { ok, err } from '@intexuraos/common';

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
 * Fake Notion connection repository for testing.
 */
export class FakeNotionConnectionRepository {
  private connections = new Map<
    string,
    {
      token: string;
      promptVaultPageId: string;
      connected: boolean;
      createdAt: string;
      updatedAt: string;
    }
  >();

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
    const conn = this.connections.get(userId);
    if (conn?.connected !== true) return Promise.resolve(ok(null));
    return Promise.resolve(ok(conn.token));
  }

  isConnected(userId: string): Promise<Result<boolean, NotionError>> {
    const conn = this.connections.get(userId);
    return Promise.resolve(ok(conn?.connected ?? false));
  }

  disconnect(userId: string): Promise<Result<NotionConnectionPublic, NotionError>> {
    const conn = this.connections.get(userId);
    if (conn === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Connection not found' }));
    }
    conn.connected = false;
    conn.updatedAt = new Date().toISOString();
    return Promise.resolve(
      ok({
        promptVaultPageId: conn.promptVaultPageId,
        connected: conn.connected,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      })
    );
  }

  disconnectConnection(userId: string): Promise<Result<NotionConnectionPublic, NotionError>> {
    return this.disconnect(userId);
  }

  // Test helpers
  setConnection(userId: string, token: string, promptVaultPageId: string, connected = true): void {
    const now = new Date().toISOString();
    this.connections.set(userId, {
      token,
      promptVaultPageId,
      connected,
      createdAt: now,
      updatedAt: now,
    });
  }

  clear(): void {
    this.connections.clear();
  }
}

/**
 * Mock Notion API adapter for testing.
 */
export class MockNotionApiAdapter {
  private pages = new Map<string, { title: string; content: string; url: string }>();
  private inaccessiblePages = new Set<string>();
  private invalidTokens = new Set<string>();

  validateToken(token: string): Promise<Result<boolean, NotionError>> {
    if (this.invalidTokens.has(token)) {
      return Promise.resolve(ok(false));
    }
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
    if (this.inaccessiblePages.has(pageId)) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Page not found' }));
    }
    const page = this.pages.get(pageId);
    if (page === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Page not found' }));
    }
    return Promise.resolve(
      ok({
        page: { id: pageId, title: page.title, url: page.url },
        blocks: [{ type: 'paragraph', content: page.content }],
      })
    );
  }

  // Test helpers
  setPage(id: string, title: string, content: string): void {
    this.pages.set(id, { title, content, url: `https://notion.so/${id}` });
  }

  setPageInaccessible(pageId: string): void {
    this.inaccessiblePages.add(pageId);
  }

  setTokenInvalid(token: string): void {
    this.invalidTokens.add(token);
  }

  clear(): void {
    this.pages.clear();
    this.inaccessiblePages.clear();
    this.invalidTokens.clear();
  }
}
