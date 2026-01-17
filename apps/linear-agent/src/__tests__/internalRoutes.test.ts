/**
 * Tests for internal API routes.
 * Tests service-to-service communication for Linear action processing.
 */
import { describe, expect, it } from 'vitest';
import { setupTestContext } from './testUtils.js';

describe('Internal Routes', () => {
  const ctx = setupTestContext();

  const validPayload = {
    action: {
      id: 'action-123',
      userId: 'user-456',
      text: 'Create a task to fix the login bug',
    },
  };

  describe('POST /internal/linear/process-action', () => {
    it('returns 401 when internal auth header is missing', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when internal auth token is invalid', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'wrong-token',
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when user is not connected to Linear', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'test-internal-token',
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 500 on internal error', async () => {
      ctx.connectionRepository.seedConnection({
        userId: 'user-456',
        apiKey: 'test-api-key',
        teamId: 'team-1',
        teamName: 'Engineering',
        connected: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      ctx.linearApiClient.setFailure(true, { code: 'API_ERROR', message: 'Linear service unavailable' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'test-internal-token',
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { status: string; error: string };
      expect(body.status).toBe('failed');
      expect(body.error).toBe('Linear service unavailable');
    });

    it('returns 502 when connection repository fails', async () => {
      ctx.connectionRepository.setGetFullConnectionFailure(true, {
        code: 'INTERNAL_ERROR',
        message: 'Database connection failed',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'test-internal-token',
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Database connection failed');
    });

    it('returns 200 with completed status on successful issue creation', async () => {
      ctx.connectionRepository.seedConnection({
        userId: 'user-456',
        apiKey: 'test-api-key',
        teamId: 'team-1',
        teamName: 'Engineering',
        connected: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      ctx.extractionService.setResponse({
        title: 'Fix login bug',
        priority: 2,
        valid: true,
        error: null,
        reasoning: 'Valid issue',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'test-internal-token',
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        status: string;
        resource_url: string;
        issue_identifier: string;
      };
      expect(body.status).toBe('completed');
      expect(body.resource_url).toBeDefined();
      expect(body.issue_identifier).toBeDefined();
    });

    it('returns 200 with failed status when extraction is invalid', async () => {
      ctx.connectionRepository.seedConnection({
        userId: 'user-456',
        apiKey: 'test-api-key',
        teamId: 'team-1',
        teamName: 'Engineering',
        connected: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      ctx.extractionService.setResponse({
        title: 'Some title',
        priority: 0,
        valid: false,
        error: 'Not a valid issue request',
        reasoning: 'Message does not contain actionable task',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'test-internal-token',
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { status: string; error: string };
      expect(body.status).toBe('failed');
      expect(body.error).toBe('Not a valid issue request');
    });

    it('includes summary in payload when provided', async () => {
      ctx.connectionRepository.seedConnection({
        userId: 'user-456',
        apiKey: 'test-api-key',
        teamId: 'team-1',
        teamName: 'Engineering',
        connected: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      ctx.extractionService.setResponse({
        title: 'Fix login bug',
        priority: 2,
        valid: true,
        error: null,
        reasoning: 'Valid issue',
      });

      const payloadWithSummary = {
        action: {
          id: 'action-789',
          userId: 'user-456',
          text: 'Create a task for the login bug',
          summary: 'User reported login issues on mobile',
        },
      };

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'test-internal-token',
        },
        payload: payloadWithSummary,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { status: string };
      expect(body.status).toBe('completed');
    });

    it('returns existing result for already processed action (idempotency)', async () => {
      ctx.connectionRepository.seedConnection({
        userId: 'user-456',
        apiKey: 'test-api-key',
        teamId: 'team-1',
        teamName: 'Engineering',
        connected: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      ctx.processedActionRepository.seedProcessedAction({
        actionId: 'action-123',
        userId: 'user-456',
        issueId: 'issue-existing',
        issueIdentifier: 'ENG-99',
        resourceUrl: 'https://linear.app/team/issue/ENG-99',
        createdAt: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'test-internal-token',
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        status: string;
        resource_url: string;
        issue_identifier: string;
      };
      expect(body.status).toBe('completed');
      expect(body.issue_identifier).toBe('ENG-99');
      expect(body.resource_url).toBe('https://linear.app/team/issue/ENG-99');
    });

    it('validates required action fields', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'test-internal-token',
        },
        payload: {
          action: {
            id: 'action-123',
          },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('saves failed issue when extraction service fails', async () => {
      ctx.connectionRepository.seedConnection({
        userId: 'user-456',
        apiKey: 'test-api-key',
        teamId: 'team-1',
        teamName: 'Engineering',
        connected: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      ctx.extractionService.setFailure(true, {
        code: 'EXTRACTION_FAILED',
        message: 'LLM service unavailable',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/linear/process-action',
        headers: {
          'X-Internal-Auth': 'test-internal-token',
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { status: string; error: string };
      expect(body.status).toBe('failed');
      expect(body.error).toBe('LLM service unavailable');
      expect(ctx.failedIssueRepository.count).toBe(1);
    });
  });
});
