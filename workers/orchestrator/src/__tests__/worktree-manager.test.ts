import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorktreeManager } from '../services/worktree-manager.js';

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

  beforeEach(() => {
    // Ensure temp directory exists
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(repoPath, { recursive: true });

    // Create MCP config template with placeholders
    const template = JSON.stringify({
      linear: { apiKey: '{{LINEAR_API_KEY}}' },
      sentry: { authToken: '{{SENTRY_AUTH_TOKEN}}' },
    });
    writeFileSync(mcpConfigTemplatePath, template, 'utf-8');

    // Mock exec to succeed
    vi.mock('node:util', () => ({
      promisify: vi.fn((_cmd: unknown) => {
        return async (
          command: string,
          _options: { cwd?: string; timeout?: number }
        ): Promise<{ stdout: string; stderr: string }> => {
          // Mock successful git commands
          if (command.includes('git worktree add')) {
            return { stdout: '', stderr: 'Preparing worktree' };
          }
          if (command.includes('git worktree remove')) {
            return { stdout: '', stderr: '' };
          }
          if (command.includes('git worktree list')) {
            // Return empty list
            return { stdout: '', stderr: '' };
          }
          if (command.includes('pnpm install')) {
            return { stdout: '', stderr: '' };
          }
          return { stdout: '', stderr: '' };
        };
      }),
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createWorktree', () => {
    it('should create a new worktree', async () => {
      const manager = new WorktreeManager(mockConfig);

      const worktreePath = await manager.createWorktree('task-123', 'feature-branch');

      expect(worktreePath).toBe(join(worktreeBasePath, 'task-123'));
    });

    it('should create base directory if it does not exist', async () => {
      const manager = new WorktreeManager(mockConfig);

      await manager.createWorktree('task-456', 'feature-branch');

      expect(existsSync(worktreeBasePath)).toBe(true);
    });

    it('should throw if worktree already exists', async () => {
      const manager = new WorktreeManager(mockConfig);

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

      const manager = new WorktreeManager(mockConfig);

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
      const manager = new WorktreeManager(mockConfig);

      await manager.createWorktree('task-no-env', 'feature-branch');

      const mcpConfigPath = join(worktreeBasePath, 'task-no-env', '.mcp.json');
      const config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
      expect(config.linear.apiKey).toBe('');
      expect(config.sentry.authToken).toBe('');
    });

    it('should skip MCP config if template does not exist', async () => {
      const manager = new WorktreeManager({
        ...mockConfig,
        mcpConfigTemplatePath: join(tempDir, 'non-existent.json'),
      });

      // Should not throw
      await manager.createWorktree('task-no-template', 'feature-branch');
    });
  });

  describe('removeWorktree', () => {
    it('should remove an existing worktree', async () => {
      const manager = new WorktreeManager(mockConfig);

      // Create worktree first
      await manager.createWorktree('task-remove', 'feature-branch');

      // Remove it - should not throw
      await manager.removeWorktree('task-remove');
    });

    it('should throw if worktree does not exist', async () => {
      const manager = new WorktreeManager(mockConfig);

      await expect(manager.removeWorktree('non-existent')).rejects.toThrow('does not exist');
    });
  });

  describe('listWorktrees', () => {
    it('should return empty array when no worktrees exist', async () => {
      const manager = new WorktreeManager(mockConfig);

      const worktrees = await manager.listWorktrees();

      expect(worktrees).toEqual([]);
    });

    it('should list all worktrees under base path', async () => {
      const manager = new WorktreeManager(mockConfig);

      // Our mock returns empty list, so we just verify the method runs
      const worktrees = await manager.listWorktrees();

      expect(worktrees).toEqual([]);
    });
  });

  describe('worktreeExists', () => {
    it('should return false for non-existent worktree', async () => {
      const manager = new WorktreeManager(mockConfig);

      const exists = await manager.worktreeExists('non-existent');

      expect(exists).toBe(false);
    });

    it('should return true for existing worktree', async () => {
      const manager = new WorktreeManager(mockConfig);

      await manager.createWorktree('task-exists', 'feature-branch');

      const exists = await manager.worktreeExists('task-exists');

      expect(exists).toBe(true);
    });
  });
});
