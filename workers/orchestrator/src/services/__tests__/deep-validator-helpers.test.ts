import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  glob: vi.fn(),
}));

import { readFile, glob } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockGlob = vi.mocked(glob);

const { extractPrNumber, findPlanOnBranch } = await import('../deep-validator-helpers.js');

beforeEach(() => {
  vi.clearAllMocks();
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

    const result = await findPlanOnBranch('/worktree');
    expect(result).toBe('# My Plan\nStep 1...');
  });

  it('returns undefined when no plan files exist', async () => {
    async function* fakeGlob(): AsyncGenerator<string> {
      // yield nothing
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);

    const result = await findPlanOnBranch('/worktree');
    expect(result).toBeUndefined();
  });

  it('returns the last (most recent) plan when multiple exist', async () => {
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/worktree/docs/plans/2026-03-01-old.md';
      yield '/worktree/docs/plans/2026-03-09-new.md';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce('new plan');

    const result = await findPlanOnBranch('/worktree');
    expect(result).toBe('new plan');
  });

  it('returns undefined when glob throws', async () => {
    mockGlob.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    const result = await findPlanOnBranch('/nonexistent');
    expect(result).toBeUndefined();
  });
});
