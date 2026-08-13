import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DockerVolume, type DockerVolumeConfig } from '../docker-volume.js';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  return {
    ...actual,
    userInfo: vi.fn().mockReturnValue({
      uid,
      gid,
      username: 'testuser',
      homedir: `/home/testuser`,
      shell: '/bin/bash',
    }),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue(['system-prompt.txt', 'user-prompt.txt', 'github-token']),
      writeFile: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    },
  };
});

interface MockDocker {
  createVolume: ReturnType<typeof vi.fn>;
  getVolume: ReturnType<typeof vi.fn>;
}

function createMockDocker(): MockDocker {
  return {
    createVolume: vi.fn().mockResolvedValue({
      Mountpoint: '/var/lib/docker/volumes/foo/_data',
    }),
    getVolume: vi.fn().mockReturnValue({
      remove: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

const createMockLogger = (): Logger => ({
  info: vi.fn() as unknown as Logger['info'],
  warn: vi.fn() as unknown as Logger['warn'],
  error: vi.fn() as unknown as Logger['error'],
  debug: vi.fn() as unknown as Logger['debug'],
});

function makeVolume(
  mockDocker: MockDocker,
  overrides: Partial<DockerVolumeConfig> = {}
): DockerVolume {
  const config: DockerVolumeConfig = {
    secretsBasePath: '/tmp/claude-secrets',
    forensicsMode: false,
    forensicsBasePath: '/tmp/forensics',
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new DockerVolume(() => mockDocker as any, createMockLogger(), config);
}

describe('DockerVolume', () => {
  let mockDocker: MockDocker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocker = createMockDocker();
  });

  it('createVolume creates a named Docker volume and returns mount point', async () => {
    const volume = makeVolume(mockDocker);
    const result = await volume.createVolume('foo');

    expect(mockDocker.createVolume).toHaveBeenCalledWith(expect.objectContaining({ Name: 'foo' }));
    expect(result).toEqual({
      name: 'foo',
      mountPoint: '/var/lib/docker/volumes/foo/_data',
    });
  });

  it('createVolume falls back to default mount path when Mountpoint missing', async () => {
    mockDocker.createVolume.mockResolvedValueOnce({});
    const volume = makeVolume(mockDocker);
    const result = await volume.createVolume('bar');

    expect(result.mountPoint).toBe('/var/lib/docker/volumes/bar/_data');
  });

  it('createVolume forwards labels to docker.createVolume when provided', async () => {
    const volume = makeVolume(mockDocker);
    await volume.createVolume('foo', { labels: { env: 'test' } });
    expect(mockDocker.createVolume).toHaveBeenCalledWith(
      expect.objectContaining({ Name: 'foo', Labels: { env: 'test' } })
    );
  });

  it('removeVolume defaults force to false when no opts given', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mockDocker.getVolume.mockReturnValueOnce({ remove });
    const volume = makeVolume(mockDocker);
    await volume.removeVolume('bar');
    expect(remove).toHaveBeenCalledWith({ force: false });
  });

  it('removeVolume delegates to docker.getVolume().remove', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mockDocker.getVolume.mockReturnValueOnce({ remove });
    const volume = makeVolume(mockDocker);
    await volume.removeVolume('foo', { force: true });

    expect(mockDocker.getVolume).toHaveBeenCalledWith('foo');
    expect(remove).toHaveBeenCalledWith({ force: true });
  });

  it('getTaskSecretsPath returns secrets path joined with taskId', () => {
    const volume = makeVolume(mockDocker);
    expect(volume.getTaskSecretsPath('task-1')).toBe('/tmp/claude-secrets/task-1');
  });

  it('creates the task forensics directory with private permissions', () => {
    const volume = makeVolume(mockDocker, { forensicsMode: true });

    expect(volume.ensureTaskForensicsPath('task-private')).toBe('/tmp/forensics/task-private');
    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/forensics/task-private', {
      mode: 0o700,
      recursive: true,
    });
    expect(fs.chmodSync).toHaveBeenCalledWith('/tmp/forensics/task-private', 0o700);
  });

  it('returns claude-session prefix for claude runtime and codex-state for codex', () => {
    const volume = makeVolume(mockDocker);
    expect(volume.getTaskRuntimeHomePath('t', 'claude')).toBe(
      '/tmp/claude-secrets/claude-session-t'
    );
    expect(volume.getTaskRuntimeHomePath('t', 'codex')).toBe('/tmp/claude-secrets/codex-state-t');
  });

  it('getContainerRuntimeHome returns /home/claude/.codex or /home/claude/.claude', () => {
    const volume = makeVolume(mockDocker);
    expect(volume.getContainerRuntimeHome('codex')).toBe('/home/claude/.codex');
    expect(volume.getContainerRuntimeHome('claude')).toBe('/home/claude/.claude');
  });

  it('getPnpmStorePath is sibling of secretsBasePath', () => {
    const volume = makeVolume(mockDocker);
    expect(volume.getPnpmStorePath()).toBe(path.join('/tmp', 'pnpm-store'));
  });

  it('binds package-manager caches outside the /home/claude tmpfs', () => {
    const volume = makeVolume(mockDocker);
    const binds = volume.buildBinds({
      worktreePath: '/worktree',
      taskSecretsPath: '/tmp/claude-secrets/task-1',
      pnpmStorePath: '/tmp/pnpm-store',
      taskRuntimeHomePath: '/tmp/claude-secrets/codex-state-task-1',
      containerRuntimeHome: '/home/claude/.codex',
      mainGitDir: null,
      useSharedCreds: false,
      useSharedCodexAuth: false,
      taskForensicsPath: null,
    });

    expect(binds).toContain('/tmp/pnpm-store:/home/claude/pnpm-store:rw');
    expect(binds).toContain('/tmp/pnpm-store/cache/pnpm:/home/claude/.cache/pnpm:rw');
    expect(binds).toContain('/tmp/pnpm-store/cache/corepack:/home/claude/.cache/node/corepack:rw');
  });

  it('buildTmpfs keeps exec on /repo/node_modules — required by pnpm .bin shims (INT-1524)', () => {
    const volume = makeVolume(mockDocker);
    const tmpfs = volume.buildTmpfs();
    // /repo/node_modules MUST stay rw,exec because pnpm-installed .bin/ shims
    // are POSIX scripts. Switching to noexec breaks pnpm test/lint/build runs.
    // Defense-in-depth against malicious lifecycle scripts is provided by
    // ignore-scripts=true (see docker/code-worker/.npmrc and worker-env.ts).
    expect(tmpfs['/repo/node_modules']).toContain('exec');
    expect(tmpfs['/repo/node_modules']).not.toContain('noexec');
    expect(tmpfs['/tmp']).toContain('noexec');
    expect(tmpfs['/home/claude']).toContain('noexec');
  });
});
