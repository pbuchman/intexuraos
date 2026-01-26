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
        id: 'issue-123',
        identifier: 'INT-123',
        title: 'Test Issue',
        url: 'https://linear.app/intexuraos/issue/INT-123',
      };

      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, mockResponse);

      const result = await client.createIssue({
        title: 'Test Issue',
        description: 'Test description',
      });

      if (result.ok) {
        expect(result.value.issueId).toBe('issue-123');
        expect(result.value.issueIdentifier).toBe('INT-123');
        expect(result.value.issueTitle).toBe('Test Issue');
        expect(result.value.issueUrl).toBe('https://linear.app/intexuraos/issue/INT-123');
        expect(mockLogger.info).toHaveBeenCalledWith(
          { issueId: 'issue-123', identifier: 'INT-123' },
          'Linear issue created'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('should include default label Code Task when labels not provided', async () => {
      const mockResponse = {
        id: 'issue-456',
        identifier: 'INT-456',
        title: 'Test Issue',
        url: 'https://linear.app/intexuraos/issue/INT-456',
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
        title: 'Test Issue',
        description: 'Test description',
      });

      expect(capturedBody).toEqual({
        title: 'Test Issue',
        description: 'Test description',
        labels: ['Code Task'],
      });
    });

    it('should return UNAVAILABLE on 500 error', async () => {
      nock(baseUrl)
        .post('/internal/issues')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(500, 'Internal Server Error');

      const result = await client.createIssue({
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
        .reply(429, 'Too Many Requests');

      const result = await client.createIssue({
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
        .reply(400, 'Bad Request');

      const result = await client.createIssue({
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
        .delay(6000)
        .reply(200, {});

      const result = await client.createIssue({
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
        .replyWithError('ECONNREFUSED');

      const result = await client.createIssue({
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
        .reply(200, {
          id: 'issue-789',
          identifier: 'INT-789',
          title: 'My Title',
          url: 'https://linear.app/intexuraos/issue/INT-789',
        });

      await client.createIssue({
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
        .reply(200);

      const result = await client.updateIssueState({
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
        .reply(200);

      const result = await client.updateIssueState({
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
        .reply(500, 'Internal Server Error');

      const result = await client.updateIssueState({
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
        .reply(200);

      await client.updateIssueState({
        issueId: 'test-issue',
        state: 'qa',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        { issueId: 'test-issue', state: 'qa' },
        'Updating Linear issue state'
      );
    });
  });
});
