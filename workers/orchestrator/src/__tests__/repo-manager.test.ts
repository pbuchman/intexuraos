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

// Mock execAsync function - will be configured per test
let mockExecAsyncImpl: (
  command: string,
  options?: { cwd?: string }
) => Promise<{ stdout: string; stderr: string }>;

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util');
  return {
    ...actual,
    promisify: vi.fn((_fn: unknown) => {
      return (
        command: string,
        options?: { cwd?: string }
      ): Promise<{ stdout: string; stderr: string }> => mockExecAsyncImpl(command, options);
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
    mockExecAsyncImpl = async (
      command: string,
      _options?: { cwd?: string }
    ): Promise<{ stdout: string; stderr: string }> => {
      if (command.includes('git clone')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git fetch')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git remote get-url')) {
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
      mockExecAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => ({
        stdout: 'https://github.com/other/repo.git\n',
        stderr: '',
      });

      await expect(
        validateRepository(repoPath, 'https://github.com/pbuchman/intexuraos.git', mockLogger)
      ).rejects.toThrow('has wrong remote origin');
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

      let cloneCommand = '';
      mockExecAsyncImpl = async (command: string): Promise<{ stdout: string; stderr: string }> => {
        cloneCommand = command;
        return { stdout: '', stderr: '' };
      };

      await cloneRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger);

      expect(cloneCommand).toContain('git clone');
      expect(cloneCommand).toContain('https://github.com/pbuchman/intexuraos.git');
      expect(cloneCommand).toContain(repoPath);
    });

    it('should handle clone failure gracefully', async () => {
      const { cloneRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'failed-clone');

      mockExecAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('fatal: repository not found');
      };

      await expect(
        cloneRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow('Failed to clone repository');
    });

    it('should include original error message in clone failure', async () => {
      const { cloneRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'failed-clone-2');

      mockExecAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('permission denied');
      };

      await expect(
        cloneRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger)
      ).rejects.toThrow('permission denied');
    });
  });

  describe('fetchRemote', () => {
    it('should fetch from remote successfully', async () => {
      const { fetchRemote } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-to-fetch');
      mkdirSync(repoPath, { recursive: true });

      let fetchCommand = '';
      let fetchCwd = '';
      mockExecAsyncImpl = async (
        command: string,
        options?: { cwd?: string }
      ): Promise<{ stdout: string; stderr: string }> => {
        fetchCommand = command;
        fetchCwd = options?.cwd ?? '';
        return { stdout: '', stderr: '' };
      };

      await fetchRemote(repoPath, mockLogger);

      expect(fetchCommand).toBe('git fetch origin');
      expect(fetchCwd).toBe(repoPath);
    });

    it('should handle fetch failure gracefully', async () => {
      const { fetchRemote } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-fetch-fail');

      mockExecAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('Could not resolve host: github.com');
      };

      await expect(fetchRemote(repoPath, mockLogger)).rejects.toThrow(
        'Failed to fetch from remote'
      );
    });

    it('should include original error message in fetch failure', async () => {
      const { fetchRemote } = await loadRepoManager();
      const repoPath = join(tempDir, 'repo-fetch-fail-2');

      mockExecAsyncImpl = async (): Promise<{ stdout: string; stderr: string }> => {
        throw new Error('network timeout');
      };

      await expect(fetchRemote(repoPath, mockLogger)).rejects.toThrow('network timeout');
    });
  });

  describe('ensureRepository', () => {
    it('should clone repository when path does not exist', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'fresh-clone');

      let cloneCalled = false;
      mockExecAsyncImpl = async (command: string): Promise<{ stdout: string; stderr: string }> => {
        if (command.includes('git clone')) {
          cloneCalled = true;
        }
        return { stdout: '', stderr: '' };
      };

      await ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger);

      expect(cloneCalled).toBe(true);
    });

    it('should validate and fetch when path exists with correct repo', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'existing-repo');
      mkdirSync(join(repoPath, '.git'), { recursive: true });
      writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ name: 'intexuraos' }));

      let fetchCalled = false;
      mockExecAsyncImpl = async (command: string): Promise<{ stdout: string; stderr: string }> => {
        if (command.includes('git fetch')) {
          fetchCalled = true;
        }
        if (command.includes('git remote get-url')) {
          return { stdout: 'https://github.com/pbuchman/intexuraos.git\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      await ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger);

      expect(fetchCalled).toBe(true);
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

    it('should create parent directories when cloning', async () => {
      const { ensureRepository } = await loadRepoManager();
      const repoPath = join(tempDir, 'nested', 'path', 'repo');

      await ensureRepository('https://github.com/pbuchman/intexuraos.git', repoPath, mockLogger);

      // Parent directory should be created
      expect(existsSync(join(tempDir, 'nested', 'path'))).toBe(true);
    });
  });
});
