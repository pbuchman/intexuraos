import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import type { Logger } from '@intexuraos/common-core';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  glob: vi.fn(),
}));

import { readFile, glob } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockGlob = vi.mocked(glob);

const { extractPrNumber, findPlanOnBranch, fetchLinearIssueDescription } =
  await import('../deep-validator-helpers.js');

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

describe('findPlanOnBranch', () => {
  it('returns plan content when plan file exists', async () => {
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/worktree/docs/plans/2026-03-09-feature.md';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce('# My Plan\nStep 1...');

    const result = await findPlanOnBranch('/worktree', mockLogger);
    expect(result).toBe('# My Plan\nStep 1...');
  });

  it('returns undefined when no plan files exist', async () => {
    async function* fakeGlob(): AsyncGenerator<string> {
      // yield nothing
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);

    const result = await findPlanOnBranch('/worktree', mockLogger);
    expect(result).toBeUndefined();
  });

  it('returns the last (most recent) plan when multiple exist', async () => {
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/worktree/docs/plans/2026-03-01-old.md';
      yield '/worktree/docs/plans/2026-03-09-new.md';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce('new plan');

    const result = await findPlanOnBranch('/worktree', mockLogger);
    expect(result).toBe('new plan');
  });

  it('returns undefined when glob throws', async () => {
    mockGlob.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    const result = await findPlanOnBranch('/nonexistent', mockLogger);
    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: '/nonexistent' }),
      'Failed to find plan on branch'
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
      expect.stringContaining('Failed to fetch Linear issue description')
    );
  });

  it('returns undefined on network error', async () => {
    nock('https://api.linear.app').post('/graphql').replyWithError('connect ECONNREFUSED');

    const result = await fetchLinearIssueDescription('INT-000', 'test-api-key', mockLogger);
    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-000' }),
      expect.stringContaining('Failed to fetch Linear issue description')
    );
  });
});
