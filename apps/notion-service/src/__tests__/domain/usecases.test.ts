/**
 * Tests for notion-service domain use-cases.
 */
import { describe, it, expect } from 'vitest';
import { ok, err, type Result } from '@intexuraos/common';
import {
  connectNotion,
  getNotionStatus,
  disconnectNotion,
  type ConnectionRepository,
  type NotionApi,
  type NotionPagePreview,
  type NotionConnectionPublic,
  type NotionError,
} from '../../domain/integration/index.js';

describe('notion-service domain use-cases', () => {
  // Mock data
  const mockPagePreview: NotionPagePreview = {
    page: {
      id: 'page-123',
      title: 'Test Page',
      url: 'https://notion.so/test-page',
    },
    blocks: [{ type: 'paragraph', content: 'Test content' }],
  };

  const mockConnection: NotionConnectionPublic = {
    promptVaultPageId: 'page-123',
    connected: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  describe('connectNotion', () => {
    it('should successfully connect when page is accessible', async () => {
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> => Promise.resolve(ok(true)),
        getPageWithPreview: (): Promise<Result<NotionPagePreview, NotionError>> =>
          Promise.resolve(ok(mockPagePreview)),
      };
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok({ ...mockConnection, connected: false })),
      };

      const result = await connectNotion(connectionRepository, notionApi, {
        userId: 'user-123',
        notionToken: 'token-abc',
        promptVaultPageId: 'page-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(true);
        expect(result.value.pageTitle).toBe('Test Page');
        expect(result.value.pageUrl).toBe('https://notion.so/test-page');
      }
    });

    it('should return PAGE_NOT_ACCESSIBLE error when page not found', async () => {
      const notionError: NotionError = { code: 'NOT_FOUND', message: 'Page not found' };
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> => Promise.resolve(ok(true)),
        getPageWithPreview: (): Promise<Result<NotionPagePreview, NotionError>> =>
          Promise.resolve(err(notionError)),
      };
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(ok(null)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
      };

      const result = await connectNotion(connectionRepository, notionApi, {
        userId: 'user-123',
        notionToken: 'token-abc',
        promptVaultPageId: 'page-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PAGE_NOT_ACCESSIBLE');
        expect(result.error.details?.pageId).toBe('page-123');
      }
    });

    it('should return INVALID_TOKEN error when unauthorized', async () => {
      const notionError: NotionError = { code: 'UNAUTHORIZED', message: 'Invalid token' };
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> => Promise.resolve(ok(true)),
        getPageWithPreview: (): Promise<Result<NotionPagePreview, NotionError>> =>
          Promise.resolve(err(notionError)),
      };
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(ok(null)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
      };

      const result = await connectNotion(connectionRepository, notionApi, {
        userId: 'user-123',
        notionToken: 'invalid-token',
        promptVaultPageId: 'page-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TOKEN');
      }
    });

    it('should return DOWNSTREAM_ERROR when save fails', async () => {
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> => Promise.resolve(ok(true)),
        getPageWithPreview: (): Promise<Result<NotionPagePreview, NotionError>> =>
          Promise.resolve(ok(mockPagePreview)),
      };
      const saveError: NotionError = { code: 'INTERNAL_ERROR', message: 'Save failed' };
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(err(saveError)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(ok(null)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
      };

      const result = await connectNotion(connectionRepository, notionApi, {
        userId: 'user-123',
        notionToken: 'token-abc',
        promptVaultPageId: 'page-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });

    it('should return DOWNSTREAM_ERROR for other Notion errors', async () => {
      const notionError: NotionError = { code: 'RATE_LIMITED', message: 'Rate limited' };
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> => Promise.resolve(ok(true)),
        getPageWithPreview: (): Promise<Result<NotionPagePreview, NotionError>> =>
          Promise.resolve(err(notionError)),
      };
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(ok(null)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
      };

      const result = await connectNotion(connectionRepository, notionApi, {
        userId: 'user-123',
        notionToken: 'token-abc',
        promptVaultPageId: 'page-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
        expect(result.error.details?.notionError).toBe('RATE_LIMITED');
      }
    });
  });

  describe('getNotionStatus', () => {
    it('should return configured=true when connection exists', async () => {
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
      };

      const result = await getNotionStatus(connectionRepository, { userId: 'user-123' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.configured).toBe(true);
        expect(result.value.connected).toBe(true);
        expect(result.value.promptVaultPageId).toBe('page-123');
      }
    });

    it('should return configured=false when no connection exists', async () => {
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(ok(null)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
      };

      const result = await getNotionStatus(connectionRepository, { userId: 'user-123' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.configured).toBe(false);
        expect(result.value.connected).toBe(false);
        expect(result.value.promptVaultPageId).toBe(null);
      }
    });

    it('should return DOWNSTREAM_ERROR when repository fails', async () => {
      const repoError: NotionError = { code: 'INTERNAL_ERROR', message: 'DB error' };
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(err(repoError)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
      };

      const result = await getNotionStatus(connectionRepository, { userId: 'user-123' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });

  describe('disconnectNotion', () => {
    it('should successfully disconnect', async () => {
      const disconnectedConnection: NotionConnectionPublic = {
        ...mockConnection,
        connected: false,
        updatedAt: '2024-01-02T00:00:00Z',
      };
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(disconnectedConnection)),
      };

      const result = await disconnectNotion(connectionRepository, { userId: 'user-123' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
      }
    });

    it('should return DOWNSTREAM_ERROR when disconnect fails', async () => {
      const repoError: NotionError = { code: 'INTERNAL_ERROR', message: 'Disconnect failed' };
      const connectionRepository: ConnectionRepository = {
        saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
          Promise.resolve(ok(mockConnection)),
        disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
          Promise.resolve(err(repoError)),
      };

      const result = await disconnectNotion(connectionRepository, { userId: 'user-123' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });
});
