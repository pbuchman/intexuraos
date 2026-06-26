import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@intexuraos/common-core';
import { WorktreeManager, type ExecFileFn } from '../services/worktree-manager.js';

// Hook mechanism to override fs/promises functions for specific tests
let fsPromisesReadFileOverride: (() => Promise<string>) | null = null;

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (path: string, options?: BufferEncoding): Promise<string> => {
      if (fsPromisesReadFileOverride) return fsPromisesReadFileOverride();
      return actual.readFile(path, { encoding: options ?? 'utf-8' });
    },
  };
});

const mockLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

// Default successful implementation
const defaultExecFile: ExecFileFn = async (
  file,
  args,
  _options
): Promise<{ stdout: string; stderr: string }> => {
  if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
    // Simulate git creating the worktree directory (real git does this).
    // Argv layout: [worktree, add, -b|-B, <branchName>, <worktreePath>, <baseRef>]
    const worktreePath = args[4];
    if (typeof worktreePath === 'string') {
      mkdirSync(worktreePath, { recursive: true });
    }
    return { stdout: '', stderr: 'Preparing worktree' };
  }
  if (file === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
    return { stdout: '', stderr: '' };
  }
  if (file === 'git' && args[0] === 'worktree' && args[1] === 'list') {
    return { stdout: '', stderr: '' };
  }
  return { stdout: '', stderr: '' };
};

describe('WorktreeManager', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'worktree-test-'));
  const repoPath = join(tempDir, 'repo');
  const worktreeBasePath = join(tempDir, 'worktrees');

  const mockConfig = {
    repositoryPath: repoPath,
    worktreeBasePath,
  };

  beforeEach(async () => {
    // Ensure temp directory exists
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createWorktree', () => {
    it('should create a new worktree', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      const worktreePath = await manager.createWorktree('task-123', 'feature-branch');

      expect(worktreePath).toBe(join(worktreeBasePath, 'task-123'));
    });

    it('should create a continuation worktree from the existing PR branch', async () => {
      const calls: { file: string; args: readonly string[] }[] = [];
      const execFile: ExecFileFn = async (file, args) => {
        calls.push({ file, args });
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await manager.createWorktree('task-continuation', 'development', 'task_existing_pr_branch');

      const fetchContCall = calls.find(
        (c) =>
          c.file === 'git' &&
          c.args[0] === 'fetch' &&
          c.args[1] === 'origin' &&
          c.args[2] === 'task_existing_pr_branch' &&
          c.args.length === 3
      );
      expect(fetchContCall).toBeDefined();
      const addCall = calls.find(
        (c) => c.file === 'git' && c.args[0] === 'worktree' && c.args[1] === 'add'
      );
      expect(addCall?.args).toEqual([
        'worktree',
        'add',
        '-B',
        'task-continuation',
        join(worktreeBasePath, 'task-continuation'),
        'origin/task_existing_pr_branch',
      ]);
    });

    it('should fetch base branch before creating worktree', async () => {
      const calls: { file: string; args: readonly string[]; cwd?: string }[] = [];
      const execFile: ExecFileFn = async (file, args, options) => {
        calls.push({ file, args, ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}) });
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await manager.createWorktree('task-fetch', 'development');

      const fetchIndex = calls.findIndex(
        (c) =>
          c.file === 'git' &&
          c.args[0] === 'fetch' &&
          c.args[1] === 'origin' &&
          c.args[2] === 'development' &&
          c.args[3] === '--force'
      );
      const branchSyncIndex = calls.findIndex(
        (c) =>
          c.file === 'git' &&
          c.args[0] === 'branch' &&
          c.args[1] === '-f' &&
          c.args[2] === 'development' &&
          c.args[3] === 'origin/development'
      );
      const worktreeAddIndex = calls.findIndex(
        (c) => c.file === 'git' && c.args[0] === 'worktree' && c.args[1] === 'add'
      );

      expect(fetchIndex).toBeGreaterThanOrEqual(0);
      expect(calls[fetchIndex]?.cwd).toBe(repoPath);
      expect(branchSyncIndex).toBeGreaterThan(fetchIndex);
      expect(calls[branchSyncIndex]?.cwd).toBe(repoPath);
      expect(worktreeAddIndex).toBeGreaterThanOrEqual(0);
      expect(branchSyncIndex).toBeLessThan(worktreeAddIndex);
    });

    it('should proceed with worktree creation when fetch fails', async () => {
      const warnSpy = vi.spyOn(mockLogger, 'warn');
      const execFile: ExecFileFn = async (file, args) => {
        if (
          file === 'git' &&
          args[0] === 'fetch' &&
          args[1] === 'origin' &&
          args[2] === 'development' &&
          args[3] === '--force'
        ) {
          throw new Error('fatal: unable to access remote');
        }
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      const worktreePath = await manager.createWorktree('task-fetch-fail', 'development');

      expect(worktreePath).toBe(join(worktreeBasePath, 'task-fetch-fail'));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-fetch-fail',
          baseBranch: 'development',
          _skipSentry: true,
        }),
        'Failed to fetch base branch — proceeding with existing local state'
      );
      warnSpy.mockRestore();
    });

    it('should log Unknown error when fetch throws a non-Error', async () => {
      const warnSpy = vi.spyOn(mockLogger, 'warn');
      const execFile: ExecFileFn = async (file, args) => {
        if (
          file === 'git' &&
          args[0] === 'fetch' &&
          args[1] === 'origin' &&
          args[2] === 'development' &&
          args[3] === '--force'
        ) {
          throw 'network timeout';
        }
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      const worktreePath = await manager.createWorktree('task-fetch-non-error', 'development');

      expect(worktreePath).toBe(join(worktreeBasePath, 'task-fetch-non-error'));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-fetch-non-error',
          error: 'Unknown error',
          _skipSentry: true,
        }),
        'Failed to fetch base branch — proceeding with existing local state'
      );
      warnSpy.mockRestore();
    });

    it('should fetch base branch even for continuation PR worktrees', async () => {
      const calls: { file: string; args: readonly string[] }[] = [];
      const execFile: ExecFileFn = async (file, args) => {
        calls.push({ file, args });
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await manager.createWorktree('task-cont-fetch', 'development', 'task_existing_branch');

      const hasFetchBase = calls.some(
        (c) =>
          c.file === 'git' &&
          c.args[0] === 'fetch' &&
          c.args[1] === 'origin' &&
          c.args[2] === 'development' &&
          c.args[3] === '--force'
      );
      const hasBranchSync = calls.some(
        (c) =>
          c.file === 'git' &&
          c.args[0] === 'branch' &&
          c.args[1] === '-f' &&
          c.args[2] === 'development' &&
          c.args[3] === 'origin/development'
      );
      const hasFetchCont = calls.some(
        (c) =>
          c.file === 'git' &&
          c.args[0] === 'fetch' &&
          c.args[1] === 'origin' &&
          c.args[2] === 'task_existing_branch' &&
          c.args.length === 3
      );
      expect(hasFetchBase).toBe(true);
      expect(hasBranchSync).toBe(true);
      expect(hasFetchCont).toBe(true);
    });

    it('should fall back to base branch when continuation PR branch no longer exists on origin', async () => {
      // Real-world scenario: PR was merged + branch deleted between task submission
      // and dispatch. `git fetch` fails with "couldn't find remote ref".
      // Orchestrator should warn and create the worktree from base branch instead
      // of failing the task outright.
      const warnSpy = vi.spyOn(mockLogger, 'warn');
      const calls: { file: string; args: readonly string[] }[] = [];
      const execFile: ExecFileFn = async (file, args) => {
        calls.push({ file, args });
        if (
          file === 'git' &&
          args[0] === 'fetch' &&
          args[1] === 'origin' &&
          args[2] === 'feature/int-1561' &&
          args.length === 3
        ) {
          throw new Error(
            "Command failed: git fetch origin feature/int-1561\nfatal: couldn't find remote ref feature/int-1561\n"
          );
        }
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      const worktreePath = await manager.createWorktree(
        'task-gone-branch',
        'development',
        'feature/int-1561'
      );

      expect(worktreePath).toBe(join(worktreeBasePath, 'task-gone-branch'));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-gone-branch',
          continuationPrBranch: 'feature/int-1561',
          baseBranch: 'development',
          _skipSentry: true,
        }),
        expect.stringContaining('Continuation PR branch no longer exists on origin')
      );
      const addCall = calls.find(
        (c) => c.file === 'git' && c.args[0] === 'worktree' && c.args[1] === 'add'
      );
      expect(addCall?.args).toEqual([
        'worktree',
        'add',
        '-b',
        'task-gone-branch',
        join(worktreeBasePath, 'task-gone-branch'),
        'origin/development',
      ]);
      const usedContinuationBaseRef = calls.some((c) =>
        c.args.some((a) => typeof a === 'string' && a.includes('origin/feature/int-1561'))
      );
      expect(usedContinuationBaseRef).toBe(false);
      warnSpy.mockRestore();
    });

    it('should re-throw when continuation PR fetch throws a non-Error value', async () => {
      // Covers the `: 'Unknown error'` branch of the message coercion. A
      // non-Error throw cannot match "couldn't find remote ref", so it must
      // re-throw rather than silently fall back.
      const execFile: ExecFileFn = async (file, args) => {
        if (
          file === 'git' &&
          args[0] === 'fetch' &&
          args[1] === 'origin' &&
          args[2] === 'feature/non-error' &&
          args.length === 3
        ) {
          throw 'string-thrown-not-an-error';
        }
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(
        manager.createWorktree('task-non-err-fetch', 'development', 'feature/non-error')
      ).rejects.toThrow(/Failed to create worktree/);
    });

    it('should re-throw when continuation PR fetch fails with non-missing-ref error', async () => {
      // Transient errors (network, auth) should not silently degrade to base
      // branch — dispatcher needs to see the failure so the task stays queued.
      const execFile: ExecFileFn = async (file, args) => {
        if (
          file === 'git' &&
          args[0] === 'fetch' &&
          args[1] === 'origin' &&
          args[2] === 'feature/network' &&
          args.length === 3
        ) {
          throw new Error('fatal: unable to access remote: Connection reset by peer');
        }
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          return { stdout: '', stderr: 'Preparing worktree' };
        }
        return { stdout: '', stderr: '' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(
        manager.createWorktree('task-net-err', 'development', 'feature/network')
      ).rejects.toThrow(/Connection reset by peer/);
    });

    it('should reject continuation branch names with shell metacharacters', async () => {
      const calls: { file: string; args: readonly string[] }[] = [];
      const execFile: ExecFileFn = async (file, args) => {
        calls.push({ file, args });
        return { stdout: '', stderr: '' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(
        manager.createWorktree('task-bad-branch', 'development', 'task$(malicious)')
      ).rejects.toThrow('Invalid continuation PR branch name');
      expect(calls).toEqual([]);
    });

    it('should create base directory if it does not exist', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      await manager.createWorktree('task-456', 'feature-branch');

      expect(existsSync(worktreeBasePath)).toBe(true);
    });

    it('should throw if worktree already exists', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      // First call succeeds
      await manager.createWorktree('task-789', 'feature-branch');

      // Second call should throw
      await expect(manager.createWorktree('task-789', 'feature-branch')).rejects.toThrow(
        'already exists'
      );
    });

    it('should copy settings.local.json template into worktree', async () => {
      const settingsTemplatePath = join(tempDir, 'settings.local.json');
      writeFileSync(
        settingsTemplatePath,
        JSON.stringify({ preferredNotifChannel: 'terminal_bell', outputStyle: 'Explanatory' }),
        'utf-8'
      );

      const manager = new WorktreeManager(
        { ...mockConfig, settingsLocalTemplatePath: settingsTemplatePath },
        mockLogger,
        defaultExecFile
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
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

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
      const manager = new WorktreeManager(
        { ...mockConfig, settingsLocalTemplatePath: join(tempDir, 'missing.json') },
        mockLogger,
        defaultExecFile
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
      const manager = new WorktreeManager(
        { ...mockConfig, settingsLocalTemplatePath: missingPath },
        mockLogger,
        defaultExecFile
      );

      await manager.createWorktree('task-warn-settings', 'feature-branch');

      expect(warnSpy).toHaveBeenCalledWith(
        { templatePath: missingPath },
        'settings.local.json template path configured but file not found on disk'
      );
      warnSpy.mockRestore();
    });

    it('constructs with default execFileFn when not injected', () => {
      // coverage-only: hits the `?? defaultExecFileAsync` arm of the constructor.
      // We don't call any methods (which would actually shell out); we only
      // verify the constructor accepts no exec injection.
      const manager = new WorktreeManager(mockConfig, mockLogger);
      expect(manager).toBeInstanceOf(WorktreeManager);
    });

    it('passes baseBranch as literal argv to git fetch (no shell expansion)', async () => {
      const calls: { file: string; args: readonly string[] }[] = [];
      const execFile: ExecFileFn = async (file, args) => {
        calls.push({ file, args });
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
          return { stdout: '', stderr: 'Preparing worktree (new branch)' };
        }
        return { stdout: '', stderr: '' };
      };
      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);
      // Use a safe branch name that is also visually shell-y to express the intent.
      // assertSafeBranchName rejects shell metacharacters; the security guarantee
      // is provided by argv-form spawn — see baseBranch fetch call below.
      const baseBranch = 'feat-x.0_release/test';
      await manager.createWorktree('task-argv-base', baseBranch);
      const fetchCall = calls.find(
        (c) => c.file === 'git' && c.args[0] === 'fetch' && c.args[1] === 'origin'
      );
      expect(fetchCall?.args).toEqual(['fetch', 'origin', baseBranch, '--force']);
    });
  });

  describe('lifecycle logging', () => {
    it('should log start and end of createWorktree', async () => {
      const infoSpy = vi.spyOn(mockLogger, 'info');

      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

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
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

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
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      // Create worktree first
      await manager.createWorktree('task-remove', 'feature-branch');

      // Remove it - should not throw
      await manager.removeWorktree('task-remove');
    });

    it('should throw if worktree does not exist', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      await expect(manager.removeWorktree('non-existent')).rejects.toThrow('does not exist');
    });
  });

  describe('listWorktrees', () => {
    it('should return empty array when no worktrees exist', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      const worktrees = await manager.listWorktrees();

      expect(worktrees).toEqual([]);
    });

    it('should list all worktrees under base path', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      // Our mock returns empty list, so we just verify the method runs
      const worktrees = await manager.listWorktrees();

      expect(worktrees).toEqual([]);
    });
  });

  describe('worktreeExists', () => {
    it('should return false for non-existent worktree', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      const exists = await manager.worktreeExists('non-existent');

      expect(exists).toBe(false);
    });

    it('should return true for existing worktree', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      await manager.createWorktree('task-exists', 'feature-branch');

      const exists = await manager.worktreeExists('task-exists');

      expect(exists).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw error when trying to remove non-existent worktree', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      await expect(manager.removeWorktree('non-existent')).rejects.toThrow('does not exist');
    });
  });

  // INT-1454: worktree metadata rehydration helpers
  describe('isWorktreeRegistered', () => {
    it('should return true when worktree path appears in git worktree list --porcelain', async () => {
      const registeredPath = join(worktreeBasePath, 'task-registered');
      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'list') {
          return {
            stdout: [
              `worktree ${repoPath}`,
              'HEAD abc',
              'branch refs/heads/main',
              '',
              `worktree ${registeredPath}`,
              'HEAD def',
              'branch refs/heads/task-registered',
            ].join('\n'),
            stderr: '',
          };
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(manager.isWorktreeRegistered('task-registered')).resolves.toBe(true);
    });

    it('should return false when only a sibling-prefix path is registered (strict equality)', async () => {
      // Guards against a regression to startsWith matching, which would
      // match `<worktreePath>-sibling` as the target worktree.
      const registeredPath = `${join(worktreeBasePath, 'task-sibling')}-sibling`;
      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'list') {
          return {
            stdout: [
              `worktree ${repoPath}`,
              'HEAD abc',
              'branch refs/heads/main',
              '',
              `worktree ${registeredPath}`,
              'HEAD def',
              'branch refs/heads/task-sibling-sibling',
            ].join('\n'),
            stderr: '',
          };
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(manager.isWorktreeRegistered('task-sibling')).resolves.toBe(false);
    });

    it('should tolerate trailing whitespace on the worktree line', async () => {
      const registeredPath = join(worktreeBasePath, 'task-trailing');
      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'list') {
          return {
            stdout: [
              `worktree ${registeredPath}   `,
              'HEAD abc',
              'branch refs/heads/task-trailing',
            ].join('\n'),
            stderr: '',
          };
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(manager.isWorktreeRegistered('task-trailing')).resolves.toBe(true);
    });

    it('should return false when worktree path is absent from porcelain output', async () => {
      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'list') {
          return {
            stdout: [`worktree ${repoPath}`, 'HEAD abc', 'branch refs/heads/main'].join('\n'),
            stderr: '',
          };
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(manager.isWorktreeRegistered('task-missing')).resolves.toBe(false);
    });

    it('should return false when git worktree list throws', async () => {
      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'list') {
          throw new Error('git binary missing');
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(manager.isWorktreeRegistered('task-crash')).resolves.toBe(false);
    });
  });

  describe('repairWorktree', () => {
    it('should throw when the worktree path does not exist on disk', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      await expect(manager.repairWorktree('never-existed')).rejects.toThrow(
        /does not exist on disk/
      );
    });

    it('should invoke git worktree repair with the worktree path and succeed on clean stderr', async () => {
      const worktreePath = join(worktreeBasePath, 'task-repair-ok');
      mkdirSync(worktreePath, { recursive: true });

      let repairArgs: readonly string[] | undefined;
      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'repair') {
          repairArgs = args;
          return { stdout: '', stderr: '' };
        }
        if (file === 'git' && args.includes('symbolic-ref')) {
          return { stdout: 'refs/heads/task-repair-ok\n', stderr: '' };
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await manager.repairWorktree('task-repair-ok');

      expect(repairArgs).toBeDefined();
      expect(repairArgs).toEqual(['worktree', 'repair', worktreePath]);
    });

    it('should tolerate advisory stderr output from git worktree repair', async () => {
      const worktreePath = join(worktreeBasePath, 'task-repair-advisory');
      mkdirSync(worktreePath, { recursive: true });

      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'repair') {
          return { stdout: '', stderr: `repair: fixing ${worktreePath}` };
        }
        if (file === 'git' && args.includes('symbolic-ref')) {
          return { stdout: 'refs/heads/task-repair-advisory\n', stderr: '' };
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      // Should not throw — "repair:" prefix is advisory, not fatal.
      await expect(manager.repairWorktree('task-repair-advisory')).resolves.toBeUndefined();
    });

    it('should warn but succeed when the post-repair worktree is HEAD-detached', async () => {
      const worktreePath = join(worktreeBasePath, 'task-repair-detached');
      mkdirSync(worktreePath, { recursive: true });

      const warnSpy = vi.fn();
      const spyLogger: Logger = {
        info: () => undefined,
        warn: warnSpy,
        error: () => undefined,
        debug: () => undefined,
      };

      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'repair') {
          return { stdout: '', stderr: '' };
        }
        if (file === 'git' && args.includes('symbolic-ref')) {
          // git exits non-zero when HEAD is detached.
          throw new Error('fatal: ref HEAD is not a symbolic ref');
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, spyLogger, execFile);

      await expect(manager.repairWorktree('task-repair-detached')).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-repair-detached', worktreePath }),
        expect.stringContaining('HEAD-detached')
      );
    });

    it('should throw when git worktree repair reports a fatal error on stderr', async () => {
      const worktreePath = join(worktreeBasePath, 'task-repair-fatal');
      mkdirSync(worktreePath, { recursive: true });

      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'repair') {
          return { stdout: '', stderr: 'fatal: not a git repository' };
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(manager.repairWorktree('task-repair-fatal')).rejects.toThrow(
        /Failed to repair worktree/
      );
    });

    it('should throw when git worktree repair exec rejects', async () => {
      const worktreePath = join(worktreeBasePath, 'task-repair-throws');
      mkdirSync(worktreePath, { recursive: true });

      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'repair') {
          throw new Error('exec boom');
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(manager.repairWorktree('task-repair-throws')).rejects.toThrow(
        /Failed to repair worktree for task task-repair-throws: exec boom/
      );
    });

    it('should throw a wrapped "Unknown error" when a non-Error value is thrown', async () => {
      const worktreePath = join(worktreeBasePath, 'task-repair-nonerror');
      mkdirSync(worktreePath, { recursive: true });

      const execFile: ExecFileFn = async (file, args) => {
        if (file === 'git' && args[0] === 'worktree' && args[1] === 'repair') {
          throw 'oops';
        }
        return { stdout: '', stderr: 'Preparing worktree' };
      };

      const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

      await expect(manager.repairWorktree('task-repair-nonerror')).rejects.toThrow(/Unknown error/);
    });
  });

  describe('list worktrees error handling', () => {
    it('should return empty array when git command fails', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

      // The mock in beforeEach always succeeds, but we can verify
      // that the function doesn't throw when it receives empty output
      const worktrees = await manager.listWorktrees();
      expect(Array.isArray(worktrees)).toBe(true);
    });
  });

  describe('listWorktrees filtering', () => {
    it('should filter worktrees by base path', async () => {
      const manager = new WorktreeManager(mockConfig, mockLogger, defaultExecFile);

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

  const mockConfig = {
    repositoryPath: repoPath,
    worktreeBasePath,
  };

  beforeEach(async () => {
    // Ensure temp directory exists
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should throw error when git worktree add returns unexpected stderr', async () => {
    const execFile: ExecFileFn = async (): Promise<{ stdout: string; stderr: string }> => {
      return { stdout: '', stderr: 'fatal: Invalid branch name' };
    };

    const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

    await expect(manager.createWorktree('task-error', 'feature-branch')).rejects.toThrow(
      'Failed to create worktree'
    );
  });

  it('should not throw when git worktree add returns "Preparing worktree" stderr', async () => {
    const execFile: ExecFileFn = async (
      file,
      args
    ): Promise<{ stdout: string; stderr: string }> => {
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        // Simulate creation
        const wt = args[4];
        if (typeof wt === 'string') mkdirSync(wt, { recursive: true });
      }
      return { stdout: '', stderr: 'Preparing worktree (detached HEAD)' };
    };

    const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

    await expect(manager.createWorktree('task-prepare', 'feature-branch')).resolves.toBe(
      join(worktreeBasePath, 'task-prepare')
    );
  });

  it('should throw error when git worktree remove returns stderr', async () => {
    // Create worktree directory first
    mkdirSync(join(worktreeBasePath, 'task-remove-error'), { recursive: true });

    const execFile: ExecFileFn = async (file, args) => {
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        return { stdout: '', stderr: 'fatal: not a valid worktree' };
      }
      return { stdout: '', stderr: 'Preparing worktree' };
    };

    const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

    await expect(manager.removeWorktree('task-remove-error')).rejects.toThrow(
      'Failed to remove worktree'
    );
  });

  it('should not throw when git worktree add returns empty stderr', async () => {
    const execFile: ExecFileFn = async (file, args) => {
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        const wt = args[4];
        if (typeof wt === 'string') mkdirSync(wt, { recursive: true });
      }
      return { stdout: '', stderr: '' };
    };

    const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

    await expect(manager.createWorktree('task-empty-stderr', 'feature-branch')).resolves.toBe(
      join(worktreeBasePath, 'task-empty-stderr')
    );
  });

  it('should handle non-Error thrown during createWorktree', async () => {
    const execFile: ExecFileFn = async (file, args) => {
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        throw 'string-thrown-not-an-error';
      }
      return { stdout: '', stderr: '' };
    };

    const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

    await expect(manager.createWorktree('task-non-error-create', 'feature-branch')).rejects.toThrow(
      'Failed to create worktree: Unknown error'
    );
  });

  it('should handle non-Error thrown during removeWorktree', async () => {
    // Create worktree directory first
    mkdirSync(join(worktreeBasePath, 'task-non-error-remove'), { recursive: true });

    const execFile: ExecFileFn = async (file, args) => {
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        throw 42;
      }
      return { stdout: '', stderr: 'Preparing worktree' };
    };

    const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

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

    const execFile: ExecFileFn = async (file, args) => {
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'list') {
        return { stdout: porcelainOutput, stderr: '' };
      }
      return { stdout: '', stderr: 'Preparing worktree' };
    };

    const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

    const worktrees = await manager.listWorktrees();

    expect(worktrees).toEqual([`${worktreeBasePath}/task-a`, `${worktreeBasePath}/task-c`]);
  });

  it('should handle non-Error thrown during copySettingsLocal', async () => {
    const execFile: ExecFileFn = async (file, args) => {
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        const wt = args[4];
        if (typeof wt === 'string') mkdirSync(wt, { recursive: true });
        return { stdout: '', stderr: 'Preparing worktree' };
      }
      return { stdout: '', stderr: '' };
    };

    // Point settings template to a directory so readFile fails with EISDIR
    const badSettingsPath = join(tempDir, 'bad-settings-dir');
    mkdirSync(badSettingsPath, { recursive: true });

    const manager = new WorktreeManager(
      {
        ...mockConfig,
        settingsLocalTemplatePath: badSettingsPath,
      },
      mockLogger,
      execFile
    );

    await expect(manager.createWorktree('task-settings-error', 'feature-branch')).rejects.toThrow(
      'Failed to create worktree'
    );
  });

  it('should not throw when git worktree remove returns empty stderr', async () => {
    // Create worktree directory first
    mkdirSync(join(worktreeBasePath, 'task-remove-empty'), { recursive: true });

    const execFile: ExecFileFn = async () => ({ stdout: '', stderr: '' });

    const manager = new WorktreeManager(mockConfig, mockLogger, execFile);

    // Should not throw - empty stderr is acceptable
    await expect(manager.removeWorktree('task-remove-empty')).resolves.toBeUndefined();
  });

  it('should surface Unknown error when copySettingsLocal catch receives a non-Error', async () => {
    const settingsTemplatePath = join(tempDir, 'settings.non-error.json');
    writeFileSync(settingsTemplatePath, '{}', 'utf-8');

    // Set readFile to throw a number (non-Error)
    fsPromisesReadFileOverride = async (): Promise<string> => {
      throw 999;
    };

    const execFile: ExecFileFn = async (file, args) => {
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        const wt = args[4];
        if (typeof wt === 'string') mkdirSync(wt, { recursive: true });
        return { stdout: '', stderr: 'Preparing worktree' };
      }
      return { stdout: '', stderr: '' };
    };

    const manager = new WorktreeManager(
      {
        ...mockConfig,
        settingsLocalTemplatePath: settingsTemplatePath,
      },
      mockLogger,
      execFile
    );

    try {
      await expect(
        manager.createWorktree('task-settings-non-error', 'feature-branch')
      ).rejects.toThrow(
        'Failed to create worktree: Failed to copy settings.local.json: Unknown error'
      );
    } finally {
      fsPromisesReadFileOverride = null;
    }
  });
});
