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

  describe('normalizeUrl', () => {
    it('should return plain HTTPS URL lowercased with no changes', async () => {
      const { normalizeUrl } = await loadRepoManager();
      expect(normalizeUrl('https://github.com/x/y')).toBe('https://github.com/x/y');
    });

    it('should strip .git suffix from HTTPS URL', async () => {
      const { normalizeUrl } = await loadRepoManager();
      expect(normalizeUrl('https://github.com/x/y.git')).toBe('https://github.com/x/y');
    });

    it('should convert SSH git@ URL to HTTPS', async () => {
      const { normalizeUrl } = await loadRepoManager();
      expect(normalizeUrl('git@github.com:x/y.git')).toBe('https://github.com/x/y');
    });

    it('should lowercase mixed-case HTTPS URL', async () => {
      const { normalizeUrl } = await loadRepoManager();
      expect(normalizeUrl('HTTPS://GitHub.com/X/Y')).toBe('https://github.com/x/y');
    });

    it('should strip embedded credentials from authenticated HTTPS URL', async () => {
      const { normalizeUrl } = await loadRepoManager();
      expect(
        normalizeUrl('https://x-access-token:ghs_TOKEN@github.com/pbuchman/intexuraos.git')
      ).toBe('https://github.com/pbuchman/intexuraos');
    });

    it('should strip credentials from authenticated URL without .git suffix', async () => {
      const { normalizeUrl } = await loadRepoManager();
      expect(normalizeUrl('https://x-access-token:ghs_TOKEN@github.com/pbuchman/intexuraos')).toBe(
        'https://github.com/pbuchman/intexuraos'
      );
    });

    it('should fall back to toLowerCase when URL parsing fails for malformed input', async () => {
      const { normalizeUrl } = await loadRepoManager();
      expect(normalizeUrl('notaurl')).toBe('notaurl');
    });
  });

  describe('urlsMatch', () => {
    it('should match authenticated URL against clean URL (regression: orchestrator crash on restart)', async () => {
      const { urlsMatch } = await loadRepoManager();
      expect(
        urlsMatch(
          'https://x-access-token:ghs_TOKEN@github.com/pbuchman/intexuraos.git',
          'https://github.com/pbuchman/intexuraos.git'
        )
      ).toBe(true);
    });

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

    it('should include "Unknown error" when git remote get-url rejects with a non-Error', async () => {
      const { validateRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'non-error-origin');
      mkdirSync(join(repoPath, '.git'), { recursive: true });

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw 'string rejection';
      };

      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).rejects.toThrow('Unknown error');
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

    it('should include "Unknown error" when clone rejects with an object without message', async () => {
      const { cloneRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'failed-clone-no-msg');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw { code: 128 };
      };

      await expect(
        cloneRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow('Failed to clone repository: Unknown error');
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

    it('should include "Unknown error" when fetch rejects with an object without message', async () => {
      const { fetchRemote } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-fetch-no-msg');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw { code: 128 };
      };

      await expect(fetchRemote(repoPath, mockLogger)).rejects.toThrow(
        'Failed to fetch from remote: Unknown error'
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

    it('should include "Unknown error" when clean rejects with an object without message', async () => {
      const { cleanWorktree } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-clean-no-msg');

      mockExecFileAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw { code: 128 };
      };

      await expect(cleanWorktree(repoPath, mockLogger)).rejects.toThrow(
        'Failed to clean worktree: Unknown error'
      );
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

  describe('sanitizeRepoConfig', () => {
    it('should reset remote URL when it contains embedded credentials', async () => {
      const { sanitizeRepoConfig } = await loadRepoManager();
      const repoPath = join(tempDir, 'stale-creds');
      mkdirSync(repoPath, { recursive: true });

      const calls: string[][] = [];
      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        calls.push(args);
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') {
          return {
            stdout: 'https://x-access-token:ghs_TOKEN@github.com/pbuchman/intexuraos.git\n',
            stderr: '',
          };
        }
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'http.extraheader') {
          throw new Error('exit code 1');
        }
        return { stdout: '', stderr: '' };
      };

      await sanitizeRepoConfig(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger);

      const setUrlCall = calls.find(
        (c) => c[0] === 'remote' && c[1] === 'set-url' && c[2] === 'origin'
      );
      expect(setUrlCall).toBeDefined();
      expect(setUrlCall?.[3]).toBe('https://github.com/pbuchman/intexuraos.git');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          currentUrl: expect.any(String),
          expectedUrl: expect.any(String),
        }),
        expect.stringContaining('Remote origin URL differs from expected')
      );
    });

    it('should not modify remote URL when it matches expected URL exactly', async () => {
      const { sanitizeRepoConfig } = await loadRepoManager();
      const repoPath = join(tempDir, 'clean-url');
      mkdirSync(repoPath, { recursive: true });

      const calls: string[][] = [];
      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        calls.push(args);
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'http.extraheader') {
          throw new Error('exit code 1');
        }
        return { stdout: '', stderr: '' };
      };

      await sanitizeRepoConfig(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger);

      const setUrlCall = calls.find((c) => c[0] === 'remote' && c[1] === 'set-url');
      expect(setUrlCall).toBeUndefined();
    });

    it('should remove http.extraheader when present', async () => {
      const { sanitizeRepoConfig } = await loadRepoManager();
      const repoPath = join(tempDir, 'extra-header');
      mkdirSync(repoPath, { recursive: true });

      const calls: string[][] = [];
      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        calls.push(args);
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'http.extraheader') {
          return { stdout: 'Authorization: token ghs_EXPIRED\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      await sanitizeRepoConfig(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger);

      const unsetCall = calls.find(
        (c) => c[0] === 'config' && c[1] === '--unset' && c[2] === 'http.extraheader'
      );
      expect(unsetCall).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ path: repoPath }),
        'Found http.extraheader in repo git config, removing'
      );
    });

    it('should not throw when config --get remote.origin.url fails', async () => {
      const { sanitizeRepoConfig } = await loadRepoManager();
      const repoPath = join(tempDir, 'url-get-fail');
      mkdirSync(repoPath, { recursive: true });

      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        if (args[0] === 'config' && args[1] === '--get') {
          throw new Error('git config failed');
        }
        return { stdout: '', stderr: '' };
      };

      await expect(
        sanitizeRepoConfig(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).resolves.toBeUndefined();
    });

    it('should not throw when config --get http.extraheader exits non-zero (key absent)', async () => {
      const { sanitizeRepoConfig } = await loadRepoManager();
      const repoPath = join(tempDir, 'no-extraheader');
      mkdirSync(repoPath, { recursive: true });

      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'http.extraheader') {
          throw new Error('exit code 1');
        }
        return { stdout: '', stderr: '' };
      };

      await expect(
        sanitizeRepoConfig(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).resolves.toBeUndefined();
    });

    it('should not unset http.extraheader when config --get returns empty string', async () => {
      const { sanitizeRepoConfig } = await loadRepoManager();
      const repoPath = join(tempDir, 'empty-extraheader');
      mkdirSync(repoPath, { recursive: true });

      const calls: string[][] = [];
      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        calls.push(args);
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'http.extraheader') {
          return { stdout: '\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      await sanitizeRepoConfig(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger);

      const unsetCall = calls.find(
        (c) => c[0] === 'config' && c[1] === '--unset' && c[2] === 'http.extraheader'
      );
      expect(unsetCall).toBeUndefined();
    });

    it('should handle both URL sanitization and extraheader removal', async () => {
      const { sanitizeRepoConfig } = await loadRepoManager();
      const repoPath = join(tempDir, 'both-dirty');
      mkdirSync(repoPath, { recursive: true });

      const calls: string[][] = [];
      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        calls.push(args);
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') {
          return {
            stdout: 'https://x-access-token:ghs_TOKEN@github.com/pbuchman/intexuraos.git\n',
            stderr: '',
          };
        }
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'http.extraheader') {
          return { stdout: 'Authorization: token ghs_EXPIRED\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      await sanitizeRepoConfig(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger);

      const setUrlCall = calls.find((c) => c[0] === 'remote' && c[1] === 'set-url');
      const unsetCall = calls.find(
        (c) => c[0] === 'config' && c[1] === '--unset' && c[2] === 'http.extraheader'
      );
      expect(setUrlCall).toBeDefined();
      expect(unsetCall).toBeDefined();
    });

    it('should not throw when config --unset http.extraheader fails', async () => {
      const { sanitizeRepoConfig } = await loadRepoManager();
      const repoPath = join(tempDir, 'unset-fail');
      mkdirSync(repoPath, { recursive: true });

      mockExecFileAsyncImpl = async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        if (args[0] === 'config' && args[1] === '--get' && args[2] === 'http.extraheader') {
          return { stdout: 'Authorization: token ghs_EXPIRED\n', stderr: '' };
        }
        if (args[0] === 'config' && args[1] === '--unset') {
          throw new Error('unset failed');
        }
        return { stdout: '', stderr: '' };
      };

      await expect(
        sanitizeRepoConfig(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ path: repoPath }),
        'Failed to unset http.extraheader'
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

    it('should validate, sanitize, fetch, and clean when path exists with correct repo', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'existing-repo');
      mkdirSync(join(repoPath, '.git'), { recursive: true });
      writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ name: 'intexuraos' }));

      const callOrder: string[] = [];
      mockExecFileAsyncImpl = async (
        file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        if (
          file === 'git' &&
          args[0] === 'config' &&
          args[1] === '--get' &&
          args[2] === 'remote.origin.url'
        ) {
          callOrder.push('sanitize-url');
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        if (
          file === 'git' &&
          args[0] === 'config' &&
          args[1] === '--get' &&
          args[2] === 'http.extraheader'
        ) {
          throw new Error('exit code 1');
        }
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

      expect(callOrder).toEqual(['sanitize-url', 'fetch', 'reset', 'clean']);
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
        'Repository validation failed'
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

    it('should continue when fetchRemote fails but cleanWorktree succeeds', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'fetch-fail-clean-ok');
      mkdirSync(join(repoPath, '.git'), { recursive: true });
      writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ name: 'intexuraos' }));

      mockExecFileAsyncImpl = async (
        file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        if (file === 'git' && args[0] === 'config' && args[1] === '--get') {
          if (args[2] === 'remote.origin.url') {
            return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
          }
          throw new Error('exit code 1');
        }
        if (file === 'git' && args[0] === 'remote') {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        if (file === 'git' && args[0] === 'fetch') {
          throw new Error('Could not resolve host: github.com');
        }
        return { stdout: '', stderr: '' };
      };

      await expect(
        ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ path: repoPath }),
        'Fetch failed, continuing with existing local state'
      );
    });

    it('should throw when both fetchRemote and cleanWorktree fail', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'fetch-fail-clean-fail');
      mkdirSync(join(repoPath, '.git'), { recursive: true });
      writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ name: 'intexuraos' }));

      mockExecFileAsyncImpl = async (
        file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        if (file === 'git' && args[0] === 'config' && args[1] === '--get') {
          if (args[2] === 'remote.origin.url') {
            return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
          }
          throw new Error('exit code 1');
        }
        if (file === 'git' && args[0] === 'remote') {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        if (file === 'git' && args[0] === 'fetch') {
          throw new Error('Could not resolve host: github.com');
        }
        if (file === 'git' && args[0] === 'reset') {
          throw new Error('reset failed');
        }
        return { stdout: '', stderr: '' };
      };

      await expect(
        ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow('Failed to clean worktree');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ path: repoPath }),
        'Both fetch and clean failed — repository is unusable'
      );
    });

    it('should throw when fetchRemote succeeds but cleanWorktree fails', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'fetch-ok-clean-fail');
      mkdirSync(join(repoPath, '.git'), { recursive: true });
      writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ name: 'intexuraos' }));

      mockExecFileAsyncImpl = async (
        file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        if (file === 'git' && args[0] === 'config' && args[1] === '--get') {
          if (args[2] === 'remote.origin.url') {
            return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
          }
          throw new Error('exit code 1');
        }
        if (file === 'git' && args[0] === 'remote') {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        if (file === 'git' && args[0] === 'fetch') {
          return { stdout: '', stderr: '' };
        }
        if (file === 'git' && args[0] === 'reset') {
          throw new Error('reset failed');
        }
        return { stdout: '', stderr: '' };
      };

      await expect(
        ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow('Failed to clean worktree');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ path: repoPath }),
        'Clean worktree failed after successful fetch'
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
