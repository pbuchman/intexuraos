import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { StatePersistence } from '../services/state-persistence.js';
import type { OrchestratorState } from '../types/index.js';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

// Create mock for exec with promisify.custom support using vi.hoisted
// to ensure these are available when the hoisted vi.mock runs
// Use Symbol.for directly since promisify.custom is just a well-known symbol
const { mockExecPromisified, mockExec } = vi.hoisted(() => {
  const mockExecPromisified = vi.fn();
  const mockExec = vi.fn() as ReturnType<typeof vi.fn> & Record<symbol, ReturnType<typeof vi.fn>>;
  mockExec[Symbol.for('nodejs.util.promisify.custom')] = mockExecPromisified;
  return { mockExecPromisified, mockExec };
});

// Mock child_process exec
vi.mock('node:child_process', () => ({
  exec: mockExec,
}));

const mockExecWithOutput = (stdout: string): void => {
  mockExecPromisified.mockResolvedValue({ stdout, stderr: '' });
};

const mockExecWithError = (error: Error): void => {
  mockExecPromisified.mockRejectedValue(error);
};

describe('StatePersistence', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
  const stateFilePath = join(tempDir, 'state.json');

  const mockState: OrchestratorState = {
    tasks: {
      'task-1': {
        taskId: 'task-1',
        workerType: 'opus',
        prompt: 'Test prompt',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running',
        tmuxSession: 'session-1',
        worktreePath: '/path/to/worktree',
        startedAt: new Date().toISOString(),
      },
    },
    githubToken: {
      token: 'ghp_test_token',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    pendingWebhooks: [],
  };

  afterEach(() => {
    // Clean up temp directory after each test
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('load/save roundtrip', () => {
    it('should save and load state correctly', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      await persistence.save(mockState);
      const loaded = await persistence.load();

      expect(loaded).toEqual(mockState);
    });

    it('should return empty state if file does not exist', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      const loaded = await persistence.load();

      expect(loaded).toEqual({
        tasks: {},
        githubToken: null,
        pendingWebhooks: [],
      });
    });
  });

  describe('atomic writes', () => {
    it('should write to temp file then rename', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      await persistence.saveAtomic(mockState);

      // Final file should exist
      expect(existsSync(stateFilePath)).toBe(true);

      // Temp file should be cleaned up
      expect(existsSync(`${stateFilePath}.tmp`)).toBe(false);

      // Content should match
      const content = readFileSync(stateFilePath, 'utf-8');
      const parsed = JSON.parse(content) as OrchestratorState;
      expect(parsed).toEqual(mockState);
    });

    it('should overwrite existing state atomically', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      // Save initial state
      await persistence.save(mockState);

      // Save updated state
      const updatedState: OrchestratorState = {
        ...mockState,
        tasks: {
          'task-2': {
            taskId: 'task-2',
            workerType: 'opus',
            prompt: 'Test prompt 2',
            repository: 'https://github.com/test/repo',
            baseBranch: 'main',
            webhookUrl: 'https://example.com/webhook',
            webhookSecret: 'secret2',
            status: 'queued',
            tmuxSession: 'session2',
            worktreePath: '/tmp/session2',
            startedAt: new Date().toISOString(),
          },
        },
      };
      await persistence.save(updatedState);

      // Load and verify
      const loaded = await persistence.load();
      expect(loaded).toEqual(updatedState);
    });
  });

  describe('corruption recovery', () => {
    it('should backup corrupted file and return empty state', async () => {
      // Create corrupted JSON file in temp directory
      const corruptedDir = join(tempDir, 'corrupted-test');
      const corruptedPath = join(corruptedDir, 'state.json');

      // Create directory first
      const { mkdir } = await import('node:fs/promises');
      await mkdir(corruptedDir, { recursive: true });

      // Write invalid JSON
      const { writeFile } = await import('node:fs/promises');
      await writeFile(corruptedPath, '{ invalid json', 'utf-8');

      const corruptPersistence = new StatePersistence(corruptedPath, mockLogger);

      // Load should recover
      const loaded = await corruptPersistence.load();

      expect(loaded).toEqual({
        tasks: {},
        githubToken: null,
        pendingWebhooks: [],
      });

      // Corrupted file should be backed up
      expect(existsSync(corruptedPath)).toBe(false);

      // Check for backup file
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(corruptedDir);
      const backupFiles = files.filter((f) => f.includes('.corrupted.'));
      expect(backupFiles.length).toBeGreaterThan(0);
    });

    it('should handle valid JSON but wrong structure gracefully', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      // Create directory first (afterEach might have cleaned it up)
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dirname(stateFilePath), { recursive: true });

      // Write valid JSON but wrong structure
      const { writeFile } = await import('node:fs/promises');
      await writeFile(stateFilePath, '{"wrong": "structure"}', 'utf-8');

      // Should parse but won't match expected structure
      const loaded = await persistence.load();
      // TypeScript allows this but runtime will have the wrong shape
      expect(loaded).toEqual({ wrong: 'structure' });
    });
  });

  describe('directory creation', () => {
    it('should create directory if it does not exist', async () => {
      const nestedPath = join(tempDir, 'nested', 'dir', 'state.json');
      const persistence = new StatePersistence(nestedPath, mockLogger);

      await persistence.save(mockState);

      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw non-SyntaxError errors', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      // Create a directory at the state file path to cause an EISDIR error
      const { mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(stateFilePath), { recursive: true });
      await mkdir(stateFilePath, { recursive: true });

      // Trying to read a directory as a file will throw an error (not SyntaxError)
      await expect(persistence.load()).rejects.toThrow();
    });
  });

  describe('detectOrphanWorktrees', () => {
    beforeEach(() => {
      mockExecPromisified.mockClear();
    });

    it('should return orphan worktrees not in active state', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      // Save state with one active task
      const task1 = mockState.tasks['task-1'];
      if (!task1) throw new Error('mockState.tasks["task-1"] should exist');
      await persistence.save({
        ...mockState,
        tasks: {
          'task-1': {
            ...task1,
            worktreePath: '/active/worktree',
          },
        },
      });

      // Mock git worktree list output with multiple worktrees
      mockExecWithOutput(
        'worktree /active/worktree\nworktree /orphan/worktree\nworktree /another/orphan\n'
      );

      const orphans = await persistence.detectOrphanWorktrees('/repo/path');

      expect(orphans).toEqual(['/orphan/worktree', '/another/orphan']);
      expect(mockExecPromisified).toHaveBeenCalledWith('git worktree list --porcelain', {
        cwd: '/repo/path',
      });
    });

    it('should return empty array when all worktrees are active', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      // Save state with two active tasks
      const task1 = mockState.tasks['task-1'];
      if (!task1) throw new Error('mockState.tasks["task-1"] should exist');
      await persistence.save({
        ...mockState,
        tasks: {
          'task-1': {
            ...task1,
            worktreePath: '/active/one',
          },
          'task-2': {
            taskId: 'task-2',
            workerType: 'opus',
            prompt: 'Test',
            repository: 'test/repo',
            baseBranch: 'main',
            webhookUrl: 'https://example.com',
            webhookSecret: 'secret',
            status: 'running',
            tmuxSession: 'session-2',
            worktreePath: '/active/two',
            startedAt: new Date().toISOString(),
          },
        },
      });

      mockExecWithOutput('worktree /active/one\nworktree /active/two\n');

      const orphans = await persistence.detectOrphanWorktrees('/repo/path');

      expect(orphans).toEqual([]);
    });

    it('should return empty array when no worktrees exist', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);
      await persistence.save(mockState);

      mockExecWithOutput('');

      const orphans = await persistence.detectOrphanWorktrees('/repo/path');

      expect(orphans).toEqual([]);
    });

    it('should return empty array and log error when git command fails', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);
      const errorSpy = vi.spyOn(mockLogger, 'error');

      mockExecWithError(new Error('Git command failed'));

      const orphans = await persistence.detectOrphanWorktrees('/repo/path');

      expect(orphans).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Failed to detect orphan worktrees'
      );
    });

    it('should parse worktree list with porcelain format correctly', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      // Save empty state
      await persistence.save({
        tasks: {},
        githubToken: null,
        pendingWebhooks: [],
      });

      // Porcelain format has additional metadata lines
      mockExecWithOutput(
        'worktree /path/one\nHEAD abcd123\nbranch refs/heads/main\nworktree /path/two\nHEAD dcba456\ndetached\n'
      );

      const orphans = await persistence.detectOrphanWorktrees('/repo/path');

      expect(orphans).toEqual(['/path/one', '/path/two']);
    });

    it('should handle worktree paths with spaces', async () => {
      const persistence = new StatePersistence(stateFilePath, mockLogger);

      await persistence.save({
        tasks: {},
        githubToken: null,
        pendingWebhooks: [],
      });

      mockExecWithOutput('worktree /path with spaces/tree\n');

      const orphans = await persistence.detectOrphanWorktrees('/repo/path');

      expect(orphans).toEqual(['/path with spaces/tree']);
    });
  });
});
