import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SensitiveFileGuard } from '../services/sensitive-file-guard.js';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

// Mock child_process execSync
const mockExecSync = vi.fn();

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

describe('SensitiveFileGuard', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('should detect .env files as sensitive', async () => {
    const guard = new SensitiveFileGuard(mockLogger);
    expect(guard.isSensitive('.env')).toBe(true);
    expect(guard.isSensitive('app/.env')).toBe(true);
    expect(guard.isSensitive('app/.env.local')).toBe(true);
  });

  it('should detect credential files as sensitive', async () => {
    const guard = new SensitiveFileGuard(mockLogger);
    expect(guard.isSensitive('credentials.json')).toBe(true);
    expect(guard.isSensitive('serviceAccountKey.json')).toBe(true);
    expect(guard.isSensitive('secrets/secret.txt')).toBe(true);
  });

  it('should detect key files as sensitive', async () => {
    const guard = new SensitiveFileGuard(mockLogger);
    expect(guard.isSensitive('private.key')).toBe(true);
    expect(guard.isSensitive('id_rsa')).toBe(true);
    expect(guard.isSensitive('cert.pem')).toBe(true);
  });

  it('should allow non-sensitive files', async () => {
    const guard = new SensitiveFileGuard(mockLogger);
    expect(guard.isSensitive('src/index.ts')).toBe(false);
    expect(guard.isSensitive('package.json')).toBe(false);
    expect(guard.isSensitive('README.md')).toBe(false);
  });

  describe('checkAndRevert', () => {
    it('should return empty result when no files changed', async () => {
      const guard = new SensitiveFileGuard(mockLogger);
      mockExecSync.mockReturnValue('');

      const result = await guard.checkAndRevert('/path/to/worktree', 1);

      expect(result).toEqual({
        reverted: [],
        remaining: [],
        allSensitive: false,
      });
      expect(mockExecSync).toHaveBeenCalledWith('git diff --name-only HEAD~1 HEAD', {
        cwd: '/path/to/worktree',
        encoding: 'utf-8',
      });
    });

    it('should revert sensitive files', async () => {
      const guard = new SensitiveFileGuard(mockLogger);
      mockExecSync.mockImplementation((command) => {
        if (typeof command === 'string' && command.includes('git diff')) {
          return '.env\nsrc/index.ts\ncredentials.json\n';
        }
        return '';
      });

      const result = await guard.checkAndRevert('/path/to/worktree', 1);

      expect(result.reverted).toEqual(['.env', 'credentials.json']);
      expect(result.remaining).toEqual(['src/index.ts']);
      expect(result.allSensitive).toBe(false);
      expect(mockExecSync).toHaveBeenCalledWith('git checkout HEAD~1 -- ".env"', {
        cwd: '/path/to/worktree',
      });
      expect(mockExecSync).toHaveBeenCalledWith('git checkout HEAD~1 -- "credentials.json"', {
        cwd: '/path/to/worktree',
      });
    });

    it('should set allSensitive to true when all changed files are reverted', async () => {
      const guard = new SensitiveFileGuard(mockLogger);
      mockExecSync.mockImplementation((command) => {
        if (typeof command === 'string' && command.includes('git diff')) {
          return '.env\ncredentials.json\n';
        }
        return '';
      });

      const result = await guard.checkAndRevert('/path/to/worktree', 1);

      expect(result.reverted).toEqual(['.env', 'credentials.json']);
      expect(result.remaining).toEqual([]);
      expect(result.allSensitive).toBe(true);
    });

    it('should handle revert failures gracefully', async () => {
      const errorLogger: Logger = {
        info: () => undefined,
        warn: () => undefined,
        error: vi.fn(),
        debug: () => undefined,
      };
      const guard = new SensitiveFileGuard(errorLogger);

      mockExecSync.mockImplementation((command) => {
        if (typeof command === 'string' && command.includes('git diff')) {
          return '.env\nsrc/index.ts';
        }
        if (typeof command === 'string' && command.includes('git checkout')) {
          throw new Error('Git checkout failed');
        }
        return '';
      });

      const result = await guard.checkAndRevert('/path/to/worktree', 1);

      expect(result.reverted).toEqual([]);
      expect(result.remaining).toEqual(['.env', 'src/index.ts']);
      expect(result.allSensitive).toBe(false);
      expect(errorLogger.error).toHaveBeenCalledWith(
        { file: '.env', error: expect.any(Error) },
        'Failed to revert sensitive file'
      );
    });

    it('should handle partial revert failures', async () => {
      const errorLogger: Logger = {
        info: () => undefined,
        warn: () => undefined,
        error: vi.fn(),
        debug: () => undefined,
      };
      const guard = new SensitiveFileGuard(errorLogger);

      let checkoutCount = 0;
      mockExecSync.mockImplementation((command) => {
        if (typeof command === 'string' && command.includes('git diff')) {
          return '.env\ncredentials.json\nsrc/index.ts';
        }
        if (typeof command === 'string' && command.includes('git checkout')) {
          checkoutCount++;
          if (checkoutCount === 1) {
            return ''; // First succeeds
          }
          throw new Error('Git checkout failed');
        }
        return '';
      });

      const result = await guard.checkAndRevert('/path/to/worktree', 1);

      expect(result.reverted).toEqual(['.env']);
      expect(result.remaining).toEqual(['credentials.json', 'src/index.ts']);
      expect(result.allSensitive).toBe(false);
      expect(errorLogger.error).toHaveBeenCalledWith(
        { file: 'credentials.json', error: expect.any(Error) },
        'Failed to revert sensitive file'
      );
    });

    it('should use correct commit count in git commands', async () => {
      const guard = new SensitiveFileGuard(mockLogger);
      mockExecSync.mockReturnValue('.env\n');

      await guard.checkAndRevert('/path/to/worktree', 3);

      expect(mockExecSync).toHaveBeenCalledWith('git diff --name-only HEAD~3 HEAD', {
        cwd: '/path/to/worktree',
        encoding: 'utf-8',
      });
      expect(mockExecSync).toHaveBeenCalledWith('git checkout HEAD~3 -- ".env"', {
        cwd: '/path/to/worktree',
      });
    });
  });
});
