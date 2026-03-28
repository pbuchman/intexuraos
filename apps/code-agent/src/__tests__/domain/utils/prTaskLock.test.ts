/**
 * Tests for domain/utils/prTaskLock.ts
 *
 * Tests the PR task lock utility functions:
 * - buildLockDocPath: formats Firestore document path from repository/prNumber
 * - deletePRTaskLock: best-effort lock deletion with logging
 */

import { describe, it, expect, vi } from 'vitest';
import { buildLockCleanups, buildLockDocPath, deletePRTaskLock } from '../../../domain/utils/prTaskLock.js';
import type { Logger } from '@intexuraos/common-core';

describe('buildLockDocPath', () => {
  it('formats path correctly with slash in repository name', () => {
    const result = buildLockDocPath('org/repo', 42);

    expect(result).toBe('pr_task_locks/org_repo_42');
  });

  it('formats path correctly with multiple slashes', () => {
    const result = buildLockDocPath('org/sub/repo', 1);

    expect(result).toBe('pr_task_locks/org_sub_repo_1');
  });

  it('formats path correctly with no slashes', () => {
    const result = buildLockDocPath('monorepo', 5);

    expect(result).toBe('pr_task_locks/monorepo_5');
  });
});

describe('deletePRTaskLock', () => {
  it('deletes the lock document and logs info', async () => {
    const mockDeleteFn = vi.fn().mockResolvedValue(undefined);
    const mockFirestore = {
      doc: vi.fn().mockReturnValue({ delete: mockDeleteFn }),
    };
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    await deletePRTaskLock(mockFirestore, 'org/repo', 42, mockLogger);

    expect(mockFirestore.doc).toHaveBeenCalledWith('pr_task_locks/org_repo_42');
    expect(mockDeleteFn).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        lockDocPath: 'pr_task_locks/org_repo_42',
        repository: 'org/repo',
        prNumber: 42,
      }),
      'Deleted PR task lock'
    );
  });

  it('logs warning on delete failure without throwing', async () => {
    const deleteError = new Error('Firestore delete failed');
    const mockDeleteFn = vi.fn().mockRejectedValue(deleteError);
    const mockFirestore = {
      doc: vi.fn().mockReturnValue({ delete: mockDeleteFn }),
    };
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    // Should not throw
    await deletePRTaskLock(mockFirestore, 'org/repo', 42, mockLogger);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        lockDocPath: 'pr_task_locks/org_repo_42',
        error: deleteError,
      }),
      'Failed to delete PR task lock (best-effort)'
    );
    // info should NOT have been called since delete failed
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('uses correct document path for multi-slash repository', async () => {
    const mockDeleteFn = vi.fn().mockResolvedValue(undefined);
    const mockFirestore = {
      doc: vi.fn().mockReturnValue({ delete: mockDeleteFn }),
    };
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;

    await deletePRTaskLock(mockFirestore, 'pbuchman/intexuraos', 997, mockLogger);

    expect(mockFirestore.doc).toHaveBeenCalledWith('pr_task_locks/pbuchman_intexuraos_997');
    expect(mockDeleteFn).toHaveBeenCalled();
  });
});

describe('buildLockCleanups', () => {
  it('returns cleanup for original PR task', () => {
    expect(buildLockCleanups({
      repository: 'org/repo',
      prNumber: 42,
    })).toEqual([{ repository: 'org/repo', prNumber: 42 }]);
  });

  it('does not return cleanup for merge-conflict follow-up task', () => {
    expect(buildLockCleanups({
      repository: 'org/repo',
      prNumber: 42,
      parentTaskId: 'task-parent',
      followUpReason: 'merge_conflict',
    })).toEqual([]);
  });

  it('does not return cleanup for legacy merge-conflict task identified by system prompt hash', () => {
    expect(buildLockCleanups({
      repository: 'org/repo',
      prNumber: 42,
      systemPromptHash: 'pr-merge-conflict-auto',
    })).toEqual([]);
  });
});
