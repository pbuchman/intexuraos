import { createToken, describe, expect, it, setupTestContext } from '../testUtils.js';
import type { LinearConnection } from '../../domain/models.js';

describe('linearRoutes', () => {
  const ctx = setupTestContext();

  function seedConnection(userId: string): void {
    const connection: LinearConnection = {
      userId,
      apiKey: 'linear-api-key-123',
      teamId: 'team-456',
      teamName: 'Engineering',
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
          teamName: 'Team',
        },
      });

      expect(response.statusCode).toBe(401);
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
  });

  describe('GET /linear/issues', () => {
    it('returns grouped issues for authenticated connected user', async () => {
      seedConnection('test-user-123');
      ctx.linearApiClient.seedIssue({
        id: 'issue-1',
        identifier: 'ENG-1',
        title: 'Test Issue',
        description: null,
        priority: 2,
        state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
        url: 'https://linear.app/issue/1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
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

      ctx.linearApiClient.seedIssue({
        id: 'issue-old',
        identifier: 'ENG-2',
        title: 'Old Completed',
        description: null,
        priority: 0,
        state: { id: 'state-done', name: 'Done', type: 'completed' },
        url: 'https://linear.app/issue/2',
        createdAt: tenDaysAgo.toISOString(),
        updatedAt: tenDaysAgo.toISOString(),
        completedAt: tenDaysAgo.toISOString(),
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

    it('handles rate limit errors from Linear API', async () => {
      seedConnection('test-user-123');
      ctx.linearApiClient.setFailure(true, { code: 'RATE_LIMIT', message: 'Rate limited' });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });

    it('handles API errors from Linear', async () => {
      seedConnection('test-user-123');
      ctx.linearApiClient.setFailure(true, { code: 'API_ERROR', message: 'API Error' });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/linear/issues',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = response.json();
      expect(body.success).toBe(false);
    });
  });
});
