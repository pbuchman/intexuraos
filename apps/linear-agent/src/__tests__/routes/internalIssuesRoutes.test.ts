import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { setServices, resetServices } from '../../services.js';
import type { FastifyInstance } from 'fastify';
import {
  FakeLinearConnectionRepository,
  FakeLinearApiClient,
} from '../fakes.js';
import type { LinearConnection, LinearIssue } from '../../domain/models.js';

// Set up internal auth token for testing
process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';

describe('internalIssuesRoutes', () => {
  let app: FastifyInstance;
  let fakeConnectionRepo: FakeLinearConnectionRepository;
  let fakeLinearClient: FakeLinearApiClient;

  const testUserId = 'user-123';
  const testApiKey = 'linear-api-key-test';
  const testConnection: LinearConnection = {
    userId: testUserId,
    apiKey: testApiKey,
    teamId: 'team-1',
    teamName: 'Engineering',
    connected: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    fakeConnectionRepo = new FakeLinearConnectionRepository();
    fakeLinearClient = new FakeLinearApiClient();

    setServices({
      connectionRepository: fakeConnectionRepo,
      linearApiClient: fakeLinearClient,
      failedIssueRepository: null as unknown as import('../../domain/index.js').FailedIssueRepository,
      extractionService: null as unknown as import('../../domain/index.js').LinearActionExtractionService,
      processedActionRepository: null as unknown as import('../../domain/index.js').ProcessedActionRepository,
      userServiceClient: null as unknown as import('@intexuraos/internal-clients').UserServiceClient,
    });

    app = await buildServer();
    fakeConnectionRepo.seedConnection(testConnection);
  });

  afterEach(() => {
    resetServices();
    vi.clearAllMocks();
  });

  const internalAuthHeader = { 'x-internal-auth': 'test-internal-token' };

  describe('POST /internal/issues', () => {
    it('should create issue and return expected response format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          title: 'Test Issue',
          description: 'Test description',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as { success: boolean; data: { id: string; identifier: string; title: string; url: string }; diagnostics?: unknown };
      expect(body.success).toBe(true);
      expect(body.data.id).toBeTruthy();
      expect(body.data.identifier).toMatch(/^ENG-/);
      expect(body.data.title).toBe('Test Issue');
      expect(body.data.url).toContain('linear.app');
    });

    it('should return 401 when X-Internal-Auth is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          'x-user-id': testUserId,
        },
        payload: {
          title: 'Test',
          description: 'Test',
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when X-User-Id is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: internalAuthHeader,
        payload: {
          title: 'Test',
          description: 'Test',
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 when user not connected to Linear', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          ...internalAuthHeader,
          'x-user-id': 'disconnected-user',
        },
        payload: {
          title: 'Test',
          description: 'Test',
        },
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should include labels when provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          title: 'Test Issue',
          description: 'Test description',
          labels: ['bug', 'high-priority'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  describe('PATCH /internal/issues/:issueId/state', () => {
    let testIssue: LinearIssue;

    beforeEach(async () => {
      // Create a test issue first
      const createResponse = await app.inject({
        method: 'POST',
        url: '/internal/issues',
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          title: 'State Test Issue',
          description: 'For state updates',
        },
      });

      const body = JSON.parse(createResponse.body) as { data: LinearIssue };
      testIssue = body.data;
    });

    it('should update state to in_progress', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          state: 'in_progress',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('should update state to in_review', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          state: 'in_review',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should update state to qa', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          state: 'qa',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should update state to backlog', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': testUserId,
        },
        payload: {
          state: 'backlog',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should return 401 when X-Internal-Auth is missing', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          'x-user-id': testUserId,
        },
        payload: {
          state: 'in_progress',
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when X-User-Id is missing', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: internalAuthHeader,
        payload: {
          state: 'in_progress',
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 when user not connected to Linear', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/issues/${testIssue.id}/state`,
        headers: {
          ...internalAuthHeader,
          'x-user-id': 'disconnected-user',
        },
        payload: {
          state: 'in_progress',
        },
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });
});
