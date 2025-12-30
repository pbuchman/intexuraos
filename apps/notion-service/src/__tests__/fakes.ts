/**
 * Fake repositories for testing notion-service.
 *
 * These fakes implement the same interfaces as the real Firestore/Notion adapters
 * but use in-memory storage. They are designed to be exercised by route tests.
 *
 * Coverage note: Some methods may show low coverage until all Tier 1 test issues
 * are completed (see docs/continuity/1-7-notion-service-coverage.md).
 */
import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';

export interface NotionConnectionPublic {
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
export class FakeConnectionRepository {
  private connections = new Map<
    string,
    {
      token: string;
      connected: boolean;
      createdAt: string;
      updatedAt: string;
    }
  >();
  private shouldFailSave = false;
  private shouldFailGet = false;
  private shouldFailDisconnect = false;

  setFailNextSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  setFailNextGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  setFailNextDisconnect(fail: boolean): void {
    this.shouldFailDisconnect = fail;
  }

  saveConnection(
    userId: string,
    notionToken: string
  ): Promise<Result<NotionConnectionPublic, NotionError>> {
    if (this.shouldFailSave) {
      this.shouldFailSave = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated save failure' }));
    }
    const now = new Date().toISOString();
    const existing = this.connections.get(userId);
    this.connections.set(userId, {
      token: notionToken,
      connected: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return Promise.resolve(
      ok({
        connected: true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    );
  }

  getConnection(userId: string): Promise<Result<NotionConnectionPublic | null, NotionError>> {
    if (this.shouldFailGet) {
      this.shouldFailGet = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated get failure' }));
    }
    const conn = this.connections.get(userId);
    if (conn === undefined) return Promise.resolve(ok(null));
    return Promise.resolve(
      ok({
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
    if (this.shouldFailDisconnect) {
      this.shouldFailDisconnect = false;
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated disconnect failure' })
      );
    }
    const conn = this.connections.get(userId);
    if (conn === undefined) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'Connection not found' }));
    }
    conn.connected = false;
    conn.updatedAt = new Date().toISOString();
    return Promise.resolve(
      ok({
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
  setConnection(userId: string, config: NotionConnectionPublic): void {
    const token = this.connections.get(userId)?.token ?? '';
    this.connections.set(userId, {
      token,
      connected: config.connected,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  }

  setToken(userId: string, token: string | null): void {
    const existing = this.connections.get(userId);
    if (existing !== undefined) {
      existing.token = token ?? '';
    } else if (token !== null) {
      const now = new Date().toISOString();
      this.connections.set(userId, {
        token,
        connected: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  clear(): void {
    this.connections.clear();
  }
}

// Backwards compatibility alias
export const FakeNotionConnectionRepository = FakeConnectionRepository;

/**
 * Mock Notion API adapter for testing.
 */
export class MockNotionApiAdapter {
  private pages = new Map<string, { title: string; content: string; url: string }>();
  private inaccessiblePages = new Set<string>();
  private invalidTokens = new Set<string>();
  private unauthorizedTokens = new Set<string>();
  private shouldFailWithError: NotionError | null = null;

  validateToken(token: string): Promise<Result<boolean, NotionError>> {
    // Check for forced error first
    if (this.shouldFailWithError !== null) {
      const error = this.shouldFailWithError;
      this.shouldFailWithError = null;
      return Promise.resolve(err(error));
    }
    // Check for unauthorized token
    if (this.unauthorizedTokens.has(token)) {
      return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Invalid token' }));
    }
    if (this.invalidTokens.has(token)) {
      return Promise.resolve(ok(false));
    }
    return Promise.resolve(ok(true));
  }

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
  > {
    // Check for forced error first
    if (this.shouldFailWithError !== null) {
      const error = this.shouldFailWithError;
      this.shouldFailWithError = null;
      return Promise.resolve(err(error));
    }
    // Check for unauthorized token
    if (this.unauthorizedTokens.has(token)) {
      return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Invalid token' }));
    }
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

  setTokenUnauthorized(token: string): void {
    this.unauthorizedTokens.add(token);
  }

  setNextError(error: NotionError): void {
    this.shouldFailWithError = error;
  }

  clear(): void {
    this.pages.clear();
    this.inaccessiblePages.clear();
    this.invalidTokens.clear();
    this.unauthorizedTokens.clear();
    this.shouldFailWithError = null;
  }
}
