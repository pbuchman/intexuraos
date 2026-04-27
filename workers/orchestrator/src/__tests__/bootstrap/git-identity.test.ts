import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockExecFileSync } = vi.hoisted(() => ({ mockExecFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { readHostGitConfig, readRepoGitConfig } from '../../bootstrap/git-identity.js';

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
});
