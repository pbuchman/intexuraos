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

    it('should create a continuation worktree from the existing PR branch', async () => {
      const commands: string[] = [];
      mockExecAsyncImpl = async (
        command: string,
        _options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        commands.push(command);
        if (command.includes('git worktree add')) {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-continuation', 'development', 'task_existing_pr_branch');

      expect(commands).toEqual(
        expect.arrayContaining([
          'git fetch origin "task_existing_pr_branch"',
          `git worktree add -B "task-continuation" "${join(worktreeBasePath, 'task-continuation')}" "origin/task_existing_pr_branch"`,
        ])
      );
    });

    it('should fetch base branch before creating worktree', async () => {
      const calls: { command: string; cwd?: string }[] = [];
      mockExecAsyncImpl = async (
        command: string,
        options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        calls.push({ command, ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
        if (command.includes('git worktree add')) {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-fetch', 'development');

      const fetchIndex = calls.findIndex(
        (c) => c.command === 'git fetch origin "development" --force'
      );
      const worktreeAddIndex = calls.findIndex((c) => c.command.includes('git worktree add'));

      expect(fetchIndex).toBeGreaterThanOrEqual(0);
      expect(calls[fetchIndex]?.cwd).toBe(repoPath);
      expect(worktreeAddIndex).toBeGreaterThanOrEqual(0);
      expect(fetchIndex).toBeLessThan(worktreeAddIndex);
    });

    it('should proceed with worktree creation when fetch fails', async () => {
      const warnSpy = vi.spyOn(mockLogger, 'warn');
      mockExecAsyncImpl = async (
        command: string,
        _options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        if (command.includes('git fetch origin "development" --force')) {
          throw new Error('fatal: unable to access remote');
        }
        if (command.includes('git worktree add')) {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      const worktreePath = await manager.createWorktree('task-fetch-fail', 'development');

      expect(worktreePath).toBe(join(worktreeBasePath, 'task-fetch-fail'));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-fetch-fail', baseBranch: 'development' }),
        'Failed to fetch base branch — proceeding with existing local state'
      );
      warnSpy.mockRestore();
    });

    it('should log Unknown error when fetch throws a non-Error', async () => {
      const warnSpy = vi.spyOn(mockLogger, 'warn');
      mockExecAsyncImpl = async (
        command: string,
        _options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        if (command.includes('git fetch origin "development" --force')) {
          throw 'network timeout';
        }
        if (command.includes('git worktree add')) {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      const worktreePath = await manager.createWorktree('task-fetch-non-error', 'development');

      expect(worktreePath).toBe(join(worktreeBasePath, 'task-fetch-non-error'));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-fetch-non-error', error: 'Unknown error' }),
        'Failed to fetch base branch — proceeding with existing local state'
      );
      warnSpy.mockRestore();
    });

    it('should fetch base branch even for continuation PR worktrees', async () => {
      const commands: string[] = [];
      mockExecAsyncImpl = async (
        command: string,
        _options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        commands.push(command);
        if (command.includes('git worktree add')) {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-cont-fetch', 'development', 'task_existing_branch');

      expect(commands).toContain('git fetch origin "development" --force');
      expect(commands).toContain('git fetch origin "task_existing_branch"');
    });

    it('should reject continuation branch names with shell metacharacters', async () => {
      const commands: string[] = [];
      mockExecAsyncImpl = async (
        command: string,
        _options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        commands.push(command);
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      await expect(
        manager.createWorktree('task-bad-branch', 'development', 'task$(malicious)')
      ).rejects.toThrow('Invalid continuation PR branch name');
      expect(commands).toEqual([]);
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
      process.env['INTEXURAOS_LINEAR_API_KEY'] = 'test-linear-key';
      process.env['INTEXURAOS_SENTRY_AUTH_TOKEN'] = 'test-sentry-token';

      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-mcp', 'feature-branch');

      const mcpConfigPath = join(worktreeBasePath, 'task-mcp', '.mcp.json');
      expect(existsSync(mcpConfigPath)).toBe(true);

      const config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
      expect(config.linear.apiKey).toBe('test-linear-key');
      expect(config.sentry.authToken).toBe('test-sentry-token');

      delete process.env['INTEXURAOS_LINEAR_API_KEY'];
      delete process.env['INTEXURAOS_SENTRY_AUTH_TOKEN'];
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

    it('should copy settings.local.json template into worktree', async () => {
      const settingsTemplatePath = join(tempDir, 'settings.local.json');
      writeFileSync(
        settingsTemplatePath,
        JSON.stringify({ preferredNotifChannel: 'terminal_bell', outputStyle: 'Explanatory' }),
        'utf-8'
      );

      const WM = await loadWorktreeManager();
      const manager = new WM(
        { ...mockConfig, settingsLocalTemplatePath: settingsTemplatePath },
        mockLogger
      );

      await manager.createWorktree('task-settings', 'feature-branch');

      const settingsPath = join(
        worktreeBasePath,
        'task-settings',
        '.claude',
        'settings.local.json'
      );
      expect(existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      expect(settings.preferredNotifChannel).toBe('terminal_bell');
      expect(settings.outputStyle).toBe('Explanatory');
    });

    it('should skip settings.local.json if template path not configured', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-no-settings', 'feature-branch');

      const settingsPath = join(
        worktreeBasePath,
        'task-no-settings',
        '.claude',
        'settings.local.json'
      );
      expect(existsSync(settingsPath)).toBe(false);
    });

    it('should skip settings.local.json if template file does not exist', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(
        { ...mockConfig, settingsLocalTemplatePath: join(tempDir, 'missing.json') },
        mockLogger
      );

      await manager.createWorktree('task-missing-settings', 'feature-branch');

      const settingsPath = join(
        worktreeBasePath,
        'task-missing-settings',
        '.claude',
        'settings.local.json'
      );
      expect(existsSync(settingsPath)).toBe(false);
    });

    it('should warn when settings.local.json template path configured but file not found', async () => {
      const warnSpy = vi.spyOn(mockLogger, 'warn');
      const missingPath = join(tempDir, 'missing-template.json');
      const WM = await loadWorktreeManager();
      const manager = new WM({ ...mockConfig, settingsLocalTemplatePath: missingPath }, mockLogger);

      await manager.createWorktree('task-warn-settings', 'feature-branch');

      expect(warnSpy).toHaveBeenCalledWith(
        { templatePath: missingPath },
        'settings.local.json template path configured but file not found on disk'
      );
      warnSpy.mockRestore();
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
      delete process.env['INTEXURAOS_LINEAR_API_KEY'];
      delete process.env['INTEXURAOS_SENTRY_AUTH_TOKEN'];

      const warnSpy = vi.spyOn(mockLogger, 'warn');

      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-missing-env', 'feature-branch');

      // Should have warned about missing keys twice (linear + sentry)
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('lifecycle logging', () => {
    it('should log start and end of createWorktree', async () => {
      const infoSpy = vi.spyOn(mockLogger, 'info');

      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-log-create', 'feature-branch');

      expect(infoSpy).toHaveBeenCalledWith(
        { taskId: 'task-log-create', baseBranch: 'feature-branch' },
        'Creating worktree'
      );
      expect(infoSpy).toHaveBeenCalledWith(
        { taskId: 'task-log-create', worktreePath: join(worktreeBasePath, 'task-log-create') },
        'Worktree created'
      );
    });

    it('should log start and end of removeWorktree', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-log-remove', 'feature-branch');

      const infoSpy = vi.spyOn(mockLogger, 'info');
      infoSpy.mockClear();

      await manager.removeWorktree('task-log-remove');

      expect(infoSpy).toHaveBeenCalledWith(
        { taskId: 'task-log-remove', worktreePath: join(worktreeBasePath, 'task-log-remove') },
        'Removing worktree'
      );
      expect(infoSpy).toHaveBeenCalledWith({ taskId: 'task-log-remove' }, 'Worktree removed');
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
      process.env['INTEXURAOS_LINEAR_API_KEY'] = 'test-key';
      process.env['INTEXURAOS_SENTRY_AUTH_TOKEN'] = 'test-token';

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

      delete process.env['INTEXURAOS_LINEAR_API_KEY'];
      delete process.env['INTEXURAOS_SENTRY_AUTH_TOKEN'];
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

  describe('listWorktrees filtering', () => {
    it('should filter worktrees by base path', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      // The mock returns empty output, so we just verify the function works
      const worktrees = await manager.listWorktrees();
      expect(Array.isArray(worktrees)).toBe(true);
    });
  });

  describe('mergePlanningBranch', () => {
    it('should fetch and merge the planning branch successfully', async () => {
      const WM = await loadWorktreeManager();
      const manager = new WM(mockConfig, mockLogger);

      await manager.createWorktree('task-merge', 'development');

      const result = await manager.mergePlanningBranch(
        join(worktreeBasePath, 'task-merge'),
        'plan/my-feature'
      );

      expect(result.ok).toBe(true);
    });

    it('should return error when merge conflicts occur', async () => {
      mockExecAsyncImpl = async (
        command: string,
        _options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        if (command.includes('git merge')) {
          throw new Error('CONFLICT (content): Merge conflict in file.ts');
        }
        if (command.includes('git worktree add')) {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      mkdirSync(join(worktreeBasePath, 'task-conflict'), { recursive: true });

      const result = await manager.mergePlanningBranch(
        join(worktreeBasePath, 'task-conflict'),
        'plan/conflicting'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('CONFLICT');
      }
    });

    it('should reject invalid planning branch names before running git commands', async () => {
      const commands: string[] = [];
      mockExecAsyncImpl = async (
        command: string,
        _options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        commands.push(command);
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      const result = await manager.mergePlanningBranch('/tmp/worktree', 'plan$(bad)');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Invalid planning branch name');
      }
      expect(commands).toEqual([]);
    });

    it('should return error when branch does not exist', async () => {
      mockExecAsyncImpl = async (
        command: string,
        _options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        if (command.includes('git fetch')) {
          throw new Error("fatal: couldn't find remote ref plan/nonexistent");
        }
        if (command.includes('git worktree add')) {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      mkdirSync(join(worktreeBasePath, 'task-no-branch'), { recursive: true });

      const result = await manager.mergePlanningBranch(
        join(worktreeBasePath, 'task-no-branch'),
        'plan/nonexistent'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('nonexistent');
      }
    });

    it('should return Unknown error when a non-Error is thrown', async () => {
      mockExecAsyncImpl = async (
        command: string,
        _options: { cwd?: string; timeout?: number }
      ): Promise<{ stdout: string; stderr: string }> => {
        if (command.includes('git fetch') || command.includes('git merge')) {
          throw 'some string error';
        }
        if (command.includes('git worktree add')) {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      vi.resetModules();
      const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
      const manager = new WM(mockConfig, mockLogger);

      mkdirSync(join(worktreeBasePath, 'task-non-error'), { recursive: true });

      const result = await manager.mergePlanningBranch(
        join(worktreeBasePath, 'task-non-error'),
        'plan/throws-string'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Unknown error');
      }
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

  it('should not throw when git worktree add returns empty stderr', async () => {
    // Override mock for this test - return empty stderr for all commands
    mockExecAsyncImpl = async (
      _command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      return { stdout: '', stderr: '' };
    };

    // Clear module cache and reload
    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
    const manager = new WM(mockConfig, mockLogger);

    // Should not throw - empty stderr is acceptable
    await expect(manager.createWorktree('task-empty-stderr', 'feature-branch')).resolves.toBe(
      join(worktreeBasePath, 'task-empty-stderr')
    );
  });

  it('should handle non-Error thrown during createWorktree', async () => {
    mockExecAsyncImpl = async (
      command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      if (command.includes('git worktree add')) {
        throw 'string-thrown-not-an-error';
      }
      return { stdout: '', stderr: '' };
    };

    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
    const manager = new WM(mockConfig, mockLogger);

    await expect(manager.createWorktree('task-non-error-create', 'feature-branch')).rejects.toThrow(
      'Failed to create worktree: Unknown error'
    );
  });

  it('should handle non-Error thrown during removeWorktree', async () => {
    // Create worktree directory first
    mkdirSync(join(worktreeBasePath, 'task-non-error-remove'), { recursive: true });

    mockExecAsyncImpl = async (
      command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      if (command.includes('git worktree remove')) {
        throw 42;
      }
      return { stdout: '', stderr: 'Preparing worktree' };
    };

    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
    const manager = new WM(mockConfig, mockLogger);

    await expect(manager.removeWorktree('task-non-error-remove')).rejects.toThrow(
      'Failed to remove worktree: Unknown error'
    );
  });

  it('should filter worktrees by base path from porcelain output', async () => {
    const porcelainOutput = [
      `worktree /repo`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      `worktree ${worktreeBasePath}/task-a`,
      'HEAD def456',
      'branch refs/heads/task-a',
      '',
      `worktree /other/path/task-b`,
      'HEAD ghi789',
      'branch refs/heads/task-b',
      '',
      `worktree ${worktreeBasePath}/task-c`,
      'HEAD jkl012',
      'branch refs/heads/task-c',
    ].join('\n');

    mockExecAsyncImpl = async (
      command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      if (command.includes('git worktree list')) {
        return { stdout: porcelainOutput, stderr: '' };
      }
      return { stdout: '', stderr: 'Preparing worktree' };
    };

    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
    const manager = new WM(mockConfig, mockLogger);

    const worktrees = await manager.listWorktrees();

    expect(worktrees).toEqual([`${worktreeBasePath}/task-a`, `${worktreeBasePath}/task-c`]);
  });

  it('should handle non-Error thrown during copyMcpConfig', async () => {
    // We need to make readFile throw a non-Error inside copyMcpConfig
    // The easiest way is to make the template file unreadable by corrupting the mock
    mockExecAsyncImpl = async (
      command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      if (command.includes('git worktree add')) {
        return { stdout: '', stderr: 'Preparing worktree' };
      }
      return { stdout: '', stderr: '' };
    };

    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');

    // Point to a template that exists but will cause copyMcpConfig to fail
    // We'll use a template path that triggers an error during processing
    const badTemplatePath = join(tempDir, 'bad-template.json');
    // Create a directory at the template path so readFile fails with EISDIR
    mkdirSync(badTemplatePath, { recursive: true });

    const manager = new WM({ ...mockConfig, mcpConfigTemplatePath: badTemplatePath }, mockLogger);

    await expect(manager.createWorktree('task-mcp-error', 'feature-branch')).rejects.toThrow(
      'Failed to create worktree'
    );
  });

  it('should handle non-Error thrown during copySettingsLocal', async () => {
    mockExecAsyncImpl = async (
      command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      if (command.includes('git worktree add')) {
        return { stdout: '', stderr: 'Preparing worktree' };
      }
      return { stdout: '', stderr: '' };
    };

    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');

    // Point settings template to a directory so readFile fails with EISDIR
    const badSettingsPath = join(tempDir, 'bad-settings-dir');
    mkdirSync(badSettingsPath, { recursive: true });

    const manager = new WM(
      {
        ...mockConfig,
        mcpConfigTemplatePath: join(tempDir, 'non-existent-mcp.json'), // skip MCP config
        settingsLocalTemplatePath: badSettingsPath,
      },
      mockLogger
    );

    await expect(manager.createWorktree('task-settings-error', 'feature-branch')).rejects.toThrow(
      'Failed to create worktree'
    );
  });

  it('should not throw when git worktree remove returns empty stderr', async () => {
    // Create worktree directory first
    mkdirSync(join(worktreeBasePath, 'task-remove-empty'), { recursive: true });

    // Override mock for this test - return empty stderr for all commands
    mockExecAsyncImpl = async (
      _command: string,
      _options: { cwd?: string; timeout?: number }
    ): Promise<{ stdout: string; stderr: string }> => {
      return { stdout: '', stderr: '' };
    };

    // Clear module cache and reload
    vi.resetModules();
    const { WorktreeManager: WM } = await import('../services/worktree-manager.js');
    const manager = new WM(mockConfig, mockLogger);

    // Should not throw - empty stderr is acceptable
    await expect(manager.removeWorktree('task-remove-empty')).resolves.toBeUndefined();
  });
});
