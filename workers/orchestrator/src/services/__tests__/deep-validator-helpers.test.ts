import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import type { Logger } from '@intexuraos/common-core';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);

const {
  extractPrNumber,
  fetchLinearIssueContext,
  fetchLinearIssueDescription,
  fetchLinearIssueContextViaCodeAgent,
  readPlanFile,
  readPlanReferencedInLinearIssue,
} = await import('../deep-validator-helpers.js');

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
});

describe('extractPrNumber', () => {
  it('extracts number from valid PR URL', () => {
    expect(extractPrNumber('https://github.com/pbuchman/intexuraos/pull/1071')).toBe(1071);
  });

  it('returns undefined for undefined input', () => {
    expect(extractPrNumber(undefined)).toBeUndefined();
  });

  it('returns undefined for URL without pull number', () => {
    expect(extractPrNumber('https://github.com/pbuchman/intexuraos')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractPrNumber('')).toBeUndefined();
  });

  it('extracts from URL with trailing path segments', () => {
    expect(extractPrNumber('https://github.com/pbuchman/intexuraos/pull/42/files')).toBe(42);
  });
});

describe('readPlanReferencedInLinearIssue', () => {
  it('returns undefined when the Linear issue does not reference a plan', async () => {
    const result = await readPlanReferencedInLinearIssue(
      '/worktree',
      {
        description: 'No plan here',
        comments: [],
      },
      mockLogger
    );

    expect(result).toBeUndefined();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('reads the exact plan referenced by the Linear issue', async () => {
    mockReadFile.mockResolvedValueOnce('# My Plan\nStep 1...');

    const result = await readPlanReferencedInLinearIssue(
      '/worktree',
      {
        description: 'Plan document: docs/plans/INT-800-design.md',
        comments: [],
      },
      mockLogger
    );

    expect(result).toBe('# My Plan\nStep 1...');
    expect(mockReadFile).toHaveBeenCalledWith('/worktree/docs/plans/INT-800-design.md', 'utf-8');
  });

  it('returns undefined when the referenced file cannot be read', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await readPlanReferencedInLinearIssue(
      '/worktree',
      {
        description: 'Plan document: docs/plans/INT-800-design.md',
        comments: [],
      },
      mockLogger
    );

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/worktree',
        planPath: 'docs/plans/INT-800-design.md',
      }),
      'Failed to read plan file from worktree'
    );
  });
});

describe('fetchLinearIssueContext', () => {
  it('returns undefined when the issue is not found', async () => {
    nock('https://api.linear.app')
      .post('/graphql')
      .reply(200, {
        data: {
          issueByIdentifier: undefined,
        },
      });

    const result = await fetchLinearIssueContext('INT-404', 'test-api-key', mockLogger);
    expect(result).toBeUndefined();
  });

  it('returns description and sorts comments newest first', async () => {
    nock('https://api.linear.app')
      .post('/graphql')
      .reply(200, {
        data: {
          issueByIdentifier: {
            description: '## Requirements\n1. Fix the bug\n2. Add tests',
            comments: {
              nodes: [
                {
                  body: 'older comment',
                  createdAt: '2026-03-08T10:00:00.000Z',
                },
                {
                  body: 'newer comment',
                  createdAt: '2026-03-09T10:00:00.000Z',
                },
              ],
            },
          },
        },
      });

    const result = await fetchLinearIssueContext('INT-123', 'test-api-key', mockLogger);
    expect(result).toEqual({
      description: '## Requirements\n1. Fix the bug\n2. Add tests',
      comments: [
        { body: 'newer comment', createdAt: '2026-03-09T10:00:00.000Z' },
        { body: 'older comment', createdAt: '2026-03-08T10:00:00.000Z' },
      ],
    });
  });

  it('filters empty comment bodies and falls back to blank createdAt when missing', async () => {
    nock('https://api.linear.app')
      .post('/graphql')
      .reply(200, {
        data: {
          issueByIdentifier: {
            description: null,
            comments: {
              nodes: [
                {
                  body: '',
                  createdAt: '2026-03-09T10:00:00.000Z',
                },
                {
                  body: 'kept comment',
                  createdAt: null,
                },
              ],
            },
          },
        },
      });

    const result = await fetchLinearIssueContext('INT-124', 'test-api-key', mockLogger);
    expect(result).toEqual({
      description: undefined,
      comments: [
        {
          body: 'kept comment',
          createdAt: '',
        },
      ],
    });
  });

  it('sorts invalid timestamps after valid ones', async () => {
    nock('https://api.linear.app')
      .post('/graphql')
      .reply(200, {
        data: {
          issueByIdentifier: {
            description: 'Only description',
            comments: {
              nodes: [
                {
                  body: 'invalid timestamp',
                  createdAt: 'not-a-date',
                },
                {
                  body: 'valid timestamp',
                  createdAt: '2026-03-10T10:00:00.000Z',
                },
              ],
            },
          },
        },
      });

    const result = await fetchLinearIssueContext('INT-126', 'test-api-key', mockLogger);
    expect(result).toEqual({
      description: 'Only description',
      comments: [
        {
          body: 'valid timestamp',
          createdAt: '2026-03-10T10:00:00.000Z',
        },
        {
          body: 'invalid timestamp',
          createdAt: 'not-a-date',
        },
      ],
    });
  });

  it('treats missing comments as an empty list', async () => {
    nock('https://api.linear.app')
      .post('/graphql')
      .reply(200, {
        data: {
          issueByIdentifier: {
            description: 'Only description',
            comments: null,
          },
        },
      });

    const result = await fetchLinearIssueContext('INT-125', 'test-api-key', mockLogger);
    expect(result).toEqual({
      description: 'Only description',
      comments: [],
    });
  });

  it('returns undefined on API error', async () => {
    nock('https://api.linear.app').post('/graphql').reply(500, 'Internal Server Error');

    const result = await fetchLinearIssueContext('INT-789', 'test-api-key', mockLogger);
    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-789' }),
      expect.stringContaining('Failed to fetch Linear issue context')
    );
  });
});

describe('fetchLinearIssueDescription', () => {
  it('returns description on successful response', async () => {
    nock('https://api.linear.app')
      .post('/graphql')
      .reply(200, {
        data: {
          issueByIdentifier: {
            description: '## Requirements\n1. Fix the bug\n2. Add tests',
            comments: {
              nodes: [],
            },
          },
        },
      });

    const result = await fetchLinearIssueDescription('INT-123', 'test-api-key', mockLogger);
    expect(result).toBe('## Requirements\n1. Fix the bug\n2. Add tests');
  });

  it('returns undefined when issue has no description', async () => {
    nock('https://api.linear.app')
      .post('/graphql')
      .reply(200, {
        data: {
          issueByIdentifier: {
            description: null,
            comments: {
              nodes: [],
            },
          },
        },
      });

    const result = await fetchLinearIssueDescription('INT-456', 'test-api-key', mockLogger);
    expect(result).toBeUndefined();
  });

  it('returns undefined on API error', async () => {
    nock('https://api.linear.app').post('/graphql').reply(500, 'Internal Server Error');

    const result = await fetchLinearIssueDescription('INT-789', 'test-api-key', mockLogger);
    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-789' }),
      expect.stringContaining('Failed to fetch Linear issue context')
    );
  });

  it('returns undefined when request times out', async () => {
    nock('https://api.linear.app')
      .post('/graphql')
      .delayConnection(200)
      .reply(200, {
        data: { issueByIdentifier: { description: 'too late', comments: { nodes: [] } } },
      });

    const result = await fetchLinearIssueDescription('INT-TIMEOUT', 'test-api-key', mockLogger, 50);
    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-TIMEOUT' }),
      'Failed to fetch Linear issue context'
    );
  });

  it('returns undefined on network error', async () => {
    nock('https://api.linear.app').post('/graphql').replyWithError('connect ECONNREFUSED');

    const result = await fetchLinearIssueDescription('INT-000', 'test-api-key', mockLogger);
    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-000' }),
      expect.stringContaining('Failed to fetch Linear issue context')
    );
  });
});

describe('fetchLinearIssueContextViaCodeAgent', () => {
  const codeAgentUrl = 'http://localhost:8080';
  const authToken = 'test-internal-auth-token';

  it('returns description, comments, and planDocumentPath on success', async () => {
    nock(codeAgentUrl)
      .get('/internal/linear/issue-context/INT-100')
      .matchHeader('X-Internal-Auth', authToken)
      .reply(200, {
        description: 'Fix the bug',
        comments: [
          { body: 'comment 1', createdAt: '2026-03-08T10:00:00.000Z' },
          { body: 'comment 2', createdAt: '2026-03-09T10:00:00.000Z' },
        ],
        planDocumentPath: 'docs/plans/INT-100-design.md',
      });

    const result = await fetchLinearIssueContextViaCodeAgent(
      'INT-100',
      { codeAgentUrl, internalAuthToken: authToken },
      mockLogger
    );

    expect(result).toEqual({
      description: 'Fix the bug',
      comments: [
        { body: 'comment 1', createdAt: '2026-03-08T10:00:00.000Z' },
        { body: 'comment 2', createdAt: '2026-03-09T10:00:00.000Z' },
      ],
      planDocumentPath: 'docs/plans/INT-100-design.md',
    });
  });

  it('returns null fields when response omits optional properties', async () => {
    nock(codeAgentUrl).get('/internal/linear/issue-context/INT-101').reply(200, {});

    const result = await fetchLinearIssueContextViaCodeAgent(
      'INT-101',
      { codeAgentUrl, internalAuthToken: authToken },
      mockLogger
    );

    expect(result).toEqual({
      description: null,
      comments: [],
      planDocumentPath: null,
    });
  });

  it('returns undefined when code-agent returns 404', async () => {
    nock(codeAgentUrl)
      .get('/internal/linear/issue-context/INT-404')
      .reply(404, { error: 'Not found' });

    const result = await fetchLinearIssueContextViaCodeAgent(
      'INT-404',
      { codeAgentUrl, internalAuthToken: authToken },
      mockLogger
    );

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-404', status: 404 }),
      'Failed to fetch Linear issue context via code-agent'
    );
  });

  it('returns undefined when code-agent is unreachable', async () => {
    nock(codeAgentUrl)
      .get('/internal/linear/issue-context/INT-500')
      .replyWithError('connect ECONNREFUSED');

    const result = await fetchLinearIssueContextViaCodeAgent(
      'INT-500',
      { codeAgentUrl, internalAuthToken: authToken },
      mockLogger
    );

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-500' }),
      'Failed to fetch Linear issue context via code-agent'
    );
  });

  it('returns undefined when request times out', async () => {
    nock(codeAgentUrl)
      .get('/internal/linear/issue-context/INT-TIMEOUT')
      .delayConnection(200)
      .reply(200, { description: 'too late' });

    const result = await fetchLinearIssueContextViaCodeAgent(
      'INT-TIMEOUT',
      { codeAgentUrl, internalAuthToken: authToken, timeoutMs: 50 },
      mockLogger
    );

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-TIMEOUT' }),
      'Failed to fetch Linear issue context via code-agent'
    );
  });

  it('encodes identifier with special characters in URL', async () => {
    nock(codeAgentUrl)
      .get('/internal/linear/issue-context/INT%2F102')
      .reply(200, { description: 'encoded' });

    const result = await fetchLinearIssueContextViaCodeAgent(
      'INT/102',
      { codeAgentUrl, internalAuthToken: authToken },
      mockLogger
    );

    expect(result).toEqual({
      description: 'encoded',
      comments: [],
      planDocumentPath: null,
    });
  });

  it('defaults missing comment fields to empty strings', async () => {
    nock(codeAgentUrl)
      .get('/internal/linear/issue-context/INT-PARTIAL')
      .reply(200, {
        description: 'partial data',
        comments: [{ body: 'has body' }, { createdAt: '2026-03-10T00:00:00Z' }, {}],
        planDocumentPath: null,
      });

    const result = await fetchLinearIssueContextViaCodeAgent(
      'INT-PARTIAL',
      { codeAgentUrl, internalAuthToken: authToken },
      mockLogger
    );

    expect(result).toEqual({
      description: 'partial data',
      comments: [
        { body: 'has body', createdAt: '' },
        { body: '', createdAt: '2026-03-10T00:00:00Z' },
        { body: '', createdAt: '' },
      ],
      planDocumentPath: null,
    });
  });
});

describe('readPlanFile', () => {
  it('reads file from worktree path', async () => {
    mockReadFile.mockResolvedValueOnce('# Plan\nStep 1...');

    const result = await readPlanFile('/worktree', 'docs/plans/INT-100.md', mockLogger);

    expect(result).toBe('# Plan\nStep 1...');
    expect(mockReadFile).toHaveBeenCalledWith('/worktree/docs/plans/INT-100.md', 'utf-8');
  });

  it('returns undefined when file does not exist', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await readPlanFile('/worktree', 'docs/plans/missing.md', mockLogger);

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/worktree',
        planPath: 'docs/plans/missing.md',
      }),
      'Failed to read plan file from worktree'
    );
  });
});
