import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Logger } from 'pino';

// Track command execution for test assertions
let gitRemoveCalls: { cmd: string; args: string[] }[] = [];
let rmCalls: string[] = [];
let throwOnExecFile = false;
let execFileError: Error | string | null = null;
let execFileStderr = '';

// Mock node:fs/promises and node:fs
vi.mock('node:fs/promises');
vi.mock('node:fs');

// Mock node:util with an inline implementation for execFile
vi.mock('node:util', () => ({
  promisify: vi.fn((_fn: unknown) => {
    // Return a mock for execFile that tracks calls
    return async (
      cmd: string,
      args: string[],
      _options: { cwd?: string }
    ): Promise<{ stdout: string; stderr: string }> => {
      gitRemoveCalls.push({ cmd, args });
      if (throwOnExecFile && execFileError !== null) {
        throw execFileError;
      }
      if (cmd === 'git' && args[0] === 'worktree') {
        return { stdout: '', stderr: execFileStderr };
      }
      return { stdout: '', stderr: '' };
    };
  }),
}));

// Import after mocks are set up
import { readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cleanupStaleWorktrees } from '../worktree-cleanup.js';

function createFakeLogger(calls: { level: string; data: unknown }[]): Logger {
  return {
    info: (msgOrObj: unknown) => calls.push({ level: 'info', data: msgOrObj }),
    warn: (msgOrObj: unknown) => calls.push({ level: 'warn', data: msgOrObj }),
    error: (msgOrObj: unknown) => calls.push({ level: 'error', data: msgOrObj }),
    debug: (msgOrObj: unknown) => calls.push({ level: 'debug', data: msgOrObj }),
  } as unknown as Logger;
}

describe('worktree-cleanup', () => {
  let logger: Logger;
  let loggerCalls: { level: string; data: unknown }[];
  let repoPath: string;
  let worktreeBasePath: string;

  beforeEach(() => {
    loggerCalls = [];
    repoPath = '/path/to/repo';
    worktreeBasePath = '/path/to/worktrees';

    vi.clearAllMocks();
    gitRemoveCalls = [];
    rmCalls = [];
    throwOnExecFile = false;
    execFileError = null;
    execFileStderr = '';

    // Mock rm to track calls
    vi.mocked(rm).mockImplementation(async (path: Parameters<typeof rm>[0]) => {
      rmCalls.push(String(path));
    });

    // Create fresh logger for each test
    logger = createFakeLogger(loggerCalls);
  });

  it('should return empty result when worktree base path does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should return empty result when no worktrees exist', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue([]);

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(0);
    expect(result.removed).toBe(0);
  });

  it('should skip fresh worktrees', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue(['fresh-task']);
    vi.mocked(stat).mockResolvedValue({
      mtime: new Date(), // Now - fresh
    } as unknown as ReturnType<typeof stat>);

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(1);
    expect(result.removed).toBe(0);
  });

  it('should remove stale worktrees', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue(['stale-task']);
    // 25 hours ago - stale
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    vi.mocked(stat).mockResolvedValue({
      mtime: staleDate,
    } as unknown as ReturnType<typeof stat>);

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(1);
    expect(result.removed).toBe(1);
  });

  it('should use custom stale age threshold', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue(['task-1']);
    // 2 hours ago - stale for 1 hour threshold
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    vi.mocked(stat).mockResolvedValue({
      mtime: twoHoursAgo,
    } as unknown as ReturnType<typeof stat>);

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 1, // 1 hour threshold
      },
      logger
    );

    expect(result.total).toBe(1);
    expect(result.removed).toBe(1);
  });

  it('should use default 24 hour threshold when staleAgeHours not provided', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue(['task-1']);
    // 25 hours ago - stale for default 24 hour threshold
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    vi.mocked(stat).mockResolvedValue({
      mtime: twentyFiveHoursAgo,
    } as unknown as ReturnType<typeof stat>);

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        // staleAgeHours not provided - should default to 24
      },
      logger
    );

    expect(result.total).toBe(1);
    expect(result.removed).toBe(1);
  });

  it('should handle readdir errors gracefully', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockRejectedValue(new Error('Permission denied'));

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(0);
    expect(result.removed).toBe(0);
    expect(loggerCalls.filter((c) => c.level === 'error').length).toBeGreaterThan(0);
  });

  it('should handle non-Error objects in readdir catch', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    // Throw a string instead of Error to test the non-Error branch
    vi.mocked(readdir).mockRejectedValue('string error');

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(0);
    expect(result.removed).toBe(0);
    expect(loggerCalls.filter((c) => c.level === 'error').length).toBeGreaterThan(0);
    const errorCall = loggerCalls.find((c) => c.level === 'error');
    expect(errorCall?.data).toHaveProperty('error', 'string error');
  });

  it('should fall back to manual removal when git worktree remove fails with stderr', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue(['stale-task']);
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    vi.mocked(stat).mockResolvedValue({
      mtime: staleDate,
    } as unknown as ReturnType<typeof stat>);

    // Set stderr to trigger manual removal
    execFileStderr = 'Failed to remove worktree';

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(1);
    expect(result.removed).toBe(1);
    expect(rmCalls.length).toBeGreaterThan(0);
    expect(loggerCalls.filter((c) => c.level === 'warn').length).toBeGreaterThan(0);
    const warnCall = loggerCalls.find((c) => c.level === 'warn');
    expect(warnCall?.data).toHaveProperty('stderr', 'Failed to remove worktree');
  });

  it('should not fall back to manual removal when stderr contains "not a valid worktree"', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue(['invalid-task']);
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    vi.mocked(stat).mockResolvedValue({
      mtime: staleDate,
    } as unknown as ReturnType<typeof stat>);

    // Set stderr to "not a valid worktree" - should NOT fall back to manual removal
    execFileStderr = 'not a valid worktree';

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(1);
    expect(result.removed).toBe(1);
    expect(rmCalls.length).toBe(0);
    expect(loggerCalls.filter((c) => c.level === 'warn').length).toBe(0);
  });

  it('should handle removal errors gracefully and add to errors list', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue(['error-task']);
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    vi.mocked(stat).mockResolvedValue({
      mtime: staleDate,
    } as unknown as ReturnType<typeof stat>);

    // Set error to throw
    throwOnExecFile = true;
    execFileError = new Error('Git command failed');

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toContain('error-task');
    expect(result.errors[0]?.error).toBe('Git command failed');
    expect(loggerCalls.filter((c) => c.level === 'error').length).toBeGreaterThan(0);
  });

  it('should handle non-Error objects in removal catch', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue(['error-task']);
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    vi.mocked(stat).mockResolvedValue({
      mtime: staleDate,
    } as unknown as ReturnType<typeof stat>);

    // Set non-Error to throw
    throwOnExecFile = true;
    execFileError = 'string error';

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toBe('string error');
    expect(loggerCalls.filter((c) => c.level === 'error').length).toBeGreaterThan(0);
  });

  it('should handle multiple worktrees with mixed states', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdir).mockResolvedValue(['fresh-task', 'stale-task-1', 'stale-task-2']);

    let callCount = 0;
    vi.mocked(stat).mockImplementation(async () => {
      callCount++;
      // First call: fresh-task, Second: stale-task-1, Third: stale-task-2
      if (callCount === 1) {
        return { mtime: new Date() } as unknown as ReturnType<typeof stat>;
      }
      return { mtime: new Date(Date.now() - 25 * 60 * 60 * 1000) } as unknown as ReturnType<
        typeof stat
      >;
    });

    const result = await cleanupStaleWorktrees(
      {
        repositoryPath: repoPath,
        worktreeBasePath,
        staleAgeHours: 24,
      },
      logger
    );

    expect(result.total).toBe(3);
    expect(result.removed).toBe(2); // Only stale tasks removed
  });
});
