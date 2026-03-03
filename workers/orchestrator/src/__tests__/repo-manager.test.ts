import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Mock execFileAsync function - will be configured per test
// Signature: (file: string, args: string[], options?: {cwd?: string}) => Promise<{stdout, stderr}>
let mockExecFileAsyncImpl: (
  file: string,
  args: string[],
  options?: { cwd?: string }
) => Promise<{ stdout: string; stderr: string }>;

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util');
  return {
    ...actual,
    promisify: vi.fn((_fn: unknown) => {
      return (
        file: string,
        args: string[],
        options?: { cwd?: string }
      ): Promise<{ stdout: string; stderr: string }> => mockExecFileAsyncImpl(file, args, options);
    }),
  };
});

// Import after mock is set up
let RepoManager: typeof import('../services/repo-manager.js');

const loadRepoManager = async (): Promise<typeof import('../services/repo-manager.js')> => {
  if (!RepoManager) {
    RepoManager = await import('../services/repo-manager.js');
  }
  return RepoManager;
};

describe('RepoManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'repo-manager-test-'));
    vi.clearAllMocks();

    // Default mock implementation - successful git commands
    mockExecFileAsyncImpl = async (
      file: string,
      args: string[],
      _options?: { cwd?: string }
    ): Promise<{ stdout: string; stderr: string }> => {
      if (file === 'git' && args[0] === 'clone') {
        return { stdout: '', stderr: '' };
      }
      if (file === 'git' && args[0] === 'fetch') {
        return { stdout: '', stderr: '' };
      }
      if (file === 'git' && args[0] === 'remote') {
        return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('urlsMatch', () => {
    it('should normalize HTTPS URL with .git suffix', async () => {
      const { urlsMatch } = await loadRepoManager();

      expect(urlsMatch('https://github.com/x/y.git', 'https://github.com/x/y')).toBe(true);
    });

    it('should normalize git@ SSH URL to HTTPS', async () => {
      const { urlsMatch } = await loadRepoManager();

      expect(urlsMatch('git@github.com:x/y', 'https://github.com/x/y')).toBe(true);
    });

    it('should be case-insensitive for URL comparison', async () => {
      const { urlsMatch } = await loadRepoManager();

      expect(urlsMatch('HTTPS://GitHub.com/X/Y', 'https://github.com/x/y')).toBe(true);
    });

    it('should return false for different repos', async () => {
      const { urlsMatch } = await loadRepoManager();

      expect(urlsMatch('https://github.com/a/b', 'https://github.com/x/y')).toBe(false);
    });

    it('should handle both URLs with .git suffix', async () => {
      const { urlsMatch } = await loadRepoManager();

      expect(urlsMatch('https://github.com/x/y.git', 'https://github.com/x/y.git')).toBe(true);
    });

    it('should handle SSH to SSH comparison', async () => {
      const { urlsMatch } = await loadRepoManager();

      expect(urlsMatch('git@github.com:x/y.git', 'git@github.com:x/y')).toBe(true);
    });
  });

  describe('validateRepository', () => {
    it('should throw when path exists but is not a git repository', async () => {
      const { validateRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'not-a-repo');
      mkdirSync(repoPath, { recursive: true });

      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).rejects.toThrow('is not a git repository');
    });

    it('should throw when path is a worktree not a main clone', async () => {
      const { validateRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'worktree');
      mkdirSync(repoPath, { recursive: true });
      // Worktrees have .git as a FILE, not a directory
      writeFileSync(join(repoPath, '.git'), 'gitdir: /some/other/path/.git/worktrees/foo');

      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).rejects.toThrow('appears to be a worktree');
    });

    it('should throw when remote origin does not match expected URL', async () => {
      const { validateRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'wrong-remote');
      mkdirSync(join(repoPath, '.git'), { recursive: true });

      // Mock returns different URL
      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => ({
        stdout: 'https://github.com/other/repo.git\n',
        stderr: '',
      });

      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).rejects.toThrow('has wrong remote origin');
    });

    it('should throw when git remote get-url fails', async () => {
      const { validateRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'no-origin');
      mkdirSync(join(repoPath, '.git'), { recursive: true });

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error("fatal: No such remote 'origin'");
      };

      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).rejects.toThrow('Failed to get remote origin URL');
    });

    it('should throw when package.json name is not intexuraos', async () => {
      const { validateRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'wrong-package');
      mkdirSync(join(repoPath, '.git'), { recursive: true });
      writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ name: 'other-project' }));

      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).rejects.toThrow('does not appear to be IntexuraOS');
    });

    it('should throw when package.json is malformed', async () => {
      const { validateRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'malformed-package');
      mkdirSync(join(repoPath, '.git'), { recursive: true });
      writeFileSync(join(repoPath, 'package.json'), '{ invalid json }');

      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).rejects.toThrow('Failed to read or parse package.json');
    });

    it('should pass validation when package.json is missing', async () => {
      const { validateRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'no-package-json');
      mkdirSync(join(repoPath, '.git'), { recursive: true });

      // Should not throw
      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).resolves.toBeUndefined();
    });

    it('should pass validation when everything is correct', async () => {
      const { validateRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'valid-repo');
      mkdirSync(join(repoPath, '.git'), { recursive: true });
      writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ name: 'intexuraos' }));

      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).resolves.toBeUndefined();
    });
  });

  describe('cloneRepository', () => {
    it('should clone repository successfully', async () => {
      const { cloneRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'new-clone');

      let cloneArgs: string[] = [];
      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        cloneArgs = args;
        return { stdout: '', stderr: '' };
      };

      await cloneRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger);

      expect(cloneArgs[0]).toBe('clone');
      expect(cloneArgs[1]).toBe('https://github.com/pbuchman/intexuraos.git');
      expect(cloneArgs[2]).toBe(repoPath);
    });

    it('should handle clone failure gracefully', async () => {
      const { cloneRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'failed-clone');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('fatal: repository not found');
      };

      await expect(
        cloneRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow('Failed to clone repository');
    });

    it('should include original error message in clone failure', async () => {
      const { cloneRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'failed-clone-2');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('permission denied');
      };

      await expect(
        cloneRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow('permission denied');
    });

    it('should include stderr in error message when available', async () => {
      const { cloneRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'failed-clone-stderr');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        const error = new Error('Command failed') as Error & { stderr: string };
        error.stderr = 'Cloning into: Permission denied';
        throw error;
      };

      await expect(
        cloneRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow('Git output: Cloning into: Permission denied');
    });

    it('should log error with context before throwing', async () => {
      const { cloneRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'failed-clone-log');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('network error');
      };

      await expect(
        cloneRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://github.com/pbuchman/intexuraos.git',
          path: repoPath,
        }),
        'Failed to clone repository'
      );
    });
  });

  describe('fetchRemote', () => {
    it('should fetch from remote successfully', async () => {
      const { fetchRemote } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-to-fetch');
      mkdirSync(repoPath, { recursive: true });

      let fetchArgs: string[] = [];
      let fetchCwd = '';
      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[],
        options?: { cwd?: string }
      ): Promise<{ stdout: string; stderr: string }> => {
        fetchArgs = args;
        fetchCwd = options?.cwd ?? '';
        return { stdout: '', stderr: '' };
      };

      await fetchRemote(repoPath, mockLogger);

      expect(fetchArgs).toEqual(['fetch', 'origin']);
      expect(fetchCwd).toBe(repoPath);
    });

    it('should handle fetch failure gracefully', async () => {
      const { fetchRemote } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-fetch-fail');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('Could not resolve host: github.com');
      };

      await expect(fetchRemote(repoPath, mockLogger)).rejects.toThrow(
        'Failed to fetch from remote'
      );
    });

    it('should include original error message in fetch failure', async () => {
      const { fetchRemote } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-fetch-fail-2');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('network timeout');
      };

      await expect(fetchRemote(repoPath, mockLogger)).rejects.toThrow('network timeout');
    });

    it('should include stderr in error message when available', async () => {
      const { fetchRemote } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-fetch-stderr');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        const error = new Error('Command failed') as Error & { stderr: string };
        error.stderr = 'fatal: Could not read from remote repository';
        throw error;
      };

      await expect(fetchRemote(repoPath, mockLogger)).rejects.toThrow(
        'Git output: fatal: Could not read from remote repository'
      );
    });

    it('should log error with context before throwing', async () => {
      const { fetchRemote } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-fetch-log');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('network error');
      };

      await expect(fetchRemote(repoPath, mockLogger)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          path: repoPath,
        }),
        'Failed to fetch from remote'
      );
    });
  });

  describe('cleanWorktree', () => {
    it('should run git reset --hard origin/development and git clean -df', async () => {
      const { cleanWorktree } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-to-clean');
      mkdirSync(repoPath, { recursive: true });

      const commands: string[][] = [];
      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        commands.push(args);
        return { stdout: '', stderr: '' };
      };

      await cleanWorktree(repoPath, mockLogger);

      expect(commands).toEqual([
        ['reset', '--hard', 'origin/development'],
        ['clean', '-df'],
      ]);
    });

    it('should throw when git reset fails', async () => {
      const { cleanWorktree } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-clean-fail');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('reset failed');
      };

      await expect(cleanWorktree(repoPath, mockLogger)).rejects.toThrow('Failed to clean worktree');
    });

    it('should include stderr in error when available', async () => {
      const { cleanWorktree } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-clean-stderr');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        const error = new Error('Command failed') as Error & { stderr: string };
        error.stderr = 'fatal: not a git repository';
        throw error;
      };

      await expect(cleanWorktree(repoPath, mockLogger)).rejects.toThrow(
        'Git output: fatal: not a git repository'
      );
    });
  });

  describe('ensureRepository', () => {
    it('should clone repository when path does not exist', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'fresh-clone');

      let cloneCalled = false;
      mockExecFileAsyncImpl = async (
        file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        if (file === 'git' && args[0] === 'clone') {
          cloneCalled = true;
        }
        return { stdout: '', stderr: '' };
      };

      await ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger);

      expect(cloneCalled).toBe(true);
    });

    it('should validate, fetch, and clean when path exists with correct repo', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'existing-repo');
      mkdirSync(join(repoPath, '.git'), { recursive: true });
      writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ name: 'intexuraos' }));

      const callOrder: string[] = [];
      mockExecFileAsyncImpl = async (
        file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        if (file === 'git' && args[0] === 'reset') {
          callOrder.push('reset');
        }
        if (file === 'git' && args[0] === 'clean') {
          callOrder.push('clean');
        }
        if (file === 'git' && args[0] === 'fetch') {
          callOrder.push('fetch');
        }
        if (file === 'git' && args[0] === 'remote') {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      await ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger);

      expect(callOrder).toEqual(['fetch', 'reset', 'clean']);
    });

    it('should throw validation error for invalid repository', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'invalid-repo');
      mkdirSync(repoPath, { recursive: true });
      // No .git directory - not a git repo

      await expect(
        ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow('is not a git repository');
    });

    it('should log error when validation fails', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'invalid-repo-log');
      mkdirSync(repoPath, { recursive: true });

      await expect(
        ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          path: repoPath,
          url: 'https://github.com/pbuchman/intexuraos.git',
        }),
        'Repository validation or fetch failed'
      );
    });

    it('should log error when clone fails', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'clone-fail-log');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('clone failed');
      };

      await expect(
        ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow();

      // ensureRepository logs error at high level
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          path: repoPath,
          url: 'https://github.com/pbuchman/intexuraos.git',
        }),
        'Repository clone failed'
      );
    });

    it('should create parent directories when cloning', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'nested', 'path', 'repo');

      await ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger);

      // Parent directory should be created
      expect(existsSync(join(tempDir, 'nested', 'path'))).toBe(true);
    });
  });
});
