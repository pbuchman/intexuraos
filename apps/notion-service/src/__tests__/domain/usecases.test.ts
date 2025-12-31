/**
 * Tests for notion-service domain use-cases.
 */
import { describe, it, expect } from 'vitest';
import { ok, err, type Result } from '@intexuraos/common-core';
import {
  connectNotion,
  getNotionStatus,
  disconnectNotion,
  createConnectNotionUseCase,
  createGetNotionStatusUseCase,
  createDisconnectNotionUseCase,
  type ConnectionRepository,
  type NotionApi,
  type NotionConnectionPublic,
  type NotionError,
} from '../../domain/integration/index.js';

describe('notion-service domain use-cases', () => {
  // Mock data
  const mockConnection: NotionConnectionPublic = {
    connected: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  describe('connectNotion', () => {
    it('should successfully connect when token is valid', async () => {
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> => Promise.resolve(ok(true)),
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
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBe('2024-01-01T00:00:00Z');
        expect(result.value.updatedAt).toBe('2024-01-01T00:00:00Z');
      }
    });

    it('should return INVALID_TOKEN error when token validation returns false', async () => {
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> => Promise.resolve(ok(false)),
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
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TOKEN');
      }
    });

    it('should return INVALID_TOKEN error when validateToken returns UNAUTHORIZED error', async () => {
      const notionError: NotionError = { code: 'UNAUTHORIZED', message: 'Invalid token' };
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> =>
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
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TOKEN');
      }
    });

    it('should return DOWNSTREAM_ERROR when save fails', async () => {
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> => Promise.resolve(ok(true)),
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
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });

    it('should return DOWNSTREAM_ERROR for other Notion API errors', async () => {
      const notionError: NotionError = { code: 'RATE_LIMITED', message: 'Rate limited' };
      const notionApi: NotionApi = {
        validateToken: (): Promise<Result<boolean, NotionError>> =>
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
        expect(result.value.createdAt).toBe('2024-01-01T00:00:00Z');
        expect(result.value.updatedAt).toBe('2024-01-01T00:00:00Z');
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
        expect(result.value.createdAt).toBe(null);
        expect(result.value.updatedAt).toBe(null);
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

  describe('factory functions', () => {
    const mockRepo: ConnectionRepository = {
      saveConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
        Promise.resolve(ok(mockConnection)),
      getConnection: (): Promise<Result<NotionConnectionPublic | null, NotionError>> =>
        Promise.resolve(ok(mockConnection)),
      disconnectConnection: (): Promise<Result<NotionConnectionPublic, NotionError>> =>
        Promise.resolve(ok({ ...mockConnection, connected: false })),
    };

    const mockApi: NotionApi = {
      validateToken: (): Promise<Result<boolean, NotionError>> => Promise.resolve(ok(true)),
    };

    it('createConnectNotionUseCase returns working usecase', async () => {
      const useCase = createConnectNotionUseCase(mockRepo, mockApi);
      const result = await useCase({ userId: 'user-123', notionToken: 'token-abc' });
      expect(result.ok).toBe(true);
    });

    it('createGetNotionStatusUseCase returns working usecase', async () => {
      const useCase = createGetNotionStatusUseCase(mockRepo);
      const result = await useCase({ userId: 'user-123' });
      expect(result.ok).toBe(true);
    });

    it('createDisconnectNotionUseCase returns working usecase', async () => {
      const useCase = createDisconnectNotionUseCase(mockRepo);
      const result = await useCase({ userId: 'user-123' });
      expect(result.ok).toBe(true);
    });
  });
});
