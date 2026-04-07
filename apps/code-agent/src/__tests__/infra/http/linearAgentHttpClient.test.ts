import { describe, it, expect, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { createLinearAgentHttpClient } from '../../../infra/http/linearAgentHttpClient.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';

describe('linearAgentHttpClient', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const baseUrl = 'http://linear-agent:8086';
  const internalAuthToken = 'test-token';

  let client: LinearAgentClient;

  beforeEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
    client = createLinearAgentHttpClient({
      baseUrl,
      internalAuthToken,
      timeoutMs: 5000,
    }, mockLogger);
  });

  describe('createIssue', () => {
    it('should create issue successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'issue-123',
          identifier: 'INT-123',
          title: 'Test Issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
        },
      };

      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, mockResponse);

      const result = await client.createIssue({
        userId: 'test-user-123',
        title: 'Test Issue',
        description: 'Test description',
      });

      if (result.ok) {
        expect(result.value.issueId).toBe('issue-123');
        expect(result.value.issueIdentifier).toBe('INT-123');
        expect(result.value.issueTitle).toBe('Test Issue');
        expect(result.value.issueUrl).toBe('https://linear.app/pbuchman/issue/INT-123');
        expect(mockLogger.info).toHaveBeenCalledWith(
          { issueId: 'issue-123', identifier: 'INT-123' },
          'Linear issue created'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should send empty labels array when labels not provided', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'issue-456',
          identifier: 'INT-456',
          title: 'Test Issue',
          url: 'https://linear.app/pbuchman/issue/INT-456',
        },
      };

      let capturedBody: unknown;

      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, function (_uri, requestBody) {
          capturedBody = requestBody;
          return mockResponse;
        });

      await client.createIssue({
        userId: 'test-user-123',
        title: 'Test Issue',
        description: 'Test description',
      });

      expect(capturedBody).toEqual({
        title: 'Test Issue',
        description: 'Test description',
        labels: [],
      });
    });

    it('should return UNAVAILABLE on 500 error', async () => {
      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(500, 'Internal Server Error');

      const result = await client.createIssue({
        userId: 'test-user-123',
        title: 'Test',
        description: 'Test',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('linear-agent unavailable');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { status: 500, error: 'Internal Server Error' },
          'linear-agent createIssue failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return RATE_LIMITED on 429 error', async () => {
      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(429, 'Too Many Requests');

      const result = await client.createIssue({
        userId: 'test-user-123',
        title: 'Test',
        description: 'Test',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.message).toBe('Linear API rate limited');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return INVALID_REQUEST on 400 error', async () => {
      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(400, 'Bad Request');

      const result = await client.createIssue({
        userId: 'test-user-123',
        title: 'Test',
        description: 'Test',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST');
        expect(result.error.message).toBe('Bad Request');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on request timeout', async () => {
      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .delay(6000)
        .reply(200, {});

      const result = await client.createIssue({
        userId: 'test-user-123',
        title: 'Test',
        description: 'Test',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Request timed out');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { timeoutMs: 5000 },
          'linear-agent request timed out'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .replyWithError('ECONNREFUSED');

      const result = await client.createIssue({
        userId: 'test-user-123',
        title: 'Test',
        description: 'Test',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('ECONNREFUSED');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should log info before creating issue', async () => {
      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, {
          id: 'issue-789',
          identifier: 'INT-789',
          title: 'My Title',
          url: 'https://linear.app/pbuchman/issue/INT-789',
        });

      await client.createIssue({
        userId: 'test-user-123',
        title: 'My Title',
        description: 'My Description',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        { title: 'My Title' },
        'Creating Linear issue via linear-agent'
      );
    });
  });

  describe('updateIssueState', () => {
    it('should update state successfully', async () => {
      nock(baseUrl)
        .patch('/internal/issues/issue-123/state')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: true, data: {} });

      const result = await client.updateIssueState({
        userId: 'test-user-123',
        issueId: 'issue-123',
        state: 'in_progress',
      });

      if (result.ok) {
        expect(result.value).toBeUndefined();
        expect(mockLogger.info).toHaveBeenCalledWith(
          { issueId: 'issue-123', state: 'in_progress' },
          'Linear issue state updated'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should update state to in_review', async () => {
      nock(baseUrl)
        .patch('/internal/issues/issue-456/state')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: true, data: {} });

      const result = await client.updateIssueState({
        userId: 'test-user-123',
        issueId: 'issue-456',
        state: 'in_review',
      });

      if (result.ok) {
        expect(result.value).toBeUndefined();
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should return error on failed update', async () => {
      nock(baseUrl)
        .patch('/internal/issues/issue-789/state')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(500, 'Internal Server Error');

      const result = await client.updateIssueState({
        userId: 'test-user-123',
        issueId: 'issue-789',
        state: 'in_progress',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { status: 500, error: 'Internal Server Error' },
          'linear-agent updateState failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should log info before updating state', async () => {
      nock(baseUrl)
        .patch('/internal/issues/test-issue/state')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: true, data: {} });

      await client.updateIssueState({
        userId: 'test-user-123',
        issueId: 'test-issue',
        state: 'qa',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        { issueId: 'test-issue', state: 'qa' },
        'Updating Linear issue state'
      );
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .patch('/internal/issues/issue-abc/state')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: false });

      const result = await client.updateIssueState({
        userId: 'test-user-123',
        issueId: 'issue-abc',
        state: 'in_progress',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { body: { success: false } },
          'Invalid response from linear-agent'
        );
      } else {
        expect.fail('Expected error result');
      }
    });
  });

  describe('validateIssue', () => {
    it('should validate issue successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'issue-123',
          identifier: 'INT-123',
          title: 'Test Issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 0,
          parentId: null,
        },
      };

      nock(baseUrl)
        .get('/internal/linear/issues/INT-123/validate')
        .query({ userId: 'test-user-123' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, mockResponse);

      const result = await client.validateIssue({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      if (result.ok) {
        expect(result.value.id).toBe('issue-123');
        expect(result.value.identifier).toBe('INT-123');
        expect(result.value.title).toBe('Test Issue');
        expect(result.value.url).toBe('https://linear.app/pbuchman/issue/INT-123');
        expect(result.value.parentId).toBe(null);
        expect(mockLogger.info).toHaveBeenCalledWith(
          { identifier: 'INT-123', issueId: 'issue-123' },
          'Linear issue validated'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should include parentId when issue is a subtask', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'issue-456',
          identifier: 'INT-456',
          title: 'Subtask Issue',
          url: 'https://linear.app/pbuchman/issue/INT-456',
          labels: [],
          childCount: 0,
          parentId: 'parent-issue-id',
        },
      };

      nock(baseUrl)
        .get('/internal/linear/issues/INT-456/validate')
        .query({ userId: 'test-user-123' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, mockResponse);

      const result = await client.validateIssue({
        userId: 'test-user-123',
        identifier: 'INT-456',
      });

      if (result.ok) {
        expect(result.value.parentId).toBe('parent-issue-id');
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should return NOT_FOUND on 404 error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-999/validate')
        .query({ userId: 'test-user-123' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(404, 'Issue not found');

      const result = await client.validateIssue({
        userId: 'test-user-123',
        identifier: 'INT-999',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('INT-999');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { identifier: 'INT-999', error: 'Issue not found' },
          'Linear issue not found or wrong team'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on non-404 error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123/validate')
        .query({ userId: 'test-user-123' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(500, 'Internal Server Error');

      const result = await client.validateIssue({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { status: 500, error: 'Internal Server Error' },
          'linear-agent validateIssue failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on request timeout', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123/validate')
        .query({ userId: 'test-user-123' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .delay(6000)
        .reply(200, {});

      const result = await client.validateIssue({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Request timed out');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123/validate')
        .query({ userId: 'test-user-123' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError('ECONNREFUSED');

      const result = await client.validateIssue({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('ECONNREFUSED');
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(Error) }),
          'linear-agent validateIssue request failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123/validate')
        .query({ userId: 'test-user-123' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, { success: false });

      const result = await client.validateIssue({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { body: { success: false } },
          'Invalid response from linear-agent'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on response with success true but missing data', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123/validate')
        .query({ userId: 'test-user-123' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, { success: true });

      const result = await client.validateIssue({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should log info before validating issue', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-456/validate')
        .query({ userId: 'test-user-123' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            id: 'issue-456',
            identifier: 'INT-456',
            title: 'Validated Issue',
            url: 'https://linear.app/pbuchman/issue/INT-456',
            labels: [],
            childCount: 0,
            parentId: null,
          },
        });

      await client.validateIssue({
        userId: 'test-user-123',
        identifier: 'INT-456',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        { identifier: 'INT-456' },
        'Validating Linear issue via linear-agent'
      );
    });
  });

  describe('generateTitle', () => {
    it('should generate title successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          title: 'Fix login button on mobile',
          issueType: 'bug' as const,
        },
      };

      nock(baseUrl)
        .post('/internal/linear/issues/generate-title')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, mockResponse);

      const result = await client.generateTitle({
        userId: 'test-user-123',
        description: 'The login button is not working on mobile devices',
      });

      if (result.ok) {
        expect(result.value.title).toBe('Fix login button on mobile');
        expect(result.value.issueType).toBe('bug');
        expect(mockLogger.info).toHaveBeenCalledWith(
          { title: 'Fix login button on mobile', issueType: 'bug' },
          'Issue title generated'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should generate feature title', async () => {
      const mockResponse = {
        success: true,
        data: {
          title: 'Add dark mode to settings',
          issueType: 'feature' as const,
        },
      };

      nock(baseUrl)
        .post('/internal/linear/issues/generate-title')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, mockResponse);

      const result = await client.generateTitle({
        userId: 'test-user-123',
        description: 'I need dark mode support',
      });

      if (result.ok) {
        expect(result.value.issueType).toBe('feature');
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should return error on failure', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/generate-title')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(500, 'Internal Server Error');

      const result = await client.generateTitle({
        userId: 'test-user-123',
        description: 'Fix the bug',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { status: 500, error: 'Internal Server Error' },
          'linear-agent generateTitle failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should log info before generating title', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/generate-title')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            title: 'Generated Title',
            issueType: 'feature' as const,
          },
        });

      await client.generateTitle({
        userId: 'test-user-123',
        description: 'Some description',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        { descriptionLength: 16 },
        'Generating issue title via linear-agent'
      );
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/generate-title')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, { success: false });

      const result = await client.generateTitle({
        userId: 'test-user-123',
        description: 'Test description',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { body: { success: false } },
          'Invalid response from linear-agent'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on request timeout', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/generate-title')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .delay(6000)
        .reply(200, {});

      const result = await client.generateTitle({
        userId: 'test-user-123',
        description: 'Test description',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Request timed out');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { timeoutMs: 5000 },
          'linear-agent request timed out'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/generate-title')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError('ECONNREFUSED');

      const result = await client.generateTitle({
        userId: 'test-user-123',
        description: 'Test description',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('ECONNREFUSED');
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(Error) }),
          'linear-agent generateTitle request failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });
  });

  describe('addComment', () => {
    it('should add comment successfully', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/issue-123/comments', { body: 'Test comment' })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: true, data: { id: 'comment-456' } });

      const result = await client.addComment({
        userId: 'test-user-123',
        issueId: 'issue-123',
        body: 'Test comment',
      });

      if (result.ok) {
        expect(result.value.commentId).toBe('comment-456');
        expect(mockLogger.info).toHaveBeenCalledWith(
          { issueId: 'issue-123', commentId: 'comment-456' },
          'Comment added to Linear issue'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should return RATE_LIMITED on 429 error', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/issue-123/comments')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(429, 'Too Many Requests');

      const result = await client.addComment({
        userId: 'test-user-123',
        issueId: 'issue-123',
        body: 'Test comment',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
        expect(result.error.message).toBe('Linear API rate limited');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { status: 429, error: 'Too Many Requests' },
          'linear-agent addComment failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on 500 error', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/issue-123/comments')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(500, 'Internal Server Error');

      const result = await client.addComment({
        userId: 'test-user-123',
        issueId: 'issue-123',
        body: 'Test comment',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('linear-agent unavailable');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return INVALID_REQUEST on 400 error', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/issue-123/comments')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(400, 'Bad Request');

      const result = await client.addComment({
        userId: 'test-user-123',
        issueId: 'issue-123',
        body: 'Test comment',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST');
        expect(result.error.message).toBe('Bad Request');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/issue-123/comments')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: false });

      const result = await client.addComment({
        userId: 'test-user-123',
        issueId: 'issue-123',
        body: 'Test comment',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { body: { success: false } },
          'Invalid response from linear-agent'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on request timeout', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/issue-123/comments')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .delay(6000)
        .reply(200, {});

      const result = await client.addComment({
        userId: 'test-user-123',
        issueId: 'issue-123',
        body: 'Test comment',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Request timed out');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { timeoutMs: 5000 },
          'linear-agent request timed out'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/issue-123/comments')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .replyWithError('ECONNREFUSED');

      const result = await client.addComment({
        userId: 'test-user-123',
        issueId: 'issue-123',
        body: 'Test comment',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('ECONNREFUSED');
      } else {
        expect.fail('Expected error result');
      }
    });
  });

  describe('fetchIssueTree', () => {
    it('should fetch issue tree successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          root: {
            id: 'issue-123',
            identifier: 'INT-123',
            url: 'https://linear.app/pbuchman/issue/INT-123',
            parentId: null,
            labels: ['backend'],
            assigneeId: 'user-123',
            state: 'in_progress',
          },
          descendants: [],
        },
      };

      nock(baseUrl)
        .get('/internal/issues/issue-123/tree')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, mockResponse);

      const result = await client.fetchIssueTree({
        userId: 'test-user-123',
        issueId: 'issue-123',
      });

      if (result.ok) {
        expect(result.value.root.id).toBe('issue-123');
        expect(result.value.root.identifier).toBe('INT-123');
        expect(result.value.descendants).toEqual([]);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should return NOT_FOUND on 404 error', async () => {
      nock(baseUrl)
        .get('/internal/issues/issue-999/tree')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(404, 'Issue not found');

      const result = await client.fetchIssueTree({
        userId: 'test-user-123',
        issueId: 'issue-999',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Issue not found');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on 500 error', async () => {
      nock(baseUrl)
        .get('/internal/issues/issue-123/tree')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(500, 'Internal Server Error');

      const result = await client.fetchIssueTree({
        userId: 'test-user-123',
        issueId: 'issue-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Internal Server Error');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .get('/internal/issues/issue-123/tree')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: false });

      const result = await client.fetchIssueTree({
        userId: 'test-user-123',
        issueId: 'issue-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .get('/internal/issues/issue-123/tree')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .replyWithError('ECONNREFUSED');

      const result = await client.fetchIssueTree({
        userId: 'test-user-123',
        issueId: 'issue-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('ECONNREFUSED');
      } else {
        expect.fail('Expected error result');
      }
    });
  });

  describe('fetchDirectChildrenLive', () => {
    it('should fetch live direct children successfully', async () => {
      const mockResponse = {
        success: true,
        data: [
          {
            id: 'child-123',
            identifier: 'INT-200',
            url: 'https://linear.app/pbuchman/issue/INT-200',
            parentId: 'issue-123',
            labels: ['code-task'],
            assigneeId: null,
            state: 'todo',
          },
        ],
      };

      nock(baseUrl)
        .get('/internal/linear/issues/issue-123/direct-children')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, mockResponse);

      const result = await client.fetchDirectChildrenLive({
        userId: 'test-user-123',
        issueId: 'issue-123',
      });

      if (result.ok) {
        expect(result.value).toEqual(mockResponse.data);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should return NOT_FOUND on 404 error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/issue-999/direct-children')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(404, 'Issue not found');

      const result = await client.fetchDirectChildrenLive({
        userId: 'test-user-123',
        issueId: 'issue-999',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Issue not found');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on non-404 HTTP errors', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/issue-123/direct-children')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(503, 'service unavailable');

      const result = await client.fetchDirectChildrenLive({
        userId: 'test-user-123',
        issueId: 'issue-123',
      });

      if (!result.ok) {
        expect(result.error).toEqual({
          code: 'UNAVAILABLE',
          message: 'service unavailable',
        });
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/issue-123/direct-children')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: false });

      const result = await client.fetchDirectChildrenLive({
        userId: 'test-user-123',
        issueId: 'issue-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
      } else {
        expect.fail('Expected error result');
      }
    });
  });

  describe('updateIssueMetadata', () => {
    it('should update metadata successfully and parse droppedLabels', async () => {
      nock(baseUrl)
        .patch('/internal/linear/issues/issue-123/metadata')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: true, data: { droppedLabels: ['nonexistent'] } });

      const result = await client.updateIssueMetadata({
        userId: 'test-user-123',
        issueId: 'issue-123',
        assigneeId: 'user-456',
        addLabels: ['bug'],
        removeLabels: ['feature'],
      });

      if (result.ok) {
        expect(result.value.droppedLabels).toEqual(['nonexistent']);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should default droppedLabels to empty array when not in response', async () => {
      nock(baseUrl)
        .patch('/internal/linear/issues/issue-123/metadata')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: true });

      const result = await client.updateIssueMetadata({
        userId: 'test-user-123',
        issueId: 'issue-123',
        addLabels: ['bug'],
      });

      if (result.ok) {
        expect(result.value.droppedLabels).toEqual([]);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should return NOT_FOUND on 404 error', async () => {
      nock(baseUrl)
        .patch('/internal/linear/issues/issue-999/metadata')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(404, 'Issue not found');

      const result = await client.updateIssueMetadata({
        userId: 'test-user-123',
        issueId: 'issue-999',
        addLabels: ['bug'],
      });

      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Issue not found');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on 500 error', async () => {
      nock(baseUrl)
        .patch('/internal/linear/issues/issue-123/metadata')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(500, 'Internal Server Error');

      const result = await client.updateIssueMetadata({
        userId: 'test-user-123',
        issueId: 'issue-123',
        addLabels: ['bug'],
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Internal Server Error');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .patch('/internal/linear/issues/issue-123/metadata')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: false });

      const result = await client.updateIssueMetadata({
        userId: 'test-user-123',
        issueId: 'issue-123',
        addLabels: ['bug'],
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .patch('/internal/linear/issues/issue-123/metadata')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .replyWithError('ECONNREFUSED');

      const result = await client.updateIssueMetadata({
        userId: 'test-user-123',
        issueId: 'issue-123',
        addLabels: ['bug'],
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('ECONNREFUSED');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should send only provided metadata fields', async () => {
      let capturedBody: unknown;

      nock(baseUrl)
        .patch('/internal/linear/issues/issue-123/metadata')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, function (_uri, requestBody) {
          capturedBody = requestBody;
          return { success: true };
        });

      await client.updateIssueMetadata({
        userId: 'test-user-123',
        issueId: 'issue-123',
        assigneeId: 'user-456',
      });

      expect(capturedBody).toEqual({ assigneeId: 'user-456' });
    });
  });

  describe('fetchIssueForDisplay', () => {
    it('should fetch issue for display successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'issue-123',
          identifier: 'INT-123',
          parentIdentifier: 'INT-100',
          title: 'Test Issue',
          description: null,
          state: { name: 'Backlog', type: 'backlog' },
          priority: 0,
          assignee: { id: 'user-123', name: 'Test User' },
          labels: [],
          url: 'https://linear.app/pbuchman/issue/INT-123',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          commentCount: 0,
          lastCommentAt: null,
        },
      };

      nock(baseUrl)
        .get('/internal/linear/issues/INT-123')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, mockResponse);

      const result = await client.fetchIssueForDisplay({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      if (result.ok) {
        expect(result.value.identifier).toBe('INT-123');
        expect(result.value.parentIdentifier).toBe('INT-100');
        expect(result.value.title).toBe('Test Issue');
        expect(result.value.state.name).toBe('Backlog');
        expect(result.value.priority).toBe(0);
        expect(result.value.assignee?.name).toBe('Test User');
        expect(result.value.url).toBe('https://linear.app/pbuchman/issue/INT-123');
        expect(result.value.commentCount).toBe(0);
        expect(result.value.lastCommentAt).toBeNull();
        expect(mockLogger.info).toHaveBeenCalledWith(
          { identifier: 'INT-123' },
          'Fetching Linear issue for display'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: false });

      const result = await client.fetchIssueForDisplay({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { body: { success: false } },
          'Invalid response from linear-agent'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on 500 error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-456')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(500, 'Internal Server Error');

      const result = await client.fetchIssueForDisplay({
        userId: 'test-user-123',
        identifier: 'INT-456',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Internal Server Error');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { status: 500, error: 'Internal Server Error' },
          'linear-agent fetchIssueForDisplay failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on 404 error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-999')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(404, 'Issue not found');

      const result = await client.fetchIssueForDisplay({
        userId: 'test-user-123',
        identifier: 'INT-999',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Issue not found');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { status: 404, error: 'Issue not found' },
          'linear-agent fetchIssueForDisplay failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNAVAILABLE on request timeout', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-789')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .delay(6000)
        .reply(200, {});

      const result = await client.fetchIssueForDisplay({
        userId: 'test-user-123',
        identifier: 'INT-789',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Request timed out');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { timeoutMs: 5000 },
          'linear-agent request timed out'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-789')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .replyWithError('ECONNREFUSED');

      const result = await client.fetchIssueForDisplay({
        userId: 'test-user-123',
        identifier: 'INT-789',
      });

      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('ECONNREFUSED');
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(Error) }),
          'linear-agent fetchIssueForDisplay request failed'
        );
      } else {
        expect.fail('Expected error result');
      }
    });
  });

  describe('getIssueDescription', () => {
    it('should return description when issue has one', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, {
          success: true,
          data: { description: 'Implement feature X.\n\nPlan document: docs/plans/feature-x.md' },
        });

      const result = await client.getIssueDescription({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Implement feature X.\n\nPlan document: docs/plans/feature-x.md');
      }
    });

    it('should return undefined when description is null', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-456')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, {
          success: true,
          data: { description: null },
        });

      const result = await client.getIssueDescription({
        userId: 'test-user-123',
        identifier: 'INT-456',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should return UNAVAILABLE on non-200 response', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-789')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(500, 'Internal Server Error');

      const result = await client.getIssueDescription({
        userId: 'test-user-123',
        identifier: 'INT-789',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Internal Server Error');
      }
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: false });

      const result = await client.getIssueDescription({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from linear-agent');
      }
    });

    it('should return UNAVAILABLE on request timeout', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .delay(6000)
        .reply(200, {});

      const result = await client.getIssueDescription({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Request timed out');
      }
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-123')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .replyWithError('ECONNREFUSED');

      const result = await client.getIssueDescription({
        userId: 'test-user-123',
        identifier: 'INT-123',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('ECONNREFUSED');
      }
    });
  });

  describe('fetchIssuesForDisplay', () => {
    it('should fetch multiple issues for display successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          issues: [
            {
              identifier: 'INT-123',
              title: 'First Issue',
              state: { name: 'Backlog', type: 'backlog' },
              priority: 0,
              assignee: null,
              labels: [{ id: 'label-1', name: 'backend' }],
              url: 'https://linear.app/pbuchman/issue/INT-123',
              commentCount: 1,
              lastCommentAt: '2026-03-06T10:00:00.000Z',
            },
            {
              identifier: 'INT-456',
              title: 'Second Issue',
              state: { name: 'In Progress', type: 'started' },
              priority: 2,
              assignee: { id: 'user-123', name: 'Test User' },
              labels: [],
              url: 'https://linear.app/pbuchman/issue/INT-456',
              commentCount: 0,
              lastCommentAt: null,
            },
          ],
        },
      };

      nock(baseUrl)
        .post('/internal/linear/issues/display-batch', {
          identifiers: ['INT-123', 'INT-456'],
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, mockResponse);

      const result = await (client as unknown as {
        fetchIssuesForDisplay: (request: {
          userId: string;
          identifiers: string[];
        }) => Promise<{
          ok: boolean;
          value?: { identifier: string; title: string }[];
          error?: { code: string; message: string };
        }>;
      }).fetchIssuesForDisplay({
        userId: 'test-user-123',
        identifiers: ['INT-123', 'INT-456'],
      });

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value?.map((issue) => issue.identifier)).toEqual(['INT-123', 'INT-456']);
        expect(result.value?.[0]?.title).toBe('First Issue');
      }
    });

    it('should return UNAVAILABLE when batch fetch returns non-200', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/display-batch', {
          identifiers: ['INT-999'],
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(503, 'linear-agent unavailable');

      const result = await (client as unknown as {
        fetchIssuesForDisplay: (request: {
          userId: string;
          identifiers: string[];
        }) => Promise<{
          ok: boolean;
          value?: { identifier: string; title: string }[];
          error?: { code: string; message: string };
        }>;
      }).fetchIssuesForDisplay({
        userId: 'test-user-123',
        identifiers: ['INT-999'],
      });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error?.code).toBe('UNAVAILABLE');
        expect(result.error?.message).toBe('linear-agent unavailable');
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { status: 503, error: 'linear-agent unavailable' },
        'linear-agent fetchIssuesForDisplay failed'
      );
    });

    it('should return UNKNOWN on invalid response with success false', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/display-batch', {
          identifiers: ['INT-123'],
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .reply(200, { success: false });

      const result = await (client as unknown as {
        fetchIssuesForDisplay: (request: {
          userId: string;
          identifiers: string[];
        }) => Promise<{
          ok: boolean;
          value?: { identifier: string; title: string }[];
          error?: { code: string; message: string };
        }>;
      }).fetchIssuesForDisplay({
        userId: 'test-user-123',
        identifiers: ['INT-123'],
      });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error?.code).toBe('UNKNOWN');
        expect(result.error?.message).toBe('Invalid response from linear-agent');
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        { body: { success: false } },
        'Invalid response from linear-agent'
      );
    });

    it('should return UNAVAILABLE on request timeout', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/display-batch', {
          identifiers: ['INT-123'],
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .delay(6000)
        .reply(200, {});

      const result = await (client as unknown as {
        fetchIssuesForDisplay: (request: {
          userId: string;
          identifiers: string[];
        }) => Promise<{
          ok: boolean;
          value?: { identifier: string; title: string }[];
          error?: { code: string; message: string };
        }>;
      }).fetchIssuesForDisplay({
        userId: 'test-user-123',
        identifiers: ['INT-123'],
      });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error?.code).toBe('UNAVAILABLE');
        expect(result.error?.message).toBe('Request timed out');
      }
      expect(mockLogger.error).toHaveBeenCalledWith(
        { timeoutMs: 5000 },
        'linear-agent request timed out'
      );
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .post('/internal/linear/issues/display-batch', {
          identifiers: ['INT-123'],
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('X-User-Id', 'test-user-123')
        .replyWithError('ECONNREFUSED');

      const result = await (client as unknown as {
        fetchIssuesForDisplay: (request: {
          userId: string;
          identifiers: string[];
        }) => Promise<{
          ok: boolean;
          value?: { identifier: string; title: string }[];
          error?: { code: string; message: string };
        }>;
      }).fetchIssuesForDisplay({
        userId: 'test-user-123',
        identifiers: ['INT-123'],
      });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error?.code).toBe('UNKNOWN');
        expect(result.error?.message).toContain('ECONNREFUSED');
      }
    });
  });

  describe('getIssueContext', () => {
    it('should return issue context on success', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-100/context')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            description: 'Fix the bug',
            comments: [{ body: 'comment 1', createdAt: '2026-03-20T10:00:00Z' }],
          },
        });

      const result = await client.getIssueContext({ identifier: 'INT-100' });

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value).toEqual({
          description: 'Fix the bug',
          comments: [{ body: 'comment 1', createdAt: '2026-03-20T10:00:00Z' }],
        });
      }
    });

    it('should return NOT_FOUND when linear-agent returns 404', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-404/context')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(404, 'Issue not found');

      const result = await client.getIssueContext({ identifier: 'INT-404' });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return UNAVAILABLE when linear-agent returns non-404 error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-500/context')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(500, 'Internal Server Error');

      const result = await client.getIssueContext({ identifier: 'INT-500' });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('UNAVAILABLE');
      }
    });

    it('should return UNKNOWN when response body is invalid', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-BAD/context')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, { success: false });

      const result = await client.getIssueContext({ identifier: 'INT-BAD' });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });

    it('should return UNAVAILABLE on timeout', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-TIMEOUT/context')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .delayConnection(10000)
        .reply(200, { success: true, data: { description: null, comments: [] } });

      const shortTimeoutClient = createLinearAgentHttpClient({
        baseUrl,
        internalAuthToken,
        timeoutMs: 50,
      }, mockLogger);

      const result = await shortTimeoutClient.getIssueContext({ identifier: 'INT-TIMEOUT' });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('UNAVAILABLE');
        expect(result.error.message).toBe('Request timed out');
      }
    });

    it('should return UNKNOWN on network error', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-ERR/context')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError('ECONNREFUSED');

      const result = await client.getIssueContext({ identifier: 'INT-ERR' });

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('ECONNREFUSED');
      }
    });

    it('should not send X-User-Id header', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT-100/context')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(function () {
          // Verify no X-User-Id header is sent
          expect(this.req.headers['x-user-id']).toBeUndefined();
          return [200, { success: true, data: { description: null, comments: [] } }];
        });

      await client.getIssueContext({ identifier: 'INT-100' });
    });

    it('should encode identifier in URL', async () => {
      nock(baseUrl)
        .get('/internal/linear/issues/INT%2F102/context')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { description: 'encoded', comments: [] },
        });

      const result = await client.getIssueContext({ identifier: 'INT/102' });

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.description).toBe('encoded');
      }
    });
  });
});
