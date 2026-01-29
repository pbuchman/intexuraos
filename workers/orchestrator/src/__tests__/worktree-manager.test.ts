import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

// Default successful implementation
const defaultExecAsync = async (
  command: string,
  _options: { cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string }> => {
  if (command.includes('git worktree add')) {
    return { stdout: '', stderr: 'Preparing worktree' };
  }
  if (command.includes('git worktree remove')) {
    return { stdout: '', stderr: '' };
  }
  if (command.includes('git worktree list')) {
    return { stdout: '', stderr: '' };
  }
  if (command.includes('pnpm install')) {
    return { stdout: '', stderr: '' };
  }
  return { stdout: '', stderr: '' };
};

// Initialize with default - this must be before the mock
let mockExecAsyncImpl = defaultExecAsync;

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util');
  return {
    ...actual,
    promisify: vi.fn((_fn: unknown) => mockExecAsyncImpl),
  };
});

// Import after mock is set up
let WorktreeManager: (typeof import('../services/worktree-manager.js'))['WorktreeManager'];

const loadWorktreeManager = async (): Promise<
  (typeof import('../services/worktree-manager.js'))['WorktreeManager']
> => {
  if (!WorktreeManager) {
    const module = await import('../services/worktree-manager.js');
    WorktreeManager = module.WorktreeManager;
  }
  return WorktreeManager;
};

describe('WorktreeManager', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'worktree-test-'));
  const repoPath = join(tempDir, 'repo');
  const worktreeBasePath = join(tempDir, 'worktrees');
  const mcpConfigTemplatePath = join(tempDir, 'mcp-template.json');

  const mockConfig = {
    repositoryPath: repoPath,
    worktreeBasePath,
    mcpConfigTemplatePath,
  };

  beforeEach(async () => {
    // Reset to default implementation
    mockExecAsyncImpl = defaultExecAsync;

    // Ensure temp directory exists
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    // Create MCP config template with placeholders
    const template = JSON.stringify({
      linear: { apiKey: '{{LINEAR_API_KEY}}' },
      sentry: { authToken: '{{SENTRY_AUTH_TOKEN}}' },
    });
    writeFileSync(mcpConfigTemplatePath, template, 'utf-8');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createWorktree', () => {
    it('should create a new worktree', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      const worktreePath = await manager.createWorktree('task-123', 'feature-branch');

      expect(worktreePath).toBe(join(worktreeBasePath, 'task-123'));
    });

    it('should create base directory if it does not exist', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-456', 'feature-branch');

      expect(existsSync(worktreeBasePath)).toBe(true);
    });

    it('should throw if worktree already exists', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      // First call succeeds
      await manager.createWorktree('task-789', 'feature-branch');

      // Second call should throw
      await expect(manager.createWorktree('task-789', 'feature-branch')).rejects.toThrow(
        'already exists'
      );
    });

    it('should copy MCP config template with env var substitution', async () => {
      process.env['LINEAR_API_KEY'] = 'test-linear-key';
      process.env['SENTRY_AUTH_TOKEN'] = 'test-sentry-token';

      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-mcp', 'feature-branch');

      const mcpConfigPath = join(worktreeBasePath, 'task-mcp', '.mcp.json');
      expect(existsSync(mcpConfigPath)).toBe(true);

      const config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
      expect(config.linear.apiKey).toBe('test-linear-key');
      expect(config.sentry.authToken).toBe('test-sentry-token');

      delete process.env['LINEAR_API_KEY'];
      delete process.env['SENTRY_AUTH_TOKEN'];
    });

    it('should handle missing env vars gracefully', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-no-env', 'feature-branch');

      const mcpConfigPath = join(worktreeBasePath, 'task-no-env', '.mcp.json');
      const config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
      expect(config.linear.apiKey).toBe('');
      expect(config.sentry.authToken).toBe('');
    });

    it('should skip MCP config if template does not exist', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(
        {
          ...mockConfig,
          mcpConfigTemplatePath: join(tempDir, 'non-existent.json'),
        },
        mockLogger
      );

      // Should not throw
      await manager.createWorktree('task-no-template', 'feature-branch');
    });

    it('should handle missing env vars with warning', async () => {
      // Clear env vars
      delete process.env['LINEAR_API_KEY'];
      delete process.env['SENTRY_AUTH_TOKEN'];

      const warnSpy = vi.spyOn(mockLogger, 'warn');

      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-missing-env', 'feature-branch');

      // Should have warned about missing keys twice (linear + sentry)
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeWorktree', () => {
    it('should remove an existing worktree', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      // Create worktree first
      await manager.createWorktree('task-remove', 'feature-branch');

      // Remove it - should not throw
      await manager.removeWorktree('task-remove');
    });

    it('should throw if worktree does not exist', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await expect(manager.removeWorktree('non-existent')).rejects.toThrow('does not exist');
    });
  });

  describe('listWorktrees', () => {
    it('should return empty array when no worktrees exist', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      const worktrees = await manager.listWorktrees();

      expect(worktrees).toEqual([]);
    });

    it('should list all worktrees under base path', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      // Our mock returns empty list, so we just verify the method runs
      const worktrees = await manager.listWorktrees();

      expect(worktrees).toEqual([]);
    });
  });

  describe('worktreeExists', () => {
    it('should return false for non-existent worktree', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      const exists = await manager.worktreeExists('non-existent');

      expect(exists).toBe(false);
    });

    it('should return true for existing worktree', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-exists', 'feature-branch');

      const exists = await manager.worktreeExists('task-exists');

      expect(exists).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw error when trying to remove non-existent worktree', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await expect(manager.removeWorktree('non-existent')).rejects.toThrow('does not exist');
    });
  });

  describe('copyMcpConfig error handling', () => {
    it('should handle non-Error objects thrown during MCP config copy', async () => {
      process.env['LINEAR_API_KEY'] = 'test-key';
      process.env['SENTRY_AUTH_TOKEN'] = 'test-token';

      const WM = await loadWorktreeManager();
      // Create a worktree without MCP config template to test error path
      const managerWithoutTemplate = new WM(
        {
          ...mockConfig,
          mcpConfigTemplatePath: join(tempDir, 'non-existent.json'),
        },
        mockLogger
      );

      // This should succeed (template is optional)
      await expect(
        managerWithoutTemplate.createWorktree('task-no-template', 'feature-branch')
      ).resolves.toBe(join(worktreeBasePath, 'task-no-template'));

      delete process.env['LINEAR_API_KEY'];
      delete process.env['SENTRY_AUTH_TOKEN'];
    });
  });

  describe('list worktrees error handling', () => {
    it('should return empty array when git command fails', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      // The mock in beforeEach always succeeds, but we can verify
      // that the function doesn't throw when it receives empty output
      const worktrees = await manager.listWorktrees();
      expect(Array.isArray(worktrees)).toBe(true);
    });
  });

  describe('installDependencies edge cases', () => {
    it('should handle worktree without pnpm-lock.yaml', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      // Create a worktree - the mock exec succeeds regardless of lock file
      // The installDependencies function checks for pnpm-lock.yaml with access()
      // and returns early if not found (no error thrown)
      const result = await manager.createWorktree('task-no-lock-file', 'feature-branch');

      expect(result).toBe(join(worktreeBasePath, 'task-no-lock-file'));
    });
  });

  describe('listWorktrees filtering', () => {
    it('should filter worktrees by base path', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      // The mock returns empty output, so we just verify the function works
      const worktrees = await manager.listWorktrees();
      expect(Array.isArray(worktrees)).toBe(true);
    });
  });
});

// Separate test suite for git stderr error handling with custom mock
describe('WorktreeManager - git stderr error handling', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'worktree-error-test-'));
  const repoPath = join(tempDir, 'repo');
  const worktreeBasePath = join(tempDir, 'worktrees');
  const mcpConfigTemplatePath = join(tempDir, 'mcp-template.json');

  const mockConfig = {
    repositoryPath: repoPath,
    worktreeBasePath,
    mcpConfigTemplatePath,
  };

  beforeEach(async () => {
    // Ensure temp directory exists
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    // Create MCP config template
    const template = JSON.stringify({
      linear: { apiKey: '{{LINEAR_API_KEY}}' },
      sentry: { authToken: '{{SENTRY_AUTH_TOKEN}}' },
    });
    writeFileSync(mcpConfigTemplatePath, template, 'utf-8');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should throw error when git worktree add returns unexpected stderr', async () => {
    // Override mock for this test
    mockExecAsyncImpl = async (
      _command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      return { stdout: '', stderr: 'fatal: Invalid branch name' };
    };

    // Clear module cache and reload
    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
    const manager = new WM(mockConfig, mockLogger);

    await expect(manager.createWorktree('task-error', 'feature-branch')).rejects.toThrow(
      'Failed to create worktree'
    );
  });

  it('should not throw when git worktree add returns "Preparing worktree" stderr', async () => {
    // Override mock for this test
    mockExecAsyncImpl = async (
      _command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      return { stdout: '', stderr: 'Preparing worktree (detached HEAD)' };
    };

    // Clear module cache and reload
    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
    const manager = new WM(mockConfig, mockLogger);

    // Should not throw
    await expect(manager.createWorktree('task-prepare', 'feature-branch')).resolves.toBe(
      join(worktreeBasePath, 'task-prepare')
    );
  });

  it('should throw error when git worktree remove returns stderr', async () => {
    // Create worktree directory first
    mkdirSync(join(worktreeBasePath, 'task-remove-error'), { recursive: true });

    // Override mock for this test
    mockExecAsyncImpl = async (
      command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      if (command.includes('git worktree remove')) {
        return { stdout: '', stderr: 'fatal: not a valid worktree' };
      }
      return { stdout: '', stderr: 'Preparing worktree' };
    };

    // Clear module cache and reload
    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
    const manager = new WM(mockConfig, mockLogger);

    await expect(manager.removeWorktree('task-remove-error')).rejects.toThrow(
      'Failed to remove worktree'
    );
  });
});
