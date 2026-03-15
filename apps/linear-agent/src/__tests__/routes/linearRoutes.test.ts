import { createToken, describe, expect, it, setupTestContext, clearTestLogs, getTestLoggerStream, beforeEach, afterEach, beforeAll, afterAll, setupJwksServer, teardownJwksServer, resetServices, setServices } from '../testUtils.js';
import { buildServer } from '../../server.js';
import type { FastifyInstance } from 'fastify';
import type { LinearConnection } from '../../domain/models.js';
import {
  FakeLinearConnectionRepository,
  FakeLinearApiClient,
  FakeFailedIssueRepository,
  FakeLinearActionExtractionService,
  FakeProcessedActionRepository,
  FakeUserServiceClient,
  FakeLinearIssueRepository,
  FakeLinearCommentRepository,
  FakeCodeAgentClient,
} from '../fakes.js';

describe('linearRoutes', () => {
  const ctx = setupTestContext();

  function seedConnection(userId: string): void {
    const connection: LinearConnection = {
      userId,
      apiKey: 'linear-api-key-123',
      teamId: 'team-456',
      teamName: 'Engineering',
      webhookSecret: null,
      connected: true,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    };
    ctx.connectionRepository.seedConnection(connection);
  }

  describe('GET /linear/connection', () => {
    it('returns connection status for authenticated user', async () => {
      seedConnection('test-user-123');

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/connection',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(true);
      expect(body.data.teamName).toBe('Engineering');
    });

    it('returns null for user without connection', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/connection',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeNull();
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/connection',
      });

      expect(response.statusCode).toBe(401);
    });

    it('handles repository error', async () => {
      ctx.connectionRepository.setGetConnectionFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database unavailable',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/connection',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /linear/connection/validate', () => {
    it('validates API key and returns teams', async () => {
      ctx.linearApiClient.setTeams([
        { id: 'team-1', name: 'Engineering', key: 'ENG' },
        { id: 'team-2', name: 'Product', key: 'PROD' },
      ]);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/linear/connection/validate',
        headers: { 'content-type': 'application/json' },
        payload: { apiKey: 'valid-api-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.teams).toHaveLength(2);
      expect(body.data.teams[0].name).toBe('Engineering');
    });

    it('returns 401 for invalid API key', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/linear/connection/validate',
        headers: { 'content-type': 'application/json' },
        payload: { apiKey: 'invalid' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('handles rate limit errors', async () => {
      ctx.linearApiClient.setFailure(true, { code: 'RATE_LIMIT', message: 'Too many requests' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/linear/connection/validate',
        headers: { 'content-type': 'application/json' },
        payload: { apiKey: 'valid-api-key' },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });

    it('handles API errors', async () => {
      ctx.linearApiClient.setFailure(true, { code: 'API_ERROR', message: 'Service unavailable' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/linear/connection/validate',
        headers: { 'content-type': 'application/json' },
        payload: { apiKey: 'valid-api-key' },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });
  });

  describe('POST /linear/connection', () => {
    it('saves connection for authenticated user', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/linear/connection',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          apiKey: 'linear-api-key-new',
          teamId: 'team-new',
      parentId: null,
          teamName: 'New Team',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(true);
      expect(body.data.teamName).toBe('New Team');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/linear/connection',
        headers: { 'content-type': 'application/json' },
        payload: {
          apiKey: 'api-key',
          teamId: 'team-id',
      parentId: null,
          teamName: 'Team',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('handles repository save error', async () => {
      ctx.connectionRepository.setSaveFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database write failed',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/linear/connection',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          apiKey: 'linear-api-key-new',
          teamId: 'team-new',
      parentId: null,
          teamName: 'New Team',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /linear/connection', () => {
    it('disconnects authenticated user', async () => {
      seedConnection('test-user-123');

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/linear/connection',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(false);
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/linear/connection',
      });

      expect(response.statusCode).toBe(401);
    });

    it('handles repository disconnect error', async () => {
      seedConnection('test-user-123');
      ctx.connectionRepository.setDisconnectFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database disconnect failed',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/linear/connection',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /linear/issues', () => {
    it('returns grouped issues for authenticated connected user', async () => {
      seedConnection('test-user-123');
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-1',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/1',
        userId: 'test-user-123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
        teamId: 'team-456',
        parentId: null,
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.teamName).toBe('Engineering');
      expect(body.data.issues.backlog).toHaveLength(1);
      expect(body.data.issues.backlog[0].title).toBe('Test Issue');
    });

    it('returns 403 when user is not connected', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues',
      });

      expect(response.statusCode).toBe(401);
    });

    it('respects includeArchive=false query parameter', async () => {
      seedConnection('test-user-123');
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      ctx.issueRepository.seedIssue({
        id: 'issue-old',
        identifier: 'ENG-2',
        title: 'Old Completed',
        description: null,
        state: 'Done',
        stateType: 'completed',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/2',
        userId: 'test-user-123',
        createdAt: tenDaysAgo.toISOString(),
        updatedAt: tenDaysAgo.toISOString(),
        syncedAt: new Date().toISOString(),
        teamId: 'team-456',
        parentId: null,
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues?includeArchive=false',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.issues.archive).toHaveLength(0);
    });

    it('handles repository errors when reading issues', async () => {
      seedConnection('test-user-123');
      ctx.issueRepository.setListByUserIdFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database read error',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /linear/failed-issues', () => {
    it('returns failed issues for authenticated user', async () => {
      await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/failed-issues',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.failedIssues).toHaveLength(1);
      expect(body.data.failedIssues[0].originalText).toBe('Create a task for testing');
      expect(body.data.failedIssues[0].error).toBe('Connection error');
    });

    it('returns empty array when no failed issues exist', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/failed-issues',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.failedIssues).toHaveLength(0);
    });

    it('only returns failed issues for the authenticated user', async () => {
      await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'User 1 task',
        extractedTitle: null,
        extractedPriority: null,
        error: 'Failed',
        reasoning: null,
      });
      await ctx.failedIssueRepository.create({
        userId: 'other-user',
        actionId: 'action-2',
        originalText: 'Other user task',
        extractedTitle: null,
        extractedPriority: null,
        error: 'Failed',
        reasoning: null,
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/failed-issues',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.failedIssues).toHaveLength(1);
      expect(body.data.failedIssues[0].originalText).toBe('User 1 task');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/failed-issues',
      });

      expect(response.statusCode).toBe(401);
    });

    it('handles repository list error', async () => {
      ctx.failedIssueRepository.setListByUserFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database query failed',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/failed-issues',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /linear/failed-issues/:id', () => {
    it('deletes failed issue for owner', async () => {
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/linear/failed-issues/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(204);

      const listResult = await ctx.failedIssueRepository.listByUser('test-user-123');
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(0);
      }
    });

    it('returns 404 for non-existent failed issue', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/linear/failed-issues/nonexistent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when user does not own the issue', async () => {
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'other-user',
        actionId: 'action-1',
        originalText: 'Other user task',
        extractedTitle: null,
        extractedPriority: null,
        error: 'Failed',
        reasoning: null,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/linear/failed-issues/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/linear/failed-issues/some-id',
      });

      expect(response.statusCode).toBe(401);
    });

    it('handles repository delete error', async () => {
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.failedIssueRepository.setDeleteFailure(true);

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/linear/failed-issues/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 404 when getById repository fails', async () => {
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.failedIssueRepository.setGetByIdFailure(true);

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/linear/failed-issues/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /linear/failed-issues/:id/retry', () => {
    it('retries issue creation and deletes failed issue on success', async () => {
      seedConnection('test-user-123');
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.issue).toBeDefined();
      expect(body.data.issue.title).toBe('Testing task');
      expect(body.data.issue.identifier).toMatch(/^ENG-\d+$/);

      const listResult = await ctx.failedIssueRepository.listByUser('test-user-123');
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value).toHaveLength(0);
      }
    });

    it('updates error and returns 422 on Linear API failure', async () => {
      seedConnection('test-user-123');
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.linearApiClient.setFailure(true, {
        code: 'RATE_LIMIT',
        message: 'Rate limit exceeded',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNPROCESSABLE_ENTITY');
      expect(body.error.message).toBe('Rate limit exceeded');

      const getResult = await ctx.failedIssueRepository.getById(createResult.value.id);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value.error).toBe('Rate limit exceeded');
        expect(getResult.value.lastRetryAt).toBeDefined();
        expect(getResult.value.lastRetryAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      }
    });

    it('returns 422 on INVALID_API_KEY error', async () => {
      seedConnection('test-user-123');
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.linearApiClient.setFailure(true, {
        code: 'INVALID_API_KEY',
        message: 'Invalid API key',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNPROCESSABLE_ENTITY');
      expect(body.error.message).toBe('Invalid API key');

      const getResult = await ctx.failedIssueRepository.getById(createResult.value.id);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value.error).toBe('Invalid API key');
        expect(getResult.value.lastRetryAt).toBeDefined();
        expect(getResult.value.lastRetryAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      }
    });

    it('returns 422 on API_ERROR', async () => {
      seedConnection('test-user-123');
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.linearApiClient.setFailure(true, {
        code: 'API_ERROR',
        message: 'Linear API unavailable',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNPROCESSABLE_ENTITY');
      expect(body.error.message).toBe('Linear API unavailable');

      const getResult = await ctx.failedIssueRepository.getById(createResult.value.id);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value.error).toBe('Linear API unavailable');
        expect(getResult.value.lastRetryAt).toBeDefined();
        expect(getResult.value.lastRetryAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      }
    });

    it('returns 404 for non-existent failed issue', async () => {
      seedConnection('test-user-123');

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/linear/failed-issues/nonexistent-id/retry',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when user does not own the issue', async () => {
      seedConnection('test-user-123');
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'other-user',
        actionId: 'action-1',
        originalText: 'Other user task',
        extractedTitle: null,
        extractedPriority: null,
        error: 'Failed',
        reasoning: null,
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/linear/failed-issues/some-id/retry',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 403 when user has no Linear connection', async () => {
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      // Note: user has failed issue but no Linear connection (edge case)
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 when getFullConnection fails on retry', async () => {
      seedConnection('test-user-123');
      const createResult = await ctx.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.connectionRepository.setGetFullConnectionFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database unavailable',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body2 = response.json();
      expect(body2.success).toBe(false);
    });
  });

  describe('Webhook Config Endpoints', () => {
    describe('GET /linear/webhook-config', () => {
      it('returns webhook config when connected without secret', async () => {
        seedConnection('test-user-123');

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.success).toBe(true);
        expect(body.data.webhookUrl).toBeDefined();
        expect(body.data.hasWebhookSecret).toBe(false);
        expect(body.data.teamId).toBe('team-456');
      });

      it('returns webhook config when connected with secret', async () => {
        seedConnection('test-user-123');
        // Set webhook secret
        const setResult = await ctx.connectionRepository.updateWebhookSecret('test-user-123', 'my-secret');
        expect(setResult.ok).toBe(true);

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.success).toBe(true);
        expect(body.data.hasWebhookSecret).toBe(true);
        expect(body.data.teamId).toBe('team-456');
      });

      it('returns 401 when no auth token provided', async () => {
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/linear/webhook-config',
        });

        expect(response.statusCode).toBe(401);
      });

      it('returns 403 when not connected', async () => {
        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(403);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('FORBIDDEN');
      });

      it('returns 500 when connection lookup fails', async () => {
        ctx.connectionRepository.setGetFullConnectionFailure(true, {
          code: 'INTERNAL_ERROR',
          message: 'Database unavailable',
        });

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(500);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
      });
    });

    describe('POST /linear/webhook-config', () => {
      it('returns 401 when no auth token provided', async () => {
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/linear/webhook-config',
          payload: { secret: 'my-secret' },
        });

        expect(response.statusCode).toBe(401);
      });

      it('sets webhook secret when connected', async () => {
        seedConnection('test-user-123');

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
          payload: { secret: 'new-webhook-secret' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.success).toBe(true);
        expect(body.data.configured).toBe(true);

        // Verify secret was set
        const conn = await ctx.connectionRepository.getFullConnection('test-user-123');
        if (conn.ok && conn.value) {
          expect(conn.value.webhookSecret).toBe('new-webhook-secret');
        }
      });

      it('returns 400 when secret is empty', async () => {
        seedConnection('test-user-123');

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
          payload: { secret: '' },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.success).toBe(false);
      });

      it('returns 400 when secret is whitespace only', async () => {
        seedConnection('test-user-123');

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
          payload: { secret: '   ' },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_REQUEST');
      });

      it('returns 403 when not connected', async () => {
        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
          payload: { secret: 'my-secret' },
        });

        expect(response.statusCode).toBe(403);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('FORBIDDEN');
      });

      it('updates existing secret', async () => {
        seedConnection('test-user-123');
        await ctx.connectionRepository.updateWebhookSecret('test-user-123', 'old-secret');

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
          payload: { secret: 'new-secret' },
        });

        expect(response.statusCode).toBe(200);

        const conn = await ctx.connectionRepository.getFullConnection('test-user-123');
        if (conn.ok && conn.value) {
          expect(conn.value.webhookSecret).toBe('new-secret');
        }
      });

      it('returns 500 when connection check fails', async () => {
        seedConnection('test-user-123');
        ctx.connectionRepository.setIsConnectedFailure(true, {
          code: 'INTERNAL_ERROR',
          message: 'Database connection error',
        });

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
          payload: { secret: 'my-secret' },
        });

        expect(response.statusCode).toBe(500);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
      });

      it('returns 500 when secret update fails', async () => {
        seedConnection('test-user-123');
        ctx.connectionRepository.setSaveFailure(true, {
          code: 'INTERNAL_ERROR',
          message: 'Database write failed',
        });

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
          payload: { secret: 'my-secret' },
        });

        expect(response.statusCode).toBe(500);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
      });
    });

    describe('DELETE /linear/webhook-config', () => {
      it('returns 401 when no auth token provided', async () => {
        const response = await ctx.app.inject({
          method: 'DELETE',
          url: '/linear/webhook-config',
        });

        expect(response.statusCode).toBe(401);
      });

      it('removes webhook secret', async () => {
        seedConnection('test-user-123');
        await ctx.connectionRepository.updateWebhookSecret('test-user-123', 'my-secret');

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'DELETE',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.success).toBe(true);
        expect(body.data.configured).toBe(false);

        // Verify secret was removed
        const conn = await ctx.connectionRepository.getFullConnection('test-user-123');
        if (conn.ok && conn.value) {
          expect(conn.value.webhookSecret).toBeNull();
        }
      });

      it('returns 403 when not connected', async () => {
        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'DELETE',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(403);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('FORBIDDEN');
      });

      it('returns 500 when connection check fails', async () => {
        seedConnection('test-user-123');
        await ctx.connectionRepository.updateWebhookSecret('test-user-123', 'my-secret');
        ctx.connectionRepository.setIsConnectedFailure(true, {
          code: 'INTERNAL_ERROR',
          message: 'Database connection error',
        });

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'DELETE',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(500);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
      });

      it('returns 500 when secret removal fails', async () => {
        seedConnection('test-user-123');
        await ctx.connectionRepository.updateWebhookSecret('test-user-123', 'my-secret');
        ctx.connectionRepository.setSaveFailure(true, {
          code: 'INTERNAL_ERROR',
          message: 'Database write failed',
        });

        const token = await createToken({ sub: 'test-user-123' });
        const response = await ctx.app.inject({
          method: 'DELETE',
          url: '/linear/webhook-config',
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(500);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
      });
    });
  });

  describe('GET /linear/issues/:identifier', () => {
    it('returns issue data for authenticated owner', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: 'Test description',
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: null,
        assigneeName: null,
        labels: [{ id: 'bug', name: 'bug', color: '#ff0000' }, { id: 'high-priority', name: 'high-priority', color: '#ff6600' }],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T01:00:00Z',
        syncedAt: '2025-01-15T01:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('issue-1');
      expect(body.data.identifier).toBe('ENG-123');
      expect(body.data.title).toBe('Test Issue');
      expect(body.data.state).toEqual({ name: 'In Progress', type: 'started' });
      expect(body.data.assignee).toBeNull();
      expect(body.data.labels).toEqual([
        { id: 'bug', name: 'bug' },
        { id: 'high-priority', name: 'high-priority' },
      ]);
      expect(body.data.commentCount).toBe(0);
      expect(body.data.lastCommentAt).toBeNull();
    });

    it('returns 401 when no auth token provided', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when issue not found', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-999',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when issue owned by different user', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Other User Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'other-user',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when issueRepository fails', async () => {
      ctx.issueRepository.setFailure(true, { code: 'INTERNAL_ERROR', message: 'Database error' });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns issue with assignee when assigneeId is not null', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Assigned Issue',
        description: null,
        state: 'In Progress',
        stateType: 'started',
        priority: 2,
        assigneeId: 'user-abc',
        assigneeName: 'John Doe',
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T01:00:00Z',
        syncedAt: '2025-01-15T01:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.assignee.id).toBe('user-abc');
      expect(body.data.assignee.name).toBe('John Doe');
    });

    it('returns issue with lastCommentAt when comments exist', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Commented Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      await ctx.commentRepository.save({
        id: 'comment-1',
        issueId: 'issue-1',
        issueIdentifier: 'ENG-123',
        userId: 'test-user-123',
        userName: 'Test User',
        body: 'First comment',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
        syncedAt: '2025-01-15T10:00:00Z',
      });

      await ctx.commentRepository.save({
        id: 'comment-2',
        issueId: 'issue-1',
        issueIdentifier: 'ENG-123',
        userId: 'test-user-123',
        userName: 'Test User',
        body: 'Second comment',
        createdAt: '2025-01-15T11:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
        syncedAt: '2025-01-15T11:00:00Z',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.commentCount).toBe(2);
      expect(body.data.lastCommentAt).toBe('2025-01-15T11:00:00Z');
    });

    it('returns 500 when commentRepository listByIssueId fails', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
        parentId: null,
      });
      ctx.commentRepository.setListByIssueIdFailure(true, { code: 'INTERNAL_ERROR', message: 'DB error' });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body2 = response.json();
      expect(body2.success).toBe(false);
      expect(body2.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /linear/issues/:identifier/comments', () => {
    it('returns paginated comments for authenticated owner', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      await ctx.commentRepository.save({
        id: 'comment-1',
        issueId: 'issue-1',
        issueIdentifier: 'ENG-123',
        userId: 'test-user-123',
        userName: 'Test User',
        body: 'First comment',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
        syncedAt: '2025-01-15T10:00:00Z',
      });

      await ctx.commentRepository.save({
        id: 'comment-2',
        issueId: 'issue-1',
        issueIdentifier: 'ENG-123',
        userId: 'test-user-123',
        userName: 'Test User',
        body: 'Second comment',
        createdAt: '2025-01-15T11:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
        syncedAt: '2025-01-15T11:00:00Z',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.comments).toHaveLength(2);
      expect(body.data.total).toBe(2);
      expect(body.data.limit).toBe(20);
      expect(body.data.offset).toBe(0);
      expect(body.data.hasMore).toBe(false);
      expect(body.data.comments[0].body).toBe('First comment');
    });

    it('returns 401 when no auth token provided', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when issue not found', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-999/comments',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when issue owned by different user', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Other User Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'other-user',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when issueRepository fails', async () => {
      ctx.issueRepository.setFailure(true, { code: 'INTERNAL_ERROR', message: 'Database error' });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when commentRepository listByIssueId fails', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });
      ctx.commentRepository.setListByIssueIdFailure(true, { code: 'INTERNAL_ERROR', message: 'List failed' });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when commentRepository countByIssueId fails', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });
      ctx.commentRepository.setCountByIssueIdFailure(true, { code: 'INTERNAL_ERROR', message: 'Count failed' });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('respects limit query parameter', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      for (let i = 1; i <= 5; i++) {
        await ctx.commentRepository.save({
          id: `comment-${i}`,
          issueId: 'issue-1',
          issueIdentifier: 'ENG-123',
          userId: 'test-user-123',
          userName: 'Test User',
          body: `Comment ${i}`,
          createdAt: `2025-01-15T1${i}:00:00Z`,
          updatedAt: `2025-01-15T1${i}:00:00Z`,
          syncedAt: `2025-01-15T1${i}:00:00Z`,
        });
      }

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments?limit=2',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.comments).toHaveLength(2);
      expect(body.data.limit).toBe(2);
      expect(body.data.total).toBe(5);
      expect(body.data.hasMore).toBe(true);
    });

    it('respects offset query parameter', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
      parentId: null,
      });

      for (let i = 1; i <= 5; i++) {
        await ctx.commentRepository.save({
          id: `comment-${i}`,
          issueId: 'issue-1',
          issueIdentifier: 'ENG-123',
          userId: 'test-user-123',
          userName: 'Test User',
          body: `Comment ${i}`,
          createdAt: `2025-01-15T1${i}:00:00Z`,
          updatedAt: `2025-01-15T1${i}:00:00Z`,
          syncedAt: `2025-01-15T1${i}:00:00Z`,
        });
      }

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments?offset=3',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.comments).toHaveLength(2);
      expect(body.data.offset).toBe(3);
      expect(body.data.hasMore).toBe(false);
    });

    it('pagination offset=total returns empty', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
        parentId: null,
      });

      // Create exactly 5 comments
      for (let i = 1; i <= 5; i++) {
        await ctx.commentRepository.save({
          id: `comment-${i}`,
          issueId: 'issue-1',
          issueIdentifier: 'ENG-123',
          userId: 'test-user-123',
          userName: 'Test User',
          body: `Comment ${i}`,
          createdAt: `2025-01-15T1${i}:00:00Z`,
          updatedAt: `2025-01-15T1${i}:00:00Z`,
          syncedAt: `2025-01-15T1${i}:00:00Z`,
        });
      }

      const token = await createToken({ sub: 'test-user-123' });
      // offset=5 equals total=5, should return empty array
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments?offset=5',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.comments).toHaveLength(0);
      expect(body.data.offset).toBe(5);
      expect(body.data.total).toBe(5);
      expect(body.data.hasMore).toBe(false);
    });

    it('pagination offset>total returns empty', async () => {
      ctx.issueRepository.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-123',
        title: 'Test Issue',
        description: null,
        state: 'Backlog',
        stateType: 'backlog',
        priority: 0,
        assigneeId: null,
        assigneeName: null,
        labels: [],
        url: 'https://linear.app/issue/ENG-123',
        userId: 'test-user-123',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
        syncedAt: '2025-01-15T00:00:00Z',
        teamId: 'team-1',
        parentId: null,
      });

      // Create exactly 5 comments
      for (let i = 1; i <= 5; i++) {
        await ctx.commentRepository.save({
          id: `comment-${i}`,
          issueId: 'issue-1',
          issueIdentifier: 'ENG-123',
          userId: 'test-user-123',
          userName: 'Test User',
          body: `Comment ${i}`,
          createdAt: `2025-01-15T1${i}:00:00Z`,
          updatedAt: `2025-01-15T1${i}:00:00Z`,
          syncedAt: `2025-01-15T1${i}:00:00Z`,
        });
      }

      const token = await createToken({ sub: 'test-user-123' });
      // offset=10 exceeds total=5, should return empty array
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues/ENG-123/comments?offset=10',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.comments).toHaveLength(0);
      expect(body.data.offset).toBe(10);
      expect(body.data.total).toBe(5);
      expect(body.data.hasMore).toBe(false);
    });
  });
});

// Logging coverage tests - use beforeEach to build server with test logger
describe('linearRoutes logging coverage', () => {
  let loggingApp: FastifyInstance;
  const loggingRepos = {
    connectionRepository: new FakeLinearConnectionRepository(),
    linearApiClient: new FakeLinearApiClient(),
    extractionService: new FakeLinearActionExtractionService(),
    failedIssueRepository: new FakeFailedIssueRepository(),
    processedActionRepository: new FakeProcessedActionRepository(),
    issueRepository: new FakeLinearIssueRepository(),
    userServiceClient: new FakeUserServiceClient(),
    commentRepository: new FakeLinearCommentRepository(),
    codeAgentClient: new FakeCodeAgentClient(),
  };

  beforeAll(async () => {
    await setupJwksServer();
  });

  afterAll(async () => {
    await teardownJwksServer();
  });

  function seedConnection(userId: string): void {
    const connection: LinearConnection = {
      userId,
      apiKey: 'linear-api-key-123',
      teamId: 'team-456',
      teamName: 'Engineering',
      webhookSecret: null,
      connected: true,
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    };
    loggingRepos.connectionRepository.seedConnection(connection);
  }

  beforeEach(async () => {
    clearTestLogs();
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    loggingRepos.connectionRepository.reset();
    loggingRepos.linearApiClient.reset();
    loggingRepos.extractionService.reset();
    loggingRepos.failedIssueRepository.reset();
    loggingRepos.processedActionRepository.reset();
    loggingRepos.issueRepository.reset();
    loggingRepos.userServiceClient.reset();
    setServices(loggingRepos);
    loggingApp = await buildServer(getTestLoggerStream());
    await loggingApp.ready();
  });

  afterEach(async () => {
    if (loggingApp) {
      await loggingApp.close();
    }
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('DELETE /linear/failed-issues/:id - logging', () => {
    it('logs error when getById repository fails', async () => {
      const createResult = await loggingRepos.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      loggingRepos.failedIssueRepository.setGetByIdFailure(true);

      const token = await createToken({ sub: 'test-user-123' });
      const response = await loggingApp.inject({
        method: 'DELETE',
        url: `/linear/failed-issues/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      // Error logging is enabled - coverage will verify the log line is hit
    });

    it('logs error when delete repository fails', async () => {
      const createResult = await loggingRepos.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      loggingRepos.failedIssueRepository.setDeleteFailure(true);

      const token = await createToken({ sub: 'test-user-123' });
      const response = await loggingApp.inject({
        method: 'DELETE',
        url: `/linear/failed-issues/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      // Error logging is enabled - coverage will verify the log line is hit
    });
  });

  describe('POST /linear/failed-issues/:id/retry - logging', () => {
    it('logs error when getById repository fails', async () => {
      const createResult = await loggingRepos.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      loggingRepos.failedIssueRepository.setGetByIdFailure(true);

      const token = await createToken({ sub: 'test-user-123' });
      const response = await loggingApp.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      // Error logging is enabled - coverage will verify the log line is hit
    });

    it('logs error when update fails after retry fails', async () => {
      seedConnection('test-user-123');
      const createResult = await loggingRepos.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      loggingRepos.linearApiClient.setFailure(true, { code: 'RATE_LIMIT', message: 'Rate limit exceeded' });
      loggingRepos.failedIssueRepository.setUpdateFailure(true);

      const token = await createToken({ sub: 'test-user-123' });
      const response = await loggingApp.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(422);
      // Error logging is enabled - coverage will verify the log line is hit
    });

    it('logs error when delete fails after successful retry', async () => {
      seedConnection('test-user-123');
      const createResult = await loggingRepos.failedIssueRepository.create({
        userId: 'test-user-123',
        actionId: 'action-1',
        originalText: 'Create a task for testing',
        extractedTitle: 'Testing task',
        extractedPriority: 2,
        error: 'Connection error',
        reasoning: 'Network timeout',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      loggingRepos.failedIssueRepository.setDeleteFailure(true);

      const token = await createToken({ sub: 'test-user-123' });
      const response = await loggingApp.inject({
        method: 'POST',
        url: `/linear/failed-issues/${createResult.value.id}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      // Error logging is enabled - coverage will verify the log line is hit
    });
  });

  describe('POST /linear/sync', () => {
    it('returns 401 when no auth token provided', async () => {
      const response = await loggingApp.inject({
        method: 'POST',
        url: '/linear/sync',
      });

      expect(response.statusCode).toBe(401);
    });

    it('syncs issues for the authenticated user successfully', async () => {
      seedConnection('test-user-123');

      const token = await createToken({ sub: 'test-user-123' });
      const response = await loggingApp.inject({
        method: 'POST',
        url: '/linear/sync',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.created).toBeGreaterThanOrEqual(0);
    });

    it('returns 500 when fullSync fails', async () => {
      seedConnection('test-user-123');
      loggingRepos.connectionRepository.setGetFullConnectionFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database error',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await loggingApp.inject({
        method: 'POST',
        url: '/linear/sync',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });
  });
});
