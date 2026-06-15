import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockExecFileSync } = vi.hoisted(() => ({ mockExecFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import {
  readHostGitConfig,
  readRepoGitConfig,
  setRepoGitConfig,
  reconcileRepoGitIdentity,
} from '../../bootstrap/git-identity.js';

describe('git-identity', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('readHostGitConfig passes key as literal argv element', () => {
    mockExecFileSync.mockReturnValue('Alice\n');
    expect(readHostGitConfig('user.name')).toBe('Alice');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['config', 'user.name'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('readHostGitConfig returns undefined when execFileSync throws', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('git not found');
    });
    expect(readHostGitConfig('user.name')).toBeUndefined();
  });

  it('readHostGitConfig returns undefined when value trims to empty', () => {
    mockExecFileSync.mockReturnValue('   \n');
    expect(readHostGitConfig('user.name')).toBeUndefined();
  });

  it('readRepoGitConfig passes repoPath and key as literal argv elements (no shell)', () => {
    mockExecFileSync.mockReturnValue('alice@example.com\n');
    expect(readRepoGitConfig('/repo', 'user.email')).toBe('alice@example.com');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['-C', '/repo', 'config', '--local', 'user.email'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('readRepoGitConfig rejects relative repoPath (defense-in-depth)', () => {
    expect(readRepoGitConfig('../etc/passwd', 'user.email')).toBeUndefined();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('readRepoGitConfig returns undefined when value trims to empty', () => {
    mockExecFileSync.mockReturnValue('\n');
    expect(readRepoGitConfig('/repo', 'user.email')).toBeUndefined();
  });

  it('readRepoGitConfig passes a key containing shell metacharacters as literal argv', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('unknown config key');
    });
    expect(readRepoGitConfig('/repo', 'user.name; rm -rf /')).toBeUndefined();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['-C', '/repo', 'config', '--local', 'user.name; rm -rf /'],
      expect.any(Object)
    );
  });

  it('setRepoGitConfig writes repo-local config via argv form', () => {
    expect(setRepoGitConfig('/repo', 'user.name', 'Worker Bot')).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['-C', '/repo', 'config', '--local', 'user.name', 'Worker Bot'],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('setRepoGitConfig rejects relative repoPath', () => {
    expect(setRepoGitConfig('../repo', 'user.email', 'worker@example.com')).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('reconcileRepoGitIdentity sets repo-local identity to resolved worker identity', () => {
    mockExecFileSync.mockReturnValue('');

    const result = reconcileRepoGitIdentity('/repo', {
      gitUserName: 'Worker Bot',
      gitUserEmail: 'worker@example.com',
    });

    expect(result).toEqual({
      appliedName: true,
      appliedEmail: true,
      effectiveName: 'Worker Bot',
      effectiveEmail: 'worker@example.com',
    });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['-C', '/repo', 'config', '--local', 'user.name', 'Worker Bot'],
      expect.any(Object)
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['-C', '/repo', 'config', '--local', 'user.email', 'worker@example.com'],
      expect.any(Object)
    );
  });

  it('reconcileRepoGitIdentity keeps existing repo-local identity when no worker identity resolved', () => {
    mockExecFileSync.mockReturnValueOnce('Local User\n').mockReturnValueOnce('local@example.com\n');

    const result = reconcileRepoGitIdentity('/repo', {
      gitUserName: undefined,
      gitUserEmail: undefined,
    });

    expect(result).toEqual({
      repoUserName: 'Local User',
      repoUserEmail: 'local@example.com',
      appliedName: false,
      appliedEmail: false,
      effectiveName: 'Local User',
      effectiveEmail: 'local@example.com',
    });
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'git',
      ['-C', '/repo', 'config', '--local', 'user.name'],
      expect.any(Object)
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'git',
      ['-C', '/repo', 'config', '--local', 'user.email'],
      expect.any(Object)
    );
  });

  it('reconcileRepoGitIdentity reports repo-local value as effective when a write fails', () => {
    mockExecFileSync
      .mockReturnValueOnce('Old User\n')
      .mockReturnValueOnce('old@example.com\n')
      .mockImplementationOnce(() => {
        throw new Error('cannot write name');
      })
      .mockReturnValueOnce('');

    const result = reconcileRepoGitIdentity('/repo', {
      gitUserName: 'Worker Bot',
      gitUserEmail: 'worker@example.com',
    });

    expect(result).toEqual({
      repoUserName: 'Old User',
      repoUserEmail: 'old@example.com',
      appliedName: false,
      appliedEmail: true,
      effectiveName: 'Old User',
      effectiveEmail: 'worker@example.com',
    });
  });
});
